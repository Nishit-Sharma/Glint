import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'work/continuation/vite-cache',test:{cache:false,include:['tests/workflow-engine*.test.ts','tests/workflow-lab.test.ts','tests/workflow-host.test.ts','tests/workflow-comparison-reopen.test.ts'],maxWorkers:2,testTimeout:15000}});
