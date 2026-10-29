import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.SEMANTIC_HELPER_DRAFT_EVIDENCE??'evidence/semantic-helper-drafts';
export default defineConfig({...base,testMatch:'semantic-helper-draft-recovery.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
