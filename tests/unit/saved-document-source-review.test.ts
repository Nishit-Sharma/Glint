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
import {createSavedDocumentDraftController} from '../../src/renderer/src/saved-document-draft-controller';
import {SavedDocumentSourceReview} from '../../src/renderer/src/components/SavedDocumentSourceReview';
import {emptySavedDocumentDraft,savedDocumentDraftBasis} from '../../src/shared/saved-document-draft';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'saved-document-source-review-')),core=await createCompanion({dataDir:directory});
 const created=await core.createTask({title:'Explicit document source review'});let task=await core.putSource(created.id,{kind:'text',label:'Linked source',content:'Original source.',role:'fact'});
 const sourceId=task.sources[0].id,sourceVersion=task.sources[0].versions[0],saved=await core.saveArtifact(task.id,{title:'Committed document',content:'Committed document body.',mimeType:'text/plain',sourceRefs:[{sourceId,version:1,digest:sourceVersion.digest}]});task=await core.getTask(task.id);let base=saved.revision,presented=0,discarded=0,scope='source-review-scope';
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),fault:{raw?:'reject-before';tombstone?:'reject-before'|'lose-after'}={};
 const makeCache=()=>createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const mode=args[4]===null?fault.tombstone:fault.raw;if(args[4]===null)fault.tombstone=undefined;else fault.raw=undefined;if(mode==='reject-before')throw Error('Sidecar write rejected before storage.');const result=await store.save(...args);if(mode==='lose-after')throw Error('Sidecar tombstone acknowledgement lost.');return result;}}),cache=makeCache();await cache.load();
 const options={cache,artifactId:saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,scope:()=>scope,send:async(input:Parameters<typeof core.saveArtifact>[1])=>{await core.saveArtifact(task.id,input);task=await core.getTask(task.id);return task;},onSaved:(revision:typeof base)=>{base=revision;presented++;},onDiscard:()=>{discarded++;}},controller=createSavedDocumentDraftController(options);
 const renderer=createControlledRenderer(()=>createElement(SavedDocumentSourceReview,{controller}));
 cleanup.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 return {core,cache,controller,renderer,sourceId,saved,makeCache,options,fault,get discarded(){return discarded},retarget:()=>{scope='new-activation'},get task(){return task},get base(){return base},get presented(){return presented},updateTask:(next:typeof task)=>{task=next},refresh:async(content='Refreshed current source.')=>{task=await core.putSource(task.id,{kind:'text',id:sourceId,label:'Linked source current',content,role:'fact'});},button:()=>{renderer.render();return renderer.find(node=>node.type==='button');}};
}
it('the actual source-review control preserves raw title/body and adopts the reviewed fresh source before an explicit revision save',async()=>{
 const f=await fixture();f.controller.edit({title:'Exact raw title',content:'Exact raw body.'});await f.cache.flush();await f.refresh();
 expect(f.controller.snapshot().held).toBe(true);const button=f.button();expect(button.props.disabled).toBe(false);button.props.onClick();
 expect(f.controller.snapshot().fields).toMatchObject({title:'Exact raw title',content:'Exact raw body.',sourceRefs:[{sourceId:f.sourceId,version:2,digest:f.task.sources[0].versions[1].digest}]});expect(f.controller.snapshot().canSave).toBe(true);await f.cache.flush();
 const reopened=f.makeCache();await reopened.load();const view=f.controller.snapshot();expect(reopened.readForm(view.owner,view.slot,emptySavedDocumentDraft,savedDocumentDraftBasis(f.task,f.saved.artifactId,f.base))).toMatchObject({status:'ready',value:{title:'Exact raw title',content:'Exact raw body.',sourceRefs:[{version:2}]}});
 expect(await f.controller.save()).toBe(true);expect(f.presented).toBe(1);expect(f.base.sourceRefs).toEqual([{sourceId:f.sourceId,version:2,digest:f.task.sources[0].versions[1].digest}]);expect(f.base.content).toBe('Exact raw body.');
});
it('review without earlier raw creates only a durable reference edit and leaves the committed document untouched',async()=>{
 const f=await fixture();await f.refresh();const button=f.button();expect(button.props.disabled).toBe(false);button.props.onClick();await f.cache.flush();
 expect(f.controller.snapshot().fields).toMatchObject({title:'Committed document',content:'Committed document body.',sourceRefs:[{version:2}]});expect(f.controller.snapshot().canSave).toBe(true);expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);expect(f.presented).toBe(0);
});
it.each(['version','freshness','revision','activation'] as const)('a captured source-review click refuses an intervening %s without changing raw or its basis',async change=>{
 const f=await fixture();f.controller.edit({title:'Earlier exact raw',content:''});await f.cache.flush();await f.refresh();const button=f.button(),before=f.cache.getSnapshot().entries[f.controller.snapshot().key];expect(button.props.disabled).toBe(false);
 if(change==='version')await f.refresh('Unreviewed third source version.');
 else if(change==='freshness')f.updateTask(await f.core.invalidateSource(f.task.id,f.sourceId,'Source changed after the rendered review.'));
 else if(change==='revision'){await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Foreign document',content:'Foreign document body.',mimeType:'text/plain',sourceRefs:[]});f.updateTask(await f.core.getTask(f.task.id));}
 else f.retarget();
 button.props.onClick();const after=f.cache.getSnapshot().entries[f.controller.snapshot().key];expect(after.local).toEqual(before.local);expect(after.generation).toBe(before.generation);expect(f.controller.snapshot().fields).toMatchObject({title:'Earlier exact raw',content:'',sourceRefs:[{version:1}]});expect(f.presented).toBe(0);
});
it('review reads the latest shared raw fields after a different mirror edits, and intentional blanks survive restart',async()=>{
 const f=await fixture(),earlierTask=f.task,mirror=createSavedDocumentDraftController({...f.options,task:()=>earlierTask});f.controller.edit({title:'Old raw title',content:'Old raw body.'});await f.cache.flush();await f.refresh();const button=f.button();
 expect(mirror.edit({content:'Newer body from another mirror.'}).kind).toBe('accepted');expect(mirror.edit({title:''}).kind).toBe('accepted');button.props.onClick();await f.cache.flush();
 expect(f.controller.snapshot().fields).toMatchObject({title:'',content:'Newer body from another mirror.',sourceRefs:[{version:2}]});expect(f.controller.snapshot().held).toBe(false);expect(f.controller.snapshot().canSave).toBe(false);
 const reopened=f.makeCache();await reopened.load();const view=f.controller.snapshot();expect(reopened.readForm(view.owner,view.slot,emptySavedDocumentDraft,view.basis)).toMatchObject({status:'ready',value:{present:true,title:'',content:'Newer body from another mirror.',sourceRefs:[{version:2}]}});
});
it('a captured review cannot overwrite another mirror’s newer source selection',async()=>{
 const f=await fixture(),earlierTask=f.task,mirror=createSavedDocumentDraftController({...f.options,task:()=>earlierTask});f.controller.edit({content:'Keep this raw body.'});await f.cache.flush();await f.refresh();const button=f.button();
 expect(mirror.edit({sourceRefs:[]}).kind).toBe('accepted');const before=f.cache.getSnapshot().entries[f.controller.snapshot().key];button.props.onClick();expect(f.cache.getSnapshot().entries[f.controller.snapshot().key].local).toEqual(before.local);expect(f.controller.snapshot().fields).toMatchObject({content:'Keep this raw body.',sourceRefs:[]});
});
it('review never drops a missing linked source or accepts one still requiring refresh',async()=>{
 const f=await fixture();f.controller.edit({content:'Unapplied raw.'});await f.cache.flush();f.updateTask(await f.core.invalidateSource(f.task.id,f.sourceId,'Needs refresh before review.'));expect(f.button().props.disabled).toBe(true);
 const previous=f.task;f.updateTask({...previous,sources:[]});expect(f.button().props.disabled).toBe(true);expect(f.controller.snapshot().fields.sourceRefs).toEqual(f.base.sourceRefs);f.updateTask(previous);
});
it('review is held while storage is unconfirmed and while quit is frozen, then works only after a successful explicit storage check',async()=>{
 const f=await fixture();f.fault.raw='reject-before';f.controller.edit({content:'Exact visible raw after storage failure.'});await expect(f.cache.flush()).rejects.toThrow();await f.refresh();expect(f.button().props.disabled).toBe(true);
 f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();expect(f.button().props.disabled).toBe(true);f.cache.setFrozen(false);
 expect(await f.controller.check()).toBe(false);const button=f.button();expect(button.props.disabled).toBe(false);f.cache.setFrozen(true);button.props.onClick();expect(f.controller.snapshot().fields.sourceRefs[0].version).toBe(1);f.cache.setFrozen(false);f.button().props.onClick();await f.cache.flush();expect(f.controller.snapshot().fields).toMatchObject({content:'Exact visible raw after storage failure.',sourceRefs:[{version:2}]});expect(f.controller.snapshot().canSave).toBe(true);
});
it.each(['reject-before','lose-after'] as const)('Cancel after source review keeps exact raw through a %s discard until storage is reconciled',async mode=>{
 const f=await fixture();f.controller.edit({title:'Cancel this exact title',content:''});await f.cache.flush();await f.refresh();f.button().props.onClick();await f.cache.flush();f.fault.tombstone=mode;
 expect(await f.controller.discard()).toBe(false);expect(f.discarded).toBe(0);expect(f.controller.snapshot().fields).toMatchObject({title:'Cancel this exact title',content:'',sourceRefs:[{version:2}]});f.renderer.render();expect(f.renderer.nodes().filter(node=>node.type==='button').every(node=>node.props.disabled)).toBe(true);
 expect(await f.controller.check()).toBe(true);expect(f.discarded).toBe(1);const reopened=f.makeCache();await reopened.load();const view=f.controller.snapshot();expect(reopened.readForm(view.owner,view.slot,emptySavedDocumentDraft,view.basis).value.present).toBe(false);expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);
});
it('deleting the reviewed document owner refuses a captured review and cannot recreate the sidecar record',async()=>{
 const f=await fixture();f.controller.edit({content:'Deleted owner raw.'});await f.cache.flush();await f.refresh();const button=f.button();await f.core.deleteTask(f.task.id);f.cache.forgetTask(f.task.id);button.props.onClick();await f.cache.flush();
 expect(f.cache.getSnapshot().entries[f.controller.snapshot().key]).toBeUndefined();expect(await f.core.listTasks()).toEqual([]);const reopened=f.makeCache();await reopened.load();expect(Object.values(reopened.getSnapshot().entries)).toEqual([]);
});

it('a confirmed discard remains usable after the linked source advances again while its tombstone acknowledgement was lost',async()=>{
 const f=await fixture();f.controller.edit({title:'Stale cancel title',content:'Stale cancel raw body.'});await f.cache.flush();await f.refresh();f.button().props.onClick();await f.cache.flush();f.fault.tombstone='lose-after';expect(await f.controller.discard()).toBe(false);await f.refresh('A later source version after discard.');
 expect(f.controller.snapshot().fields).toMatchObject({title:'Stale cancel title',content:'Stale cancel raw body.'});expect(await f.controller.check()).toBe(true);expect(f.discarded).toBe(1);expect(f.controller.snapshot().raw.present).toBe(false);const reopened=f.makeCache();await reopened.load();expect(Object.values(reopened.getSnapshot().entries).every(entry=>entry.local===null)).toBe(true);
});
