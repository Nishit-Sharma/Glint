import {defineConfig} from '@playwright/test';
import {isAbsolute,join} from 'node:path';
const evidence=process.env.BROWSER_FAILURE_QA_EVIDENCE;
if(!evidence||!isAbsolute(evidence))throw Error('Set BROWSER_FAILURE_QA_EVIDENCE to a fresh owned absolute directory.');
export default defineConfig({testDir:'tests',testMatch:'browser-launch-renderer.e2e.ts',outputDir:join(evidence,'results'),workers:1,retries:0,maxFailures:1,timeout:60000,expect:{timeout:10000},use:{viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:join(evidence,'results.json')}]]});
