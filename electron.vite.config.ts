import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: resolve('src/host/index.ts') } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('src/host/preload.ts'), credentials: resolve('src/host/credentials-preload.ts') }, output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: { root: 'src/renderer', plugins: [react(),tailwindcss()] }
})
