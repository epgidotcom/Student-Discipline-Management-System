import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build/dev-server config for the frontend bundle.
// Connected to src/main.jsx as the entry module and to npm scripts (dev/build/preview) in package.json.
export default defineConfig({
  // Enables React transform and fast-refresh for all App.jsx-driven pages.
  plugins: [react()],
  server: {
    // Keep frontend and API calls on one browser origin in local dev.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
})
