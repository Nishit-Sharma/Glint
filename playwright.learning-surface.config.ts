import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4192';
export default defineConfig({
 testDir:'tests',testMatch:'learning-surface.e2e.ts',outputDir:'evidence/learning-surface/results',workers:1,timeout:60000,
 expect:{timeout:7000},use:{headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},
 reporter:[['list'],['json',{outputFile:'evidence/learning-surface/results.json'}]],
 webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4192 --strictPort',url:'http://127.0.0.1:4192',reuseExistingServer:false,timeout:20000},
});
