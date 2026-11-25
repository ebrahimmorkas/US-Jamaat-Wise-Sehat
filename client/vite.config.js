import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";

// The Express server's port: API_PORT, else PORT in server/.env, else 5000.
function apiPort() {
  if (process.env.API_PORT) return process.env.API_PORT;
  try {
    const m = fs.readFileSync(new URL("../server/.env", import.meta.url), "utf8").match(/^\s*PORT\s*=\s*["']?(\d+)/m);
    if (m) return m[1];
  } catch {}
  return "5000";
}
const API = `http://localhost:${apiPort()}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During development, API calls go to the Express server.
    // Live updates (Socket.IO) too, so the browser only ever talks to this address.
    proxy: {
      "/api": API,
      "/socket.io": { target: API, ws: true },
    },
  },
});
