import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-basis-blocked';
export default rooted(defineConfig({...base,testMatch:'learning-draft-basis-blocked.e2e.ts',outputDir:`${evidence}/playwright`,maxFailures:0,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]}));
