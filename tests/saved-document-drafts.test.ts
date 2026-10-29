import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftOwner,savedDocumentDraftBasis} from '../src/shared/saved-document-draft';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'saved-document-draft-'));let core=await createCompanion({dataDir:directory});
 const task=await core.createTask({title:'Saved ordinary document'}),saved=await core.saveArtifact(task.id,{title:'Committed title',content:'Committed body.',mimeType:'text/markdown',sourceRefs:[]}),owner=savedDocumentDraftOwner(task.id,saved.artifactId),slot=SAVED_DOCUMENT_DRAFT_SLOT;
 const makeStore=()=>new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)});
 const makeCache=()=>{const store=makeStore();return createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});};
 const cache=makeCache();await cache.load();cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,get core(){return core},task,saved,owner,slot,cache,makeCache,makeStore,restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});}};
}
it('the existing sidecar restores intentional blank fields for the same saved document without changing the committed revision',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id),basis=savedDocumentDraftBasis(task,f.saved.artifactId,f.saved.revision);
 expect(f.cache.edit(f.owner,f.slot,emptySavedDocumentDraft,basis,()=>({present:true,title:'',content:'',sourceRefs:[]}))).toBe(true);
 await f.cache.flush();f.cache.setFrozen(true);await f.cache.flushForQuit();await f.restart();
 const reopened=f.makeCache();await reopened.load();expect(reopened.readForm(f.owner,f.slot,emptySavedDocumentDraft,basis)).toMatchObject({status:'ready',value:{present:true,title:'',content:'',sourceRefs:[]}});
 expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);
});

import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
it('a confirmed manual save retires only its submitted generation and rebases newer raw onto that saved revision',async()=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id),base=f.saved.revision;let release:()=>void=()=>{},entered:()=>void=()=>{};
 const held=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:async input=>{await f.core.saveArtifact(task.id,input);entered();await held;task=await f.core.getTask(task.id);return task;},onSaved:revision=>{base=revision;}});
 expect(controller.edit({content:'Submitted g1.'}).kind).toBe('accepted');const saving=controller.save();await started;
 expect(controller.edit({content:'Newer g2 after dispatch.'}).kind).toBe('accepted');release();expect(await saving).toBe(true);await f.cache.flush();
 expect(base.revision).toBe(2);expect(controller.snapshot().fields.content).toBe('Newer g2 after dispatch.');
 const reopened=f.makeCache();await reopened.load();expect(reopened.readForm(f.owner,f.slot,emptySavedDocumentDraft,savedDocumentDraftBasis(task,f.saved.artifactId,base))).toMatchObject({status:'ready',value:{present:true,content:'Newer g2 after dispatch.'}});
 expect((await f.core.getTask(task.id)).artifacts[0].revisions.map(revision=>revision.content)).toEqual(['Committed body.','Submitted g1.']);
});
it.each(['revision','freshness'] as const)('a changed %s keeps earlier raw in recovery and never dispatches a save',async kind=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id);
 if(kind==='freshness'){task=await f.core.putSource(task.id,{kind:'text',label:'Linked',content:'Original source',role:'fact'});const source=task.sources[0],v=source.versions[0];await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Linked doc',content:'Linked body',mimeType:'text/plain',sourceRefs:[{sourceId:source.id,version:1,digest:v.digest}]});task=await f.core.getTask(task.id);}
 const base=task.artifacts[0].revisions.at(-1)!;let calls=0;
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:async()=>{calls++;return task;},onSaved:()=>{}});
 controller.edit({title:'Exact earlier raw',content:''});await f.cache.flush();
 if(kind==='revision'){await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:base.revision,title:'Foreign revision',content:'Foreign body',sourceRefs:[]});task=await f.core.getTask(task.id);}
 else task=await f.core.invalidateSource(task.id,task.sources[0].id,'Changed freshness');
 expect(controller.snapshot().fields).toMatchObject({title:'Exact earlier raw',content:''});expect(controller.snapshot().held).toBe(true);expect(await controller.save()).toBe(false);expect(calls).toBe(0);
 const reopened=f.makeCache();await reopened.load();expect(reopened.readForm(f.owner,f.slot,emptySavedDocumentDraft,savedDocumentDraftBasis(task,f.saved.artifactId,task.artifacts[0].revisions.at(-1)!)).status).toBe('recovery');
});
it('an obsolete navigation scope cannot clear its draft or publish a late save error',async()=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id),scope='original';const base=f.saved.revision;let entered:()=>void=()=>{},release:()=>void=()=>{};
 const started=new Promise<void>(done=>{entered=done;}),held=new Promise<void>(done=>{release=done;});
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,scope:()=>scope,send:async input=>{await f.core.saveArtifact(task.id,input);entered();await held;throw Error('Late foreign-scope error');},onSaved:()=>{throw Error('Retired save must not present.');}});
 controller.edit({content:'Submitted old scope'});const saving=controller.save();await started;scope='incoming-activation';task=await f.core.getTask(task.id);release();expect(await saving).toBe(false);
 expect(controller.snapshot().message).not.toContain('Late foreign-scope error');expect(controller.snapshot().raw.present).toBe(true);expect((await f.core.getTask(task.id)).artifacts[0].revisions).toHaveLength(2);
});
it('Cancel removes only the exact durable raw generation and restart cannot resurrect it',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id);let discarded=0;
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>f.saved.revision,isCurrent:()=>true,send:async()=>{throw Error('Cancel cannot dispatch a document save');},onSaved:()=>{},onDiscard:()=>{discarded++;}});
 controller.edit({title:'Raw cancel title',content:'Raw cancel body'});await f.cache.flush();expect(await controller.discard()).toBe(true);expect(discarded).toBe(1);
 const reopened=f.makeCache();await reopened.load();expect(reopened.readForm(f.owner,f.slot,emptySavedDocumentDraft,savedDocumentDraftBasis(task,f.saved.artifactId,f.saved.revision)).value.present).toBe(false);expect((await f.core.getTask(task.id)).artifacts[0].revisions).toHaveLength(1);
});
it('a large accepted raw document stays visible when the unchanged8MiB sidecar refuses it, and quit refuses success',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id),large='界'.repeat(3_000_000);
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>f.saved.revision,isCurrent:()=>true,send:async()=>{throw Error('Unsaved raw must not dispatch');},onSaved:()=>{}});
 expect(controller.edit({content:large}).kind).toBe('accepted');await expect(f.cache.flush()).rejects.toThrow(/full/);
 expect(controller.snapshot().fields.content).toBe(large);expect(controller.snapshot().form.error).toBeTruthy();f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();f.cache.setFrozen(false);
 expect((await f.core.getTask(task.id)).artifacts[0].revisions).toEqual([f.saved.revision]);expect(await controller.discard()).toBe(true);
});
it('deleting the task removes draft applicability and delayed raw writes cannot recreate it',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id),basis=savedDocumentDraftBasis(task,f.saved.artifactId,f.saved.revision);
 f.cache.edit(f.owner,f.slot,emptySavedDocumentDraft,basis,()=>({present:true,title:'Deleted raw',content:'Never resurrect',sourceRefs:[]}));await f.cache.flush();await f.core.deleteTask(task.id);
 const store=f.makeStore(),read=await store.read();expect(read.kind).toBe('available');if(read.kind!=='available')throw Error('Expected readable store');expect(read.records).toEqual([]);
 await expect(store.save(f.owner,f.slot,read.epoch,0,{initial:serializeLearningDraftJson(emptySavedDocumentDraft,'saved-document-edit'),value:serializeLearningDraftJson({present:true,title:'Deleted raw',content:'Never resurrect',sourceRefs:[]},'saved-document-edit'),basis})).rejects.toThrow(/no longer/);expect(await f.core.listTasks()).toEqual([]);
});
it('a stale mirror title event preserves another mirror’s newer body and edits the latest heading only',async()=>{
 const f=await fixture();await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Committed title',content:'# Committed title\n\nOriginal body.',mimeType:'text/markdown',sourceRefs:[]});const task=await f.core.getTask(f.task.id),base=task.artifacts[0].revisions.at(-1)!;
 const options={cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:async()=>task,onSaved:()=>{}};
 const hidden=createSavedDocumentDraftController(options),visible=createSavedDocumentDraftController(options);hidden.snapshot();
 expect(visible.edit({content:'# Committed title\n\nNewer body from visible mirror.'}).kind).toBe('accepted');
 expect(hidden.edit({title:'Renamed from hidden mirror'}).kind).toBe('accepted');await f.cache.flush();
 expect(visible.snapshot().fields).toMatchObject({title:'Renamed from hidden mirror',content:'# Renamed from hidden mirror\n\nNewer body from visible mirror.'});
});
it('failed discard keeps the exact raw visible until the authoritative tombstone is reconciled',async()=>{
 const f=await fixture(),task=await f.core.getTask(f.task.id),store=f.makeStore();let fail=false,discarded=0;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{if(fail&&args[4]===null){fail=false;await store.save(...args);throw Error('Lost tombstone acknowledgement');}return store.save(...args);}});await cache.load();
 const controller=createSavedDocumentDraftController({cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>f.saved.revision,isCurrent:()=>true,send:async()=>task,onSaved:()=>{},onDiscard:()=>{discarded++;}});
 controller.edit({title:'Exact raw title',content:''});await cache.flush();fail=true;expect(await controller.discard()).toBe(false);expect(controller.snapshot().fields).toMatchObject({title:'Exact raw title',content:''});expect(discarded).toBe(0);
 expect(await controller.check()).toBe(true);expect(discarded).toBe(1);expect(controller.snapshot().raw.present).toBe(false);
});
it.each(['application/json','image/png','text/plain;base64'])('the raw owner refuses %s artifacts without touching the sidecar',async format=>{
 const f=await fixture();const artifact=await f.core.saveArtifact(f.task.id,format==='image/png'?{title:'Image',content:'Not an image',sourceRefs:[]}:format==='text/plain;base64'?{title:'Encoded',content:'Ordinary first',mimeType:'text/plain',sourceRefs:[]}:{title:'Structured',content:'{}',mimeType:'application/json',sourceRefs:[]});
 const task=await f.core.getTask(f.task.id),stored=task.artifacts.find(item=>item.id===artifact.artifactId)!;
 if(format!=='application/json'){stored.revisions[0].mimeType=format==='image/png'?'image/png':'text/plain';stored.revisions[0].encoding='base64';}
 const owner=savedDocumentDraftOwner(task.id,artifact.artifactId),basis=savedDocumentDraftBasis(task,artifact.artifactId,stored.revisions[0]);const store=new LearningDraftStore({directory:f.directory,lookupTask:async()=>task});
 await expect(store.save(owner,f.slot,'initial',0,{initial:serializeLearningDraftJson(emptySavedDocumentDraft,'saved-document-edit'),value:serializeLearningDraftJson({present:true,title:'Raw',content:'No authority',sourceRefs:[]},'saved-document-edit'),basis})).rejects.toThrow(/no longer/);expect(await store.read()).toMatchObject({kind:'available',records:[]});
});
it('the pinned pre-source strict reader refuses the new document owner and leaves sidecar bytes intact',async()=>{
 const {readFile}=await import('node:fs/promises'),{resolve}=await import('node:path'),ts=await import('typescript'),effect=await import('effect'),local=await import('../src/shared/local-task-draft'),policy=await import('../src/shared/learning-draft-form-policy'),validation=await import('../src/shared/learning-draft-validation');
 const f=await fixture(),task=await f.core.getTask(f.task.id),basis=savedDocumentDraftBasis(task,f.saved.artifactId,f.saved.revision);
 f.cache.edit(f.owner,f.slot,emptySavedDocumentDraft,basis,()=>({present:true,title:'Earlier raw',content:'Exact current reader document raw',sourceRefs:[]}));await f.cache.flush();const bytes=await readFile(join(f.directory,'learning-drafts.json'));
 const source=await readFile(resolve('tests/fixtures/source-text-prior-shared.ts.txt'),'utf8'),{createHash}=await import('node:crypto');expect(createHash('sha256').update(source).digest('hex')).toBe('4307fd87ffc93b12360837b139945d5c5059c2cfa2e2a39e10f8595827fe958b');
 const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as {parseLearningDraftFile?:(value:unknown)=>unknown}},dependencies:Record<string,unknown>={'effect':effect,'./local-task-draft':local,'./learning-draft-form-policy':policy,'./learning-draft-validation':validation};
 Function('require','module','exports',output)((name:string)=>{if(!(name in dependencies))throw Error('Unlisted fixture dependency '+name);return dependencies[name];},module,module.exports);
 expect(module.exports.parseLearningDraftFile).toBeTypeOf('function');expect(()=>module.exports.parseLearningDraftFile!(JSON.parse(bytes.toString()))).toThrow();expect(await readFile(join(f.directory,'learning-drafts.json'))).toEqual(bytes);expect((await f.makeStore().read()).kind).toBe('available');
});
import {requestSavedDocument} from '../src/renderer/src/saved-document-save-request';
it('an own v2 reply followed by refresh of foreign v3 keeps newer g2 on its original basis without presenting or clearing',async()=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id),base=f.saved.revision,presented=0,release:()=>void=()=>{},entered:()=>void=()=>{};
 const held=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
 const controller=createSavedDocumentDraftController({cache:f.cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:input=>requestSavedDocument(task.id,input,{lock:{current:false},setBusy:()=>{},invoke:async command=>{await f.core.saveArtifact(task.id,command.artifact);return f.core.getTask(task.id);},refresh:async()=>{entered();await held;task=await f.core.getTask(task.id);return task;}}),onSaved:revision=>{base=revision;presented++;}});
 controller.edit({content:'Own submitted g1.'});const saving=controller.save();await started;controller.edit({content:'Newer g2 to retain.'});await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:2,title:'Foreign v3',content:'Foreign committed text',mimeType:'text/markdown',sourceRefs:[]});release();
 expect(await saving).toBe(false);expect(presented).toBe(0);expect(base.revision).toBe(1);await f.cache.flush();
 expect(controller.snapshot().fields.content).toBe('Newer g2 to retain.');expect(controller.snapshot().held).toBe(true);
 const entry=f.cache.getSnapshot().entries[controller.snapshot().key];expect(entry.local?.basis).toBe(savedDocumentDraftBasis(task,f.saved.artifactId,f.saved.revision));expect(task.artifacts[0].revisions.map(revision=>revision.content)).toEqual(['Committed body.','Own submitted g1.','Foreign committed text']);
});
it('canonical source references use a literal Unicode ordering independent of locale collation',async()=>{
 const {orderedDocumentRefs,parseSavedDocumentDraftBasis}=await import('../src/shared/saved-document-draft');
 const refs=['東京','α','é','z','🙂'].map(sourceId=>({sourceId,version:1,digest:'a'.repeat(64)}));
 expect(orderedDocumentRefs(refs).map(ref=>ref.sourceId)).toEqual(['z','é','α','東京','🙂']);
 const f=await fixture(),task=await f.core.getTask(f.task.id),revision={...f.saved.revision,sourceRefs:refs};
 const basis=savedDocumentDraftBasis(task,f.saved.artifactId,revision);expect(parseSavedDocumentDraftBasis(basis).sourceRefs.map(ref=>ref.sourceId)).toEqual(['z','é','α','東京','🙂']);expect(parseSavedDocumentDraftBasis(basis).sources.map(source=>source.kind)).toEqual(['missing','missing','missing','missing','missing']);
});

it.each([
 {advance:'revision',ack:'lost',newer:true},
 {advance:'freshness',ack:'lost',newer:true},
 {advance:'revision',ack:'held',newer:false},
 {advance:'freshness',ack:'held',newer:true},
 {advance:'source-version',ack:'lost',newer:true},
 {advance:'source-version',ack:'held',newer:true},
] as const)('pending Check refuses $advance after a $ack sidecar acknowledgement, newer=$newer',async mode=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id);
 if(mode.advance!=='revision'){task=await f.core.putSource(task.id,{kind:'text',label:'Linked source',content:'Exact original source',role:'fact'});const source=task.sources[0],version=source.versions[0];await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Linked original',content:'Original linked body',mimeType:'text/markdown',sourceRefs:[{sourceId:source.id,version:version.version,digest:version.digest}]});task=await f.core.getTask(task.id);}
 let base=task.artifacts[0].revisions.at(-1)!,presented=0,releaseReply:()=>void=()=>{},replyEntered:()=>void=()=>{},releaseCompletion:()=>void=()=>{},completionEntered:()=>void=()=>{};
 const originalBase=base,originalBasis=savedDocumentDraftBasis(task,f.saved.artifactId,base),reply=new Promise<void>(done=>{releaseReply=done;}),started=new Promise<void>(done=>{replyEntered=done;}),completion=new Promise<void>(done=>{releaseCompletion=done;}),completionStarted=new Promise<void>(done=>{completionEntered=done;});
 const store=f.makeStore();let hold=true;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const result=await store.save(...args);if(hold&&(args[4]===null||args[4].basis!==originalBasis)){hold=false;completionEntered();await completion;if(mode.ack==='lost')throw Error('Lost acknowledgement after actual completion write');}return result;}});await cache.load();
 const controller=createSavedDocumentDraftController({cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:async input=>{await f.core.saveArtifact(task.id,input);const own=await f.core.getTask(task.id);task=own;replyEntered();await reply;return own;},onSaved:revision=>{base=revision;presented++;}});
 controller.edit({content:'Own submitted g1 before completion.'});const saving=controller.save();await started;if(mode.newer)controller.edit({content:'Newer raw g2 before completion.'});releaseReply();await completionStarted;
 if(mode.advance==='revision')await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:originalBase.revision+1,title:'Foreign advanced document',content:'Foreign latest body',mimeType:base.mimeType,sourceRefs:[]});
 else if(mode.advance==='freshness')await f.core.invalidateSource(task.id,task.sources[0].id,'Freshness changed before Check');
 else await f.core.putSource(task.id,{kind:'text',id:task.sources[0].id,label:'Foreign source version',content:'New linked source version before Check.',role:'fact'});
 task=await f.core.getTask(task.id);releaseCompletion();expect(await saving).toBe(false);expect(presented).toBe(0);
 expect(await controller.check()).toBe(false);expect(presented).toBe(0);expect(base).toEqual(originalBase);expect(controller.snapshot().held).toBe(true);
 if(mode.newer){expect(controller.snapshot().fields.content).toBe('Newer raw g2 before completion.');expect(controller.snapshot().raw.present).toBe(true);}
 expect((await f.core.getTask(task.id)).artifacts[0].revisions).toHaveLength(originalBase.revision+(mode.advance==='revision'?2:1));
});
it.each(['revision','freshness','source-version'] as const)('a lost completion acknowledgement followed later by %s cannot present pending history on Check',async advance=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id);
 if(advance!=='revision'){task=await f.core.putSource(task.id,{kind:'text',label:'Linked',content:'Initial linked source.',role:'fact'});const source=task.sources[0],version=source.versions[0];await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Linked document',content:'Linked committed body.',mimeType:'text/plain',sourceRefs:[{sourceId:source.id,version:1,digest:version.digest}]});task=await f.core.getTask(task.id);}
 const base=task.artifacts[0].revisions.at(-1)!,originalBasis=savedDocumentDraftBasis(task,f.saved.artifactId,base),store=f.makeStore();let lose=true,presented=0;
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const result=await store.save(...args);if(lose&&args[4]?.basis!==originalBasis){lose=false;throw Error('Own completion response lost before later external change.');}return result;}});await cache.load();
 const controller=createSavedDocumentDraftController({cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:async input=>{await f.core.saveArtifact(task.id,input);task=await f.core.getTask(task.id);controller.edit({content:'Later raw g2 remains inspectable.'});return task;},onSaved:()=>{presented++;}});
 controller.edit({content:'Submitted own g1.'});expect(await controller.save()).toBe(false);expect(controller.snapshot().pending).toBe(true);expect(presented).toBe(0);
 if(advance==='revision')await f.core.saveArtifact(task.id,{artifactId:f.saved.artifactId,expectedRevision:base.revision+1,title:'Later foreign',content:'Later foreign content.',mimeType:base.mimeType,sourceRefs:[]});
 else if(advance==='freshness')await f.core.invalidateSource(task.id,task.sources[0].id,'Later invalidation after failed completion.');
 else await f.core.putSource(task.id,{kind:'text',id:task.sources[0].id,label:'Later source version',content:'Later foreign source text.',role:'fact'});
 task=await f.core.getTask(task.id);expect(await controller.check()).toBe(false);expect(presented).toBe(0);expect(controller.snapshot().fields.content).toBe('Later raw g2 remains inspectable.');expect(controller.snapshot().held).toBe(true);
});
it.each([false,true])('Check may present the exact still-current own revision after a lost acknowledgement, newer=%s',async newer=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id),base=f.saved.revision,presented=0,lose=true;const store=f.makeStore(),oldBasis=savedDocumentDraftBasis(task,f.saved.artifactId,base);
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const result=await store.save(...args);if(lose&&(args[4]===null||args[4].basis!==oldBasis)){lose=false;throw Error('Lost completion with no external change.');}return result;}});await cache.load();
 const controller=createSavedDocumentDraftController({cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>base,isCurrent:()=>true,send:async input=>{await f.core.saveArtifact(task.id,input);task=await f.core.getTask(task.id);if(newer)controller.edit({content:'Newer raw g2.'});return task;},onSaved:revision=>{base=revision;presented++;}});
 controller.edit({content:'Own submitted g1.'});expect(await controller.save()).toBe(false);expect(await controller.check()).toBe(true);expect(presented).toBe(1);expect(base.revision).toBe(2);expect(controller.snapshot().fields.content).toBe(newer?'Newer raw g2.':'Own submitted g1.');expect(task.artifacts[0].revisions).toHaveLength(2);
});
it('retargeting during a held completion cannot present a saved revision or publish a late source message',async()=>{
 const f=await fixture();let task=await f.core.getTask(f.task.id),scope='original',release:()=>void=()=>{},entered:()=>void=()=>{},presented=0;
 const held=new Promise<void>(done=>{release=done}),started=new Promise<void>(done=>{entered=done}),store=f.makeStore();
 const cache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{const result=await store.save(...args);if(args[4]===null){entered();await held;}return result;}});await cache.load();
 const controller=createSavedDocumentDraftController({cache,artifactId:f.saved.artifactId,task:()=>task,base:()=>f.saved.revision,isCurrent:()=>true,scope:()=>scope,send:async input=>{await f.core.saveArtifact(task.id,input);task=await f.core.getTask(task.id);return task;},onSaved:()=>{presented++;}});
 controller.edit({content:'Saved in the retired activation.'});const saving=controller.save();await started;const before=controller.snapshot().message;scope='incoming';release();expect(await saving).toBe(false);expect(presented).toBe(0);expect(controller.snapshot().message).toBe(before);expect(await controller.check()).toBe(false);expect(presented).toBe(0);
});
