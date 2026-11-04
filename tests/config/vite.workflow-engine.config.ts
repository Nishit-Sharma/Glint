import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {resolve} from 'node:path';
export default defineConfig({root:'src/renderer',cacheDir:resolve('work/continuation/renderer-vite-cache'),plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:4631,strictPort:true},optimizeDeps:{entries:['index.html']}});
