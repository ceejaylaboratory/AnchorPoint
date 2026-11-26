/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('recharts') ||
              id.includes('chart.js') ||
              id.includes('d3-') ||
              id.includes('victory')
            ) {
              return 'vendor-charts';
            }
            if (
              id.includes('@stellar') ||
              id.includes('@creit.tech') ||
              id.includes('@albedo-link')
            ) {
              return 'vendor-stellar';
            }
            if (
              id.includes('lucide-react') ||
              id.includes('framer-motion') ||
              id.includes('@tanstack/react-virtual')
            ) {
              return 'vendor-ui';
            }
          }
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  }
})
