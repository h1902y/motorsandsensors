import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DAEMON = "http://127.0.0.1:7770";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: DAEMON, changeOrigin: true },
      "/auth": { target: DAEMON, changeOrigin: true },
      "/ws": { target: DAEMON, changeOrigin: true, ws: true },
    },
  },
});
