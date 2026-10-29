import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-drafts-visual-followup';
export default defineConfig({...base,testMatch:'learning-drafts-visual-followup.e2e.ts',outputDir:`${evidence}/playwright`,maxFailures:1,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
