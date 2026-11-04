import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
// Source-only plan. Root owns one leased server/browser invocation; no webServer.
export default rooted(defineConfig({
 testDir:'tests',testMatch:'sql-last-change-public.e2e.ts',outputDir:'evidence/public/results',workers:1,fullyParallel:false,timeout:90000,retries:0,maxFailures:1,
 expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},actionTimeout:7000,reducedMotion:'reduce',trace:'retain-on-failure'},
 reporter:[['list'],['json',{outputFile:'evidence/public/results.json'}]],
}));
