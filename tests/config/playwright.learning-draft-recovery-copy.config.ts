import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import base from './playwright.text-helper-entry.config';

export default rooted(defineConfig({...base,testMatch:'learning-draft-recovery-copy.e2e.ts',outputDir:'evidence/learning-draft-recovery-copy/playwright',reporter:[['list'],['json',{outputFile:'evidence/learning-draft-recovery-copy/results.json'}]]}));
