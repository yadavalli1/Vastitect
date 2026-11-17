import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import pkg from "./package.json";

export default defineConfig({
  plugins: [react(), tailwind()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 6000 },
});
