import {defineConfig} from 'vitest/config';
import {join} from 'node:path';
const root=(import.meta.dirname+'/../..'),evidence=join(root,'evidence/unit');
export default defineConfig({root,cacheDir:join(evidence,'cache'),test:{include:['tests/unit/picking-helper.test.ts','tests/unit/picking-helper-host.test.ts','tests/unit/picking-helper-renderer.test.ts','tests/unit/picking-helper-raw.test.ts','tests/unit/picking-helper-ui.test.ts','tests/unit/picking-digest.test.ts'],maxWorkers:1,retry:0,testTimeout:15000,api:false,watch:false,reporters:['default','json'],outputFile:join(evidence,'results.json')}});
