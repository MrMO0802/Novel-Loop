import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./src/main/index.ts', import.meta.url))
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: fileURLToPath(new URL('./src/preload/index.ts', import.meta.url))
      }
    }
  },
  renderer: {
    root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
    plugins: [react()],
    build: {
      outDir: fileURLToPath(new URL('./out/renderer', import.meta.url))
    },
    resolve: {
      alias: {
        '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url))
      }
    }
  }
});
