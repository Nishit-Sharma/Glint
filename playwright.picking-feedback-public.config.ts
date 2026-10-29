import {defineConfig} from '@playwright/test';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
process.env.PICKING_PUBLIC_APP_EVIDENCE??='evidence/picking-feedback-public';
const evidence=process.env.PICKING_PUBLIC_APP_EVIDENCE;
// Source-only qualification plan; root owns the existing leased recipe.
export default defineConfig({testDir:'tests',testMatch:'picking-feedback-public.e2e.ts',outputDir:evidence+'/results',workers:1,fullyParallel:false,retries:0,maxFailures:1,timeout:90000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},actionTimeout:7000,reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:evidence+'/results.json'}]]});
