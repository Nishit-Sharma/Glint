import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {createComposerDrafts} from '../../src/renderer/src/composer-drafts';
import {createQuitDraftBarrier} from '../../src/host/quit-drafts';
import {RecurringWorkPanel} from '../../src/renderer/src/components/RecurringWork';
import {TaskHistory} from '../../src/renderer/src/components/TaskHistory';
import {DraftNavigationProvider,useDraftNavigation} from '../../src/renderer/src/draft-navigation';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

const cleanup:Array<()=>Promise<void>>=[];afterEach(async()=>{vi.unstubAllGlobals();for(const close of cleanup.splice(0).reverse())await close();});
type Renderer=ReturnType<typeof createControlledRenderer>;type Node=ReturnType<Renderer['nodes']>[number];
const text=(n:Node):string=>n.type==='#text'?n.props.text:n.children.map(text).join('');
const button=(r:Renderer,label:string)=>r.find(n=>n.type==='button'&&text(n)===label);
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function hold(){let release!:()=>void,enter!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),started:new Promise<void>(resolve=>enter=resolve),release:()=>release(),enter:()=>enter()};}
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'glint-quit-unsaved-')),core=await createCompanion({dataDir:directory});cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const saved=await core.changeRecurringWork({kind:'save',id:'paused-owned',expectedRevision:0,title:'Saved title',instruction:'Saved question.',mode:'response',intervalHours:24,nextDueAt:'2199-01-01T13:00:00.000Z',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(t=>t.id===id)}),writes:unknown[]=[],cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>{writes.push(args);return store.save(...args);}});await cache.load();
 const commands:any[]=[],prompts:string[]=[],acks:any[]=[],quitDraftId={current:undefined as string|undefined};let answer=false,composerGate:ReturnType<typeof hold>|undefined;
 const composer=createComposerDrafts(async(taskId,revision,value)=>{composerGate?.enter();await composerGate?.wait;return core.saveComposerDraft(taskId,revision,value);});
 let nav!:ReturnType<typeof useDraftNavigation>,handler:(event:any)=>void=()=>{},historyTask:Awaited<ReturnType<typeof core.createTask>>|undefined;
 const barrier=createQuitDraftBarrier({send:quitId=>handler({type:'draft.flush',quitId}),confirmDiscard:async reason=>{prompts.push(reason);return answer;}});
 const invoke=async(command:any)=>{commands.push(command);if(command.type==='draft.flushed'){acks.push(command);return barrier.acknowledge(command.quitId,command.error);}if(command.type==='schedules.get')return {items:await core.getRecurringWork(),runtime:{state:'stopped',message:'No scheduler in this fixture'}};if(command.type==='schedules.models')return {kind:'unavailable',message:'No model transport'};throw Error('Unexpected command '+command.type);};
 vi.stubGlobal('window',{companion:{subscribe:()=>()=>{},invoke}});
 function Surface(){nav=useDraftNavigation();return createElement(DraftNavigationProvider,{value:nav.api,children:historyTask?createElement(TaskHistory,{task:historyTask,busy:false,run:async()=>{throw Error('Activity note must stay unsaved');}}):createElement(RecurringWorkPanel,{cache,isCurrent:()=>true,onOpenTask:()=>{}})});}
 const renderer=createControlledRenderer(()=>createElement(Surface));renderer.render();await tick();renderer.render();
 const source=await readFile('src/renderer/src/App.tsx','utf8'),start=source.indexOf("e => { if(e.type==='draft.flush')"),end=source.indexOf("if(e.type==='capture.retired')",start);if(start<0||end<start)throw Error('Actual App draft handler changed.');
 handler=new Function('quitDraftId','drafts','learningDrafts','setDraftFrozen','bridge','draftNavigation','return e=>{'+source.slice(start+'e => {'.length,end)+'};')(quitDraftId,composer,cache,()=>{},{invoke},nav);
 const edit=(value:string,type='input',index=0)=>{renderer.nodes().filter(n=>n.type===type)[index].props.onChange({target:{value}});renderer.render();};
 const fields=()=>({title:renderer.nodes().filter(n=>n.type==='input')[0].props.value,question:renderer.nodes().filter(n=>n.type==='textarea')[0].props.value,next:renderer.nodes().filter(n=>n.type==='input')[1].props.value});
 return {directory,core,cache,composer,renderer,writes,commands,prompts,acks,saved,barrier,handler,edit,fields,get nav(){return nav;},async activity(){historyTask=await core.createTask({title:'Uncached Activity note owner'});renderer.render();button(renderer,'Add note').props.onClick();renderer.render();return historyTask;},note:()=>renderer.find(n=>n.type==='textarea').props.value,answer(value:boolean){answer=value;},holdComposer(){return composerGate=hold();}};
}
test('actual uncached Activity note reaches existing quit Keep decision and retains exact open fields',async()=>{
 const f=await fixture();await f.activity();f.edit('  Exact unsaved Activity note.\nSecond line.  ','textarea');const before=f.note(),saved=await f.core.contentSnapshot();expect(f.nav.api.hasDirty()).toBe(true);
 const quit=await f.barrier.request();expect(quit).toMatchObject({allowQuit:false,saved:false});expect(f.prompts).toHaveLength(1);expect(f.acks[0].error).toContain('unsaved');expect(f.note()).toEqual(before);expect(await f.core.getRecurringWork()).toEqual(f.saved);expect(f.writes).toEqual([]);expect(await f.core.contentSnapshot()).toEqual(saved);
 f.handler({type:'draft.resume',quitId:quit.id});f.renderer.render();expect(f.cache.getSnapshot().frozen).toBe(false);expect(f.note()).toEqual(before);f.edit('Edited after Keep','textarea');expect(f.note()).toBe('Edited after Keep');expect(f.nav.api.hasDirty()).toBe(true);
});
test('explicit Quit without saving an uncached Activity note reports unsaved and does not mutate saved content',async()=>{
 const f=await fixture();const task=await f.activity();f.edit('Explicitly discarded by quit','textarea');const before=await f.core.contentSnapshot();f.answer(true);expect(await f.barrier.request()).toMatchObject({allowQuit:true,saved:false});expect(f.prompts).toHaveLength(1);expect(await f.core.getRecurringWork()).toEqual(f.saved);expect(f.writes).toEqual([]);expect(await f.core.listTasks()).toEqual([task]);expect(await f.core.contentSnapshot()).toEqual(before);
});
test('cached Edit fields pass actual App live navigation check and remain durable without an extra prompt',async()=>{
 const f=await fixture();button(f.renderer,'Edit schedule').props.onClick();f.renderer.render();f.edit('  Durable Edit title  ');f.edit('Exact unfinished Edit question.','textarea');f.edit('','input',1);const before=f.fields();expect(f.nav.api.hasDirty()).toBe(false);
 const quit=await f.barrier.request();expect(quit).toMatchObject({allowQuit:true,saved:true});expect(f.prompts).toEqual([]);expect(f.acks[0]).not.toHaveProperty('error');expect(f.fields()).toEqual(before);expect(f.writes.length).toBeGreaterThan(0);expect(await f.core.getRecurringWork()).toEqual(f.saved);expect(await f.core.listTasks()).toEqual([]);
 const sidecar=JSON.parse(await readFile(join(f.directory,'learning-drafts.json'),'utf8'));expect(sidecar.records.some((record:any)=>record.owner.kind==='recurring-work-edit'&&record.value&&JSON.parse(record.value.value).title===before.title)).toBe(true);
 f.handler({type:'draft.resume',quitId:quit.id});f.renderer.render();expect(f.cache.getSnapshot().frozen).toBe(false);expect(f.fields()).toEqual(before);f.edit('Edited after resumed durable quit');expect(f.fields().title).toBe('Edited after resumed durable quit');expect(f.nav.api.hasDirty()).toBe(false);
});
test('cached New fields pass the live navigation check and remain durable without an extra prompt',async()=>{
 const f=await fixture();button(f.renderer,'New schedule').props.onClick();f.renderer.render();f.edit('Durable New title');f.edit('Durable New question.','textarea');expect(f.nav.api.hasDirty()).toBe(false);expect(await f.barrier.request()).toMatchObject({allowQuit:true,saved:true});expect(f.prompts).toEqual([]);expect(f.writes.length).toBeGreaterThan(0);expect(await f.core.getRecurringWork()).toEqual(f.saved);expect(await f.core.listTasks()).toEqual([]);
});
test.each(['becomes dirty','becomes clean'])('quit reads live uncached form state after held composer drain: %s',async change=>{
 const f=await fixture(),task=await f.core.createTask({title:'Composer owner'});f.composer.hydrate([task]);const gate=f.holdComposer();f.composer.edit(task.id,{text:'Durable composer before quit'});await gate.started;const token=Symbol('other uncached form');f.nav.api.register(token,change==='becomes clean');const quitting=f.barrier.request();await tick();expect(f.acks).toEqual([]);f.nav.api.register(token,change==='becomes dirty');gate.release();expect(await quitting).toMatchObject({allowQuit:change==='becomes clean',saved:change==='becomes clean'});expect(f.prompts).toHaveLength(change==='becomes dirty'?1:0);expect((await f.core.getTask(task.id)).session?.draft).toBe('Durable composer before quit');
});
test('a stale resume cannot unfreeze a later dirty quit and exact resume preserves the form',async()=>{
 const f=await fixture();await f.activity();f.edit('Still open across quits','textarea');const first=await f.barrier.request();f.handler({type:'draft.resume',quitId:first.id});expect(f.cache.getSnapshot().frozen).toBe(false);const second=await f.barrier.request();expect(second.id).not.toBe(first.id);f.handler({type:'draft.resume',quitId:first.id});expect(f.cache.getSnapshot().frozen).toBe(true);f.handler({type:'draft.resume',quitId:second.id});expect(f.cache.getSnapshot().frozen).toBe(false);expect(f.note()).toBe('Still open across quits');expect(f.nav.api.hasDirty()).toBe(true);expect(f.prompts).toHaveLength(2);
});
test('a failed composer drain keeps its existing failure path and does not clear uncached dirtiness',async()=>{
 const f=await fixture();f.nav.api.register(Symbol('unpersisted editor'),true);const task=await f.core.createTask({title:'Composer failure owner'});f.composer.hydrate([task]);const save=vi.spyOn(f.core,'saveComposerDraft').mockRejectedValue(Error('Owned disk failure'));f.composer.edit(task.id,{text:'Kept open text'});await tick();expect(await f.barrier.request()).toMatchObject({allowQuit:false,saved:false});expect(f.acks[0].error).toBe('Unsent messages or practice edits could not be saved.');expect(f.prompts).toHaveLength(1);expect(f.nav.api.hasDirty()).toBe(true);expect(f.composer.getSnapshot()[task.id].text).toBe('Kept open text');save.mockRestore();
});
