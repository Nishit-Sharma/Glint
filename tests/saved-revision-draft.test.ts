import {withOrdinaryAppBindings} from './concurrent-app-bindings.fixture';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {prepareSavedRevisionDraft,savedRevisionDraftSelection} from '../src/renderer/src/saved-revision-draft';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis,savedDocumentDraftOwner} from '../src/shared/saved-document-draft';
import ts from 'typescript';
import type {SavedRevisionDraftResult} from '../src/renderer/src/saved-revision-draft';
import type {Task} from '../src/core/types';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(advanceSource=true){
 const directory=await mkdtemp(join(tmpdir(),'saved-revision-draft-')),core=await createCompanion({dataDir:directory});
 let task=await core.createTask({title:'Recover an earlier plan'});
 task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Visit requirements',content:'Visitors: 18.'});
 const source=task.sources[0],a1={sourceId:source.id,version:1,digest:source.versions[0].digest};
 const earlier=await core.saveArtifact(task.id,{title:'Earlier plan',content:'\n# Earlier plan\n\n  Keep exact earlier text.  \n',mimeType:'text/markdown',sourceRefs:[a1]});
 if(advanceSource)task=await core.putSource(task.id,{id:source.id,kind:'text',role:'fact',label:'Visit requirements',content:'Visitors: 22.'});
 const version=task.sources[0].versions.at(-1)!,currentRef={sourceId:source.id,version:version.version,digest:version.digest};
 const latest=await core.saveArtifact(task.id,{artifactId:earlier.artifactId,expectedRevision:1,title:'Current plan',content:'# Current plan\n\nCurrent saved body.\n',mimeType:'text/markdown',sourceRefs:[currentRef]});
 task=await core.getTask(task.id);
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)});let fail=false;
 const makeCache=()=>createLearningDrafts({read:()=>store.read(),save:async(...args)=>{if(fail){fail=false;throw Error('Owned raw write refused before storage.');}return store.save(...args);}}),cache=makeCache();await cache.load();
 const reference={artifactId:earlier.artifactId,revision:1,digest:earlier.revision.digest},owner=savedDocumentDraftOwner(task.id,earlier.artifactId),slot=SAVED_DOCUMENT_DRAFT_SLOT;
 cleanup.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,core,store,cache,makeCache,earlier,latest,reference,owner,slot,a1,currentRef,get task(){return task},setTask:(value:typeof task)=>{task=value;},failNext:()=>{fail=true;},prepare:(isCurrent=()=>true)=>prepareSavedRevisionDraft({cache,taskId:task.id,reference,task:()=>task,isCurrent})};
}

it('reopens exact historical text as a durable draft based on the latest revision, then requires source review and an explicit Save',async()=>{
 const f=await fixture(),before=structuredClone(f.task),expected={title:f.earlier.revision.title,content:f.earlier.revision.content,sourceRefs:[f.a1]};
 expect(await f.prepare()).toEqual({kind:'ready'});expect(await f.core.getTask(f.task.id)).toEqual(before);
 const reopened=f.makeCache();await reopened.load();
 expect(reopened.readForm(f.owner,f.slot,emptySavedDocumentDraft,savedDocumentDraftBasis(f.task,f.earlier.artifactId,f.latest.revision))).toMatchObject({status:'ready',value:{present:true,...expected}});
 let base=f.latest.revision;
 const controller=createSavedDocumentDraftController({cache:reopened,artifactId:f.earlier.artifactId,task:()=>f.task,base:()=>base,isCurrent:()=>true,send:async input=>{await f.core.saveArtifact(f.task.id,input);f.setTask(await f.core.getTask(f.task.id));return f.task;},onSaved:revision=>{base=revision;}});
 expect(controller.snapshot().fields).toEqual(expected);expect(controller.snapshot().canSave).toBe(false);expect(await controller.save()).toBe(false);
 const review=controller.snapshot().sourceReview;expect(review).toBeDefined();expect(controller.reviewSources(review!,f.a1.sourceId)).toBe(true);await reopened.flush();
 expect(controller.snapshot().fields).toEqual({...expected,sourceRefs:[f.currentRef]});expect(await f.core.getTask(f.task.id)).toEqual(before);
 expect(await controller.save()).toBe(true);
 const revisions=f.task.artifacts[0].revisions;expect(revisions.slice(0,2)).toEqual(before.artifacts[0].revisions);expect(revisions[2]).toMatchObject({...expected,revision:3,sourceRefs:[f.currentRef]});
});

it('keeps still-current original links unchanged when staging an earlier revision',async()=>{
 const f=await fixture(false),before=structuredClone(f.task);expect(await f.prepare()).toEqual({kind:'ready'});
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.earlier.artifactId,task:()=>f.task,base:()=>f.latest.revision,isCurrent:()=>true,send:async()=>{throw Error('Preparation cannot dispatch a save.');},onSaved:()=>{}});
 expect(controller.snapshot().fields).toMatchObject({title:f.earlier.revision.title,content:f.earlier.revision.content,sourceRefs:[f.a1]});expect(controller.snapshot().canSave).toBe(true);expect(await f.core.getTask(f.task.id)).toEqual(before);
});

it.each(['ready','recovery'] as const)('protects an existing %s draft and permits replacement only after explicit discard',async state=>{
 const f=await fixture(),basis=savedDocumentDraftBasis(f.task,f.earlier.artifactId,state==='ready'?f.latest.revision:f.earlier.revision),raw={present:true,title:'My unfinished changes',content:'',sourceRefs:[f.a1]};
 expect(f.cache.tryEdit(f.owner,f.slot,emptySavedDocumentDraft,basis,()=>raw).kind).toBe('accepted');await f.cache.flush();
 const bytes=await readFile(join(f.directory,'learning-drafts.json')),before=f.cache.getSnapshot();
 expect(await f.prepare()).toMatchObject({kind:'existing-draft',message:expect.stringContaining('explicitly discard')});expect(f.cache.getSnapshot()).toBe(before);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(bytes);
 const reopened=f.makeCache();await reopened.load();expect(reopened.readForm(f.owner,f.slot,emptySavedDocumentDraft,basis).value).toEqual(raw);
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.earlier.artifactId,task:()=>f.task,base:()=>f.latest.revision,isCurrent:()=>true,send:async()=>{throw Error('Discard cannot save a revision.');},onSaved:()=>{}});
 expect(controller.snapshot().fields).toEqual({title:raw.title,content:raw.content,sourceRefs:raw.sourceRefs});expect(await controller.discard()).toBe(true);expect(await f.prepare()).toEqual({kind:'ready'});expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(2);
});

it('refuses unavailable original source snapshots before creating raw input',async()=>{
 const f=await fixture(),before=await f.store.read();f.setTask({...f.task,sources:[]});
 expect(await f.prepare()).toMatchObject({kind:'held',message:expect.stringContaining('original source snapshot is unavailable')});expect(await f.store.read()).toEqual(before);expect(f.cache.getSnapshot().entries).toEqual({});
});

it('holds a failed raw storage acknowledgement without changing saved versions or resending',async()=>{
 const f=await fixture(),before=structuredClone(f.task);f.failNext();expect(await f.prepare()).toMatchObject({kind:'held',message:expect.stringContaining('could not be confirmed')});
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.earlier.artifactId,task:()=>f.task,base:()=>f.latest.revision,isCurrent:()=>true,send:async()=>{throw Error('Unconfirmed draft cannot save.');},onSaved:()=>{}});
 expect(controller.snapshot().fields).toMatchObject({title:f.earlier.revision.title,content:f.earlier.revision.content,sourceRefs:[f.a1]});expect(controller.snapshot().canSave).toBe(false);expect(await f.core.getTask(f.task.id)).toEqual(before);expect(await f.store.read()).toMatchObject({kind:'available',records:[]});
});

it('holds preparation while frozen or outside the owning page',async()=>{
 const f=await fixture();f.cache.setFrozen(true);expect(await f.prepare()).toMatchObject({kind:'held'});f.cache.setFrozen(false);expect(await f.prepare(()=>false)).toMatchObject({kind:'held'});expect(await f.store.read()).toMatchObject({kind:'available',records:[]});
});

it('requires an exact earlier ordinary revision in the same text format',async()=>{
 const f=await fixture(),artifact=f.task.artifacts[0];expect(savedRevisionDraftSelection(artifact,f.reference)?.revision).toEqual(f.earlier.revision);
 for(const reference of [{...f.reference,digest:'wrong'},{...f.reference,artifactId:'other'},{artifactId:artifact.id,revision:2,digest:f.latest.revision.digest}])expect(savedRevisionDraftSelection(artifact,reference)).toBeUndefined();
 for(const change of [{mimeType:'application/json'},{mimeType:'text/plain'},{encoding:'base64' as const}])expect(savedRevisionDraftSelection({...artifact,revisions:[{...artifact.revisions[0],...change},artifact.revisions[1]]},f.reference)).toBeUndefined();
 const brief=JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'A structured source review.',actions:[]});
 for(const index of [0,1])expect(savedRevisionDraftSelection({...artifact,revisions:artifact.revisions.map((item,i)=>i===index?{...item,content:brief}:item)},f.reference)).toBeUndefined();
});

it.each([
 {draft:'empty',delivery:'rendered'},{draft:'unfinished',delivery:'rendered'},
 {draft:'empty',delivery:'queued'},{draft:'unfinished',delivery:'queued'},
 {draft:'empty',delivery:'queued-inspection'},{draft:'unfinished',delivery:'queued-inspection'}
] as const)('the actual App refuses a held older lookup after a same-task update: $draft draft, $delivery state',async({draft,delivery})=>{
 const f=await fixture(),stale=structuredClone(f.task);
 if(draft==='unfinished'){const basis=savedDocumentDraftBasis(f.task,f.earlier.artifactId,f.latest.revision);expect(f.cache.tryEdit(f.owner,f.slot,emptySavedDocumentDraft,basis,()=>({present:true,title:'Keep my unsent title',content:'',sourceRefs:[f.currentRef]})).kind).toBe('accepted');await f.cache.flush();}
 const stored=await f.store.read(),taskRef={current:stale},taskListSnapshot={current:{generation:0,tasks:[stale]}},updates:{phase:string;task:Task}[]=[],opened:string[]=[],prepare=vi.fn(prepareSavedRevisionDraft);let entered!:()=>void,release!:()=>void,phase='restoration';
 const reached=new Promise<void>(done=>{entered=done;}),held=new Promise<void>(done=>{release=done;});
 // Existing App-test convention: exact AST-selected function bodies, with bridge
 // delivery and batched React setters substituted. No render drains this queue.
 const source=await readFile(new URL('../src/renderer/src/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),bodies=new Map<string,string>();
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name&&['useSavedRevision','refresh','inspectBrowser'].includes(node.name.text))bodies.set(node.name.text,node.getText(file));ts.forEachChild(node,visit);};visit(file);expect([...bodies.keys()].sort()).toEqual(['inspectBrowser','refresh','useSavedRevision']);
 const bindings=withOrdinaryAppBindings(file,{newQuestionEpoch:{current:1},incomingActivationEpoch:{current:1},surfaceIntentEpoch:{current:1},taskRef,taskListSnapshot,surfaceModeRef:{current:'workspace'},lock:{current:false},bridge:{invoke:async(command:{type:string})=>{if(command.type==='tasks.list')return f.core.listTasks();if(command.type==='browser.inspect')return f.core.getTask(f.task.id);entered();await held;return stale;}},setTask:(task:Task)=>{updates.push({phase,task});},prepareSavedRevisionDraft:prepare,learningDrafts:f.cache,openArtifact:(artifact:{id:string})=>{opened.push(artifact.id);},deletedTaskIds:{current:new Set<string>()},drafts:{hydrate:()=>{}},requestRef:{current:undefined},requestErrorOwner:{current:undefined},arrivedRequests:{current:new Set<string>()},readModelDraft:()=>undefined,readScreenBrief:()=>undefined,MODULE_MIME:'application/vnd.window-companion.modules+json',setArrivalIdentities:()=>{},setTasks:()=>{},viewRestored:{current:true},viewSelectionEpoch:{current:0},restoreTaskView:()=>undefined,setError:()=>{},setTasksHydrated:()=>{}});
 const code=ts.transpileModule('('+bodies.get('useSavedRevision')+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,refreshCode=ts.transpileModule('('+bodies.get('refresh')+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 const run=Function(...Object.keys(bindings),'return '+code)(...Object.values(bindings)) as (taskId:string,reference:typeof f.reference)=>Promise<SavedRevisionDraftResult>,refresh=Function(...Object.keys(bindings),'return '+refreshCode)(...Object.values(bindings)) as ()=>Promise<void>,inspectionCode=ts.transpileModule('('+bodies.get('inspectBrowser')+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,inspect=Function(...Object.keys(bindings),'return '+inspectionCode)(...Object.values(bindings)) as (taskId:string,runId:string,operationId:string,url:string,attemptId:string)=>Promise<void>;
 const restoring=run(f.task.id,f.reference);await reached;
 let newer=await f.core.putSource(f.task.id,{id:f.currentRef.sourceId,kind:'text',role:'fact',label:'Visit requirements',content:'Visitors: 30.'});
 const version=newer.sources[0].versions.at(-1)!,reference={sourceId:version.id,version:version.version,digest:version.digest};
 await f.core.saveArtifact(f.task.id,{artifactId:f.earlier.artifactId,expectedRevision:2,title:'Newer accepted plan',content:'Newer accepted body.',mimeType:'text/markdown',sourceRefs:[reference]});newer=await f.core.getTask(f.task.id);f.setTask(newer);
 if(delivery==='rendered')taskRef.current=newer;
 else{const accepted=delivery==='queued'?'refresh':'inspection';phase=accepted;if(delivery==='queued')await refresh();else await inspect(f.task.id,'owned-run','owned-operation','https://owned.invalid','owned-inspection');phase='restoration';expect(taskRef.current).toBe(stale);expect(taskListSnapshot.current.generation).toBe(1);expect(taskListSnapshot.current.tasks.find(item=>item.id===newer.id)).toEqual(newer);expect(updates).toEqual([{phase:accepted,task:newer}]);}
 release();const result=await restoring,afterRender=delivery!=='rendered'?updates.at(-1)!.task:taskRef.current;
 expect({result:result.kind,visibleRevision:afterRender.artifacts[0].revisions.at(-1)!.revision,visibleSource:afterRender.sources[0].currentVersion,replacements:updates.filter(update=>update.phase==='restoration').length,staged:prepare.mock.calls.length,navigation:opened.length}).toEqual({result:'held',visibleRevision:3,visibleSource:3,replacements:0,staged:0,navigation:0});
 expect(await f.store.read()).toEqual(stored);expect(await f.core.getTask(f.task.id)).toEqual(newer);
});
