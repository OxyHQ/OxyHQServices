import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, type Plugin } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const emptyModule = resolve(__dirname, './src/empty-module.js')

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
    TanStackRouterVite(),
    tailwindcss(),
    viteReact(),
  ],
  resolve: {
    alias: [
      { find: '@', replacement: resolve(__dirname, './src') },
      // `@oxyhq/bloom` (peer-deps `react-native`) compiles to JS that still
      // imports `react-native` for primitives like `Platform` and
      // `useColorScheme`. On web we route those imports to `react-native-web`,
      // and stub the deep native-only modules that monorepo hoisting can
      // pull in transitively (so Vite never tries to parse Flow-typed code).
      { find: /^react-native\/Libraries\/.*/, replacement: emptyModule },
      { find: 'react-native', replacement: 'react-native-web' },
      { find: 'react-native-svg', replacement: emptyModule },
      { find: 'react-native-screens', replacement: emptyModule },
      { find: 'react-native-safe-area-context', replacement: emptyModule },
      { find: 'react-native-gesture-handler', replacement: emptyModule },
    ],
    extensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
    __APP_NAME__: JSON.stringify(appName),
  },
  optimizeDeps: {
    exclude: ['@oxyhq/auth'],
  },
  build: {
    outDir: 'dist',
  },
})

export default config
