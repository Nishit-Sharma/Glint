import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({root:'src/renderer',cacheDir:'../../work/continuation/selected-suggestions/vite-cache',plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:47881,strictPort:true},optimizeDeps:{entries:['index.html']}});
