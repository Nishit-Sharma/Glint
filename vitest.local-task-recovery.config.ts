import {defineConfig} from 'vitest/config';
export default defineConfig({cacheDir:'.local-task-recovery-vite-cache',test:{include:['tests/local-task-recovery-layout.test.ts'],maxWorkers:1,testTimeout:15000}});
