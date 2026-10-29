import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'evidence/revision-instructions/vite-cache',test:{include:['tests/revision-instruction-stop-render.test.ts','tests/revision-instruction-app-errors.test.ts','tests/revision-instructions.test.ts'],testTimeout:15000,maxWorkers:1,fileParallelism:false}});
