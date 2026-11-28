import { defineConfig } from 'vite';

// The built site keeps scripts and styles external to the HTML for a strict CSP.
export default defineConfig({
  root: '.',
  base: '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    sourcemap: false,
  },
  worker: { format: 'es' },
  server: { port: 5173 },
  preview: { port: 4173 },
});
