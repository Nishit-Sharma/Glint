import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-dispatch-race';
export default rooted(defineConfig({...base,testMatch:'learning-draft-dispatch-race.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]}));
