import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-maintenance-status';
export default defineConfig({...base,testMatch:'learning-draft-maintenance-status.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
