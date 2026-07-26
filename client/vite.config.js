import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces, not just 127.0.0.1, so the dev server is reachable
    // from other devices (e.g. a phone) on the same network.
    host: true,
  },
})
