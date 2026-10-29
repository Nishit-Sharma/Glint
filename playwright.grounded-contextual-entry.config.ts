import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
export default defineConfig({testDir:'tests',testMatch:'grounded-contextual-entry.e2e.ts',outputDir:'evidence/grounded-contextual-entry/results',workers:1,fullyParallel:false,retries:0,maxFailures:1,timeout:180000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/grounded-contextual-entry/results.json'}]]});
