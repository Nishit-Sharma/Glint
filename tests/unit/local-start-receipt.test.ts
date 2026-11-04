import {afterEach,beforeEach,expect,test} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {createCompanion,type Companion} from '../../src/core/companion';
import {readState,type State} from '../../src/core/store';
import {encodeLocalStartReceipt,findLocalStartReceipt,LOCAL_START_RECEIPT_LIMIT,type LocalStartReceipt} from '../../src/core/local-start-receipt';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const receipt:LocalStartReceipt={intentHash:hash('intent'),payloadDigest:hash('payload'),taskId:randomUUID(),kind:'text',targetId:randomUUID()};
const prefix='local-start:v1:',encoded=encodeLocalStartReceipt(receipt);
test('receipt is bounded, canonical, non-hash and resolves only the exact claimed intent',()=>{
 expect(encoded.length).toBeLessThan(LOCAL_START_RECEIPT_LIMIT);expect(encoded).not.toMatch(/^[a-f0-9]{64}$/);
 expect(findLocalStartReceipt([receipt.intentHash,encoded,'unrelated-opaque-entry'],receipt.intentHash)).toEqual(receipt);
 expect(findLocalStartReceipt([receipt.intentHash,encoded],hash('another'))).toBeUndefined();
 expect(findLocalStartReceipt(['unrelated-opaque-entry',hash('ordinary')],receipt.intentHash)).toBeUndefined();
});
test.each([
 ['broken JSON',prefix+'{'],
 ['unknown version',encoded.replace('v1:','v2:')],
 ['empty reserved family','local-start:'],
 ['too long',prefix+' '.repeat(LOCAL_START_RECEIPT_LIMIT)],
 ['extra field',prefix+JSON.stringify({...receipt,authority:'capture'})],
 ['missing field',prefix+JSON.stringify({...receipt,targetId:undefined})],
 ['wrong kind',prefix+JSON.stringify({...receipt,kind:'module'})],
 ['non-host task ID',prefix+JSON.stringify({...receipt,taskId:'renderer-chosen'})],
 ['non-host target ID',prefix+JSON.stringify({...receipt,targetId:'renderer-chosen'})],
 ['bad digest',prefix+JSON.stringify({...receipt,payloadDigest:'not-a-digest'})],
 ['trailing whitespace',encoded+' '],
 ['key ordering',prefix+JSON.stringify(Object.fromEntries(Object.entries(receipt).reverse()))],
 ['duplicate JSON key',encoded.replace('{','{"kind":"text",')],
])('reserved %s receipt is rejected without echoing stored data',(_label,entry)=>{
 expect(()=>findLocalStartReceipt([receipt.intentHash,entry],receipt.intentHash)).toThrow('A local save record is unreadable or conflicting. Your saved tasks are unchanged.');
});
test('duplicate intent receipts, reused task IDs and missing ordinary claims fail closed',()=>{
 expect(()=>findLocalStartReceipt([receipt.intentHash,encoded,encoded],receipt.intentHash)).toThrow(/conflicting/);
 const other={...receipt,intentHash:hash('other')};
 expect(()=>findLocalStartReceipt([receipt.intentHash,other.intentHash,encoded,encodeLocalStartReceipt(other)],receipt.intentHash)).toThrow(/conflicting/);
 expect(()=>findLocalStartReceipt([encoded],receipt.intentHash)).toThrow(/conflicting/);
});

let directory:string,core:Companion;
const input={intentId:'live-host-intent',kind:'text',title:'Private title',content:'Private original payload.'};
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'opaque-local-receipt-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function alterStore(change:(state:State)=>void){
 await core.close();const state=await Effect.runPromise(readState(directory));change(state);
 await writeFile(join(directory,'tasks.json'),JSON.stringify(state));core=await createCompanion({dataDir:directory});
}
test.each(['malformed','duplicate','missing claim','missing receipt','missing target','foreign target'] as const)('%s cannot recreate or redirect a local task and leaves saved bytes unchanged',async mode=>{
 const saved=await core.startLocalTask(input,'original-bot');
 const other=await core.startLocalTask({...input,intentId:'second-live-intent'},'other-bot');if(other.kind!=='text')throw Error('Expected text');
 await alterStore(state=>{
  const index=state.usedRequestIds.findIndex(entry=>entry.startsWith(prefix));
  const receipt=findLocalStartReceipt(state.usedRequestIds,hash(input.intentId))!;
  if(mode==='malformed')state.usedRequestIds[index]=prefix+'{';
  if(mode==='duplicate')state.usedRequestIds.push(state.usedRequestIds[index]);
  if(mode==='missing claim')state.usedRequestIds=state.usedRequestIds.filter(entry=>entry!==receipt.intentHash);
  if(mode==='missing receipt')state.usedRequestIds.splice(index,1);
  if(mode==='missing target')state.tasks.find(task=>task.id===saved.task.id)!.sources=[];
  if(mode==='foreign target')state.usedRequestIds[index]=encodeLocalStartReceipt({...receipt,targetId:other.sourceId});
 });
 const before=await readFile(join(directory,'tasks.json'));
 await expect(core.startLocalTask(input,'new-default')).rejects.toThrow(/unreadable|already used/);
 expect(await core.listTasks()).toHaveLength(2);expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
});
test('receipt-looking renderer intent cannot insert a ledger record or steal a replay',async()=>{
 const untrusted='local-start:v1:{"kind":"draft"}';
 const saved=await core.startLocalTask({...input,intentId:untrusted},'original-bot');
 const state=await Effect.runPromise(readState(directory));
 expect(state.usedRequestIds).toHaveLength(2);expect(state.usedRequestIds).toContain(hash(untrusted));expect(state.usedRequestIds).not.toContain(untrusted);
 expect(await core.startLocalTask({...input,intentId:untrusted},'different-default')).toEqual(saved);
 await expect(core.startLocalTask({...input,intentId:untrusted,content:'Changed'},'original-bot')).rejects.toThrow(/different text/);
});
