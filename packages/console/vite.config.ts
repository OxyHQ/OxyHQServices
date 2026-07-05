import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const emptyModule = resolve(__dirname, './src/empty-module.js')

// Some React Native community packages pulled in by `@oxyhq/services`' account
// dialog ship untranspiled JSX inside plain `.js` source files (`@expo/vector-icons`
// for MaterialCommunityIcons; `react-native-qrcode-svg` for the QR view).
// esbuild — used both by Vite's dev dependency pre-bundler and by
// `@rollup/plugin-commonjs`'s resolver during `vite build` — does not enable the
// JSX syntax extension for `.js` by default, so those files fail to transform.
// In dev the `optimizeDeps.esbuildOptions.loader` below handles the pre-bundle;
// the production build has no pre-bundle step, so this `enforce: 'pre'` transform
// converts the offending files to valid JS before the commonjs resolver sees them.
const RN_JSX_SOURCE_PACKAGES = ['@expo/vector-icons', 'react-native-qrcode-svg']
const rnJsxSourceRe = new RegExp(
  `node_modules/(?:${RN_JSX_SOURCE_PACKAGES.map((p) => p.replace(/[/\\]/g, '[/\\\\]')).join('|')})/.*\\.js$`,
)

const rnJsxInJsPlugin: Plugin = {
  name: 'oxy-rn-jsx-in-js',
  enforce: 'pre',
  async transform(code, id) {
    // In dev, Vite appends cache-busting query params (`?v=<hash>`, `?import`)
    // to module ids, so match against the path without its query string.
    const path = id.split('?')[0]
    if (!rnJsxSourceRe.test(path)) return null
    const result = await transformWithEsbuild(code, path, {
      loader: 'jsx',
      jsx: 'automatic',
    })
    return { code: result.code, map: result.map }
  },
}

// Single source of truth for the app display name: public/manifest.json
// `short_name`. Read once at config load, then injected both as a global
// constant (__APP_NAME__) for React code and as an `%APP_NAME%` token in
// index.html. The literal app name lives ONLY in manifest.json.
const manifestPath = resolve(__dirname, './public/manifest.json')
const appName = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { short_name: string }).short_name

const appNamePlugin: Plugin = {
  name: 'oxy-app-name',
  transformIndexHtml(html) {
    return html.replaceAll('%APP_NAME%', appName)
  },
}

const config = defineConfig({
  plugins: [
    appNamePlugin,
    rnJsxInJsPlugin,
    TanStackRouterVite(),
    tailwindcss(),
    viteReact(),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      // `@oxyhq/bloom` and `@oxyhq/services` (peer-deps `react-native`) compile
      // to JS that still imports `react-native` for primitives like `Platform`
      // and `useColorScheme`. On web we route those imports to
      // `react-native-web`, and stub the deep native-only modules that monorepo
      // hoisting can pull in transitively (so Vite never tries to parse
      // Flow-typed code).
      //
      // `react-native-gesture-handler`, `react-native-safe-area-context` and
      // `react-native-svg` are NOT stubbed: they ship real web implementations
      // that `OxyProvider` (and its `OxyAccountDialog` QR view) render on web.
      { find: /^react-native\/Libraries\/.*/, replacement: emptyModule },
      { find: 'react-native', replacement: 'react-native-web' },
      { find: 'react-native-screens', replacement: emptyModule },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    __APP_NAME__: JSON.stringify(appName),
  },
  optimizeDeps: {
    // The React Native graph pulled in by `@oxyhq/services` ships native-only
    // spec files (Fabric/TurboModule `specs/Native*.js`, deep
    // `react-native/Libraries/*` re-exports) that `react-native-web` and our
    // empty-module stubs deliberately do not provide. Vite's esbuild dep
    // optimizer pre-bundles a dependency eagerly and treats those missing named
    // exports as HARD errors, whereas the production Rollup build tree-shakes
    // the unused native specs away. Excluding the RN packages from the optimizer
    // serves them through Vite's normal plugin pipeline (import-analysis only
    // warns on the unused native bindings), aligning dev with the passing build.
    exclude: [
      '@oxyhq/services',
      'react-native-reanimated',
      'react-native-gesture-handler',
      'react-native-safe-area-context',
      'react-native-svg',
      'react-native-qrcode-svg',
      '@expo/vector-icons',
      '@react-native-community/netinfo',
      'expo-modules-core',
      'sonner-native',
    ],
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  build: {
    outDir: 'dist',
  },
})

export default config
