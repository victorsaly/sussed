import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Relative, not by package name: Vite externalises workspace packages when
// it bundles this config, and then hands node a raw .ts file it cannot load.
import { serviceWorker } from '../../packages/pwa/src/vite';

export default defineConfig({
  plugins: [react(), serviceWorker()],
  build: {
    target: 'es2022',
    // The puzzle bundle is inlined into the build rather than fetched — that is
    // what makes the first paint playable. Arrows boards are path lists rather
    // than grids, so a year is around 120 kB.
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5176, host: true },
});
