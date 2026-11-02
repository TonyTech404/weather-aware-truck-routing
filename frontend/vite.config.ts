import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  server: {
    port: 5173,
    // In development the browser calls /api on the Vite origin; this forwards it to Django.
    proxy: { '/api': process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8000' },
  },
  preview: { proxy: { '/api': process.env.VITE_DEV_API_TARGET ?? 'http://127.0.0.1:8000' } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200, // maplibre-gl is ~1 MB; it loads lazily in its own chunk
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
