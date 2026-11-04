import {defineConfig} from '@playwright/test';
import {rooted} from './root';
import base from './playwright.offline-task-entry.config';
export default rooted(defineConfig({...base,testMatch:'source-aware-empty-state.e2e.ts',outputDir:'evidence/source-aware-rendered/results',workers:1,retries:0,maxFailures:1,reporter:[['list'],['json',{outputFile:'evidence/source-aware-rendered/results.json'}]]}));
