import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-quit-freeze';
export default defineConfig({...base,testMatch:'learning-draft-quit-freeze.e2e.ts',outputDir:`${evidence}/playwright`,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
