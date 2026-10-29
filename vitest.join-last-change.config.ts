import {defineConfig} from 'vitest/config';
import {join} from 'node:path';
const root=import.meta.dirname,evidence=join(root,'evidence/unit');
export default defineConfig({root,cacheDir:join(evidence,'cache'),test:{include:['tests/join-last-change.test.ts','src/learning/join-lab.test.ts','tests/grounded-join.test.ts','tests/grounded-notes.test.ts','tests/grounded-review-corrections.test.ts','tests/join-module.test.ts','tests/learning-draft-basis.test.ts'],maxWorkers:1,retry:0,testTimeout:15000,api:false,watch:false,reporters:['default','json'],outputFile:join(evidence,'results.json')}});
