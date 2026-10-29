import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
export default defineConfig({...base,testMatch:['learning-drafts.e2e.ts','learning-navigation.e2e.ts'],outputDir:process.env.LEARNING_DRAFT_EVIDENCE?`${process.env.LEARNING_DRAFT_EVIDENCE}/playwright`:'evidence/learning-drafts/playwright',maxFailures:1,reporter:[['list'],['json',{outputFile:'evidence/learning-drafts/results.json'}]]});
