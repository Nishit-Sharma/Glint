import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {resolve} from 'node:path';
/** Renderer-only preparation. Root owns any separately reviewed server lease. */
export default defineConfig({root:resolve('src/renderer'),cacheDir:resolve('evidence/vite-app-cache'),plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:4180,strictPort:true,hmr:false}});
