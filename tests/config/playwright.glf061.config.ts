import {defineConfig} from '@playwright/test';
import {rooted} from './root';
export default rooted(defineConfig({testDir:'tests',testMatch:'conversation-attempt-public.e2e.ts',outputDir:'docs/glf061/browser-results',workers:1,timeout:60000,expect:{timeout:10000},use:{trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'docs/glf061/browser-results.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4197 --strictPort',url:'http://127.0.0.1:4197',reuseExistingServer:false,timeout:30000}}));
