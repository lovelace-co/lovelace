/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.tsx', 'test/**/*.spec.ts'],
    setupFiles: ['test/setup.ts'],
    css: false,
  },
});
