import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the FastAPI backend on :8000.
// API_PORT moves that target (a second checkout can then run its own backend beside the
// first); the default is what start.cmd / serve.cmd launch.
export default defineConfig({
  plugins: [react()],
  server: {
    // Fixed port so start.cmd and any bookmarks stay stable.
    port: Number(process.env.PORT) || 3000,
    proxy: {
      "/api": `http://127.0.0.1:${Number(process.env.API_PORT) || 8000}`,
    },
  },
});
