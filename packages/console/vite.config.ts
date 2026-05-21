import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

const emptyModule = resolve(__dirname, './src/empty-module.js')

const config = defineConfig({
  plugins: [
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
  },
  optimizeDeps: {
    exclude: ['@oxyhq/auth'],
  },
  build: {
    outDir: 'dist',
  },
})

export default config
