import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // The puzzle bundle is inlined into the build rather than fetched — that is
    // what makes the first paint playable. Arrows boards are path lists rather
    // than grids, so a year is around 120 kB.
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5176, host: true },
});
