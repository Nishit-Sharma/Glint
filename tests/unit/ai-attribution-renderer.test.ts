import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import type {Task} from '../../src/core/types';
import {AI_ATTRIBUTION_NOTE} from '../../src/shared/ai-attribution';
import {ArtifactAttribution} from '../../src/renderer/src/components/ArtifactAttribution';
import {DraftNavigationProvider,useDraftNavigation} from '../../src/renderer/src/draft-navigation';
import type {Run} from '../../src/renderer/src/ui';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
function gate(){let release!:()=>void;return {wait:new Promise<void>(resolve=>release=resolve),release:()=>release()};}
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'attribution-ui-')),core=await createCompanion({dataDir:dir});const owner=await core.createTask({title:'Owner'});await core.saveComposerDraft(owner.id,0,{text:'Kept original draft',kind:'explain'});
 await core.runRequest({taskId:owner.id,requestId:'answer',kind:'create',prompt:'Draft text'},async()=>({title:'Generated text',content:'Exact original café Ω.\r\n',mimeType:'text/markdown',modelReceipt:{requestId:'answer',provider:'codex',model:'fixture',effort:'medium',tier:'default',confirmation:'accepted-thread-and-completed-turn'}}));
 let task=await core.getTask(owner.id),current=true,disabled=false,loseReceipt=false,readGate:ReturnType<typeof gate>|undefined;const answer=task.requests[0].answer!,commands:any[]=[],opened:any[]=[],flights=new Set<Promise<unknown>>();let navigation!:ReturnType<typeof useDraftNavigation>;
 const run=(<T,>(command:any):Promise<T|undefined>=>{commands.push(structuredClone(command));const flight=(async()=>{if(command.type==='artifact.ai-attribution'){const saved=await core.saveAiAttributedCopy(Object.fromEntries(Object.entries(command).filter(([key])=>key!=='type')));task=await core.getTask(owner.id);if(loseReceipt){loseReceipt=false;throw Error('Synthetic receipt lost');}return saved as T;}if(command.type==='tasks.get'){await readGate?.wait;return await core.getTask(command.taskId) as T;}throw Error('Unexpected command');})();flights.add(flight);void flight.finally(()=>flights.delete(flight)).catch(()=>{});return flight;}) as Run;
 function Harness(){navigation=useDraftNavigation();return createElement(DraftNavigationProvider,{value:navigation.api,children:createElement(ArtifactAttribution,{task,answer,isCurrent:()=>current,disabled,run,onOpen:saved=>navigation.api.guard(()=>opened.push(saved))})});}
 const r=createControlledRenderer(()=>createElement(Harness)),text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>r.find(n=>n.type==='button'&&text(n)===label),checkbox=()=>r.find(n=>n.type==='input'&&n.props.type==='checkbox');
 async function drain(){for(let i=0;i<10;i++){if(flights.size)await Promise.allSettled([...flights]);await Promise.resolve();r.render();}}
 closes.push(async()=>{await core.close();await rm(dir,{recursive:true,force:true});});r.render();return {core,r,commands,opened,button,checkbox,drain,get task(){return task;},get nav(){return navigation;},setCurrent:(v:boolean)=>{current=v;},setDisabled:(v:boolean)=>{disabled=v;},lose:()=>{loseReceipt=true;},holdRead:()=>{readGate=gate();return readGate;},setTask:(v:Task)=>{task=v;}};
}
async function save(f:Awaited<ReturnType<typeof fixture>>){f.checkbox().props.onChange({target:{checked:true}});f.r.render();f.button('Save attributed copy').props.onClick();f.r.render();await f.drain();}
test('opt-in changes actual saved body only after explicit save, leaves default off and prevents duplicate clicks',async()=>{
 const f=await fixture();expect(f.checkbox().props.checked).toBe(false);expect(f.commands).toEqual([]);expect(f.r.nodes().some(n=>n.type==='textarea')).toBe(false);expect(f.button('Save attributed copy').props.disabled).toBe(true);
 f.checkbox().props.onChange({target:{checked:true}});f.r.render();expect(f.nav.api.hasDirty()).toBe(true);const preview=f.r.find(n=>n.type==='textarea');expect(preview.props.readOnly).toBe(true);expect(preview.props.value).toBe('Exact original café Ω.\r\n\n'+AI_ATTRIBUTION_NOTE+'\n');expect(f.r.find(n=>n.type==='label'&&n.props.htmlFor===preview.props.id)).toBeDefined();
 f.checkbox().props.onChange({target:{checked:false}});f.r.render();expect(f.nav.api.hasDirty()).toBe(false);expect(f.commands).toEqual([]);f.checkbox().props.onChange({target:{checked:true}});f.r.render();f.button('Save attributed copy').props.onClick();f.button('Save attributed copy').props.onClick();f.r.render();await f.drain();expect(f.commands).toHaveLength(1);expect(f.task.artifacts).toHaveLength(2);expect(f.task.artifacts[1].revisions[0].content).toBe(preview.props.value);expect(f.opened).toEqual([]);expect(f.nav.api.hasDirty()).toBe(false);expect(f.task.session?.draft).toBe('Kept original draft');
});
test('lost acknowledgment retries the same retained copy, and explicit Open clears only its own transient guard despite its own busy read',async()=>{
 const f=await fixture();f.lose();await save(f);expect(f.r.nodes().some(n=>n.props.role==='alert')).toBe(true);expect(f.checkbox().props.checked).toBe(true);f.button('Save attributed copy').props.onClick();f.r.render();await f.drain();expect(f.task.artifacts).toHaveLength(2);expect(f.commands[0]).toEqual(f.commands[1]);
 const held=f.holdRead();f.button('Open attributed copy').props.onClick();f.r.render();expect(f.nav.api.hasDirty()).toBe(true);f.setDisabled(true);f.r.render();held.release();await f.drain();expect(f.opened).toHaveLength(1);expect(f.opened[0].artifactId).toBe(f.task.artifacts[1].id);expect(f.nav.review).toBeNull();expect(f.nav.api.hasDirty()).toBe(false);
});
test('new dirty original edits hold explicit Open, while retired navigation cannot open or accept a late save',async()=>{
 const f=await fixture();await save(f);const held=f.holdRead();f.button('Open attributed copy').props.onClick();f.r.render();const other=Symbol('original-editor');f.nav.api.register(other,true);f.setDisabled(true);f.r.render();held.release();await f.drain();expect(f.opened).toEqual([]);expect(f.nav.api.hasDirty()).toBe(true);expect(f.nav.review).not.toBeNull();f.nav.review!.props.onKeep();f.r.render();expect(f.opened).toEqual([]);expect(f.nav.api.hasDirty()).toBe(true);
 const late=await fixture();late.checkbox().props.onChange({target:{checked:true}});late.r.render();late.button('Save attributed copy').props.onClick();late.setCurrent(false);late.r.render();await late.drain();expect(late.opened).toEqual([]);expect(late.r.nodes().some(n=>n.type==='button'&&n.children.some(c=>c.props.text==='Open attributed copy'))).toBe(false);
});
test('unknown generation provenance and later manual edits expose no opt-in producer',async()=>{
 const f=await fixture();const unconfirmed=structuredClone(f.task);delete unconfirmed.requests[0].responseModel;f.setTask(unconfirmed);f.r.render();expect(f.r.nodes().some(n=>n.type==='input')).toBe(false);expect(f.r.nodes().some(n=>n.type==='#text'&&n.props.text.includes('provider-confirmed'))).toBe(true);expect(f.commands).toEqual([]);
 const current=await f.core.getTask(f.task.id);const stale=structuredClone(current);stale.artifacts[0].revisions.push({...stale.artifacts[0].revisions[0],revision:2,digest:'b'.repeat(64),content:'Manual latest edit'});f.setTask(stale);f.r.render();expect(f.r.nodes().some(n=>n.type==='input')).toBe(false);expect(f.r.nodes().some(n=>n.type==='#text'&&n.props.text.includes('unchanged generated text'))).toBe(true);
 const large=structuredClone(current);large.artifacts[0].revisions[0].content='x'.repeat(12_000_000);f.setTask(large);f.r.render();expect(f.r.nodes().some(n=>n.type==='input')).toBe(false);expect(f.r.nodes().some(n=>n.type==='#text'&&n.props.text.includes('12,000,000-character'))).toBe(true);
});

test('late Leave retires old navigation and re-reads an exact copy after a held guard instead of retaining a stale target',async()=>{
 for(const changed of ['scope','copy'] as const){const f=await fixture();await save(f);const held=f.holdRead();f.button('Open attributed copy').props.onClick();f.r.render();f.nav.api.register(Symbol('new original edit'),true);held.release();await f.drain();expect(f.nav.review).not.toBeNull();expect(f.opened).toEqual([]);
  if(changed==='scope')f.setCurrent(false);else{const copy=f.task.artifacts[1];await f.core.saveArtifact(f.task.id,{artifactId:copy.id,expectedRevision:1,title:'Manual copy edit',content:'Removed note',mimeType:'text/plain'});}
  f.nav.review!.props.onLeave();f.r.render();await f.drain();expect(f.opened).toEqual([]);if(changed==='copy')expect(f.commands.filter(c=>c.type==='tasks.get')).toHaveLength(2);
 }
});
