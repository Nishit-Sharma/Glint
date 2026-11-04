import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
// Root owns the sole leased server/browser invocation. No implicit webServer.
export default rooted(defineConfig({
 testDir:'tests',testMatch:'source-join-entry.e2e.ts',outputDir:'evidence/source-entry/results',workers:1,fullyParallel:false,timeout:60000,
 expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'no-preference',trace:'retain-on-failure'},
 reporter:[['list'],['json',{outputFile:'evidence/source-entry/results.json'}]],
}));
