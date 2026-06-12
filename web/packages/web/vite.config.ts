import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DAEMON = "http://127.0.0.1:7770";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Big leaf dependencies ride their own cacheable chunks (the editor pane
    // and the ⌘K palette are additionally lazy at the React level).
    rolldownOptions: {
      output: {
        advancedChunks: {
          groups: [
            { name: "xterm-addons", test: /node_modules[\\/]@xterm[\\/]addon-/ },
            { name: "xterm", test: /node_modules[\\/]@xterm[\\/]/ },
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          ],
        },
      },
    },
    // Every app/vendor chunk is now < 500 kB. The single remaining offender
    // is Monaco's core (editor.api, ~3.6 MB) — third-party, irreducible, and
    // only fetched via dynamic import when the first file opens. Lift the
    // warning threshold just past it so REAL regressions still warn loudly.
    chunkSizeWarningLimit: 3700,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: DAEMON, changeOrigin: true },
      "/auth": { target: DAEMON, changeOrigin: true },
      "/ws": { target: DAEMON, changeOrigin: true, ws: true },
    },
  },
});
