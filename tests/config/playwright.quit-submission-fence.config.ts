import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
const evidence=process.env.QUIT_SUBMISSION_EVIDENCE??'evidence/quit-submission-app';
// Root owns the one leased server and bounded run. No implicit webServer.
export default rooted(defineConfig({testDir:'tests',testMatch:'quit-submission-fence.e2e.ts',outputDir:`${evidence}/playwright`,workers:1,fullyParallel:false,retries:0,maxFailures:1,timeout:90000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]}));
