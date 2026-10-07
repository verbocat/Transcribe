import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { execSync } from 'node:child_process'

let sha = 'nogit'
try { sha = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
const BUILD_ID = `${sha} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`

const backendTarget = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000'

export default defineConfig({
  define: { __APP_BUILD__: JSON.stringify(BUILD_ID) },
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
