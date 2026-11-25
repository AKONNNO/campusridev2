import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// KNUST Bus Tracker frontend.
// In development the Vite server proxies /api and /socket.io to the Express
// backend on :5000 so the app can use same-origin URLs (no CORS friction).
// For deployment set VITE_API_URL / VITE_SOCKET_URL (see client/.env.example).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:5000', ws: true, changeOrigin: true },
    },
  },
  build: {
    sourcemap: false,
    target: 'es2020', // keep the bundle runnable on low-end Android WebViews
  },
});
