import {defineConfig} from '@playwright/test';
import {rooted} from './root';
export default rooted(defineConfig({testDir:'tests',testMatch:'learning-tools.browser.ts',outputDir:'evidence/learning-playwright',workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:4178',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/learning-e2e.json'}]],webServer:{command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4178 --strictPort',url:'http://127.0.0.1:4178/learning-demo.html',reuseExistingServer:false}}));
