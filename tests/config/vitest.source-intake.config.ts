import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'work/continuation/vite-cache',test:{include:['tests/unit/source-intake*.test.ts'],maxWorkers:1,testTimeout:20000,watch:false,api:false}});
