import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {workflowTestHost} from '../support/workflow-server';
export default defineConfig({root:'src/renderer',plugins:[react(),workflowTestHost()],server:{host:'127.0.0.1',port:4180,strictPort:true}});
