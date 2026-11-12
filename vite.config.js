import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        diorama: resolve(__dirname, 'diorama.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
