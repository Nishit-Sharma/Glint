import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.SEMANTIC_HELPER_EVIDENCE??'evidence/semantic-helper-entry';
export default defineConfig({...base,testMatch:'semantic-helper-entry.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
