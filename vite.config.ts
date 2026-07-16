import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: '/card-room/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    // Keep card art as separate cacheable files instead of base64-inlining small
    // SVGs into the JS bundle — that way the browser caches each card once and
    // only re-downloads it if that specific file changes, not on every app deploy.
    assetsInlineLimit: 0,
  },
});
