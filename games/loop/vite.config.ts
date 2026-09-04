import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // The puzzle bundle is the biggest asset and it is deliberately inlined
    // into the build rather than fetched — that is what makes the first paint
    // playable. Keep an eye on this number; a year of Loop is ~150 kB.
    chunkSizeWarningLimit: 700,
  },
  server: { port: 5175, host: true },
});
