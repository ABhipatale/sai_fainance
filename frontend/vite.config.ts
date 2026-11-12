import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// The production build is written straight into Laravel's /public folder, so one Hostinger domain
// serves both the SPA (app.html) and the API (/api).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        name: 'Sai Finance',
        short_name: 'Sai Finance',
        description: 'Weekly loan & collection management',
        theme_color: '#0f2a5c',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'mr',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/app.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['index.php'],
        runtimeCaching: [
          // read-only API data stays available offline (network first, short timeout)
          {
            urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET' && !url.pathname.startsWith('/api/media'),
            handler: 'NetworkFirst',
            options: { cacheName: 'api-get', networkTimeoutSeconds: 6, expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 2 }, cacheableResponse: { statuses: [200] } },
          },
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/media'), handler: 'StaleWhileRevalidate', options: { cacheName: 'media', expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 12 } } },
          { urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/, handler: 'CacheFirst', options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
          { urlPattern: /^https:\/\/.*tile\.openstreetmap\.org\/.*/, handler: 'StaleWhileRevalidate', options: { cacheName: 'map-tiles', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 } } },
        ],
      },
    }),
    // Laravel owns index.php, so the SPA entry is published as app.html
    {
      name: 'rename-index-to-app-html',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        const idx = bundle['index.html']
        if (idx) {
          idx.fileName = 'app.html'
        }
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: '../backend/public',
    emptyOutDir: false,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } },
  },
})
