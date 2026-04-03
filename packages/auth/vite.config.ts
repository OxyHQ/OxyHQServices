import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      { find: /^react-native\/(.+)/, replacement: path.resolve(__dirname, "../../node_modules/react-native-web/dist/$1") },
      { find: "react-native", replacement: path.resolve(__dirname, "../../node_modules/react-native-web") },
    ],
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".js"],
  },
  define: {
    __DEV__: JSON.stringify(process.env.NODE_ENV !== "production"),
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { ".js": "jsx" },
    },
    exclude: [
      "react-native-svg",
      "react-native-screens",
      "react-native-safe-area-context",
      "react-native-gesture-handler",
      "expo-router",
      "expo-image",
      "expo-modules-core",
    ],
  },
  ssr: {
    noExternal: ["react-native-web", "@oxyhq/bloom"],
  },
  server: {
    port: 3002,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
