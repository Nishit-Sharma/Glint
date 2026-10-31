import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4197';
export default defineConfig({testDir:'tests',testMatch:'conversation-search-public.e2e.ts',outputDir:'evidence/conversation-search/results',workers:1,retries:0,maxFailures:1,timeout:60000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4197',headless:true,viewport:{width:1080,height:800},actionTimeout:7000,reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/conversation-search/results.json'}]]});
