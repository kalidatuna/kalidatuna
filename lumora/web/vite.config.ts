import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/sitemap.xml': 'http://localhost:8080',
      '/robots.txt': 'http://localhost:8080',
    },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
