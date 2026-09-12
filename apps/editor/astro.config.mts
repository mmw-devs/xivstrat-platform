import { defineConfig } from 'astro/config'

export default defineConfig({
  vite: {
    server: {
      proxy: {
        '/api/proofread': 'http://127.0.0.1:4322',
        '/api/submissions': 'http://127.0.0.1:4323',
      },
    },
  },
})
