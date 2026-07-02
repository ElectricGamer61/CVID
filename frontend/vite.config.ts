import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the FastAPI backend on :8000, and mounts the vendored
// FreeCut editor same-origin under /editor (proxied to its dev server on :5173) so its
// File System Access workspace picker works — that API is blocked in cross-origin iframes.
export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port so it never collides with FreeCut's :5173 and the /editor proxy is stable.
    port: Number(process.env.PORT) || 3000,
    // Cross-origin isolation lets the embedded FreeCut editor run its WebGPU/WebCodecs
    // pipeline. `credentialless` keeps Cvideo's own cross-origin resources loading without
    // requiring a CORP header on each one.
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
    proxy: {
      "/api": "http://127.0.0.1:8000",
      // FreeCut dev server runs with --base=/editor/ (see .claude/launch.json), so it serves
      // its app + assets under /editor/*. ws:true forwards its HMR socket.
      "/editor": {
        target: "http://127.0.0.1:5173",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
