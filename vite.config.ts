import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built game works from any static host / sub-folder.
  base: './',
  server: { port: 5173, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
