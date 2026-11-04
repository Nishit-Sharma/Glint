import {defineConfig} from '@playwright/test';
import {rooted} from './root';
process.env.WINDOW_COMPANION_TEST_PORT='4198';
export default rooted(defineConfig({testDir:'tests',testMatch:['gaze-response.e2e.ts','character-lifecycle.e2e.ts'],outputDir:'test-results/gaze',workers:1,timeout:60000,expect:{timeout:5000},use:{headless:true,viewport:{width:1120,height:760}},reporter:[['list'],['json',{outputFile:'evidence/gaze/results.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4198 --strictPort',url:'http://127.0.0.1:4198',reuseExistingServer:false,timeout:30000}}));
