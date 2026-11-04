import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
export default rooted(defineConfig({testDir:'tests',testMatch:['saved-text-source.e2e.ts','saved-text-source-recovery.e2e.ts'],outputDir:'evidence/saved-text-source/results',workers:1,fullyParallel:false,retries:0,maxFailures:1,timeout:90000,expect:{timeout:7000},use:{actionTimeout:7000,baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/saved-text-source/results.json'}]]}));
