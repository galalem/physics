import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { ReactLocalizationPlugin } from '@galalem/react-localization/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), ReactLocalizationPlugin()],
  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ['import', 'if-function'],
      },
    },
  },
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      // Mirrors prod's external nginx: strips /runtime/ before forwarding
      // to the runtime container, which serves at /<slug>-v<version>/.
      '/runtime': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/runtime/, ''),
      },
    },
  },
})
