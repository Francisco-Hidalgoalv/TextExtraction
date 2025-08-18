import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/n8n-webhook': {
        target: 'https://n8n.dwitmexico.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/n8n-webhook/, '/webhook'),
      },
    },
  },
})
