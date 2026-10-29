import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({root:'src/renderer',cacheDir:'../../evidence/local-task-durable-app/vite-cache',plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:4180,strictPort:true},optimizeDeps:{entries:['index.html']}});
