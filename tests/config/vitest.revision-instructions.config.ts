import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'evidence/revision-instructions/vite-cache',test:{include:['tests/unit/revision-instruction-stop-render.test.ts','tests/unit/revision-instruction-app-errors.test.ts','tests/unit/revision-instructions.test.ts'],testTimeout:15000,maxWorkers:1,fileParallelism:false}});
