import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/companion-motion.test.ts','tests/companion-materials.test.ts','tests/character-preferences.test.ts','tests/bot-identities.test.ts'],testTimeout:15000,maxWorkers:1,reporters:['default',['json',{outputFile:'preparation/motion-test-results.json'}]]}});
