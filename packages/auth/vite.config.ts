import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const emptyModule = path.resolve(__dirname, "src/empty-module.js");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, ".") },
      // Stub native-only deep imports that monorepo hoisting pulls in
      { find: /^react-native\/Libraries\/.*/, replacement: emptyModule },
      { find: "react-native", replacement: "react-native-web" },
      { find: "expo-router", replacement: emptyModule },
      { find: "expo-modules-core", replacement: emptyModule },
      { find: "react-native-svg", replacement: emptyModule },
      { find: "react-native-screens", replacement: emptyModule },
      { find: "react-native-safe-area-context", replacement: emptyModule },
      { find: "react-native-gesture-handler", replacement: emptyModule },
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
    exclude: ["@react-native-async-storage/async-storage"],
  },
  server: {
    port: 3002,
    strictPort: true,
  },
  build: {
    outDir: "dist",
  },
});
