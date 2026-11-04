import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {RecurringWorkPanel} from '../src/renderer/src/components/RecurringWork';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createComposerDrafts} from '../src/renderer/src/composer-drafts';
import {createQuitDraftBarrier} from '../src/host/quit-drafts';
import {createCompanion} from '../src/core/companion';
import {learningDraftKey,parseLearningDraftOwner,parseLearningDraftValue,serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {emptyRecurringDraft,recurringDraftOwner,RECURRING_DRAFT_SLOT,RECURRING_DRAFT_BASIS,RECURRING_EDIT_DRAFT_BASIS,recurringEditDraftOwner} from '../src/shared/recurring-work-draft';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
type Renderer=ReturnType<typeof createControlledRenderer>;type Node=ReturnType<Renderer['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
const button=(renderer:Renderer,name:string)=>renderer.find(node=>node.type==='button'&&text(node)===name);
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-schedule-raw-'));let core=await createCompanion({dataDir:directory});
 cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),calls:any[]=[],writes:any[]=[];
 let beforeChange:(()=>Promise<void>)|undefined,readGate:Promise<void>|undefined,readEntered=()=>{},writeGate:Promise<void>|undefined,changeGate:Promise<void>|undefined,writeEntered=()=>{},changeEntered=()=>{},failWrites=false,loseAck=false,wrongReply=false;
 const newCache=()=>createLearningDrafts({read:()=>store.read(),save:async(...args)=>{writes.push(args);writeEntered();if(writeGate)await writeGate;if(failWrites)throw Error('Owned raw write failure');return store.save(...args);}});
 let cache=newCache(),epoch=0;await cache.load();
 let listener:(event:any)=>void=()=>{};
 const companion={subscribe:(next:(event:any)=>void)=>{listener=next;return ()=>{};},invoke:async(command:any)=>{calls.push(structuredClone(command));if(command.type==='schedules.get'){const items=await core.getRecurringWork();readEntered();if(readGate)await readGate;return {items,runtime:{state:'ready',message:'Synthetic source fixture'}};}if(command.type==='schedules.models')return {kind:'unavailable',message:'No cached model choices'};if(command.type==='schedules.change'){await beforeChange?.();const items=await core.changeRecurringWork(command.change);changeEntered();if(changeGate)await changeGate;if(loseAck)throw Error('Owned lost schedule ACK');return {items:wrongReply?[]:items,runtime:{state:'ready',message:'Synthetic source fixture'}};}throw Error('Unexpected command '+command.type);}};
 vi.stubGlobal('window',{companion});
 async function render(){const r=createControlledRenderer(()=>{const entryEpoch=epoch;return createElement(RecurringWorkPanel,{cache,isCurrent:()=>entryEpoch===epoch,onOpenTask:()=>{}});});r.render();await tick();r.render();return r;}
 function edit(r:Renderer,value:string,type='input',index=0){r.nodes().filter(node=>node.type===type)[index].props.onChange({target:{value}});r.render();}
 const hold=(kind:'write'|'change'|'read')=>{let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{if(kind==='read'){readGate=gate;readEntered=resolve;}else if(kind==='write'){writeGate=gate;writeEntered=resolve;}else{changeGate=gate;changeEntered=resolve;}});return {entered,release(){if(kind==='read')readGate=undefined;else if(kind==='write')writeGate=undefined;else changeGate=undefined;release();}};};
 return {directory,get core(){return core;},store,calls,writes,render,edit,async refresh(r:Renderer){listener({type:'schedules.changed'});await tick();r.render();},async reopenCore(){await core.close();core=await createCompanion({dataDir:directory});},get cache(){return cache;},async reopen(){cache=newCache();await cache.load();},leave(){epoch++;},beforeChange(work:()=>Promise<void>){beforeChange=work;},holdRead:()=>hold('read'),holdWrite:()=>hold('write'),holdChange:()=>hold('change'),failWrites(value=true){failWrites=value;},loseAck(){loseAck=true;},wrongReply(){wrongReply=true;}};
}
const owner=recurringDraftOwner,slot=RECURRING_DRAFT_SLOT,basis=RECURRING_DRAFT_BASIS,key=learningDraftKey(owner,slot);
function fill(f:Awaited<ReturnType<typeof fixture>>,r:Renderer){button(r,'New schedule').props.onClick();r.render();f.edit(r,'Owned schedule');f.edit(r,'Exact owned question.','textarea');}
const submit=(r:Renderer)=>r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}}) as Promise<void>;
test('actual form survives actual App quit flush and sidecar reopen without creating a schedule',async()=>{
 const f=await fixture(),r=await f.render();button(r,'New schedule').props.onClick();r.render();f.edit(r,'  Kept title  ');f.edit(r,'Exact unfinished question.','textarea');
 const source=await readFile('src/renderer/src/App.tsx','utf8'),start=source.indexOf("e => { if(e.type==='draft.flush')"),end=source.indexOf("if(e.type==='capture.retired')",start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const composer=createComposerDrafts(async()=>{throw Error('No composer write expected');});let discards=0;const quitDraftId={current:undefined as string|undefined};
 let handler:(event:any)=>void=()=>{};const barrier=createQuitDraftBarrier({send:quitId=>handler({type:'draft.flush',quitId}),confirmDiscard:async()=>{discards++;return false;}});
 handler=new Function('quitDraftId','drafts','learningDrafts','setDraftFrozen','bridge','draftNavigation','return e=>{'+source.slice(start+'e => {'.length,end)+'};')(quitDraftId,composer,f.cache,()=>{},{invoke:async(command:any)=>{expect(command.type).toBe('draft.flushed');barrier.acknowledge(command.quitId,command.error);}},{api:{hasDirty:()=>false}});
 expect(await barrier.request()).toMatchObject({allowQuit:true,saved:true});expect(discards).toBe(0);await f.reopen();const reopened=await f.render();button(reopened,reopened.nodes().some(node=>node.type==='button'&&text(node)==='Continue new schedule')?'Continue new schedule':'New schedule').props.onClick();reopened.render();
 expect(reopened.nodes().filter(node=>node.type==='input')[0].props.value).toBe('  Kept title  ');expect(reopened.nodes().filter(node=>node.type==='textarea')[0].props.value).toBe('Exact unfinished question.');expect(f.writes.length).toBeGreaterThan(0);expect(await f.core.getRecurringWork()).toEqual([]);expect(await f.core.listTasks()).toEqual([]);expect(f.calls.filter(command=>command.type==='schedules.change')).toEqual([]);
});
test('raw owner admits exact bounded incomplete fields, survives unrelated deletion, and rejects hidden grants or identities',async()=>{
 const f=await fixture(),raw={...emptyRecurringDraft,id:crypto.randomUUID(),title:'\0'.repeat(200),instruction:'\u0001'.repeat(10_000),next:'invalid local time',timeZone:'unfinished zone'};
 const envelope={initial:serializeLearningDraftJson(emptyRecurringDraft),value:serializeLearningDraftJson(raw),basis};
 await f.store.save(owner,slot,'initial',0,envelope);const task=await f.core.createTask({title:'Unrelated task'});await f.core.deleteTask(task.id);await f.store.purgeTask(task.id);expect(await f.store.cleanup()).toMatchObject({removed:0});await f.reopen();expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value).toEqual(raw);
 for(const hostile of [{...owner,taskId:'hidden'},{...owner,enabled:true},{...owner,grants:['run']}])expect(()=>parseLearningDraftOwner(hostile)).toThrow();
 for(const value of [{...raw,enabled:true},{...raw,instruction:'x'.repeat(10_001)},{...raw,id:''}])expect(()=>parseLearningDraftValue({...envelope,value:serializeLearningDraftJson(value)},owner,slot)).toThrow();
 expect(()=>parseLearningDraftValue({...envelope,basis:'another'},owner,slot)).toThrow();expect(()=>parseLearningDraftValue(envelope,owner,'another')).toThrow();expect(await f.core.getRecurringWork()).toEqual([]);
});
test('explicit discard saves its tombstone without changing existing schedules',async()=>{
 const f=await fixture(),r=await f.render();fill(f,r);await f.cache.flush();const saved=await f.core.changeRecurringWork({kind:'save',id:'existing',expectedRevision:0,title:'Existing',instruction:'Keep existing',intervalHours:24,nextDueAt:'2199-01-01T00:00:00.000Z'});
 await button(r,'Discard unfinished schedule').props.onClick();await tick();await f.cache.flush();await f.reopen();expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value).toEqual(emptyRecurringDraft);expect(await f.core.getRecurringWork()).toEqual(saved);expect((await f.store.read())).toMatchObject({records:[{value:null}]});
});
test.each(['navigation','raw generation','quit/resume'])('held raw flush refuses schedule publication after %s',async kind=>{
 const f=await fixture(),r=await f.render();fill(f,r);await f.cache.flush();const gate=f.holdWrite();f.edit(r,'Before pending flush');await gate.entered;const saving=submit(r);
 if(kind==='navigation')f.leave();else if(kind==='raw generation')f.cache.edit(owner,slot,emptyRecurringDraft,basis,raw=>({...raw,title:'Newer mirror'}));else{f.cache.setFrozen(true);f.cache.setFrozen(false);}
 gate.release();await saving;expect(f.calls.filter(command=>command.type==='schedules.change')).toEqual([]);expect(await f.core.getRecurringWork()).toEqual([]);expect(f.cache.getSnapshot().entries[key].local).not.toBeNull();
});
test('late confirmed Save preserves a newer edit-and-undo generation and does not close its form',async()=>{
 const f=await fixture(),r=await f.render();fill(f,r);const gate=f.holdChange(),saving=submit(r);await gate.entered;const raw=f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value;
 f.cache.edit(owner,slot,emptyRecurringDraft,basis,value=>({...value,title:'Newer mirror'}));f.cache.edit(owner,slot,emptyRecurringDraft,basis,()=>raw);gate.release();await saving;r.render();expect(r.nodes().some(node=>node.type==='form')).toBe(true);expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value).toEqual(raw);expect(await f.core.getRecurringWork()).toMatchObject([{enabled:false}]);
});
test('quit drains an in-flight Save and its exact raw tombstone without automatic navigation',async()=>{
 const f=await fixture(),r=await f.render();fill(f,r);const gate=f.holdChange(),saving=submit(r);await gate.entered;f.cache.setFrozen(true);let done=false;const quitting=f.cache.flushForQuit().then(()=>{done=true;});await tick();expect(done).toBe(false);gate.release();await saving;await quitting;r.render();expect(r.nodes().some(node=>node.type==='form')).toBe(true);expect(f.cache.getSnapshot().entries[key].local).toBeNull();await f.reopen();expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value).toEqual(emptyRecurringDraft);expect(await f.core.getRecurringWork()).toMatchObject([{enabled:false,history:[]}]);expect(await f.core.listTasks()).toEqual([]);
});
test.each(['lost','wrong'])('%s Save acknowledgement retains stable raw identity; reopen and explicit retry cannot duplicate',async kind=>{
 const f=await fixture(),r=await f.render();fill(f,r);if(kind==='lost')f.loseAck();else f.wrongReply();await submit(r);const raw=f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value;expect(raw.title).toBe('Owned schedule');expect(await f.core.getRecurringWork()).toHaveLength(1);await f.reopen();const reopened=await f.render();button(reopened,'Continue new schedule').props.onClick();reopened.render();await submit(reopened);expect(await f.core.getRecurringWork()).toHaveLength(1);expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value.id).toBe(raw.id);expect(await f.core.listTasks()).toEqual([]);
});
test('raw write failure prevents Save and quit reports failure while input remains recoverable',async()=>{
 const f=await fixture(),r=await f.render();f.failWrites();fill(f,r);await tick();r.render();await submit(r);f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();expect(await f.core.getRecurringWork()).toEqual([]);expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value.title).toBe('Owned schedule');f.cache.setFrozen(false);f.failWrites(false);await f.cache.retry(owner,slot);await f.reopen();expect(f.cache.readForm(owner,slot,emptyRecurringDraft,basis).value.title).toBe('Owned schedule');
});
test('restored timezone is displayed and blocks reinterpretation until explicit zone review',async()=>{
 const f=await fixture(),r=await f.render();fill(f,r);const zone=Intl.DateTimeFormat().resolvedOptions().timeZone==='Pacific/Honolulu'?'Etc/UTC':'Pacific/Honolulu';f.cache.edit(owner,slot,emptyRecurringDraft,basis,raw=>({...raw,timeZone:zone}));r.render();expect(button(r,'Save schedule').props.disabled).toBe(true);await submit(r);expect(await f.core.getRecurringWork()).toEqual([]);button(r,'Use current time zone').props.onClick();r.render();await submit(r);expect(await f.core.getRecurringWork()).toMatchObject([{enabled:false,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}]);expect(await f.core.listTasks()).toEqual([]);
});

const savedChange=(id='existing paused schedule')=>({kind:'save' as const,id,expectedRevision:0,title:'Original saved title',instruction:'Original saved question.',intervalHours:24 as const,nextDueAt:'2199-01-01T13:00:00.000Z',mode:'response' as const,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
async function existing(){const f=await fixture(),[saved]=await f.core.changeRecurringWork(savedChange()),r=await f.render();button(r,'Edit schedule').props.onClick();r.render();const editOwner=recurringEditDraftOwner(saved);return {f,r,saved,editOwner,editKey:learningDraftKey(editOwner,slot)};}
const editForm=(f:Awaited<ReturnType<typeof fixture>>,o:ReturnType<typeof recurringEditDraftOwner>)=>f.cache.readForm(o,slot,emptyRecurringDraft,RECURRING_EDIT_DRAFT_BASIS);
test('existing Edit raw invalid fields survive actual App quit, real core and cache reopen without changing paused schedule',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'  Kept existing title  ');f.edit(r,'Exact unsaved existing question.','textarea');f.edit(r,'','input',1);
 const source=await readFile('src/renderer/src/App.tsx','utf8'),start=source.indexOf("e => { if(e.type==='draft.flush')"),end=source.indexOf("if(e.type==='capture.retired')",start);expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
 const composer=createComposerDrafts(async()=>{throw Error('No composer write expected');}),quitDraftId={current:undefined as string|undefined};let handler:(e:any)=>void=()=>{},discards=0;
 const barrier=createQuitDraftBarrier({send:quitId=>handler({type:'draft.flush',quitId}),confirmDiscard:async()=>{discards++;return false;}});
 handler=new Function('quitDraftId','drafts','learningDrafts','setDraftFrozen','bridge','draftNavigation','return e=>{'+source.slice(start+'e => {'.length,end)+'};')(quitDraftId,composer,f.cache,()=>{},{invoke:async(command:any)=>barrier.acknowledge(command.quitId,command.error)},{api:{hasDirty:()=>false}});
 expect(await barrier.request()).toMatchObject({allowQuit:true,saved:true});expect(discards).toBe(0);await f.reopenCore();await f.reopen();const reopened=await f.render();button(reopened,'Edit schedule').props.onClick();reopened.render();expect(reopened.nodes().filter(node=>node.type==='input').map(node=>node.props.value)).toEqual(['  Kept existing title  ','']);expect(reopened.nodes().find(node=>node.type==='textarea')?.props.value).toBe('Exact unsaved existing question.');expect(editForm(f,editOwner).value.next).toBe('');expect(await f.core.getRecurringWork()).toEqual([saved]);expect(await f.core.listTasks()).toEqual([]);expect(f.calls.filter(command=>command.type==='schedules.change')).toEqual([]);
});
test('Edit owner binds target revision and snapshot, rejects hidden authority/raw identity, and leaves New UUID contract unchanged',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'  Raw edit  ');f.edit(r,'raw invalid due','input',1);await f.cache.flush();const envelope={initial:serializeLearningDraftJson(emptyRecurringDraft),value:serializeLearningDraftJson(editForm(f,editOwner).value),basis:RECURRING_EDIT_DRAFT_BASIS};
 expect(()=>parseLearningDraftValue(envelope,editOwner,slot)).not.toThrow();for(const owner of [{...editOwner,enabled:true},{...editOwner,scheduleRevision:0},{...editOwner,scheduleDigest:'wrong'}])expect(()=>parseLearningDraftOwner(owner)).toThrow();
 for(const raw of [{...editForm(f,editOwner).value,id:'another'},{...editForm(f,editOwner).value,enabled:true}])expect(()=>parseLearningDraftValue({...envelope,value:serializeLearningDraftJson(raw)},editOwner,slot)).toThrow();
 expect(()=>parseLearningDraftValue({...envelope,basis:RECURRING_DRAFT_BASIS},editOwner,slot)).toThrow();expect(()=>parseLearningDraftValue({...envelope,basis},owner,slot)).toThrow();
 expect(learningDraftKey(recurringEditDraftOwner({...saved,revision:saved.revision+1}),slot)).not.toBe(learningDraftKey(editOwner,slot));expect(learningDraftKey(recurringEditDraftOwner({...saved,createdAt:'2198-01-01T00:00:00.000Z'}),slot)).not.toBe(learningDraftKey(editOwner,slot));
});
test('Edit Back keeps raw fields; explicit discard persists tombstone and leaves saved schedule unchanged',async()=>{
 const {f,r,saved,editOwner,editKey}=await existing();f.edit(r,'Unfinished edit');await f.cache.flush();button(r,'Back to schedules').props.onClick();r.render();await f.reopen();const reopened=await f.render();button(reopened,'Edit schedule').props.onClick();reopened.render();expect(reopened.nodes().filter(node=>node.type==='input')[0].props.value).toBe('Unfinished edit');await button(reopened,'Discard unfinished schedule').props.onClick();await f.reopen();expect(editForm(f,editOwner).value).toEqual(emptyRecurringDraft);expect(f.cache.getSnapshot().entries[editKey].local).toBeNull();expect(await f.core.getRecurringWork()).toEqual([saved]);
});
test.each(['changed','deleted','recreated'])('earlier Edit stays inspectable and inert after %s target, including restart',async kind=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Earlier raw title');await f.cache.flush();if(kind==='changed')await f.core.changeRecurringWork({...savedChange(saved.id),expectedRevision:saved.revision,title:'Changed saved title'});else{await f.core.changeRecurringWork({kind:'delete',id:saved.id,expectedRevision:saved.revision});if(kind==='recreated')await f.core.changeRecurringWork({...savedChange(saved.id),title:'Replacement saved title'});}
 const after=await f.core.getRecurringWork();await f.refresh(r);expect(button(r,'Save schedule').props.disabled).toBe(true);await submit(r);expect(await f.core.getRecurringWork()).toEqual(after);await f.reopenCore();await f.reopen();const reopened=await f.render();expect(reopened.nodes().some(node=>node.type==='summary'&&text(node)==='Unfinished edits for an earlier schedule version')).toBe(true);expect(reopened.nodes().some(node=>node.type==='input'&&node.props.readOnly&&node.props.value==='Earlier raw title')).toBe(true);
 if(kind!=='deleted'){button(reopened,'Edit schedule').props.onClick();reopened.render();expect(reopened.nodes().filter(node=>node.type==='input'&&!node.props.readOnly)[0].props.value).toBe(kind==='changed'?'Changed saved title':'Replacement saved title');}expect(editForm(f,editOwner).value.title).toBe('Earlier raw title');button(reopened,'Discard earlier schedule edits').props.onClick();await f.cache.flush();await f.reopen();expect(editForm(f,editOwner).value).toEqual(emptyRecurringDraft);expect(await f.core.getRecurringWork()).toEqual(after);
});
test.each(['navigation','raw generation','quit/resume','saved revision'])('held Edit raw flush refuses schedule publication after %s',async kind=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Unfinished edit');await f.cache.flush();const gate=f.holdWrite();f.edit(r,'Captured edit');await gate.entered;const saving=submit(r);
 if(kind==='navigation')f.leave();else if(kind==='raw generation')f.cache.edit(editOwner,slot,emptyRecurringDraft,RECURRING_EDIT_DRAFT_BASIS,raw=>({...raw,title:'Newer raw'}));else if(kind==='saved revision'){await f.core.changeRecurringWork({...savedChange(saved.id),expectedRevision:saved.revision,title:'Changed target'});await f.refresh(r);}else{f.cache.setFrozen(true);f.cache.setFrozen(false);}
 gate.release();await saving;expect(f.calls.filter(command=>command.type==='schedules.change')).toEqual([]);expect(editForm(f,editOwner).value.id).toBe(saved.id);
});
test('Edit Save acknowledges exact generation and closes after parent renders saved revision during tombstone flush',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Saved edited title');await f.cache.flush();const change=f.holdChange(),saving=submit(r);await change.entered;const write=f.holdWrite();change.release();await write.entered;r.render();expect(r.nodes().some(node=>node.type==='form')).toBe(true);write.release();await saving;r.render();expect(r.nodes().some(node=>node.type==='form')).toBe(false);expect(editForm(f,editOwner).value).toEqual(emptyRecurringDraft);expect(await f.core.getRecurringWork()).toMatchObject([{id:saved.id,title:'Saved edited title',revision:2,enabled:false,history:[]}]);expect(await f.core.listTasks()).toEqual([]);
});
test.each(['lost','wrong'])('Edit %s Save ACK preserves raw under earlier revision without duplicate or implicit retry',async kind=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Raw attempted edit');if(kind==='lost')f.loseAck();else f.wrongReply();await submit(r);await f.cache.flush();expect(editForm(f,editOwner).value.title).toBe('Raw attempted edit');expect(await f.core.getRecurringWork()).toHaveLength(1);await f.reopenCore();await f.reopen();const reopened=await f.render();expect(reopened.nodes().some(node=>node.type==='input'&&node.props.readOnly&&node.props.value==='Raw attempted edit')).toBe(true);expect(f.calls.filter(command=>command.type==='schedules.change')).toHaveLength(1);expect(await f.core.getRecurringWork()).toMatchObject([{id:saved.id,revision:2,enabled:false,history:[]}]);
});
test('Edit local write failure refuses Save and quit, and retry preserves exact input',async()=>{
 const {f,r,saved,editOwner}=await existing();f.failWrites();f.edit(r,'Kept failed local edit');await tick();r.render();await submit(r);f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();expect(await f.core.getRecurringWork()).toEqual([saved]);f.cache.setFrozen(false);f.failWrites(false);await f.cache.retry(editOwner,slot);await f.reopen();expect(editForm(f,editOwner).value.title).toBe('Kept failed local edit');
});

test('Edit late Save ACK preserves a newer edit-and-undo raw generation',async()=>{
 const {f,r,editOwner}=await existing();f.edit(r,'Attempted saved edit');const gate=f.holdChange(),saving=submit(r);await gate.entered;const raw=editForm(f,editOwner).value;f.cache.edit(editOwner,slot,emptyRecurringDraft,RECURRING_EDIT_DRAFT_BASIS,value=>({...value,title:'Newer raw'}));f.cache.edit(editOwner,slot,emptyRecurringDraft,RECURRING_EDIT_DRAFT_BASIS,()=>raw);gate.release();await saving;r.render();expect(r.nodes().some(node=>node.type==='form')).toBe(true);expect(editForm(f,editOwner).value).toEqual(raw);expect(await f.core.getRecurringWork()).toMatchObject([{enabled:false,history:[]}]);
});
test('quit drains in-flight Edit Save and its exact tombstone without automatic navigation',async()=>{
 const {f,r,editOwner,editKey}=await existing();f.edit(r,'Explicit edited save');const gate=f.holdChange(),saving=submit(r);await gate.entered;f.cache.setFrozen(true);let done=false;const quitting=f.cache.flushForQuit().then(()=>{done=true;});await tick();expect(done).toBe(false);gate.release();await saving;await quitting;r.render();expect(r.nodes().some(node=>node.type==='form')).toBe(true);expect(f.cache.getSnapshot().entries[editKey].local).toBeNull();await f.reopen();expect(editForm(f,editOwner).value).toEqual(emptyRecurringDraft);expect(await f.core.getRecurringWork()).toMatchObject([{enabled:false,history:[]}]);expect(await f.core.listTasks()).toEqual([]);
});

test('Edit refreshes exact saved snapshot before dispatch even without a schedules event',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Earlier pending raw');await f.cache.flush();await f.core.changeRecurringWork({kind:'delete',id:saved.id,expectedRevision:saved.revision});const recreated=await f.core.changeRecurringWork({...savedChange(saved.id),title:'Replacement without event'});await submit(r);expect(f.calls.filter(command=>command.type==='schedules.change')).toEqual([]);expect(await f.core.getRecurringWork()).toEqual(recreated);expect(editForm(f,editOwner).value.title).toBe('Earlier pending raw');
});

test('Edit rechecks raw generation after its asynchronous saved-snapshot read',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Captured raw');await f.cache.flush();const gate=f.holdRead(),saving=submit(r);await gate.entered;f.cache.edit(editOwner,slot,emptyRecurringDraft,RECURRING_EDIT_DRAFT_BASIS,raw=>({...raw,title:'Newer mirror raw'}));gate.release();await saving;expect(f.calls.filter(command=>command.type==='schedules.change')).toEqual([]);expect(await f.core.getRecurringWork()).toEqual([saved]);expect(editForm(f,editOwner).value.title).toBe('Newer mirror raw');
});

test('Edit atomic core digest refuses same-id/revision replacement after renderer preflight without changing replacement',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Earlier raw must never overwrite replacement');await f.cache.flush();let replacement:Awaited<ReturnType<typeof f.core.getRecurringWork>>=[];
 f.beforeChange(async()=>{await f.core.changeRecurringWork({kind:'delete',id:saved.id,expectedRevision:saved.revision});replacement=await f.core.changeRecurringWork({...savedChange(saved.id),title:'Replacement between read and commit'});});await submit(r);expect(f.calls.filter(command=>command.type==='schedules.change')).toMatchObject([{change:{expectedDigest:editOwner.scheduleDigest}}]);expect(await f.core.getRecurringWork()).toEqual(replacement);expect(replacement).toMatchObject([{title:'Replacement between read and commit',revision:1,enabled:false,history:[]}]);expect(editForm(f,editOwner).value.title).toBe('Earlier raw must never overwrite replacement');expect(await f.core.listTasks()).toEqual([]);
});
test('core atomic digest accepts exact snapshot, refuses malformed/stale/missing targets, and preserves old Save callers',async()=>{
 const {f,saved,editOwner}=await existing();expect(()=>f.core.changeRecurringWork({...savedChange(saved.id),expectedRevision:saved.revision,expectedDigest:'not-a-digest'})).toThrow();await expect(f.core.changeRecurringWork({...savedChange(saved.id),expectedRevision:saved.revision,expectedDigest:'0'.repeat(64)})).rejects.toThrow();expect(await f.core.getRecurringWork()).toEqual([saved]);
 const [updated]=await f.core.changeRecurringWork({...savedChange(saved.id),expectedRevision:saved.revision,expectedDigest:editOwner.scheduleDigest,title:'Exact snapshot accepted'});expect(updated).toMatchObject({id:saved.id,revision:2,title:'Exact snapshot accepted',enabled:false,history:[]});await expect(f.core.changeRecurringWork({...savedChange('missing'),expectedDigest:editOwner.scheduleDigest})).rejects.toThrow();await f.core.changeRecurringWork({...savedChange('old caller without digest')});expect(await f.core.getRecurringWork()).toHaveLength(2);
});

test('failed discard of stale Edit exposes retained saved fields and truthful error until retry persists tombstone',async()=>{
 const {f,r,saved,editOwner}=await existing();f.edit(r,'Retained earlier raw after failed discard');await f.cache.flush();await f.core.changeRecurringWork({...savedChange(saved.id),expectedRevision:saved.revision,title:'Changed saved target'});await f.refresh(r);button(r,'Back to schedules').props.onClick();r.render();f.failWrites();button(r,'Discard earlier schedule edits').props.onClick();await tick();r.render();const entry=f.cache.getSnapshot().entries[learningDraftKey(editOwner,slot)];expect(entry.local).toBeNull();expect(entry.error).toBeTruthy();expect(r.nodes().some(node=>node.type==='details'&&node.props.open&&text(node).includes('Discard or local storage was not confirmed.'))).toBe(true);expect(r.nodes().some(node=>node.type==='input'&&node.props.readOnly&&node.props.value==='Retained earlier raw after failed discard')).toBe(true);expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('Discard or local storage was not confirmed.'))).toBe(true);f.failWrites(false);await f.cache.retry(editOwner,slot);await f.cache.flush();await f.reopen();expect(editForm(f,editOwner).value).toEqual(emptyRecurringDraft);expect(await f.core.getRecurringWork()).toMatchObject([{title:'Changed saved target',revision:2,enabled:false,history:[]}]);
});
