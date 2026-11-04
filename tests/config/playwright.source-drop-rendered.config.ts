import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const evidence=process.env.SOURCE_DROP_VISUAL_EVIDENCE;
if(!evidence||!isAbsolute(evidence))throw Error('SOURCE_DROP_VISUAL_EVIDENCE must be an absolute owned evidence directory.');
process.env.WINDOW_COMPANION_TEST_PORT='4193';
process.env.LEARNING_DRAFT_EVIDENCE=evidence;
const here=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export default rooted(defineConfig({testDir:resolve(here,'tests'),testMatch:['**/source-drop-preview-rendered.e2e.ts','**/source-drop-anchor-copy.e2e.ts','**/source-drag-renderer.e2e.ts'],outputDir:join(evidence,'playwright'),workers:1,fullyParallel:false,retries:0,maxFailures:1,timeout:120000,expect:{timeout:7000},use:{baseURL:'http://127.0.0.1:4193',headless:true,viewport:{width:1080,height:800},reducedMotion:'reduce',trace:'retain-on-failure'},reporter:[['list'],['json',{outputFile:join(evidence,'results.json')}]]}));
