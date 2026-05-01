import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getHttpsServerOptions } from "office-addin-dev-certs";

// Office add-ins must be served over HTTPS. We use the dev cert installed by
// `office-addin-dev-certs` (run `npm run setup-certs` once) so Excel will trust
// the local server. The backend runs on http://127.0.0.1:8000; we proxy /api/*
// through Vite to dodge mixed-content restrictions in the Excel WebView.
export default defineConfig(async () => ({
  plugins: [react()],
  server: {
    port: 3000,
    https: await getHttpsServerOptions(),
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
}));
