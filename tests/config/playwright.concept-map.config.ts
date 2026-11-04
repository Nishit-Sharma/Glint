import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4197';
export default rooted(defineConfig({testDir:'tests',testMatch:'concept-map-public.e2e.ts',workers:1,timeout:60000,expect:{timeout:10000},use:{viewport:{width:1080,height:760},reducedMotion:'reduce',trace:'retain-on-failure'},outputDir:'test-results/concept-map-quotation-repair',reporter:[['list'],['json',{outputFile:'evidence/concept-map-quotation-repair/results.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4197 --strictPort',url:'http://127.0.0.1:4197',reuseExistingServer:false,timeout:30000}}));
