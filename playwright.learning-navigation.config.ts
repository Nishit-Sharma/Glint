import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
export default defineConfig({...base,testMatch:'learning-navigation.e2e.ts',outputDir:'evidence/learning-navigation/playwright',maxFailures:0,reporter:[['list'],['json',{outputFile:'evidence/learning-navigation/results.json'}]]});
