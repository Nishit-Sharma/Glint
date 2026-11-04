import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'work/continuation/vite-cache',test:{include:['tests/unit/source-comparison*.test.ts','tests/unit/source-history-renderer.test.ts'],cache:false,testTimeout:15000,maxWorkers:1}});
