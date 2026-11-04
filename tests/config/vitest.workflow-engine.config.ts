import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'work/continuation/vite-cache',test:{cache:false,include:['tests/unit/workflow-engine*.test.ts','tests/unit/workflow-lab.test.ts','tests/unit/workflow-host.test.ts','tests/unit/workflow-comparison-reopen.test.ts'],maxWorkers:2,testTimeout:15000}});
