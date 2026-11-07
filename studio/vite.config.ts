import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Studio lives at /studio: in dev on its own port, and in server mode the backend serves
// the built app at http://<host>:8000/studio (app/main.py mounts studio/dist there).
// /api goes to the same FastAPI backend Cvideo uses; API_PORT moves it.
export default defineConfig({
  base: "/studio/",
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 3200,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${Number(process.env.API_PORT) || 8000}`,
    },
  },
});
