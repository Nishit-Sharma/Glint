import {defineConfig} from '@playwright/test';
import base from './playwright.text-helper-entry.config';
const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/continuity-drag-working/app';
export default defineConfig({...base,testMatch:['learning-drafts.e2e.ts','learning-navigation.e2e.ts','learning-draft-basis-blocked.e2e.ts','learning-draft-dispatch-race.e2e.ts','learning-draft-maintenance-status.e2e.ts','learning-draft-quit-freeze.e2e.ts','learning-draft-recovery-copy.e2e.ts','learning-drafts-visual-followup.e2e.ts','source-drag-renderer.e2e.ts'],outputDir:`${evidence}/playwright`,maxFailures:1,reporter:[['list'],['json',{outputFile:`${evidence}/results.json`}]]});
