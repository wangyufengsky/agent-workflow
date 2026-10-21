import { resolve } from 'node:path';
import { API_PREFIX, devPorts } from '@aw/shared';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const webRoot = resolve(import.meta.dirname, '../web');
const ports = devPorts(process.env);

/**
 * The backend serves the renderer at the origin's root (D31), so asset paths are absolute and a page loaded at a
 * nested address (a reload on /tasks/:id, the PDF export's print view /ppt/:id/print) finds them. electron-vite's
 * renderer preset sets `base: './'` for production builds (meant for file:// pages), which resolves them under that
 * address and serves the SPA's HTML instead; this runs after the preset.
 */
const servedFromRoot: Plugin = { name: 'aw:served-from-root', config: () => ({ base: '/' }) };

export default defineConfig(({ mode }) => ({
  main: {
    // Replaced at build time so development-only branches (the plaintext credential adapter) are removed from
    // production bundles; scripts/check-prod-bundle.mjs verifies it.
    define: { 'process.env.NODE_ENV': JSON.stringify(mode === 'development' ? 'development' : 'production') },
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
    plugins: [react(), servedFromRoot],
    server: { port: ports.web, strictPort: true, proxy: { [API_PREFIX]: `http://127.0.0.1:${ports.api}` } },
    build: { rollupOptions: { input: resolve(webRoot, 'index.html') } },
  },
}));
