import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {groundedJoinTestHost} from '../grounded-join-server';
export default defineConfig({root:'src/renderer',plugins:[react(),groundedJoinTestHost()],server:{host:'127.0.0.1',port:4179,strictPort:true}});
