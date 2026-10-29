import {defineConfig} from 'vitest/config';
import {join} from 'node:path';
const candidate=import.meta.dirname,evidence=join(candidate,'evidence/affected-unit');
export default defineConfig({root:candidate,cacheDir:join(evidence,'cache'),test:{include:["tests/saved-text-source-editor.test.ts", "tests/saved-text-source-drafts.test.ts", "tests/source-text-save.test.ts", "tests/learning-drafts-cache.test.ts", "tests/learning-draft-quit-freeze.test.ts", "tests/learning-draft-edit-rejection.test.ts", "tests/learning-draft-constraint-rejection.test.ts", "tests/learning-drafts-cleanup-integration.test.ts", "tests/workflow-source-review-drafts.test.ts"],maxWorkers:1,retry:0,testTimeout:15000,api:false,watch:false,reporters:['default','json'],outputFile:join(evidence,'results.json')}});
