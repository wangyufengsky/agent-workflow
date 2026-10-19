import { API_PREFIX, DEV_API_PORT, DEV_WEB_PORT } from '@aw/shared';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The renderer always calls the API by relative URL. In production the backend serves the built
// renderer (same origin); in development Vite proxies the API to the backend's fixed dev port.
export default defineConfig({
  plugins: [react()],
  server: {
    port: DEV_WEB_PORT,
    strictPort: true,
    proxy: { [API_PREFIX]: `http://127.0.0.1:${DEV_API_PORT}` },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
