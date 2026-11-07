import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any sub-path (e.g. GitHub Pages).
  base: './',
  build: {
    target: 'es2022',
    // Prototype chunks are loaded on demand; three.js alone is ~600 kB raw,
    // which is fine because it is only fetched when a 3D prototype opens.
    chunkSizeWarningLimit: 900,
  },
});
