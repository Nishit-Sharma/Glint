import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4267';
export default rooted(defineConfig({
 testDir:'tests',testMatch:['direct-send.e2e.ts','queued-followup.e2e.ts','composer.e2e.ts'],outputDir:'test-results/direct-send',workers:1,timeout:60000,
 expect:{timeout:10000},use:{trace:'retain-on-failure'},reporter:[['list']],
 webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4267 --strictPort',url:'http://127.0.0.1:4267',reuseExistingServer:false,timeout:30000},
}));
