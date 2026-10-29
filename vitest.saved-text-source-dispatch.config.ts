import {defineConfig} from 'vitest/config';
import {join} from 'node:path';
const candidate=import.meta.dirname,evidence=join(candidate,'evidence/dispatch-unit');
export default defineConfig({root:candidate,cacheDir:join(evidence,'cache'),test:{include:['tests/saved-text-source-dispatch.test.ts'],maxWorkers:1,retry:0,testTimeout:15000,api:false,watch:false,reporters:['default','json'],outputFile:join(evidence,'results.json')}});
