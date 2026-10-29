import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
export default defineConfig({testDir:'tests',testMatch:'local-task-durable.e2e.ts',outputDir:'evidence/local-task-durable-app/results',workers:1,fullyParallel:false,retries:0,maxFailures:1,timeout:90000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/local-task-durable-app/results.json'}]]});
