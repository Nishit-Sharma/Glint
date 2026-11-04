import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
export default rooted(defineConfig({testDir:'tests',testMatch:['raw-capacity-renderer.e2e.ts','raw-capacity-caller.e2e.ts'],outputDir:'evidence/raw-capacity-app/results',workers:1,retries:0,maxFailures:1,fullyParallel:false,timeout:180000,expect:{timeout:7000},use:{actionTimeout:7000,baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'no-preference',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/raw-capacity-app/results.json'}]]}));
