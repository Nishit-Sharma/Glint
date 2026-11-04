import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4180';
export default rooted(defineConfig({testDir:'tests',testMatch:'workflow-reviewed-entry.e2e.ts',outputDir:'evidence/workflow-reviewed-entry/results',workers:1,fullyParallel:false,timeout:90000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4180',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/workflow-reviewed-entry/results.json'}]]}));
