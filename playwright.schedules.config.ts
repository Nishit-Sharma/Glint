import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4189';
export default defineConfig({testDir:'tests',outputDir:'evidence/schedules-playwright',testMatch:'recurring-work-public.e2e.ts',workers:1,timeout:70000,expect:{timeout:10000},use:{trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/schedules-e2e-results.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4189 --strictPort',url:'http://127.0.0.1:4189',reuseExistingServer:false,timeout:30000}});
