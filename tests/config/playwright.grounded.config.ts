import {defineConfig} from '@playwright/test';
import {rooted} from './root';
export default rooted(defineConfig({testDir:'tests',testMatch:'grounded-join.browser.ts',outputDir:'evidence/grounded-join/playwright',workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:4179',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/grounded-join/browser.json'}]],webServer:{command:'./node_modules/.bin/vite --config tests/config/vite.grounded.config.ts',url:'http://127.0.0.1:4179/grounded-join-demo.html',reuseExistingServer:false}}));
