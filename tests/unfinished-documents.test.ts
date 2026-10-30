import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {requestSavedWorkNavigation} from '../src/renderer/src/saved-work-navigation';
import {resolveSavedWorkMatch,type SavedWorkMatch} from '../src/shared/saved-work-search';
import type {Artifact,Task} from '../src/core/types';
import {unfinishedDocumentCurrent,unfinishedDocuments} from '../src/renderer/src/unfinished-documents';
import {createRevisionInstructionsController} from '../src/renderer/src/revision-instructions-controller';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis,savedDocumentDraftOwner} from '../src/shared/saved-document-draft';

const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'unfinished-documents-')),core=await createCompanion({dataDir:directory}),store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)});let fail=false,loseClear=false;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{if(fail){fail=false;throw Error('Owned draft storage refused the write.');}const result=await store.save(...args);if(loseClear&&args[4]===null){loseClear=false;throw Error('Owned clear acknowledgement was lost.');}return result;}});await cache.load();
 const tasks:Task[]=[];
 for(const title of ['Orchard','Mesa']){const created=await core.createTask({title}),saved=await core.saveArtifact(created.id,{title:title+' plan',content:'# '+title+' plan\n\nSaved body.',mimeType:'text/markdown',sourceRefs:[]}),task=await core.getTask(created.id);tasks.push(task);const controller=createSavedDocumentDraftController({cache,artifactId:saved.artifactId,task:()=>task,base:()=>saved.revision,isCurrent:()=>true,send:async()=>{throw Error('Opening the draft cannot save it.');},onSaved:()=>{}});expect(controller.edit({title:'RAW_PRIVATE_'+title,content:title==='Mesa'?'':'RAW_BODY_'+title}).kind).toBe('accepted');}
 await cache.flush();cleanup.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 const target=tasks[1],revision=target.artifacts[0].revisions[0],match:SavedWorkMatch={kind:'file',taskId:target.id,taskTitle:target.title,title:revision.title,artifactId:target.artifacts[0].id,revision:revision.revision,digest:revision.digest,mimeType:revision.mimeType,encoding:revision.encoding,contentLength:revision.content.length,contentPrefix:'',field:'File name',excerpt:''};
 return {directory,core,store,cache,tasks,target,match,failNext:()=>{fail=true;},loseNextClear:()=>{loseClear=true;}};
}
async function appOpen(){
 const source=await readFile(new URL('../src/renderer/src/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.FunctionDeclaration|undefined;
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='openSavedWork')found=node;ts.forEachChild(node,visit);};visit(file);expect(found).toBeDefined();return ts.transpileModule('('+found!.getText(file)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
}
it('uses the actual guarded App navigation to open the owning draft editor without changing either task or its raw edits',async()=>{
 const f=await fixture(),before=await readFile(join(f.directory,'learning-drafts.json')),taskRef={current:f.tasks[0]},tasks=structuredClone(f.tasks),selected:Artifact[]=[],pages:string[]=[],reads:string[]=[];let dirty=true,leave:(()=>void)|undefined;
 const scope={current:()=>true,started:vi.fn(),finished:vi.fn(),failed:vi.fn()},bindings={requestSavedWorkNavigation,resolveSavedWorkMatch,taskRef,newQuestionEpoch:{current:1},incomingActivationEpoch:{current:1},surfaceIntentEpoch:{current:1},surfaceModeRef:{current:'workspace'},taskListSnapshot:{current:{generation:1,tasks:f.tasks}},deletedTaskIds:{current:new Set()},draftNavigation:{api:{guard:(action:()=>void)=>{if(dirty){leave=action;return false;}action();return true;},hasDirty:()=>dirty}},drafts:{flush:async()=>{},hydrate:()=>{}},bridge:{invoke:async(command:{taskId:string})=>{reads.push(command.taskId);return f.core.getTask(command.taskId);}},viewSelectionEpoch:{current:0},viewRestored:{current:true},retireContext:()=>{},setLocalStart:()=>{},setAddingBot:()=>{},setArrivalIdentities:()=>{},setTask:()=>{},setTasks:()=>{},setBasePage:()=>{},setError:()=>{},setNotice:()=>{},setArtifact:(artifact:Artifact)=>{selected.push(artifact);},setRevisionOrigin:()=>{},setReviewRevision:()=>{},setHistorySelection:()=>{},setPage:(page:string)=>{pages.push(page);}};
 const open=Function(...Object.keys(bindings),'return '+await appOpen())(...Object.values(bindings));open(f.match,scope,'draft');expect(leave).toBeDefined();expect(reads).toEqual([]);expect(pages).toEqual([]);expect(taskRef.current).toBe(f.tasks[0]);
 dirty=false;leave!();await vi.waitFor(()=>expect(scope.finished).toHaveBeenCalled());expect(scope.failed).not.toHaveBeenCalled();expect(reads).toEqual([f.target.id]);expect(pages).toEqual(['artifact']);expect(selected).toEqual([f.target.artifacts[0]]);expect(taskRef.current.id).toBe(f.target.id);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);expect(await f.core.listTasks()).toEqual(tasks);
});

it('lists owning saved names across tasks, including intentionally blank edits, without publishing draft text as row or search data',async()=>{
 const f=await fixture(),before=await readFile(join(f.directory,'learning-drafts.json')),rows=unfinishedDocuments(f.tasks,f.cache.getSnapshot());
 expect(rows.map(row=>[row.match.taskTitle,row.match.title,row.status])).toEqual([['Mesa','Mesa plan','continue'],['Orchard','Orchard plan','continue']]);
 expect(rows.every(row=>row.match.excerpt===''&&row.match.contentPrefix==='')).toBe(true);expect(JSON.stringify(rows)).not.toContain('RAW_');expect(rows.every(row=>unfinishedDocumentCurrent(row,f.cache.getSnapshot()))).toBe(true);
 const reopened=createLearningDrafts({read:()=>f.store.read(),save:(...args)=>f.store.save(...args)});await reopened.load();expect(unfinishedDocuments(f.tasks,reopened.getSnapshot()).map(row=>row.match.taskId).sort()).toEqual(f.tasks.map(task=>task.id).sort());expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);
 const base=f.target.artifacts[0].revisions[0],controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.target.artifacts[0].id,task:()=>f.target,base:()=>base,isCurrent:()=>true,send:async()=>{throw Error('Indexing cannot save.');},onSaved:()=>{}});
 expect(controller.snapshot().fields).toMatchObject({title:'RAW_PRIVATE_Mesa',content:''});controller.edit({content:'Newer blank-preserving edit'});expect(unfinishedDocumentCurrent(rows.find(row=>row.match.taskId===f.target.id)!,f.cache.getSnapshot())).toBe(false);
});

it('distinguishes changed source links and saved revisions while leaving every unapplied field and saved file untouched',async()=>{
 const f=await fixture();let task=await f.core.createTask({title:'Source-dependent task'});task=await f.core.putSource(task.id,{kind:'text',role:'fact',label:'Original source',content:'Version one'});const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest},saved=await f.core.saveArtifact(task.id,{title:'Source plan',content:'Saved source plan.',mimeType:'text/plain',sourceRefs:[ref]});task=await f.core.getTask(task.id);
 const owner=savedDocumentDraftOwner(task.id,saved.artifactId),raw={present:true,title:'',content:'',sourceRefs:[ref]};expect(f.cache.tryEdit(owner,SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis(task,saved.artifactId,saved.revision),()=>raw).kind).toBe('accepted');await f.cache.flush();task=await f.core.putSource(task.id,{id:source.id,kind:'text',role:'fact',label:'Original source',content:'Version two'});
 await f.core.saveArtifact(f.tasks[0].id,{artifactId:f.tasks[0].artifacts[0].id,expectedRevision:1,title:'Newer Orchard plan',content:'Later saved body.',mimeType:'text/markdown',sourceRefs:[]});const tasks=await f.core.listTasks(),before=await readFile(join(f.directory,'learning-drafts.json')),rows=unfinishedDocuments(tasks,f.cache.getSnapshot());
 expect(rows.find(row=>row.match.taskId===task.id)?.status).toBe('sources');expect(rows.find(row=>row.match.taskId===f.tasks[0].id)?.status).toBe('revision');expect(rows.find(row=>row.match.taskId===f.target.id)?.status).toBe('continue');expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);expect(await f.core.listTasks()).toEqual(tasks);
});

it.each(['write','clear'] as const)('keeps an unconfirmed %s actionable as a storage check without resending or changing saved work',async kind=>{
 const f=await fixture(),base=f.target.artifacts[0].revisions[0],controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.target.artifacts[0].id,task:()=>f.target,base:()=>base,isCurrent:()=>true,send:async()=>{throw Error('Unconfirmed draft cannot save.');},onSaved:()=>{}});
 if(kind==='write'){f.failNext();controller.edit({content:'Kept newer input after storage failure'});await expect(f.cache.flush()).rejects.toThrow();}
 else{f.loseNextClear();expect(await controller.discard()).toBe(false);}
 const before=await readFile(join(f.directory,'learning-drafts.json')),row=unfinishedDocuments(f.tasks,f.cache.getSnapshot()).find(item=>item.match.taskId===f.target.id);expect(row?.status).toBe('storage');expect(JSON.stringify(row)).not.toContain('RAW_PRIVATE');expect(JSON.stringify(row)).not.toContain('Kept newer');expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);expect(await f.core.getTask(f.target.id)).toEqual(f.target);
});

it('excludes instructions, cleared drafts, unavailable owners and ambiguous task/document identities',async()=>{
 const f=await fixture(),base=f.target.artifacts[0].revisions[0],instructions=createRevisionInstructionsController({cache:f.cache,artifactId:f.target.artifacts[0].id,task:()=>f.target,base:()=>base,isCurrent:()=>true,scope:()=>'',send:async()=>{throw Error('Indexing cannot send instructions.');}});instructions.edit('PRIVATE_INSTRUCTIONS');await f.cache.flush();
 expect(unfinishedDocuments(f.tasks,f.cache.getSnapshot())).toHaveLength(2);expect(unfinishedDocuments([f.tasks[0]],f.cache.getSnapshot())).toHaveLength(1);expect(unfinishedDocuments([...f.tasks,f.target],f.cache.getSnapshot()).map(row=>row.match.taskId)).toEqual([f.tasks[0].id]);
 const ambiguous={...f.target,artifacts:[...f.target.artifacts,f.target.artifacts[0]]};expect(unfinishedDocuments([f.tasks[0],ambiguous],f.cache.getSnapshot()).map(row=>row.match.taskId)).toEqual([f.tasks[0].id]);
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.target.artifacts[0].id,task:()=>f.target,base:()=>base,isCurrent:()=>true,send:async()=>undefined,onSaved:()=>{}});expect(await controller.discard()).toBe(true);expect(unfinishedDocuments(f.tasks,f.cache.getSnapshot()).map(row=>row.match.taskId)).toEqual([f.tasks[0].id]);
});

it.each(['revised','deleted'] as const)('the reused navigation refuses a %s destination and preserves the current task and both raw drafts',async change=>{
 const f=await fixture(),before=await readFile(join(f.directory,'learning-drafts.json')),open=vi.fn(),finished=vi.fn(),failed=vi.fn();
 if(change==='revised')await f.core.saveArtifact(f.target.id,{artifactId:f.target.artifacts[0].id,expectedRevision:1,title:'Foreign saved update',content:'New saved body.',mimeType:'text/markdown',sourceRefs:[]});else await f.core.deleteTask(f.target.id);
 requestSavedWorkNavigation(f.match,{current:()=>true,guard:action=>(action(),true),dirty:()=>false,listGeneration:()=>1,knownTask:id=>f.tasks.find(task=>task.id===id),flush:async()=>{},load:id=>f.core.getTask(id),started:()=>{},finished,failed,open});await vi.waitFor(()=>expect(finished).toHaveBeenCalled());expect(failed).toHaveBeenCalledOnce();expect(open).not.toHaveBeenCalled();expect(await f.core.getTask(f.tasks[0].id)).toEqual(f.tasks[0]);expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(before);
 if(change==='deleted')expect(unfinishedDocuments(await f.core.listTasks(),f.cache.getSnapshot()).map(row=>row.match.taskId)).toEqual([f.tasks[0].id]);
});
