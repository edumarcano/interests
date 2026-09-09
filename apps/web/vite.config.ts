import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = process.env.SERVER_URL || "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target,
        changeOrigin: false,
      },
      "/socket.io": {
        target,
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
