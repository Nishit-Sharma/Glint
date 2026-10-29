import {test,expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

test('tall contextual modules reveal bounded arriving parts once and retain keyboard edits',async({},info)=>{
 test.setTimeout(90000);
 await promisify(execFile)(process.execPath,['scripts/verify-tall-motion.mjs'],{cwd:resolve('.'),timeout:80000,maxBuffer:1024*1024});
 const path='evidence/module-arrival-motion/result.json';
 expect(JSON.parse(await readFile(path,'utf8')).passed).toBe(true);
 await info.attach('module-arrival-motion',{path,contentType:'application/json'});
});
