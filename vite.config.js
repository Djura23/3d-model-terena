import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` pravi JEDAN samostalni dist/index.html (radi i bez servera, dvoklikom).
export default defineConfig({
  plugins: [viteSingleFile()],
  server: { port: 5178, open: false },
  // na Windows-u antivirus često blokira preimenovanje keša zavisnosti (EPERM) — three.js je čist ESM, optimizacija nije potrebna
  optimizeDeps: { noDiscovery: true, include: [] },
  build: { chunkSizeWarningLimit: 2000 },
});
