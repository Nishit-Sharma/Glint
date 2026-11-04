import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4186';
export default rooted(defineConfig({testDir:'tests',testMatch:['onboarding.e2e.ts','onboarding-exit.e2e.ts'],outputDir:'test-results/onboarding',workers:1,timeout:60000,expect:{timeout:10000},use:{headless:true,video:'on',trace:'retain-on-failure',viewport:{width:1120,height:760}},reporter:[['list'],['json',{outputFile:'evidence/onboarding/browser-results.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4186 --strictPort',url:'http://127.0.0.1:4186',reuseExistingServer:false,timeout:30000}}));
