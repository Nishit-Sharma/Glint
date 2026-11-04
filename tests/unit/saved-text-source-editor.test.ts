import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {createCompanion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {requestSavedTextSource} from '../../src/renderer/src/source-text-save-request';
import {SavedTextSourceEditor,type SavedTextSourceStart} from '../../src/renderer/src/components/SavedTextSourceEditor';
import {sourceTextDraftOwner,SOURCE_TEXT_DRAFT_SLOT} from '../../src/shared/source-text-draft';
import {learningDraftKey} from '../../src/shared/learning-drafts';
import type {SourceTextSaveInput} from '../../src/shared/source-text-save';
import type {Run} from '../../src/renderer/src/ui';
import type {Command,Task} from '../../src/shared/bridge';
import type {ExportCommand,ExportReply,OtherCommand} from '../../src/shared/export-contract';
import type {SourceRef} from '../../src/core/types';

type Renderer=ReturnType<typeof createControlledRenderer>;
type Host=ReturnType<Renderer['nodes']>[number];
const text=(node:Host):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
function field(renderer:Renderer,label:string){const labelNode=renderer.find(node=>node.type==='label'&&text(node)===label);return renderer.find(node=>['input','textarea','select'].includes(node.type)&&node.props.id===labelNode.props.htmlFor);}
function change(renderer:Renderer,label:string,value:string){field(renderer,label).props.onChange({target:{value}});renderer.render();}
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
function expectedSource(command:Command):(SourceRef&{freshness:'fresh'|'refresh-required'})|undefined{
 if(!('expectedSource' in command)||command.expectedSource===undefined)return;
 const value=command.expectedSource;
 if(!value||typeof value!=='object'||!('sourceId' in value)||typeof value.sourceId!=='string'||!('version' in value)||typeof value.version!=='number'||!('digest' in value)||typeof value.digest!=='string'||!('freshness' in value)||(value.freshness!=='fresh'&&value.freshness!=='refresh-required'))throw Error('Invalid finite source guard in fixture.');
 return {sourceId:value.sourceId,version:value.version,digest:value.digest,freshness:value.freshness};
}

/** Real product component functions/handlers, cache and atomic core/sidecar.
 * Existing controlled renderer substitutes React scheduling and DOM only; no
 * App/browser/native lifecycle or actual accessible-name engine claim. */
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'saved-source-component-')),core=await createCompanion({dataDir:directory});
 const created=await core.createTask({title:'Actual saved-source component'}),task=await core.putSource(created.id,{kind:'text',label:'Applied source name',content:'Applied source text.',role:'fact'}),source=task.sources[0],version=source.versions[0];
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)});
 let sidecarReply:{promise:Promise<void>;release:()=>void;reached:boolean}|undefined;
 const fault:{tombstone?:'reject-before'|'lose-after';sourceReply?:'lose-after'|'reject-before';sourceRefresh?:boolean}={},writes:{tombstone:boolean;outcome?:string}[]=[],events:string[]=[];
 const makeCache=()=>createLearningDrafts({read:()=>{events.push('read');return store.read();},save:async(...args)=>{
  const write:{tombstone:boolean;outcome?:string}={tombstone:args[4]===null};writes.push(write);
  events.push(write.tombstone?'save:null':'save:raw');
  const mode=write.tombstone?fault.tombstone:undefined;if(mode)fault.tombstone=undefined;
  if(mode==='reject-before'){write.outcome=mode;throw Error('Owned discard transport rejected before atomic write.');}
  const result=await store.save(...args);write.outcome=result.kind;
  if(write.tombstone&&sidecarReply){const held=sidecarReply;sidecarReply=undefined;held.reached=true;await held.promise;}
  if(mode==='lose-after'){write.outcome=mode;throw Error('Owned discard reply lost after actual atomic tombstone.');}
  return result;
 }});
 const cache=makeCache();await cache.load();cleanup.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 const sourceLock={current:false},sourceBusy:boolean[]=[];let genericSourceCalls=0;
 let currentEditor=true,currentTask=task,beforeWrite:(()=>Promise<void>)|undefined,reply:{promise:Promise<void>;release:()=>void;reached:boolean}|undefined;const commands:Command[]=[],done:unknown[]=[];
 function run<C extends ExportCommand>(command:C):Promise<ExportReply<C>|undefined>;
 function run<T=unknown>(command:OtherCommand):Promise<T|undefined>;
 async function run(command:Command):Promise<unknown>{
  if(command.type==='source.text.inspect'){const {type,...input}=command;return core.inspectTextSourceSave(input);}
  commands.push(structuredClone(command));if(command.type!=='source.text')throw Error('Unsupported component command.');
  if(fault.sourceReply==='reject-before'){fault.sourceReply=undefined;throw Error('Owned source write refused before commit.');}
  const hook=beforeWrite;beforeWrite=undefined;await hook?.();
  const result=command.edit?await core.saveTextSource({taskId:command.taskId,source:command.source,expectedSource:command.expectedSource,...command.edit}):await core.putSource(command.taskId,command.source,undefined,expectedSource(command));
  currentTask='kind' in result?result.task:result;
  const held=reply;reply=undefined;if(held){held.reached=true;await held.promise;}
  if(fault.sourceReply==='lose-after'){fault.sourceReply=undefined;throw Error('Owned source reply lost after actual commit.');}
  return result;
 }
 const start={reference:{sourceId:source.id,version:version.version,digest:version.digest},freshness:source.freshness,fields:{label:version.label,content:version.content,role:version.role}};
 const render=(current=cache,entryStart:SavedTextSourceStart=start)=>{const renderer=createControlledRenderer(()=>createElement(SavedTextSourceEditor,{task:currentTask,start:entryStart,cache:current,busy:false,run:((command:Command)=>{if(command.type==='source.text')genericSourceCalls++;return run(command as OtherCommand);}) as Run,saveSourceText:input=>requestSavedTextSource(input,{lock:sourceLock,setBusy:value=>sourceBusy.push(value),start:()=>events.push('source:start'),invoke:command=>run(command),refresh:async()=>{events.push('source:refresh');if(fault.sourceRefresh){fault.sourceRefresh=false;throw Error('Owned postcommit authoritative refresh failed.');}currentTask=await core.getTask(currentTask.id);}}),inspect:input=>core.inspectTextSourceSave(input),isCurrent:()=>currentEditor,onDone:reference=>done.push(reference)}));renderer.render();return renderer;};
 return {directory,core,task,source,sourceLock,sourceBusy,genericSourceCalls:()=>genericSourceCalls,store,cache,makeCache,render,commands,done,fault,writes,events,beforeSourceWrite:(hook:()=>Promise<void>)=>{beforeWrite=hook;},holdSourceReply(){let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});reply={promise,release,reached:false};return reply;},holdTombstoneReply(){let release!:()=>void;const promise=new Promise<void>(done=>{release=done;});sidecarReply={promise,release,reached:false};return sidecarReply;},retarget(){currentEditor=false;},updateTask:(next:Task)=>{currentTask=next;},key:learningDraftKey(sourceTextDraftOwner(task.id,source.id),SOURCE_TEXT_DRAFT_SLOT)};
}

it('intentional blank name and content remain visible and durable instead of restoring committed fact-source fields',async()=>{
 const f=await fixture(),renderer=f.render();
 change(renderer,'Source name (optional)','');change(renderer,'Source text','');
 await f.cache.flush();renderer.render();
 expect.soft(field(renderer,'Source name (optional)').props.value).toBe('');expect.soft(field(renderer,'Source text').props.value).toBe('');
 expect.soft(renderer.find(node=>node.type==='button'&&text(node)==='Save new version').props.disabled).toBe(true);
 expect.soft(f.cache.getSnapshot().entries[f.key].local).not.toBeNull();
 const reopened=f.makeCache();await reopened.load();const after=f.render(reopened);
 expect.soft(field(after,'Source name (optional)').props.value).toBe('');expect.soft(field(after,'Source text').props.value).toBe('');
 expect((await f.core.getTask(f.task.id)).sources).toEqual([f.source]);
 expect(f.commands).toEqual([]);expect(f.done).toEqual([]);
});

it.each(['version','freshness'] as const)('mounted editor holds raw and refuses source submission after the current %s changes',async changeKind=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Keep this raw for explicit review.');await f.cache.flush();
 const updated=changeKind==='version'?await f.core.putSource(f.task.id,{kind:'text',id:f.source.id,label:'External current name',content:'External committed version.',role:'style'}):await f.core.invalidateSource(f.task.id,f.source.id,'Changed after this editor opened.');
 f.updateTask(updated);renderer.render();const before=structuredClone(updated.sources);
 expect.soft(renderer.find(node=>node.type==='button'&&text(node)==='Save new version').props.disabled).toBe(true);
 // Calling the actual submit handler also models an already queued form event;
 // its current-state fence must refuse independently of the native disabled flag.
 await renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();
 expect.soft(f.commands).toEqual([]);expect.soft(f.done).toEqual([]);
 expect.soft(field(renderer,'Source text').props.value).toBe('Keep this raw for explicit review.');
 expect((await f.core.getTask(f.task.id)).sources).toEqual(before);
});

it.each(['reject-before','lose-after'] as const)('failed cancel %s keeps the exact visible raw and does not blindly replay its tombstone',async mode=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source name (optional)','Keep this raw name');change(renderer,'Source text','Keep this raw after an unconfirmed cancel.');await f.cache.flush();
 f.fault.tombstone=mode;renderer.find(node=>node.type==='button'&&text(node)==='Cancel').props.onClick();
 await vi.waitFor(()=>{renderer.render();expect(renderer.nodes().some(node=>node.type==='p'&&node.props.role==='alert'&&text(node).includes('Discarding these source edits was not confirmed.'))).toBe(true);});
 expect.soft(field(renderer,'Source name (optional)').props.value).toBe('Keep this raw name');
 expect.soft(field(renderer,'Source text').props.value).toBe('Keep this raw after an unconfirmed cancel.');
 expect(f.done).toEqual([]);expect(f.commands).toEqual([]);expect(f.writes.filter(write=>write.tombstone)).toHaveLength(1);
 const read=await f.store.read();expect(read.kind).toBe('available');if(read.kind!=='available')throw Error('Expected real store to stay readable.');
 expect(read.records[0].value===null).toBe(mode==='lose-after');expect((await f.core.getTask(f.task.id)).sources).toEqual([f.source]);
 const checkpoint=f.events.length;
 renderer.find(node=>node.type==='button'&&text(node)==='Retry source edit discard').props.onClick();
 await vi.waitFor(()=>{renderer.render();expect(f.done).toHaveLength(1);});
 expect(f.events.slice(checkpoint)[0]).toBe('read');expect(f.writes.filter(write=>write.tombstone)).toHaveLength(mode==='lose-after'?1:2);
 expect(f.cache.getSnapshot().entries[f.key].local).toBeNull();expect((await f.core.getTask(f.task.id)).sources).toEqual([f.source]);
});

it.each(['version','freshness'] as const)('source changed after renderer admission is protected by atomic %s CAS and keeps raw',async changeKind=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Exact original submitted raw.');await f.cache.flush();
 let external=f.task.sources;
 f.beforeSourceWrite(async()=>{const updated=changeKind==='version'?await f.core.putSource(f.task.id,{kind:'text',id:f.source.id,label:'Racing current source',content:'Committed after renderer admission.',role:'style'}):await f.core.invalidateSource(f.task.id,f.source.id,'Changed after renderer admission.');external=structuredClone(updated.sources);});
 await renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();
 expect.soft(f.commands).toHaveLength(1);
 expect.soft(f.commands[0]).toMatchObject({type:'source.text',expectedSource:{sourceId:f.source.id,version:1,digest:f.source.versions[0].digest,freshness:'fresh'}});
 expect.soft(f.done).toEqual([]);expect.soft(field(renderer,'Source text').props.value).toBe('Exact original submitted raw.');
 expect((await f.core.getTask(f.task.id)).sources).toEqual(external);
});

it('lost postcommit source reply preserves the original submitted identity while newer raw stays durable and reopen is inert',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Original submitted body.');await f.cache.flush();
 const held=f.holdSourceReply();f.fault.sourceReply='lose-after';
 const saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{
  await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();
  const atDispatch=f.cache.getSnapshot().entries[f.key].local!;const submitted=JSON.parse(atDispatch.value);
  expect.soft(submitted.intentId).toEqual(expect.stringMatching(/^[a-f0-9-]{36}$/));expect.soft(submitted.binding).toEqual(expect.stringMatching(/^source-text-edit:v1:[a-f0-9]{64}$/));
  expect.soft(field(renderer,'Source text').props.readOnly).toBe(false);
  change(renderer,'Source text','Newer body typed while the committed reply is held.');await f.cache.flush();
  const newer=JSON.parse(f.cache.getSnapshot().entries[f.key].local!.value);
  expect.soft(newer).toMatchObject({content:'Newer body typed while the committed reply is held.',intentId:submitted.intentId,binding:submitted.binding,submittedContent:'Original submitted body.',submittedFrozen:true});
  held.release();await saving;renderer.render();expect(f.done).toEqual([]);
  const task=await f.core.getTask(f.task.id),source=task.sources[0],version=source.versions.at(-1)!;
  expect(source.versions).toHaveLength(2);expect(version.content).toBe('Original submitted body.');
  const reopened=f.makeCache();await reopened.load();const view=f.render(reopened,{reference:{sourceId:source.id,version:version.version,digest:version.digest},freshness:source.freshness,fields:{label:version.label,content:version.content,role:version.role}});
  expect(field(view,'Source text').props.value).toBe('Newer body typed while the committed reply is held.');expect(f.commands).toHaveLength(1);
 }finally{held.release();await saving;}
});

async function checkSaved(renderer:Renderer){renderer.find(node=>node.type==='button'&&text(node)==='Check saved source').props.onClick();await vi.waitFor(()=>{renderer.render();expect(renderer.nodes().some(node=>node.type==='p'&&text(node)==='Checking the original source edit…')).toBe(false);});}
it.each([false,true])('confirmed own changed event before reply rebases only exact newer raw (newer=%s)',async newer=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Original explicit save.');await f.cache.flush();const held=f.holdSourceReply();const saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();if(newer){change(renderer,'Source text','Newer explicit raw.');await f.cache.flush();}held.release();await saving;renderer.render();
 const task=await f.core.getTask(f.task.id);expect(task.sources[0].versions).toHaveLength(2);
 if(newer){expect(f.done).toEqual([]);expect(field(renderer,'Source text').props.value).toBe('Newer explicit raw.');const local=f.cache.getSnapshot().entries[f.key].local!;expect(JSON.parse(local.value)).toMatchObject({intentId:'',content:'Newer explicit raw.'});expect(JSON.parse(local.basis)).toMatchObject({version:2,digest:task.sources[0].versions[1].digest});expect(renderer.find(node=>node.type==='button'&&text(node)==='Save new version').props.disabled).toBe(false);}
 else{expect(f.done).toHaveLength(1);expect(f.cache.getSnapshot().entries[f.key].local).toBeNull();}
 }finally{held.release();await saving;}
});
it('explicit check after lost response confirms one saved version and keeps newer raw on its confirmed basis',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Original saved via uncertain reply.');await f.cache.flush();const held=f.holdSourceReply();f.fault.sourceReply='lose-after';const saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();change(renderer,'Source text','Recover this newer raw.');await f.cache.flush();held.release();await saving;renderer.render();await checkSaved(renderer);
 expect(f.commands).toHaveLength(1);expect(f.done).toEqual([]);expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(2);expect(field(renderer,'Source text').props.value).toBe('Recover this newer raw.');expect(JSON.parse(f.cache.getSnapshot().entries[f.key].local!.value)).toMatchObject({intentId:'',content:'Recover this newer raw.'});
 }finally{held.release();await saving;}
});
it('an unchanged authoritative source permits only an explicit retry of the original identity and payload',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Original not committed.');await f.cache.flush();f.fault.sourceReply='reject-before';await renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();change(renderer,'Source text','Keep later typing through explicit retry.');await f.cache.flush();await checkSaved(renderer);
 expect(f.commands).toHaveLength(1);renderer.find(node=>node.type==='button'&&text(node)==='Retry original source save').props.onClick();await vi.waitFor(()=>{renderer.render();expect(f.commands).toHaveLength(2);expect(renderer.nodes().some(node=>node.type==='p'&&text(node).includes('earlier edit is saved'))).toBe(true);});
 expect(f.commands[1]).toEqual(f.commands[0]);expect((await f.core.getTask(f.task.id)).sources[0].versions.at(-1)!.content).toBe('Original not committed.');expect(field(renderer,'Source text').props.value).toBe('Keep later typing through explicit retry.');expect(f.done).toEqual([]);
});
it.each(['version','freshness'] as const)('an intervening external %s stays explicit recovery after own commit',async kind=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Own committed body.');await f.cache.flush();const held=f.holdSourceReply(),saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();change(renderer,'Source text','Newer raw for external conflict.');await f.cache.flush();const next=kind==='version'?await f.core.putSource(f.task.id,{kind:'text',id:f.source.id,label:'External after own save',content:'External newest body.',role:'style'}):await f.core.invalidateSource(f.task.id,f.source.id,'External freshness invalidation.');f.updateTask(next);held.release();await saving;renderer.render();
 expect(f.done).toEqual([]);expect(field(renderer,'Source text').props.value).toBe('Newer raw for external conflict.');expect(renderer.find(node=>node.type==='button'&&text(node)==='Save new version').props.disabled).toBe(true);expect((await f.core.getTask(f.task.id)).sources).toEqual(next.sources);expect(JSON.parse(f.cache.getSnapshot().entries[f.key].local!.basis).version).toBe(1);
 }finally{held.release();await saving;}
});
it.each(['retarget','cancelled-quit'] as const)('late same-owner completion cannot present across %s',async kind=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Saved before late presentation.');await f.cache.flush();const held=f.holdSourceReply(),saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));if(kind==='retarget')f.retarget();else{f.cache.setFrozen(true);f.cache.setFrozen(false);}held.release();await saving;renderer.render();expect(f.done).toEqual([]);expect(f.cache.getSnapshot().entries[f.key].local).toBeNull();expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(2);
 }finally{held.release();await saving;}
});

it.each(['version','freshness'] as const)('external %s arriving during held post-save sidecar completion cannot auto-present the old saved version',async kind=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Own version saved before sidecar completion.');await f.cache.flush();const held=f.holdTombstoneReply(),saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));const next=kind==='version'?await f.core.putSource(f.task.id,{kind:'text',id:f.source.id,label:'External while draft ack held',content:'External newest body during sidecar ack.',role:'style'}):await f.core.invalidateSource(f.task.id,f.source.id,'External invalidation during sidecar ack.');f.updateTask(next);renderer.render();held.release();await saving;renderer.render();expect.soft(f.done).toEqual([]);expect.soft(renderer.nodes().some(node=>node.type==='p'&&node.props.role==='alert'&&text(node).includes('source changed'))).toBe(true);expect((await f.core.getTask(f.task.id)).sources).toEqual(next.sources);
 }finally{held.release();await saving;}
});

it('two maximum escaped snapshots fail the unchanged aggregate limit explicitly, then confirmation stores only the newer raw',async()=>{
 const f=await fixture(),renderer=f.render(),original='\u0001'.repeat(1_000_000),newer='\u0002'.repeat(1_000_000);change(renderer,'Source text',original);await f.cache.flush();const durableBefore=await f.store.read();expect(durableBefore.kind).toBe('available');const held=f.holdSourceReply();f.fault.sourceReply='lose-after';const saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();change(renderer,'Source text',newer);await expect(f.cache.flush()).rejects.toThrow();renderer.render();expect(field(renderer,'Source text').props.value).toBe(newer);const durable=await f.store.read();expect(durable.kind).toBe('available');if(durable.kind!=='available')throw Error('Last durable source input must remain available.');expect(JSON.parse(durable.records[0].value!.value)).toMatchObject({content:original,submittedFrozen:false});
 f.cache.setFrozen(true);const quitting=expect(f.cache.flushForQuit()).rejects.toThrow();held.release();await saving;await quitting;f.cache.setFrozen(false);renderer.render();await checkSaved(renderer);expect(field(renderer,'Source text').props.value).toBe(newer);await f.cache.flush();const after=await f.store.read();expect(after.kind).toBe('available');if(after.kind!=='available')throw Error('Confirmed smaller current raw must persist.');expect(JSON.parse(after.records[0].value!.value)).toMatchObject({content:newer,intentId:'',submittedContent:'',submittedFrozen:false});expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(2);expect(f.commands).toHaveLength(1);expect(f.done).toEqual([]);
 }finally{held.release();await saving;f.cache.setFrozen(false);}
});
it('task deletion while own committed response is held cannot resurrect its source or retired draft',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Delete owner while original reply is held.');await f.cache.flush();const held=f.holdSourceReply(),saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));await f.core.deleteTask(f.task.id);f.cache.forgetTask(f.task.id);f.retarget();held.release();await saving;expect(f.done).toEqual([]);expect(f.cache.getSnapshot().entries[f.key]).toBeUndefined();expect((await f.core.listTasks()).find(task=>task.id===f.task.id)).toBeUndefined();expect(f.commands).toHaveLength(1);
 }finally{held.release();await saving;}
});

it('newer edit then undo during a held reply retains its newer generation even when its fields equal the submitted snapshot',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Exact submitted body before edit and undo.');await f.cache.flush();const held=f.holdSourceReply(),saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();change(renderer,'Source text','An intervening newer change.');change(renderer,'Source text','Exact submitted body before edit and undo.');await f.cache.flush();held.release();await saving;renderer.render();expect(f.done).toEqual([]);const raw=JSON.parse(f.cache.getSnapshot().entries[f.key].local!.value);expect(raw).toMatchObject({intentId:'',content:'Exact submitted body before edit and undo.'});expect(raw.editVersion).toBeGreaterThan(1);expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(2);
 }finally{held.release();await saving;}
});

it.each(['freshness','version'] as const)('Cancel after confirmed V2 with newer raw and external %s returns the known reconciled V2 rather than original V1 or an unreviewed newer source',async kind=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Own V2 original submitted body.');await f.cache.flush();const held=f.holdSourceReply();f.fault.sourceReply='lose-after';const saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{
  await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();change(renderer,'Source text','Newer unapplied raw after own commit.');await f.cache.flush();held.release();await saving;renderer.render();await checkSaved(renderer);
  const own=await f.core.getTask(f.task.id),v2=own.sources[0].versions[1];expect(own.sources[0].currentVersion).toBe(2);expect(JSON.parse(f.cache.getSnapshot().entries[f.key].local!.basis)).toMatchObject({version:2,digest:v2.digest});
  const stale=kind==='freshness'?await f.core.invalidateSource(f.task.id,f.source.id,'Actual external freshness change after confirmed V2.'):await f.core.putSource(f.task.id,{kind:'text',id:f.source.id,label:'External V3 current source',content:'External V3 that was never this editor baseline.',role:'style'});f.updateTask(stale);renderer.render();expect(renderer.find(node=>node.type==='button'&&text(node)==='Save new version').props.disabled).toBe(true);
  renderer.find(node=>node.type==='button'&&text(node)==='Cancel').props.onClick();await vi.waitFor(()=>{renderer.render();expect(f.done).toHaveLength(1);});expect(f.done[0]).toEqual({sourceId:f.source.id,version:2,digest:v2.digest});expect(f.cache.getSnapshot().entries[f.key].local).toBeNull();expect((await f.core.getTask(f.task.id)).sources).toEqual(stale.sources);
 }finally{held.release();await saving;}
});

it('checked uncommitted source save shows one authoritative source save guidance message',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Original edit awaiting an explicit same retry.');await f.cache.flush();f.fault.sourceReply='reject-before';await renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();await checkSaved(renderer);
 change(renderer,'Source text','Newer text after the original edit was authoritatively checked.');expect(renderer.nodes().filter(node=>node.type==='p'&&/original edit/i.test(text(node))).map(text)).toEqual(['The original edit has not been saved. Retry that same edit, or keep this text for review.']);expect(f.commands).toHaveLength(1);expect(f.genericSourceCalls()).toBe(0);expect(f.sourceBusy).toEqual([true,false]);expect(f.sourceLock.current).toBe(false);expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(1);
});

it.each(['invoke','refresh'] as const)('source request propagates %s failure to its caller and releases admission without a task-level error channel',async phase=>{
 const input:SourceTextSaveInput={taskId:'owned-task',source:{kind:'text',id:'owned-source',label:'Owned source',content:'Original exact source payload.',role:'fact'},expectedSource:{sourceId:'owned-source',version:1,digest:'a'.repeat(64),freshness:'fresh'},intentId:'00000000-0000-4000-8000-000000000001',binding:'source-text-edit:v1:'+ 'b'.repeat(64)},lock={current:false},events:string[]=[],failure=Error('Owned '+phase+' response failure'),commands:unknown[]=[];
 await expect(requestSavedTextSource(input,{lock,setBusy:value=>events.push('busy:'+value),start:()=>events.push('start'),invoke:async command=>{events.push('invoke');commands.push(command);if(phase==='invoke')throw failure;return {kind:'actual-host-result'};},refresh:async()=>{events.push('refresh');throw failure;}})).rejects.toBe(failure);
 expect(lock.current).toBe(false);expect(events).toEqual(phase==='invoke'?['busy:true','start','invoke','busy:false']:['busy:true','start','invoke','refresh','busy:false']);expect(commands).toEqual([{type:'source.text',taskId:input.taskId,source:input.source,expectedSource:input.expectedSource,edit:{intentId:input.intentId,binding:input.binding}}]);
});
it('source request retains the same App lock and busy admission through invoke and authoritative refresh, with no concurrent duplicate dispatch',async()=>{
 const input:SourceTextSaveInput={taskId:'owned-task',source:{kind:'text',id:'owned-source',label:'Owned source',content:'Original exact source payload.',role:'fact'},expectedSource:{sourceId:'owned-source',version:1,digest:'a'.repeat(64),freshness:'fresh'},intentId:'00000000-0000-4000-8000-000000000001',binding:'source-text-edit:v1:'+ 'b'.repeat(64)},lock={current:false},events:string[]=[],commands:unknown[]=[],result={kind:'actual-host-result'};let releaseInvoke!:(value:unknown)=>void,releaseRefresh!:()=>void;const invokeGate=new Promise<unknown>(done=>{releaseInvoke=done;}),refreshGate=new Promise<void>(done=>{releaseRefresh=done;});
 const effects={lock,setBusy:(value:boolean)=>events.push('busy:'+value),start:()=>events.push('start'),invoke:async(command:Extract<Command,{type:'source.text'}>)=>{events.push('invoke');commands.push(command);return invokeGate;},refresh:async()=>{events.push('refresh');await refreshGate;}};
 const first=requestSavedTextSource(input,effects);try{expect(lock.current).toBe(true);expect(await requestSavedTextSource(input,effects)).toBeUndefined();expect(commands).toHaveLength(1);releaseInvoke(result);await vi.waitFor(()=>expect(events).toContain('refresh'));expect(lock.current).toBe(true);expect(await requestSavedTextSource(input,effects)).toBeUndefined();releaseRefresh();expect(await first).toBe(result);expect(lock.current).toBe(false);expect(events).toEqual(['busy:true','start','invoke','refresh','busy:false']);}finally{releaseInvoke(result);releaseRefresh();await first;}
});

it('postcommit App refresh failure remains uncertain in the owning editor and confirms once while retaining newer raw',async()=>{
 const f=await fixture(),renderer=f.render();change(renderer,'Source text','Original source committed before failed refresh.');await f.cache.flush();const held=f.holdSourceReply();f.fault.sourceRefresh=true;const saving=renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 try{await vi.waitFor(()=>expect(held.reached).toBe(true));renderer.render();change(renderer,'Source text','Newer raw retained after authoritative refresh failure.');await f.cache.flush();held.release();await saving;renderer.render();expect(f.done).toEqual([]);expect(f.genericSourceCalls()).toBe(0);expect(f.sourceLock.current).toBe(false);expect(f.sourceBusy).toEqual([true,false]);expect(f.commands).toHaveLength(1);expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(2);expect(JSON.parse(f.cache.getSnapshot().entries[f.key].local!.value)).toMatchObject({content:'Newer raw retained after authoritative refresh failure.',submittedContent:'Original source committed before failed refresh.',submittedFrozen:true});expect(renderer.find(node=>node.type==='button'&&text(node)==='Save new version').props.disabled).toBe(true);
 await checkSaved(renderer);expect(f.commands).toHaveLength(1);expect(f.done).toEqual([]);expect((await f.core.getTask(f.task.id)).sources[0].versions).toHaveLength(2);expect(JSON.parse(f.cache.getSnapshot().entries[f.key].local!.value)).toMatchObject({content:'Newer raw retained after authoritative refresh failure.',intentId:'',submittedContent:''});expect(JSON.parse(f.cache.getSnapshot().entries[f.key].local!.basis).version).toBe(2);
 }finally{held.release();await saving;}
});
