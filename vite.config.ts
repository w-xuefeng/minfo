import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const normalizeBasePath = (value: string | undefined): string => {
  if (!value || value === '/') {
    return '/'
  }

  return `/${value.replace(/^\/+|\/+$/g, '')}/`
}

export default defineConfig(({ command }) => {
  const repository = process.env.GITHUB_REPOSITORY?.split('/')[1]
  const base =
    command === 'serve' ? '/' : normalizeBasePath(process.env.VITE_BASE_PATH ?? repository)

  return {
    base,
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      include: ['src/**/*.test.ts'],
    },
  }
})
