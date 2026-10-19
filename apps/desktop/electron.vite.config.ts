import { resolve } from 'node:path';
import { API_PREFIX, DEV_API_PORT, DEV_WEB_PORT } from '@aw/shared';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const webRoot = resolve(import.meta.dirname, '../web');

export default defineConfig({
  main: {
    build: {
      // Bundle the backend and all its dependencies into out/main so the packaged app needs no node_modules.
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          server: resolve(import.meta.dirname, '../../packages/server/src/main.ts'),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      // Sandboxed preload scripts cannot use ES modules.
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: webRoot,
    plugins: [react()],
    server: { port: DEV_WEB_PORT, strictPort: true, proxy: { [API_PREFIX]: `http://127.0.0.1:${DEV_API_PORT}` } },
    build: { rollupOptions: { input: resolve(webRoot, 'index.html') } },
  },
});
