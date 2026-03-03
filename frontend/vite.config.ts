import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/cleanup': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/analytics/upload': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/analytics/analyze': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/analytics/results': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/analytics/stations': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/analytics/reset': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
