import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  // The browser FFmpeg builds its own worker; pre-bundling breaks that
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      host: 'localhost',
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true
      }
    }
  },

  preview: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['transcribe.verbolabs.com']
  }
})
