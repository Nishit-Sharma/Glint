import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4193';
export default defineConfig({testDir:'tests',testMatch:'combined-learning-quit.e2e.ts',outputDir:'evidence/combined-learning-quit/results',workers:1,retries:0,maxFailures:1,fullyParallel:false,timeout:90000,expect:{timeout:7000},use:{actionTimeout:7000,baseURL:'http://127.0.0.1:4193',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/combined-learning-quit/results.json'}]]});
