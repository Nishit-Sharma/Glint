import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Effect} from 'effect';
import {createCompanion,type Companion} from '../src/core/companion';
import {readState,type State} from '../src/core/store';
import {sourceTextSavePayload,sourceTextSaveBindingText,SOURCE_TEXT_SAVE_BINDING_PREFIX,readSourceTextSave,readSourceTextSaveInspection,type SourceTextSaveInput} from '../src/shared/source-text-save';

import {encodeSourceTextSaveReceipt,findSourceTextSaveReceipt,sourceTextSaveClaim,SOURCE_TEXT_SAVE_RECEIPT_LIMIT,type SourceTextSaveReceipt} from '../src/core/source-text-save-receipt';

const fault=vi.hoisted(()=>({rename:'none' as 'none'|'before'|'after'}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,rename:async(...args:Parameters<typeof fs.rename>)=>{const phase=fault.rename;fault.rename='none';if(phase==='before')throw Error('Synthetic rename failure before commit.');await fs.rename(...args);if(phase==='after')throw Error('Synthetic lost acknowledgement after rename.');}};});

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const basis={sourceId:'source',version:1,digest:'a'.repeat(64),freshness:'fresh' as const};
test('explicit save derives a nonempty label from the first nonblank line without changing the body',()=>{
 const content='\n  \r\n  Visit notes  \nKeep these exact spaces.  \n';
 const payload=sourceTextSavePayload('task',basis,{label:'  ',content,role:'fact'});
 expect(payload).toEqual({taskId:'task',source:{kind:'text',id:'source',label:'Visit notes',content,role:'fact'},expectedSource:basis});
 const clipped=sourceTextSavePayload('task',basis,{label:'',content:'a'.repeat(79)+'🐈tail',role:'style'});
 expect(clipped.source.label).toBe('a'.repeat(79));
 expect(sourceTextSavePayload('task',basis,{label:'',content:'\uD800',role:'fact'}).source.label).toBe('Text source');
 expect(sourceTextSaveBindingText(payload)).toBe('{"operation":"source-text-edit:v1","taskId":"task","expectedSource":{"sourceId":"source","version":1,"digest":"'+ 'a'.repeat(64)+'","freshness":"fresh"},"source":{"kind":"text","id":"source","label":"Visit notes","content":"\\n  \\r\\n  Visit notes  \\nKeep these exact spaces.  \\n","role":"fact"}}');
});

let directory:string,core:Companion;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'source-text-save-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
async function fixture(){
 const task=await core.createTask({title:'Synthetic visit'});
 const saved=await core.putSource(task.id,{id:'source',kind:'text',label:'Original',content:'Doors open at 18:00.',role:'fact'}),source=saved.sources[0],version=source.versions[0];
 const expectedSource={sourceId:source.id,version:version.version,digest:version.digest,freshness:source.freshness};
 const payload=sourceTextSavePayload(task.id,expectedSource,{label:'  Updated  ',content:'\nDoors open at 19:00.  \n',role:'style'});
 const input:SourceTextSaveInput={...payload,intentId:randomUUID(),binding:SOURCE_TEXT_SAVE_BINDING_PREFIX+hash(sourceTextSaveBindingText(payload))};
 const inspect={taskId:task.id,sourceId:source.id,expectedSource,intentId:input.intentId,binding:input.binding};
 return {task:saved,input,inspect};
}
test('one source edit saves once, confirms the historical version on replay, and returns the current task after later edits and restart',async()=>{
 const {input,inspect}=await fixture();
 const [saved,replayed]=await Promise.all([core.saveTextSource(input),core.saveTextSource(input)]);
 expect(saved).toEqual(replayed);expect(saved.kind).toBe('confirmed');
 expect(saved.reference).toMatchObject({sourceId:'source',version:2});
 expect(saved.task.sources[0].versions).toHaveLength(2);
 expect(saved.task.sources[0].versions[1]).toMatchObject({kind:'text',label:'Updated',content:'\nDoors open at 19:00.  \n',role:'style'});
 await core.putSource(input.taskId,{id:'source',kind:'text',label:'Later',content:'Later user edit.',role:'fact'});
 await core.updateTask(input.taskId,{title:'Renamed later'});
 await core.close();core=await createCompanion({dataDir:directory});
 const current=await core.saveTextSource(input);
 expect(current.reference).toEqual(saved.reference);expect(current.task.title).toBe('Renamed later');expect(current.task.sources[0].versions).toHaveLength(3);
 const before=await readFile(join(directory,'tasks.json'));
 expect(await core.inspectTextSourceSave(inspect)).toEqual(current);
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
});

async function alterStore(change:(state:State)=>void){
 await core.close();const state=await Effect.runPromise(readState(directory));change(state);
 await writeFile(join(directory,'tasks.json'),JSON.stringify(state));core=await createCompanion({dataDir:directory});
}
test('a receipt redirected to an existing older version cannot confirm a different source save',async()=>{
 const {input,inspect}=await fixture();await core.saveTextSource(input);
 await alterStore(state=>{
  const index=state.usedRequestIds.findIndex(entry=>entry.startsWith('source-text-save:v1:'));
  const receipt=JSON.parse(state.usedRequestIds[index].slice('source-text-save:v1:'.length));
  receipt.version=1;receipt.digest=input.expectedSource.digest;
  state.usedRequestIds[index]='source-text-save:v1:'+JSON.stringify(receipt);
 });
 const before=await readFile(join(directory,'tasks.json'));
 await expect(core.saveTextSource(input)).rejects.toThrow(/source save|source version/);
 await expect(core.inspectTextSourceSave(inspect)).rejects.toThrow(/source save|source version/);
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
});

const rebound=(input:SourceTextSaveInput,change:Partial<SourceTextSaveInput>):SourceTextSaveInput=>{const next={...input,...change};return {...next,binding:SOURCE_TEXT_SAVE_BINDING_PREFIX+hash(sourceTextSaveBindingText(next))};};
test('readers reject getters, hidden unknown fields, extra authority and invalid text without consuming an identity',async()=>{
 const {input,inspect}=await fixture();let getterCalls=0;
 const getter={...input};Object.defineProperty(getter,'source',{get(){getterCalls++;return input.source;},enumerable:true});
 const nested={...input,expectedSource:{...input.expectedSource}};Object.defineProperty(nested.expectedSource,'digest',{get(){getterCalls++;return basis.digest;},enumerable:true});
 const hidden={...input};Object.defineProperty(hidden,'authority',{value:'capture'});
 const invalidInputs:unknown[]=[getter,nested,hidden,{...input,source:{...input.source,windowId:'foreign'}},{...input,source:{...input.source,kind:'window'}},{...input,source:{...input.source,id:'other'}},{...input,source:{...input.source,content:' \n '}},{...input,source:{...input.source,content:'bad\0text'}},{...input,source:{...input.source,content:'x'.repeat(1_000_001)}},{...input,source:{...input.source,label:'x'.repeat(201)}},{...input,source:{...input.source,label:'bad\0label'}},{...input,source:{...input.source,role:'system'}},{...input,intentId:'renderer-intent'},{...input,binding:'source-text-edit:v1:'+ 'b'.repeat(64)},{...input,expectedSource:{...input.expectedSource,version:1.1}},{...input,expectedSource:{...input.expectedSource,version:Number.MAX_SAFE_INTEGER+1}},{...input,expectedSource:{...input.expectedSource,permission:true}}];
 const before=await readFile(join(directory,'tasks.json'));
 for(const invalid of invalidInputs)await expect(core.saveTextSource(invalid)).rejects.toThrow();
 const inspectionGetter={...inspect};Object.defineProperty(inspectionGetter,'expectedSource',{get(){getterCalls++;return inspect.expectedSource;},enumerable:true});
 expect(()=>readSourceTextSaveInspection(inspectionGetter)).toThrow();expect(()=>readSourceTextSaveInspection({...inspect,sourceId:'other'})).toThrow();
 expect(getterCalls).toBe(0);expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
 expect((await core.saveTextSource(input)).reference.version).toBe(2);
});
test('payload readers detach before queued work and preserve exact body limits',async()=>{
 const {input,inspect}=await fixture(),original=structuredClone(input);
 const saving=core.saveTextSource(input);input.source.content='Mutated after dispatch';input.source.label='Mutated';input.expectedSource={...input.expectedSource,version:9};
 expect((await saving).task.sources[0].versions[1].content).toBe(original.source.content);
 const inspecting=core.inspectTextSourceSave(inspect);inspect.sourceId='changed';inspect.expectedSource={...inspect.expectedSource,version:9};
 expect((await inspecting).kind).toBe('confirmed');
 const full=sourceTextSavePayload('task',basis,{label:'x'.repeat(200),content:'x'.repeat(1_000_000),role:'inspiration'});
 expect(full.source.content.length).toBe(1_000_000);expect(full.source.label.length).toBe(200);
 expect(readSourceTextSave({...original,source:{...original.source,label:'  Updated  '}})).toEqual(original);
});
test('changed payloads and foreign task or source owners cannot reuse an intent',async()=>{
 const {input,inspect}=await fixture();await core.saveTextSource(input);
 const other=await core.createTask({title:'Other owned task'});await core.putSource(other.id,{id:'other',kind:'text',label:'Other',content:'Other source',role:'fact'});
 for(const changed of [rebound(input,{source:{...input.source,content:'Different body'}}),rebound(input,{source:{...input.source,label:'Different label'}}),rebound(input,{source:{...input.source,role:'inspiration'}}),rebound(input,{taskId:other.id}),rebound(input,{source:{...input.source,id:'other'},expectedSource:{...input.expectedSource,sourceId:'other'}})])await expect(core.saveTextSource(changed)).rejects.toThrow(/different text|different source/);
 await expect(core.inspectTextSourceSave({...inspect,binding:SOURCE_TEXT_SAVE_BINDING_PREFIX+'c'.repeat(64)})).rejects.toThrow(/different text/);
 await expect(core.inspectTextSourceSave({...inspect,taskId:other.id})).rejects.toThrow(/different source/);
 expect((await core.getTask(input.taskId)).sources[0].versions).toHaveLength(2);
});
test.each(['version','freshness','kind','missing-source','missing-task'] as const)('%s changes reject pending saves and inspection never recreates anything',async mode=>{
 const {input,inspect}=await fixture();
 expect(await core.inspectTextSourceSave(inspect)).toMatchObject({kind:'uncommitted',expectedUnchanged:true});
 if(mode==='version')await core.putSource(input.taskId,{...input.source,content:'Later edit.'});
 if(mode==='freshness')await core.invalidateSource(input.taskId,'source','Needs explicit review.');
 if(mode==='kind')await core.putSource(input.taskId,{...input.source,kind:'image'});
 if(mode==='missing-source')await alterStore(state=>{state.tasks[0].sources=[];});
 if(mode==='missing-task')await core.deleteTask(input.taskId);
 const before=await readFile(join(directory,'tasks.json'));
 await expect(core.saveTextSource(input)).rejects.toThrow(/changed|not found/);
 if(mode.startsWith('missing'))await expect(core.inspectTextSourceSave(inspect)).rejects.toThrow(/not found/);
 else expect(await core.inspectTextSourceSave(inspect)).toMatchObject({kind:'uncommitted',expectedUnchanged:false});
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
});
test('a reviewed refresh-required text source saves fresh and applies the ordinary append effects once',async()=>{
 const {input}=await fixture();await core.invalidateSource(input.taskId,'source','Review required.');
 const pending=rebound(input,{expectedSource:{...input.expectedSource,freshness:'refresh-required'}});
 const before=await core.getTask(input.taskId),session=before.session!;
 await core.replaceSession(input.taskId,session.revision,{...session,browserContext:{origin:'https://fixture.invalid',url:'https://fixture.invalid',requestId:'old-browser'},draft:'Keep unsent text',draftKind:'explain',draftRevision:4});
 const observed=await core.getTask(input.taskId),saved=await core.saveTextSource(pending);
 expect(saved.task.sources[0].freshness).toBe('fresh');expect(saved.task.sources[0]).not.toHaveProperty('staleReason');
 expect(saved.task.session).toMatchObject({draft:'Keep unsent text',draftRevision:4,revision:observed.session!.revision+1,contextRevision:observed.session!.contextRevision!+1});
 expect(saved.task.session).not.toHaveProperty('browserContext');
 expect((await core.saveTextSource(pending)).task.session).toEqual(saved.task.session);
});
test('the host guard can cancel before commit without reserving the intent or modifying the source',async()=>{
 const {input}=await fixture();let calls=0;const before=await readFile(join(directory,'tasks.json'));
 await expect(core.saveTextSource(input,()=>{if(++calls===2)throw Error('Synthetic retired host.');})).rejects.toThrow('retired host');
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);expect((await core.saveTextSource(input)).reference.version).toBe(2);
});
test.each(['source','task'] as const)('a deleted committed %s stays deleted on save and inspection after reopen',async mode=>{
 const {input,inspect}=await fixture();await core.saveTextSource(input);
 if(mode==='task')await core.deleteTask(input.taskId);else await alterStore(state=>{state.tasks[0].sources=[];});
 await core.close();core=await createCompanion({dataDir:directory});const before=await readFile(join(directory,'tasks.json'));
 await expect(core.saveTextSource(input)).rejects.toThrow(/not found|no longer available/);
 await expect(core.inspectTextSourceSave(inspect)).rejects.toThrow(/not found|no longer available/);
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
});
test.each(['before','after'] as const)('a real store rename failure %s commit keeps source and receipt together and requires reopening',async phase=>{
 const {input,inspect}=await fixture(),before=await readFile(join(directory,'tasks.json'));
 fault.rename=phase;await expect(core.saveTextSource(input)).rejects.toThrow(/Synthetic/);
 await expect(core.saveTextSource(input)).rejects.toThrow(/reopen/);await expect(core.inspectTextSourceSave(inspect)).rejects.toThrow(/reopen/);
 const durable=await Effect.runPromise(readState(directory));
 expect(durable.tasks[0].sources[0].versions).toHaveLength(phase==='before'?1:2);
 expect(durable.usedRequestIds.filter(entry=>entry.startsWith('source-text-save'))).toHaveLength(phase==='before'?0:2);
 if(phase==='before')expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
 await core.close();core=await createCompanion({dataDir:directory});
 expect(await core.inspectTextSourceSave(inspect)).toMatchObject(phase==='before'?{kind:'uncommitted',expectedUnchanged:true}:{kind:'confirmed',reference:{version:2}});
 expect((await core.saveTextSource(input)).task.sources[0].versions).toHaveLength(2);
});

test('bounded canonical opaque receipts support escaped legacy IDs and ignore unrelated ledger entries',()=>{
 const receipt:SourceTextSaveReceipt={intentHash:'1'.repeat(64),payloadDigest:'2'.repeat(64),taskId:'\u0001'.repeat(200),sourceId:'\u001f'.repeat(200),version:Number.MAX_SAFE_INTEGER,digest:'3'.repeat(64)};
 const encoded=encodeSourceTextSaveReceipt(receipt),claim=sourceTextSaveClaim(receipt.intentHash);
 expect(encoded.length).toBeLessThan(SOURCE_TEXT_SAVE_RECEIPT_LIMIT);
 expect(findSourceTextSaveReceipt(['unknown opaque ledger string','4'.repeat(64),claim,encoded],receipt.intentHash)).toEqual(receipt);
 expect(claim).not.toMatch(/^[a-f0-9]{64}$/);
 for(const entry of ['source-text-save:','source-text-save:v2:{}',encoded+' ',encoded.replace('{','{"version":1,'),'source-text-save:v1:'+JSON.stringify({...receipt,authority:'capture'}),'source-text-save:v1:'+JSON.stringify({...receipt,sourceId:'x'.repeat(201)}),'source-text-save:v1:'+JSON.stringify({...receipt,version:1.2}),'source-text-save:v1:'+JSON.stringify({...receipt,digest:'INVALID'}),'source-text-save:v1:'+ ' '.repeat(SOURCE_TEXT_SAVE_RECEIPT_LIMIT)])expect(()=>findSourceTextSaveReceipt([claim,entry],receipt.intentHash)).toThrow(/unreadable or conflicting/);
 for(const entries of [[claim,encoded,encoded],[claim,claim,encoded],[encoded],[claim],['source-text-save-claim:v2:'+receipt.intentHash],['source-text-save-claim:v1:bad']])expect(()=>findSourceTextSaveReceipt(entries,receipt.intentHash)).toThrow(/unreadable or conflicting/);
 const duplicateVersion={...receipt,intentHash:'5'.repeat(64)};
 expect(()=>findSourceTextSaveReceipt([claim,encoded,sourceTextSaveClaim(duplicateVersion.intentHash),encodeSourceTextSaveReceipt(duplicateVersion)],receipt.intentHash)).toThrow(/unreadable or conflicting/);
});
test.each(['malformed','duplicate','missing-claim','missing-receipt','owner','digest'] as const)('a %s reserved receipt fails closed without changing saved bytes',async mode=>{
 const {input,inspect}=await fixture();await core.saveTextSource(input);
 await alterStore(state=>{
  const index=state.usedRequestIds.findIndex(entry=>entry.startsWith('source-text-save:v1:'));
  const receipt=JSON.parse(state.usedRequestIds[index].slice('source-text-save:v1:'.length)) as SourceTextSaveReceipt;
  if(mode==='malformed')state.usedRequestIds[index]='source-text-save:v1:{';
  if(mode==='duplicate')state.usedRequestIds.push(state.usedRequestIds[index]);
  if(mode==='missing-claim')state.usedRequestIds=state.usedRequestIds.filter(entry=>entry!==sourceTextSaveClaim(receipt.intentHash));
  if(mode==='missing-receipt')state.usedRequestIds.splice(index,1);
  if(mode==='owner')state.usedRequestIds[index]=encodeSourceTextSaveReceipt({...receipt,taskId:'another-owner'});
  if(mode==='digest')state.usedRequestIds[index]=encodeSourceTextSaveReceipt({...receipt,digest:'a'.repeat(64)});
 });
 const before=await readFile(join(directory,'tasks.json'));
 await expect(core.saveTextSource(input)).rejects.toThrow(/unreadable|different source|no longer available/);
 await expect(core.inspectTextSourceSave(inspect)).rejects.toThrow(/unreadable|different source|no longer available/);
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
});
test('source save claims cannot collide with ordinary or local creation intents and preserve unrelated opaque strings',async()=>{
 const first=await fixture(),second=await fixture();
 await core.runRequest({taskId:first.input.taskId,requestId:first.input.intentId,kind:'explain',prompt:'Synthetic fixture.'},async()=>({title:'Local output',content:'No provider used.'}));
 await core.startLocalTask({intentId:second.input.intentId,kind:'text',content:'Unrelated local creation.'},'fixture-bot');
 await alterStore(state=>{state.usedRequestIds.push('future opaque ledger string');});
 const ledger=(await Effect.runPromise(readState(directory))).usedRequestIds;
 expect((await core.saveTextSource(first.input)).reference.version).toBe(2);
 expect((await core.saveTextSource(second.input)).reference.version).toBe(2);
 const after=await Effect.runPromise(readState(directory));
 expect(after.usedRequestIds.slice(0,ledger.length)).toEqual(ledger);expect(after.usedRequestIds).toHaveLength(ledger.length+4);
 expect(after.usedRequestIds.join('')).not.toContain(first.input.source.content);
 expect((await core.getTask(first.input.taskId))).not.toHaveProperty('sourceTextSave');
});
test('the pinned old store reader and core preserve source-save receipts through later edits and deletion',async()=>{
 const {input,inspect}=await fixture(),saved=await core.saveTextSource(input);
 await alterStore(state=>{state.usedRequestIds.push('future opaque ledger string');});
 const ledger=(await Effect.runPromise(readState(directory))).usedRequestIds;await core.close();
 await mkdir(resolve('evidence'),{recursive:true});const readerDirectory=await mkdtemp(resolve('evidence/source-save-legacy-'));
 let old:Companion|undefined;
 try{
  const contents=await readFile(resolve('tests/fixtures/legacy-local-start-store.ts.txt'),'utf8');
  expect(hash(contents)).toBe('f92762234f2937d69d113b06109d5867f42a02afd58d738f96017db2dfbce831');
  const companion=await readFile(resolve('tests/fixtures/legacy-local-start-companion.ts.txt'),'utf8');
  expect(hash(companion)).toBe('7735e42bfc8ae7966202aad4044b0d3db8f348b5a42b53f4506385bffc4b70e7');
  const storeFile=join(readerDirectory,'store.mjs'),coreFile=join(readerDirectory,'companion.mjs');
  await build({stdin:{contents,loader:'ts',sourcefile:'legacy-store.ts',resolveDir:resolve('src/core')},outfile:storeFile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
  const legacy:typeof import('../src/core/store')=await import(pathToFileURL(storeFile).href);
  expect((await Effect.runPromise(legacy.readState(directory))).usedRequestIds).toEqual(ledger);
  await build({stdin:{contents:companion,loader:'ts',sourcefile:'legacy-companion.ts',resolveDir:resolve('src/core')},outfile:coreFile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'pinned-store',setup(build){build.onResolve({filter:/^\.\/store$/},()=>({path:'legacy-store',namespace:'pinned'}));build.onLoad({filter:/.*/,namespace:'pinned'},()=>({contents,loader:'ts',resolveDir:resolve('src/core')}));}}]});
  const legacyCore:typeof import('../src/core/companion')=await import(pathToFileURL(coreFile).href);
  old=await legacyCore.createCompanion({dataDir:directory});
  await old.putSource(input.taskId,{...input.source,content:'Later old-reader edit.'});await old.updateTask(input.taskId,{title:'Old-reader title'});
  await old.close();old=undefined;
  expect((await Effect.runPromise(legacy.readState(directory))).usedRequestIds).toEqual(ledger);
  core=await createCompanion({dataDir:directory});const replay=await core.saveTextSource(input);
  expect(replay.reference).toEqual(saved.reference);expect(replay.task.title).toBe('Old-reader title');expect(replay.task.sources[0].versions).toHaveLength(3);
  await core.close();old=await legacyCore.createCompanion({dataDir:directory});await old.deleteTask(input.taskId);await old.close();old=undefined;
  core=await createCompanion({dataDir:directory});await expect(core.inspectTextSourceSave(inspect)).rejects.toThrow(/not found/);await expect(core.saveTextSource(input)).rejects.toThrow(/not found/);
  expect((await Effect.runPromise(legacy.readState(directory))).usedRequestIds).toEqual(ledger);
 }finally{await old?.close();await rm(readerDirectory,{recursive:true,force:true});}
});
test('saving edited text retires its approved export and aborts its running request after the source commit',async()=>{
 const {input}=await fixture();
 const artifact=await core.saveArtifact(input.taskId,{title:'Synthetic output',content:'Derived from the old source.'});
 const proposed=await core.proposeExport(input.taskId,{artifactId:artifact.artifactId,revision:1,path:join(directory,'never-written.txt')});
 await core.approveExport(input.taskId,proposed.proposal.id,proposed.proposal.digest);
 let ready:()=>void=()=>{};const started=new Promise<void>(resolve=>{ready=resolve;});let observedSignal:AbortSignal|undefined;
 const running=core.runRequest({taskId:input.taskId,requestId:'pending-source-request',kind:'explain',prompt:'Synthetic local runner.'},async context=>{
  observedSignal=context.signal;ready();await new Promise<void>(resolve=>context.signal.addEventListener('abort',()=>resolve(),{once:true}));
  return {title:'Late output',content:'Must not become a new artifact.'};
 });
 await started;const saved=await core.saveTextSource(input);
 expect(saved.task.actions[0]).toMatchObject({status:'retired',error:'Source refreshed.'});
 expect(observedSignal?.aborted).toBe(true);expect((await running).status).toBe('cancelled');
 const task=await core.getTask(input.taskId);expect(task.artifacts).toHaveLength(1);expect(task.sources[0].versions).toHaveLength(2);
});
test('identity and digest readers reject a trailing newline instead of accepting a regex end anchor',async()=>{
 const {input,inspect}=await fixture();
 expect(()=>readSourceTextSave({...input,intentId:input.intentId+'\n'})).toThrow();
 expect(()=>readSourceTextSave({...input,binding:input.binding+'\n'})).toThrow();
 expect(()=>readSourceTextSave({...input,expectedSource:{...input.expectedSource,digest:input.expectedSource.digest+'\n'}})).toThrow();
 expect(()=>readSourceTextSaveInspection({...inspect,binding:inspect.binding+'\n'})).toThrow();
 const receipt:SourceTextSaveReceipt={intentHash:'1'.repeat(64)+'\n',payloadDigest:'2'.repeat(64),taskId:'legacy task',sourceId:'legacy source',version:2,digest:'3'.repeat(64)};
 expect(()=>encodeSourceTextSaveReceipt(receipt)).toThrow();
 expect(()=>findSourceTextSaveReceipt([sourceTextSaveClaim(receipt.intentHash)],receipt.intentHash)).toThrow();
});
