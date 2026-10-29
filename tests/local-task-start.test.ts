import {afterEach,beforeEach,expect,test} from 'vitest';
import {mkdtemp,rm,rename,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {createHash} from 'node:crypto';
import {readState} from '../src/core/store';
import {findLocalStartReceipt} from '../src/core/local-start-receipt';
import {createCompanion,type Companion} from '../src/core/companion';
import {projectTaskDialogue} from '../src/core/task-dialogue';
let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'local-task-start-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});
const textInput={intentId:'owned-text-intent',kind:'text' as const,title:'Owned rules',content:'Draft + Submit -> Ready'};
test('a local text start atomically saves one assigned task and ordinary source, and identical replay survives restart',async()=>{
 const first=await core.startLocalTask(textInput,'bot-original');
 expect(first.kind).toBe('text');expect(first.task.assignedBotId).toBe('bot-original');
 expect(first.task.sources).toHaveLength(1);expect(first.task.artifacts).toEqual([]);expect(first.task.requests).toEqual([]);
 expect(first.task.sources[0].versions[0]).toMatchObject({kind:'text',role:'fact',label:'Owned rules',content:'Draft + Submit -> Ready',version:1});
 expect(await core.listTasks()).toHaveLength(1);
 await core.close();core=await createCompanion({dataDir:root});
 const again=await core.startLocalTask(textInput,'bot-new-default');
 expect(again).toMatchObject({kind:'text',task:{id:first.task.id,assignedBotId:'bot-original',sources:first.task.sources}});
 if(first.kind==='text'&&again.kind==='text')expect(again.sourceId).toBe(first.sourceId);
 expect(await core.listTasks()).toHaveLength(1);
});
test('a local draft saves one ordinary Markdown document with no source claim or provider request',async()=>{
 const saved=await core.startLocalTask({intentId:'owned-draft',kind:'draft',content:'# A local draft\n\nUnsent work.'},'bot-original');
 expect(saved.kind).toBe('draft');expect(saved.task.title).toBe('# A local draft');expect(saved.task.sources).toEqual([]);expect(saved.task.requests).toEqual([]);
 expect(saved.task.artifacts).toHaveLength(1);expect(saved.task.artifacts[0].revisions[0]).toMatchObject({content:'# A local draft\n\nUnsent work.',mimeType:'text/markdown',sourceRefs:[],revision:1});
 expect(saved.task).not.toHaveProperty('localStart');
 if(saved.kind==='draft')expect(saved.artifactId).toBe(saved.task.artifacts[0].id);
});
test('concurrent repeated creation returns one target while an explicit new intent creates another',async()=>{
 const saved=await Promise.all(Array.from({length:3},()=>core.startLocalTask(textInput,'bot-original')));
 expect(new Set(saved.map(item=>item.task.id)).size).toBe(1);expect(await core.listTasks()).toHaveLength(1);
 const separate=await core.startLocalTask({...textInput,intentId:'new-deliberate-save'},'bot-original');
 expect(separate.task.id).not.toBe(saved[0].task.id);expect(await core.listTasks()).toHaveLength(2);
});
test('canonical titles permit equivalent retry while exact content remains bound to the original intent',async()=>{
 const input={intentId:'canonical-intent',kind:'text' as const,content:'  First line\r\nKeep this spacing.  '};
 const saved=await core.startLocalTask(input,'bot-original');expect(saved.task.title).toBe('First line');
 const same=await core.startLocalTask({content:input.content,title:' First line ',kind:'text',intentId:input.intentId},'bot-other');
 expect(same.task.id).toBe(saved.task.id);expect(same.task.sources[0].versions[0].content).toBe(input.content);
 await expect(core.startLocalTask({...input,content:input.content.trim()},'bot-original')).rejects.toThrow(/different text/);
});
test('same-intent replay preserves the original target and bot after edits; changed payloads cannot overwrite it',async()=>{
 const saved=await core.startLocalTask(textInput,'bot-original');if(saved.kind!=='text')throw Error('Expected source');
 await core.updateTask(saved.task.id,{title:'Renamed later'});
 await core.putSource(saved.task.id,{id:saved.sourceId,kind:'text',role:'fact',label:'Edited later',content:'Ready + Edit -> Draft'});
 const replay=await core.startLocalTask(textInput,'new-default');
 expect(replay).toMatchObject({kind:'text',sourceId:saved.sourceId,task:{id:saved.task.id,title:'Renamed later',assignedBotId:'bot-original'}});
 expect(replay.task.sources[0].versions).toHaveLength(2);
 for(const change of [{content:'Changed original payload'},{title:'Different title'},{kind:'draft'}])await expect(core.startLocalTask({...textInput,...change},'bot-original')).rejects.toThrow(/different text/);
 expect(await core.listTasks()).toHaveLength(1);
});
test('deleted local intents cannot resurrect tasks and intent IDs cannot cross into or out of request execution',async()=>{
 const saved=await core.startLocalTask(textInput,'bot-original'),other=await core.createTask({title:'Other'});
 let executed=false;
 await expect(core.runRequest({taskId:other.id,requestId:textInput.intentId,kind:'create',prompt:'A normal request'},async()=>{executed=true;return {title:'Unexpected',content:'Unexpected'};})).rejects.toThrow(/already used/);
 expect(executed).toBe(false);
 await core.deleteTask(saved.task.id);await core.close();core=await createCompanion({dataDir:root});
 await expect(core.startLocalTask(textInput,'bot-original')).rejects.toThrow(/already used/);
 await core.runRequest({taskId:other.id,requestId:'normal-request-id',kind:'create',prompt:'A local runner fixture'},async()=>({title:'Fixture',content:'No provider used'}));
 await expect(core.startLocalTask({...textInput,intentId:'normal-request-id'},'bot-original')).rejects.toThrow(/already used/);
 expect(await core.listTasks()).toHaveLength(1);
});
test('invalid or authority-bearing payloads save nothing and do not reserve the intent',async()=>{
 const bad=[{...textInput,taskId:'renderer-chosen'},{...textInput,assignedBotId:'renderer-chosen'},{...textInput,sourceRefs:[]},{...textInput,permissions:['capture']},{...textInput,kind:'module'},{...textInput,content:' \n '},{...textInput,content:'x'.repeat(100001)},{...textInput,title:'x'.repeat(201)},{...textInput,content:'bad\0text'}];
 for(const input of bad)await expect(core.startLocalTask(input,'bot-original')).rejects.toThrow(/Add text/);
 expect(await core.listTasks()).toEqual([]);
 await core.startLocalTask(textInput,'bot-original');expect(await core.listTasks()).toHaveLength(1);
});
test('host lifecycle cancellation before the atomic save creates neither task nor consumed intent',async()=>{
 let calls=0;
 await expect(core.startLocalTask(textInput,'bot-original',()=>{if(++calls===2)throw Error('Host retired before saving');})).rejects.toThrow('Host retired');
 expect(await core.listTasks()).toEqual([]);
 await core.startLocalTask(textInput,'bot-original');expect(await core.listTasks()).toHaveLength(1);
});
test('local creation receipts stay outside ordinary task history and detached request context',async()=>{
 const saved=await core.startLocalTask(textInput,'bot-original'),ledger=(await Effect.runPromise(readState(root))).usedRequestIds,receipt=findLocalStartReceipt(ledger,createHash('sha256').update(textInput.intentId).digest('hex'))!;
 expect(receipt).toBeDefined();expect(ledger.join('')).not.toContain(textInput.content);expect(ledger.join('')).not.toContain(textInput.title);expect(ledger.join('')).not.toContain(textInput.intentId);
 const history=projectTaskDialogue(saved.task,'later-request',[]);
 expect(history).not.toContain(textInput.intentId);expect(history).not.toContain(receipt.payloadDigest);expect(history).not.toContain('localStart');
 await core.runRequest({taskId:saved.task.id,requestId:'later-request',kind:'explain',prompt:'Explain the selected text.'},async context=>{
  expect(context.task).not.toHaveProperty('localStart');expect(context.taskHistory).not.toContain(textInput.intentId);expect(context.taskHistory).not.toContain(receipt.payloadDigest);
  return {title:'Local runner fixture',content:'No provider used'};
 });
 expect(await core.getTask(saved.task.id)).not.toHaveProperty('localStart');expect(await core.listTasks()).not.toHaveProperty('usedRequestIds');
 expect((await Effect.runPromise(readState(root))).usedRequestIds.slice(0,2)).toEqual(ledger);
});
test('a failed atomic write leaves no partial task or consumed intent after reopening the preserved store',async()=>{
 const store=join(root,'tasks.json'),backup=join(root,'original-tasks.json');
 await rename(store,backup);await mkdir(store);
 await expect(core.startLocalTask(textInput,'bot-original')).rejects.toThrow();await core.close();
 await rm(store,{recursive:true});await rename(backup,store);core=await createCompanion({dataDir:root});
 expect(await core.listTasks()).toEqual([]);expect((await Effect.runPromise(readState(root))).usedRequestIds).toEqual([]);
 const saved=await core.startLocalTask(textInput,'bot-original');expect(saved.task.sources).toHaveLength(1);expect(await core.listTasks()).toHaveLength(1);
});
