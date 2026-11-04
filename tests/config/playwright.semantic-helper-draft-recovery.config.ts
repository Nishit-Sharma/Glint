import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.SEMANTIC_HELPER_DRAFT_EVIDENCE??'evidence/semantic-helper-drafts';
export default rooted(defineConfig({...base,testMatch:'semantic-helper-draft-recovery.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]}));
