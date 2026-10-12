import { defineConfig } from 'vite';

// The dev client runs on :5173 and proxies the WebSocket endpoint to the game server on :8080.
export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
