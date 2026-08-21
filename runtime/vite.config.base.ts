/**
 * Shared Vite config for exercises. Extend it per-exercise:
 *
 *   // exercises/reflexion-lumiere/vite.config.ts
 *   import { defineConfig, mergeConfig } from 'vite'
 *   import base from '../../runtime/vite.config.base'
 *
 *   export default mergeConfig(base, defineConfig({
 *     // exercise-specific overrides here
 *   }))
 *
 * V1 note: each exercise bundles its own React (~50 KB gz). Vendor-chunk
 * de-duplication across exercises is a Y1.5 optimization — matters for the
 * 1.5 Mbps target market but requires cross-package coordination. Ship the
 * simpler shape first.
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Relative URLs so the built bundle works under any /runtime/{slug}-vN/ path
  // without knowing its final mount location.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: true,
    rollupOptions: {
      output: {
        entryFileNames: 'main-[hash].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
})
