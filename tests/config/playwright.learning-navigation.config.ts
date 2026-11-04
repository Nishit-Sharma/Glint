import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import base from './playwright.text-helper-entry.config';
export default rooted(defineConfig({...base,testMatch:'learning-navigation.e2e.ts',outputDir:'evidence/learning-navigation/playwright',maxFailures:0,reporter:[['list'],['json',{outputFile:'evidence/learning-navigation/results.json'}]]}));
