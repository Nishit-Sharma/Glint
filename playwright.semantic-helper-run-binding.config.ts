import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??'evidence/semantic-helper-run-binding';
export default defineConfig({...base,testMatch:'semantic-helper-run-binding.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
