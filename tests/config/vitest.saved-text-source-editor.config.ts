import {defineConfig} from 'vitest/config';
import {join} from 'node:path';
const candidate=(import.meta.dirname+'/../..'),evidence=join(candidate,'evidence/editor-unit');
export default defineConfig({root:candidate,cacheDir:join(evidence,'cache'),test:{include:['tests/saved-text-source-editor.test.ts'],maxWorkers:1,retry:0,testTimeout:15000,api:false,watch:false,reporters:['default','json'],outputFile:join(evidence,'results.json')}});
