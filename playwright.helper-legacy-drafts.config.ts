import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
export default defineConfig({...base,testMatch:'helper-legacy-drafts.e2e.ts',outputDir:'evidence/helper-legacy-drafts/playwright',reporter:[['list'],['json',{outputFile:'evidence/helper-legacy-drafts/results.json'}]]});
