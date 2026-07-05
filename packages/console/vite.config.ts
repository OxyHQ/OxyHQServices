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

// Some files inside the RN packages excluded from the dep optimizer are plain
// CommonJS sitting INSIDE the package's ESM build (react-native-svg ships
// PEG.js-generated parsers as `module.exports = { … }` under `lib/module/`).
// `vite build` interops them via Rollup's CJS handling, but dev serves the
// excluded packages raw, so sibling ESM files' named imports explode with
// `does not provide an export named '…'`. This wraps exactly those files with
// a minimal CJS→ESM interop: run the module body, then re-export the keys of
// the final `module.exports = { … }` object as named exports.
// Census (grep `module.exports` under each excluded package's ESM tree):
// react-native-svg's three PEG.js parsers + @expo/vector-icons' vendored
// object-utils. Reanimated's mock.js and the icon build scripts are never
// imported at runtime.
const RN_CJS_IN_ESM_FILES = new RegExp(
  'node_modules/(?:' +
    'react-native-svg/lib/module/(?:lib|filter-image)/extract/(?:transform|transformToRn|extractFiltersString)' +
    '|@expo/vector-icons/build/vendor/react-native-vector-icons/lib/object-utils' +
    ')\\.js$',
)

const rnCjsInEsmPlugin: Plugin = {
  name: 'oxy-rn-cjs-in-esm',
  enforce: 'pre',
  apply: 'serve',
  transform(code, id) {
    const path = id.split('?')[0]
    if (!RN_CJS_IN_ESM_FILES.test(path)) return null
    const assignment = code.match(/module\.exports\s*=\s*\{([^}]*)\}/)
    if (!assignment) return null
    const keys = assignment[1]
      .split(',')
      .map((entry) => entry.split(':')[0].trim())
      .filter((key) => /^[A-Za-z_$][\w$]*$/.test(key))
    const named = keys
      .map((key) => `export const ${key} = __cjsModule.exports.${key};`)
      .join('\n')
    return {
      code: `const __cjsModule = { exports: {} };\n(function (module, exports) {\n${code}\n})(__cjsModule, __cjsModule.exports);\n${named}\nexport default __cjsModule.exports;\n`,
      map: null,
    }
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
    rnCjsInEsmPlugin,
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
      {
        find: 'react-native-screens',
        replacement: resolve(__dirname, './src/shims/react-native-screens.js'),
      },
      // See src/shims/validate-worklets-version.js — CJS-in-ESM native version
      // handshake that Vite dev cannot interop with reanimated excluded from
      // the optimizer.
      {
        find: 'react-native-reanimated/scripts/validate-worklets-version',
        replacement: resolve(__dirname, './src/shims/validate-worklets-version.js'),
      },
      // react-native-svg asset resolution reaches for RN's Flow-typed CJS asset
      // registry; on web the one true registry is react-native-web's (ESM, same
      // registerAsset/getAssetByID API).
      {
        find: '@react-native/assets-registry/registry',
        replacement: 'react-native-web/dist/modules/AssetRegistry',
      },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    __APP_NAME__: JSON.stringify(appName),
    // React Native modules (gesture-handler's isFabric, and friends) read the
    // RN `global` object, which browsers don't define.
    global: 'globalThis',
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
      '@react-native-community/netinfo',
      'expo-modules-core',
      'sonner-native',
    ],
    // The excluded RN packages above are served raw, so their CommonJS
    // dependencies never get the optimizer's CJS→ESM interop — pre-bundle
    // those explicitly or the browser throws
    // `does not provide an export named 'default'`.
    // `@expo/vector-icons` is pre-bundled (NOT excluded): its icon sets
    // `require()` their .ttf fonts, which only works through the optimizer's
    // CJS handling + the `.ttf` file loader below.
    include: [
      'hoist-non-react-statics',
      'invariant',
      'react-native-is-edge-to-edge',
      '@expo/vector-icons',
    ],
    esbuildOptions: {
      // `dataurl` (not `file`) for fonts: the dependency SCANNER runs esbuild
      // without an output path, and the `file` loader aborts the whole scan
      // ("Cannot use the file loader without an output path"), silently
      // disabling pre-bundling. Dev-only cost: icon fonts inlined as data URLs.
      loader: { '.js': 'jsx', '.ttf': 'dataurl', '.otf': 'dataurl' },
      // Mirror `resolve.extensions`: expo packages ship platform-split files
      // (ExpoFontLoader.web.ts vs .ts); without `.web.*` priority the
      // pre-bundle resolves the native variant and requireNativeModule throws
      // at runtime.
      resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
    },
  },
  build: {
    outDir: 'dist',
  },
})

export default config
