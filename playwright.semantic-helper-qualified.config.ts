import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.SEMANTIC_HELPER_RUN_EVIDENCE??'evidence/semantic-helper-run-qualified';
export default defineConfig({...base,testMatch:['semantic-helper-run-binding.e2e.ts','semantic-helper-run-races.e2e.ts','semantic-helper-draft-recovery.e2e.ts','helper-legacy-drafts.e2e.ts','semantic-helper-entry.e2e.ts','typed-semantic-procedure.e2e.ts'],outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
