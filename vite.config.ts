import { defineConfig } from 'vite';

// Relative base so the build works under any GitHub Pages sub-path (/<repo>/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
