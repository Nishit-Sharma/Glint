import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const evidence=process.env.SOURCE_DROP_VISUAL_EVIDENCE;
if(!evidence||!isAbsolute(evidence))throw Error('SOURCE_DROP_VISUAL_EVIDENCE must be an absolute owned evidence directory.');
const here=dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:resolve(here,'src/renderer'),cacheDir:join(evidence,'vite-cache'),plugins:[react(),tailwindcss()],server:{host:'127.0.0.1',port:4193,strictPort:true},optimizeDeps:{entries:['index.html']}});
