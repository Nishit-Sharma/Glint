import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createCompanion} from '../src/core/companion';
import {Effect} from 'effect';
import {readState as oldRead} from './fixtures/a91/src/core/store';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {SavedDocumentSourceReview} from '../src/renderer/src/components/SavedDocumentSourceReview';
import {createControlledRenderer} from './controlled-renderer.fixture';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'document-selective-sources-')),core=await createCompanion({dataDir:directory});
 let task=await core.createTask({title:'Observatory visit'});
 task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Visit requirements',content:'Group size: 18.\nArrival: 09:30.\n'});
 task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Transport plan',content:'Coach seats: 24.\nReturn: 15:00.\n'});
 const [a,b]=task.sources.map(source=>source.id),refs=task.sources.map(source=>({sourceId:source.id,version:1,digest:source.versions[0].digest}));
 const saved=await core.saveArtifact(task.id,{title:'Visit plan',mimeType:'text/plain',content:'Bring 18 visitors. Return at 15:00.',sourceRefs:refs});task=await core.getTask(task.id);let base=saved.revision,scope='document-surface',current=true;
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)}),cache=makeCache();await cache.load();
 const options={cache,artifactId:saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>current,scope:()=>scope,send:async(input:Parameters<typeof core.saveArtifact>[1])=>{await core.saveArtifact(task.id,input);task=await core.getTask(task.id);return task;},onSaved:(revision:typeof base)=>{base=revision;}},controller=createSavedDocumentDraftController(options);
 cleanup.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,core,cache,controller,options,makeCache,a,b,refs,saved,get task(){return task},get base(){return base},retarget(){scope='other-surface';},leave(){current=false;},setTask(next:typeof task){task=next;},async refresh(id:string,content:string){task=await core.putSource(task.id,{id,kind:'text',role:'fact',label:id===a?'Visit requirements':'Transport plan',content});}};
}

it('adopts only the explicitly reviewed dependency and preserves authored text and unadopted links',async()=>{
 const f=await fixture();f.controller.edit({title:'My exact visit plan',content:'My unfinished correction.\n  Keep this spacing.  '});await f.cache.flush();
 await f.refresh(f.a,'Group size: 22.\nArrival: 09:30.\n');await f.refresh(f.b,'Coach seats: 24.\nReturn: 16:00.\n');
 const review=f.controller.snapshot().sourceReview!;expect(f.controller.reviewSources(review,f.a)).toBe(true);
 expect(f.controller.snapshot().fields).toMatchObject({title:'My exact visit plan',content:'My unfinished correction.\n  Keep this spacing.  ',sourceRefs:[{sourceId:f.a,version:2},{sourceId:f.b,version:1}]});
 expect(f.controller.snapshot().canSave).toBe(false);expect(await f.controller.save()).toBe(false);
 expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);
 await f.cache.flush();const reopened=f.makeCache();await reopened.load();const next=createSavedDocumentDraftController({...f.options,cache:reopened});
 expect(next.snapshot().fields.sourceRefs.map(ref=>ref.version)).toEqual([2,1]);expect(next.snapshot().fields.content).toBe('My unfinished correction.\n  Keep this spacing.  ');
 expect(next.reviewSources(next.snapshot().sourceReview!,f.b)).toBe(true);await reopened.flush();expect(next.snapshot().canSave).toBe(true);
 next.edit({content:'Bring 22 visitors. Return at 16:00.'});expect(await next.save()).toBe(true);
 const revisions=(await f.core.getTask(f.task.id)).artifacts[0].revisions;expect(revisions).toHaveLength(2);expect(revisions[0]).toEqual(f.saved.revision);expect(revisions[1]).toMatchObject({content:'Bring 22 visitors. Return at 16:00.',sourceRefs:[{sourceId:f.a,version:2},{sourceId:f.b,version:2}]});
});

it.each(['refresh-required','missing'] as const)('can review an available source while a different dependency is %s, leaving saving blocked',async unavailable=>{
 const f=await fixture();f.controller.edit({content:'Authored correction to retain.'});await f.cache.flush();await f.refresh(f.a,'Group size: 22.\nArrival: 09:30.\n');
 f.setTask({...f.task,sources:unavailable==='missing'?f.task.sources.filter(source=>source.id!==f.b):f.task.sources.map(source=>source.id===f.b?{...source,freshness:'refresh-required'}:source)});
 const review=f.controller.snapshot().sourceReview;expect(review).toBeDefined();expect(f.controller.reviewSources(review!,f.a)).toBe(true);
 expect(f.controller.snapshot().fields).toMatchObject({content:'Authored correction to retain.',sourceRefs:[{sourceId:f.a,version:2},{sourceId:f.b,version:1}]});expect(f.controller.snapshot().canSave).toBe(false);
 expect(f.controller.reviewSources(f.controller.snapshot().sourceReview!,f.b)).toBe(false);expect(await f.controller.save()).toBe(false);
});

it('the document control exposes the exact source change and adopts the named source alone',async()=>{
 const f=await fixture();await f.refresh(f.a,'Group size: 22.\nArrival: 09:30.\n');await f.refresh(f.b,'Coach seats: 24.\nReturn: 16:00.\n');
 const r=createControlledRenderer(()=>createElement(SavedDocumentSourceReview,{controller:f.controller})),text=(node:ReturnType<typeof r.nodes>[number]):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');r.render();
 expect(r.nodes().some(node=>node.type==='h4'&&text(node)==='Visit requirements')).toBe(true);
 r.find(node=>node.type==='details'&&node.props['aria-label']==='Compare Visit requirements').props.onToggle({currentTarget:{open:true}});r.render();
 expect(r.nodes().some(node=>node.type==='pre'&&text(node).includes('Group size: 18.'))).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node).includes('Group size: 22.'))).toBe(true);
 expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);
 r.find(node=>node.type==='button'&&text(node)==='Use reviewed version 2 · Visit requirements').props.onClick();r.render();
 expect(f.controller.snapshot().fields.sourceRefs.map(ref=>ref.version)).toEqual([2,1]);expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Use reviewed version 2 · Transport plan')).toBe(true);
 expect(r.nodes().some(node=>node.props.role==='status'&&text(node)==='1 source link still needs review or refresh before saving.')).toBe(true);
});

it('a missing exact historical snapshot cannot be silently replaced by an available newer snapshot',async()=>{
 const f=await fixture();await f.refresh(f.a,'Group size: 22.\n');f.setTask({...f.task,sources:f.task.sources.map(source=>source.id===f.a?{...source,versions:source.versions.slice(1)}:source)});
 const view=f.controller.snapshot();expect(view.sourceChanges.find(change=>change.reference.sourceId===f.a)?.kind).toBe('unavailable');expect(f.controller.reviewSources(view.sourceReview!,f.a)).toBe(false);expect(f.controller.snapshot().fields.sourceRefs).toEqual(f.refs);
});

it.each(['version','freshness','artifact','scope','owner'] as const)('refuses a captured selective adoption after its %s changes',async change=>{
 const f=await fixture();f.controller.edit({title:'Raw title',content:''});await f.cache.flush();await f.refresh(f.a,'Group size: 22.\n');const review=f.controller.snapshot().sourceReview!,before=f.controller.snapshot().entry?.local;
 if(change==='version')await f.refresh(f.a,'Group size: 27.\n');
 else if(change==='freshness')f.setTask(await f.core.invalidateSource(f.task.id,f.a,'Changed after review.'));
 else if(change==='artifact'){await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Newer document',content:'Another editor saved this.',sourceRefs:[]});f.setTask(await f.core.getTask(f.task.id));}
 else if(change==='scope')f.retarget();else f.leave();
 expect(f.controller.reviewSources(review,f.a)).toBe(false);expect(f.controller.snapshot().entry?.local).toEqual(before);expect(f.controller.snapshot().fields).toMatchObject({title:'Raw title',content:'',sourceRefs:[{version:1},{version:1}]});
});

it('an unrelated source update does not enter the review or replace a dependency',async()=>{
 const f=await fixture();await f.refresh(f.a,'Group size: 22.\n');const review=f.controller.snapshot().sourceReview!;f.setTask(await f.core.putSource(f.task.id,{kind:'text',role:'inspiration',label:'Unrelated poster',content:'This is unrelated.'}));
 expect(f.controller.reviewSources(review,f.a)).toBe(true);expect(f.controller.snapshot().fields.sourceRefs.map(ref=>ref.sourceId)).toEqual([f.a,f.b]);expect(f.controller.snapshot().fields.sourceRefs.map(ref=>ref.version)).toEqual([2,1]);
});

it('a later mirror text edit is preserved by the captured review while a changed link selection refuses it',async()=>{
 const f=await fixture(),earlierTask=f.task,mirror=createSavedDocumentDraftController({...f.options,task:()=>earlierTask});f.controller.edit({content:'Earlier draft.'});await f.cache.flush();await f.refresh(f.a,'Group size: 22.\n');const review=f.controller.snapshot().sourceReview!;
 mirror.edit({title:'',content:'Newer mirror text.\n  Exact whitespace.  '});expect(f.controller.reviewSources(review,f.a)).toBe(true);expect(f.controller.snapshot().fields).toMatchObject({title:'',content:'Newer mirror text.\n  Exact whitespace.  ',sourceRefs:[{version:2},{version:1}]});
 const g=await fixture(),oldTask=g.task,other=createSavedDocumentDraftController({...g.options,task:()=>oldTask});g.controller.edit({content:'Keep this draft.'});await g.cache.flush();await g.refresh(g.a,'Group size: 22.\n');const captured=g.controller.snapshot().sourceReview!;other.edit({sourceRefs:[g.refs[1]]});expect(g.controller.reviewSources(captured,g.a)).toBe(false);expect(g.controller.snapshot().fields.sourceRefs).toEqual([g.refs[1]]);
});

it('source invalidation before the atomic save refuses publication and keeps the corrected draft',async()=>{
 const f=await fixture();await f.refresh(f.a,'Group size: 22.\n');f.controller.reviewSources(f.controller.snapshot().sourceReview!,f.a);f.controller.edit({content:'My corrected visit plan.'});
 let entered!:()=>void,release!:()=>void;const arrived=new Promise<void>(resolve=>{entered=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const controller=createSavedDocumentDraftController({...f.options,send:async input=>{entered();await held;return f.options.send(input);}}),saving=controller.save();await arrived;f.setTask(await f.core.invalidateSource(f.task.id,f.a,'Changed before actual save.'));release();expect(await saving).toBe(false);
 expect(controller.snapshot().fields.content).toBe('My corrected visit plan.');expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);expect((await f.core.getTask(f.task.id)).requests).toEqual([]);
});

it('the pinned older task reader refuses new provenance without changing saved work or the partial-review sidecar',async()=>{
 const f=await fixture();f.controller.edit({content:'Preserve this partial source review.'});await f.cache.flush();await f.refresh(f.a,'Group size: 22.\n');await f.refresh(f.b,'Return: 16:00.\n');f.controller.reviewSources(f.controller.snapshot().sourceReview!,f.a);await f.cache.flush();
 const before=await f.core.getTask(f.task.id),sidecar=await readFile(join(f.directory,'learning-drafts.json'));await f.core.close();const ledger=await readFile(join(f.directory,'tasks.json'));await expect(Effect.runPromise(oldRead(f.directory))).rejects.toThrow(/unreadable or incompatible/);expect(await readFile(join(f.directory,'tasks.json'))).toEqual(ledger);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(sidecar);
 const reopened=await createCompanion({dataDir:f.directory});try{expect((await reopened.getTask(before.id)).artifacts).toEqual(before.artifacts);const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await reopened.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();const view=createSavedDocumentDraftController({...f.options,cache,task:()=>before}).snapshot();expect(view.fields).toMatchObject({content:'Preserve this partial source review.',sourceRefs:[{version:2},{version:1}]});}finally{await reopened.close();}
});

it('comparison stays on demand and large text exposes complete exact snapshots instead of an unbounded diff',async()=>{
 const f=await fixture(),large='Long requirement line. '+('x'.repeat(100_001));await f.refresh(f.a,large);
 const r=createControlledRenderer(()=>createElement(SavedDocumentSourceReview,{controller:f.controller})),text=(node:ReturnType<typeof r.nodes>[number]):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');r.render();expect(r.nodes().some(node=>node.type==='pre')).toBe(false);
 r.find(node=>node.type==='details'&&node.props['aria-label']==='Compare Visit requirements').props.onToggle({currentTarget:{open:true}});r.render();
 expect(r.nodes().some(node=>text(node).includes('too large or complex for an inline comparison'))).toBe(true);expect(r.nodes().some(node=>node.type==='pre'&&text(node)===large)).toBe(true);expect(f.controller.snapshot().fields.sourceRefs).toEqual(f.refs);
});

it('non-text comparison has an explicit manual-review boundary and does not echo image data as text',async()=>{
 const f=await fixture();f.setTask(await f.core.putSource(f.task.id,{id:f.a,kind:'image',role:'fact',label:'Visit requirement image',content:'data:image/png;base64,QUJDREVGRw=='}));
 const r=createControlledRenderer(()=>createElement(SavedDocumentSourceReview,{controller:f.controller})),text=(node:ReturnType<typeof r.nodes>[number]):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');r.render();r.find(node=>node.type==='details'&&node.props['aria-label']==='Compare Visit requirement image').props.onToggle({currentTarget:{open:true}});r.render();
 expect(r.nodes().some(node=>text(node).includes('Text comparison is unavailable for image and window snapshots.'))).toBe(true);expect(r.nodes().some(node=>text(node).includes('data:image/'))).toBe(false);expect(f.controller.snapshot().fields.sourceRefs).toEqual(f.refs);
});

it('cancelling a partial adoption restores the saved document without changing its original links or text',async()=>{
 const f=await fixture();f.controller.edit({content:'Unfinished authored correction.'});await f.cache.flush();await f.refresh(f.a,'Group size: 22.\n');await f.refresh(f.b,'Return: 16:00.\n');f.controller.reviewSources(f.controller.snapshot().sourceReview!,f.a);await f.cache.flush();expect(await f.controller.discard()).toBe(true);
 const reopened=f.makeCache();await reopened.load();const controller=createSavedDocumentDraftController({...f.options,cache:reopened});expect(controller.snapshot().raw.present).toBe(false);expect(controller.snapshot().fields).toMatchObject({content:f.saved.revision.content,sourceRefs:f.refs});expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);
});

it('a lost raw-write acknowledgement keeps the partial choice held until explicit storage reconciliation',async()=>{
 const f=await fixture();await f.refresh(f.a,'Group size: 22.\n');await f.refresh(f.b,'Return: 16:00.\n');const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(task=>task.id===id)});let lose=true;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const result=await store.save(...args);if(lose){lose=false;throw Error('Lost raw write acknowledgement.');}return result;}});await cache.load();const controller=createSavedDocumentDraftController({...f.options,cache});expect(controller.reviewSources(controller.snapshot().sourceReview!,f.a)).toBe(true);await expect(cache.flush()).rejects.toThrow('Lost raw write acknowledgement.');
 expect(controller.snapshot().fields.sourceRefs.map(ref=>ref.version)).toEqual([2,1]);expect(controller.snapshot().sourceReview).toBeUndefined();expect(await controller.save()).toBe(false);expect(await controller.check()).toBe(false);expect(controller.snapshot().fields.sourceRefs.map(ref=>ref.version)).toEqual([2,1]);expect(controller.reviewSources(controller.snapshot().sourceReview!,f.b)).toBe(true);await cache.flush();expect(controller.snapshot().canSave).toBe(true);expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);
});
