import {defineConfig} from '@playwright/test';
import {rooted} from './root';
export default rooted(defineConfig({testDir:'tests',testMatch:'workflow-lab.browser.ts',outputDir:'evidence/workflow-lab/playwright',workers:1,timeout:30000,use:{baseURL:'http://127.0.0.1:4180',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:'evidence/workflow-lab/browser.json'}]],webServer:{command:'./node_modules/.bin/vite --config tests/config/vite.workflow.config.ts',url:'http://127.0.0.1:4180/workflow-demo.html',reuseExistingServer:false}}));
