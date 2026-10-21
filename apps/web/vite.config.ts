import { API_PREFIX, devPorts } from '@aw/shared';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The renderer always calls the API by relative URL. In production the backend serves the built
// renderer (same origin); in development Vite proxies the API to the backend's dev port.
const ports = devPorts(process.env);

export default defineConfig({
  plugins: [react()],
  server: {
    port: ports.web,
    strictPort: true,
    proxy: { [API_PREFIX]: `http://127.0.0.1:${ports.api}` },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
