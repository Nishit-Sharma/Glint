import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'work/continuation/host-vite-cache',test:{cache:false,include:['tests/unit/host-boundary.test.ts'],testNamePattern:'persists bounded workflow experiments through production module commands',maxWorkers:1,testTimeout:30000}});
