import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
const path='../../src/shared/picking-digest';
test('canonical local identities match SHA-256 on empty, Unicode and multi-block inputs',async()=>{
 const {pickingDigest}=await import(path);
 for(const value of [null,'',{z:'雪 🧭',a:[true,19,null]},'x'.repeat(4000)]){const encoded=JSON.stringify(value,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);expect(pickingDigest(value)).toBe(createHash('sha256').update(encoded).digest('hex'));}
 expect(pickingDigest({b:2,a:1})).toBe(pickingDigest({a:1,b:2}));
});
