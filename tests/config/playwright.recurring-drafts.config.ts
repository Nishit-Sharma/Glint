import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='47905';
export default rooted(defineConfig({testDir:'tests',testMatch:'recurring-work-drafts.e2e.ts',outputDir:'work/continuation/rendered02',workers:1,timeout:90000,expect:{timeout:15000},use:{viewport:{width:1100,height:820},trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'work/continuation/rendered02-results.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 47905 --strictPort',url:'http://127.0.0.1:47905',reuseExistingServer:false,timeout:30000}}));
