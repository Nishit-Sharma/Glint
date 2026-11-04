import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/unit/companion-motion.test.ts','tests/unit/companion-materials.test.ts','tests/unit/character-preferences.test.ts','tests/unit/bot-identities.test.ts'],testTimeout:15000,maxWorkers:1,reporters:['default',['json',{outputFile:'preparation/motion-test-results.json'}]]}});
