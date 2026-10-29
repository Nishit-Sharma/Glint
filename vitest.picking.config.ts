import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'./evidence/vite-cache',test:{include:['tests/**/*.test.ts'],testTimeout:15000,maxWorkers:1}});
