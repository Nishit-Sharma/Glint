import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
import base from '../playwright.config';
process.env.WINDOW_COMPANION_TEST_PORT='4197';
export default defineConfig({...base,testDir:resolve('tests'),testMatch:'task-response-mode-dom.e2e.ts',timeout:90000,outputDir:resolve('evidence/mode-dom-diagnostic/fixed-results'),reporter:[['list'],['json',{outputFile:resolve('evidence/mode-dom-diagnostic/fixed-results.json')}]],webServer:{cwd:process.cwd(),command:'./node_modules/.bin/vite src/renderer --host 127.0.0.1 --port 4197 --strictPort',url:'http://127.0.0.1:4197',reuseExistingServer:false,timeout:30000},use:{...base.use,viewport:{width:430,height:760},reducedMotion:'no-preference'}});
