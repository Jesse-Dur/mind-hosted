import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { version } from "./package.json"

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Stable vendor chunks keep the app shell smaller and improve repeat-load caching.
            { name: "vendor-react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 50 },
            { name: "vendor-clerk", test: /node_modules[\\/]@clerk[\\/]/, priority: 40 },
            { name: "vendor-cmdk", test: /node_modules[\\/]cmdk[\\/]/, priority: 30 },
            { name: "vendor-dexie", test: /node_modules[\\/]dexie[\\/]/, priority: 30 },
            { name: "vendor-zustand", test: /node_modules[\\/]zustand[\\/]/, priority: 30 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
})
