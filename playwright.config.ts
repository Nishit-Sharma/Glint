import {defineConfig} from '@playwright/test'
process.env.WINDOW_COMPANION_TEST_PORT='4173';
process.env.WINDOW_COMPANION_CAPTURE_RUN??=String(Date.now());
export default defineConfig({
  testDir:'tests',outputDir:`test-results/run-${process.pid}`,testMatch:'**/*.e2e.ts',workers:1,timeout:60000,
  expect:{timeout:10000},use:{trace:'retain-on-failure'},
  reporter:[['list'],['json',{outputFile:'evidence/e2e-results.json'}]],
  webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4173 --strictPort',url:'http://127.0.0.1:4173',reuseExistingServer:true,timeout:30000}
})
