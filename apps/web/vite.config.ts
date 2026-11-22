import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const API = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Task board',
        short_name: 'Tasks',
        description: "Tom's task board",
        theme_color: '#16191d',
        background_color: '#e9ebef',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is cached; the API and live socket always go to the server.
        navigateFallbackDenylist: [/^\/api\//, /^\/health/],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api/v1/live': { target: API.replace(/^http/, 'ws'), ws: true },
      '/api': { target: API },
      '/health': { target: API },
    },
  },
  test: { environment: 'jsdom' },
});
