import {currentAnswerOrigin} from './current-answer-origin.fixture';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {RevisionInstructionsStatus} from '../src/renderer/src/components/RevisionInstructionsStatus';
import {LearningDraftReview} from '../src/renderer/src/learning-draft-context';
import {RevisionInstructionsInput} from '../src/renderer/src/components/RevisionInstructionsInput';
import {Composer} from '../src/renderer/src/components/Composer';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {savedDocumentDraftOwner,savedDocumentDraftBasis,emptySavedDocumentDraft,SAVED_DOCUMENT_DRAFT_SLOT} from '../src/shared/saved-document-draft';
import {serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {createRevisionInstructionsController} from '../src/renderer/src/revision-instructions-controller';
import {assertRevisionInstructionRequest,type RevisionInstructionSubmission,type RevisionInstructions} from '../src/shared/revision-instructions';
import type {RequestContext,Task} from '../src/core/types';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('restores exact unsent revision instructions through the real shared sidecar and reopened core without revising or requesting',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'revision-instructions-'));let core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const created=await core.createTask({title:'Revision instruction continuity'}),saved=await core.saveArtifact(created.id,{title:'Committed document',content:'Committed body.',mimeType:'text/plain',sourceRefs:[]}),task=await core.getTask(created.id);
 const owner=savedDocumentDraftOwner(task.id,saved.artifactId),slot='saved-document:revision-instructions',basis=savedDocumentDraftBasis(task,saved.artifactId,saved.revision),initial={present:false,text:''};
 const makeCache=()=>{const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)});return createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});};
 const cache=makeCache();await cache.load();const raw='  Please keep α and 👋.  ';
 expect(cache.tryEdit(owner,slot,initial,basis,()=>({present:true,text:raw})).kind).toBe('accepted');
 cache.setFrozen(true);await cache.flushForQuit();await core.close();core=await createCompanion({dataDir:directory});
 const reopened=makeCache();await reopened.load();expect(reopened.readForm(owner,slot,initial,basis)).toMatchObject({status:'ready',value:{text:raw}});
 const current=await core.getTask(task.id);expect(current.artifacts).toEqual(task.artifacts);expect(current.requests).toEqual([]);
});

async function controllerFixture(){
 const directory=await mkdtemp(join(tmpdir(),'revision-instruction-submit-'));let core=await createCompanion({dataDir:directory});
 cleanup.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 const created=await core.createTask({title:'Bound revision instructions'}),saved=await currentAnswerOrigin(core,created.id,'fixture-revision-origin:'+created.id,{title:'Committed document',content:'Committed body.',mimeType:'text/plain'},[]);
 let task=await core.getTask(created.id),base=saved.revision,scope='original',calls=0,lastSubmission:RevisionInstructionSubmission|undefined;
 const faults:{raw?:'reject-before';tombstone?:'reject-before'|'lose-after';onTombstone?:()=>void}={},script:{run:(context:RequestContext)=>Promise<void>;reply:(task:Task)=>Task|undefined|Promise<Task|undefined>}={run:async()=>{},reply:task=>task};
 const store=()=>new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),makeCache=()=>{const current=store();return createLearningDrafts({read:()=>current.read(),save:async(...args)=>{const mode=args[4]===null?faults.tombstone:faults.raw;if(args[4]===null){faults.tombstone=undefined;const hook=faults.onTombstone;faults.onTombstone=undefined;hook?.();}else faults.raw=undefined;if(mode==='reject-before')throw Error('Controlled sidecar write rejection.');const result=await current.save(...args);if(mode==='lose-after')throw Error('Controlled tombstone acknowledgement loss.');return result;}});},cache=makeCache();await cache.load();
 const send=async(prompt:string,submission:RevisionInstructionSubmission)=>{
  const current=await core.getTask(task.id),revision=assertRevisionInstructionRequest(current,saved.artifactId,submission.basis,submission.sourceRefs.map(ref=>ref.sourceId),submission.sourceRefs);
  lastSubmission=submission;await core.runRequest({taskId:task.id,requestId:submission.requestId,kind:'revise',prompt,artifactId:saved.artifactId,expectedRevision:revision.revision,sourceIds:submission.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:submission.sourceRefs},async context=>{calls++;await script.run(context);return {title:'Committed document',content:'Scripted confirmed revision.',mimeType:'text/plain'};});
  task=await core.getTask(task.id);base=task.artifacts[0].revisions.at(-1)!;return script.reply(structuredClone(task));
 };
 const options={cache,artifactId:saved.artifactId,task:()=>task,base:()=>base,scope:()=>scope,isCurrent:()=>true,send},controller=createRevisionInstructionsController(options);
 return {directory,get core(){return core},saved,originRequestId:saved.requestId,cache,makeCache,options,controller,faults,script,get task(){return task},get base(){return base},get calls(){return calls},get lastSubmission(){return lastSubmission},refresh:async()=>{task=await core.getTask(task.id);base=task.artifacts[0].revisions.at(-1)!;},retarget:()=>{scope='incoming-selection';},restart:async()=>{await core.close();core=await createCompanion({dataDir:directory});}};
}
it('only an exactly confirmed revision clears its captured raw instructions after durable acknowledgement',async()=>{
 const f=await controllerFixture(),raw='  Keep α and 👋 exactly.  ';
 expect(f.controller.edit(raw).kind).toBe('accepted');expect(await f.controller.submit(raw.trim())).toBe(true);
 expect(f.controller.snapshot().raw.text).toBe('');expect(f.controller.snapshot().pendingClear).toBe(false);expect(f.calls).toBe(1);
 expect(f.task.requests.filter(request=>request.id!==f.originRequestId)).toHaveLength(1);expect(f.task.requests.find(request=>request.id===f.lastSubmission!.requestId)!).toMatchObject({status:'completed',kind:'revise',prompt:raw.trim(),expectedRevision:1,targetArtifactId:f.saved.artifactId,answer:{artifactId:f.saved.artifactId,revision:2}});
 await f.restart();const reopened=f.makeCache();await reopened.load();expect(reopened.readForm(f.controller.snapshot().owner,f.controller.snapshot().slot,{present:false,text:''},savedDocumentDraftBasis(f.task,f.saved.artifactId,f.base))).toMatchObject({status:'ready',value:{text:''}});
});

function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(done=>{enter=done;}),waiting:new Promise<void>(done=>{release=done;}),enter:()=>enter(),release:()=>release()};}
it('intentional whitespace survives safe unmount-style reuse and real core/store/cache recreation without any request',async()=>{
 const f=await controllerFixture(),raw=' \t  \n \t ';expect(f.controller.edit(raw).kind).toBe('accepted');await f.cache.flush();
 const mirror=createRevisionInstructionsController(f.options);expect(mirror.snapshot().raw.text).toBe(raw);expect(mirror.snapshot().canSubmit).toBe(false);
 f.cache.setFrozen(true);await f.cache.flushForQuit();await f.restart();const cache=f.makeCache();await cache.load();
 const reopened=createRevisionInstructionsController({...f.options,cache});expect(reopened.snapshot().raw.text).toBe(raw);expect(reopened.snapshot().canSubmit).toBe(false);expect(f.calls).toBe(0);expect((await f.core.getTask(f.task.id)).requests.filter(request=>request.id!==f.originRequestId)).toEqual([]);
});
it.each(['new-text','edit-undo'] as const)('a confirmation preserves a newer %s generation and exposes recovery instead of applying it to the new revision',async mode=>{
 const f=await controllerFixture(),hold=gate(),raw='Original instructions';f.script.run=async()=>{hold.enter();await hold.waiting;};f.controller.edit(raw);const sending=f.controller.submit();await hold.entered;
 expect(f.controller.edit('Newer unsent α').kind).toBe('accepted');if(mode==='edit-undo')expect(f.controller.edit(raw).kind).toBe('accepted');hold.release();expect(await sending).toBe(true);await f.cache.flush();
 expect(f.controller.snapshot().raw.text).toBe(mode==='new-text'?'Newer unsent α':raw);expect(f.controller.snapshot().form.status).toBe('recovery');expect(f.calls).toBe(1);expect(await f.controller.submit()).toBe(false);expect(f.calls).toBe(1);
});
it.each(['failed','cancelled','unknown','wrong-answer'] as const)('a %s model outcome never consumes instructions merely because a Task was returned',async mode=>{
 const f=await controllerFixture(),raw='Retain these exact instructions.';
 if(mode==='failed')f.script.run=async()=>{throw Error('Scripted model failure.');};
 if(mode==='cancelled')f.script.run=async()=>{await f.core.cancelRequest(f.task.id,f.lastSubmission!.requestId);};
 if(mode==='unknown')f.script.reply=()=>undefined;
 if(mode==='wrong-answer')f.script.reply=task=>{task.requests.find(request=>request.id===f.lastSubmission!.requestId)!.answer!.digest='f'.repeat(64);return task;};
 f.controller.edit(raw);expect(await f.controller.submit()).toBe(false);await f.cache.flush();expect(f.controller.snapshot().raw.text).toBe(raw);expect(f.calls).toBe(1);
 const cache=f.makeCache();await cache.load();expect(createRevisionInstructionsController({...f.options,cache}).snapshot().raw.text).toBe(raw);
});
it('an incoming navigation scope cannot consume instructions from the request it retired',async()=>{
 const f=await controllerFixture(),hold=gate(),raw='Keep retired-scope instructions';f.script.run=async()=>{hold.enter();await hold.waiting;};f.controller.edit(raw);const sending=f.controller.submit();await hold.entered;f.retarget();hold.release();expect(await sending).toBe(false);await f.cache.flush();expect(f.controller.snapshot().raw.text).toBe(raw);expect(f.calls).toBe(1);
});
it('a raw persistence failure refuses dispatch and blocks quit until an explicit storage check succeeds',async()=>{
 const f=await controllerFixture(),raw='Raw must be durable before Send';f.faults.raw='reject-before';f.controller.edit(raw);expect(await f.controller.submit()).toBe(false);expect(f.calls).toBe(0);expect(f.controller.snapshot().raw.text).toBe(raw);
 f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();f.cache.setFrozen(false);expect(await f.controller.check()).toBe(true);expect(f.controller.snapshot().raw.text).toBe(raw);expect(f.calls).toBe(0);
});
it.each(['reject-before','lose-after'] as const)('a confirmed revision with %s tombstone failure keeps recoverable input and storage check never resends',async mode=>{
 const f=await controllerFixture(),raw='Confirmed request, uncertain draft clear';f.controller.edit(raw);await f.cache.flush();f.faults.tombstone=mode;
 expect(await f.controller.submit()).toBe(false);expect(f.task.requests.find(request=>request.id===f.lastSubmission!.requestId)!.status).toBe('completed');expect(f.controller.snapshot().pendingClear).toBe(true);expect(f.controller.snapshot().raw.text).toBe(raw);expect(f.calls).toBe(1);
 f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();f.cache.setFrozen(false);expect(await f.controller.check()).toBe(true);expect(f.controller.snapshot().raw.text).toBe('');expect(f.controller.snapshot().pendingClear).toBe(false);expect(f.calls).toBe(1);
});
it('quit waits for the matching request and tombstone while interrupted quit resumes without an old successful acknowledgement',async()=>{
 const f=await controllerFixture(),hold=gate();f.script.run=async()=>{hold.enter();await hold.waiting;};f.controller.edit('Pending confirmed generation');const sending=f.controller.submit();await hold.entered;
 f.cache.setFrozen(true);let finished=false;const quitting=f.cache.flushForQuit().then(()=>{finished=true;},error=>{throw error;});
 await Promise.resolve();expect(finished).toBe(false);f.cache.setFrozen(false);expect(f.controller.edit('Newer resumed instructions').kind).toBe('accepted');hold.release();expect(await sending).toBe(true);await expect(quitting).rejects.toThrow(/cancelled/);await f.cache.flush();expect(f.controller.snapshot().raw.text).toBe('Newer resumed instructions');expect(finished).toBe(false);
});
it.each(['revision','source-version','source-freshness'] as const)('an advanced %s holds earlier instructions in contextual recovery before any model runner',async change=>{
 const f=await controllerFixture();
 if(change!=='revision'){
  const next=await f.core.putSource(f.task.id,{kind:'text',label:'Linked source',content:'Original linked content.',role:'fact'}),source=next.sources[0],version=source.versions[0];
  await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Linked document',content:'Linked body.',mimeType:'text/plain',sourceRefs:[{sourceId:source.id,version:1,digest:version.digest}]});await f.refresh();
 }
 const basis=f.controller.snapshot().basis;f.controller.edit('Exact instructions for the earlier basis.');await f.cache.flush();
 if(change==='revision')await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Foreign revision',content:'Foreign body.',sourceRefs:[]});
 else if(change==='source-version')await f.core.putSource(f.task.id,{kind:'text',id:f.task.sources[0].id,label:'Advanced source',content:'New linked content.',role:'fact'});
 else await f.core.invalidateSource(f.task.id,f.task.sources[0].id,'Needs explicit refresh');
 await f.refresh();expect(f.controller.snapshot().held).toBe(true);expect(f.controller.snapshot().form.status).toBe('recovery');expect(f.controller.snapshot().raw.text).toBe('Exact instructions for the earlier basis.');expect(await f.controller.submit()).toBe(false);expect(f.calls).toBe(0);
 expect(()=>assertRevisionInstructionRequest(f.task,f.saved.artifactId,basis,[],[])).toThrow(/changed/);
});
it('the validated owner, closed slot and closed raw shape cannot redirect instruction storage or consume document edits',async()=>{
 const f=await controllerFixture(),view=f.controller.snapshot(),basis=view.basis,raw='Valid instruction';f.controller.edit(raw);await f.cache.flush();
 expect(f.cache.tryEdit<RevisionInstructions>({...view.owner,artifactId:'another-document'},view.slot,{present:false,text:''},basis,()=>({present:true,text:'Foreign owner'})).kind).toBe('held');
 expect(f.cache.tryEdit<RevisionInstructions>(view.owner,view.slot+':unknown',{present:false,text:''},basis,()=>({present:true,text:'Unknown slot'})).kind).toBe('held');
 expect(f.cache.tryEdit<{present:boolean;text:string}>(view.owner,view.slot,{present:false,text:''},basis,()=>({present:true,text:'Invalid extra data',execute:true})).kind).toBe('rejected');expect(f.controller.snapshot().raw.text).toBe(raw);
 f.cache.dismissEditRejection(view.owner,view.slot,f.cache.getEditRejection(view.owner,view.slot)!.id);
 const store=new LearningDraftStore({directory:f.directory,lookupTask:async()=>f.task}),read=await store.read();if(read.kind!=='available')throw Error('Expected available sidecar');
 expect(()=>store.save({...view.owner,artifactId:'another-document'},view.slot,read.epoch,0,{initial:serializeLearningDraftJson({present:false,text:''}),value:serializeLearningDraftJson({present:true,text:'Foreign owner'}),basis})).toThrow();
 expect(f.cache.edit(view.owner,SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,basis,()=>({present:true,title:'Separate manual title',content:'Separate manual body.',sourceRefs:[]}))).toBe(true);await f.cache.flush();
 expect(await f.controller.submit()).toBe(true);expect(f.cache.readForm(view.owner,SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,basis).value.content).toBe('Separate manual body.');
});
it('the instruction slot retains generic string and JSON limits instead of inheriting the large document allowance',async()=>{
 const f=await controllerFixture();f.controller.edit('Accepted raw');await f.cache.flush();
 expect(f.controller.edit('x'.repeat(32*1024+1))).toMatchObject({kind:'rejected',reason:'text-too-long'});expect(f.controller.snapshot().raw.text).toBe('Accepted raw');
 f.cache.dismissEditRejection(f.controller.snapshot().owner,f.controller.snapshot().slot,f.cache.getEditRejection(f.controller.snapshot().owner,f.controller.snapshot().slot)!.id);
 expect(f.controller.edit('\0'.repeat(24000))).toMatchObject({kind:'rejected',reason:'too-large'});expect(f.controller.snapshot().raw.text).toBe('Accepted raw');expect(f.calls).toBe(0);
});
it('the shared8MiB aggregate still refuses new instructions without losing open raw or falsely acknowledging quit',async()=>{
 const f=await controllerFixture(),view=f.controller.snapshot();
 expect(f.cache.edit(view.owner,SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,view.basis,()=>({present:true,title:'Large accepted raw',content:'界'.repeat(2_795_000),sourceRefs:[]}))).toBe(true);await f.cache.flush();
 expect(f.controller.edit('x'.repeat(10000)).kind).toBe('accepted');await expect(f.cache.flush()).rejects.toThrow(/full/);expect(f.controller.snapshot().raw.text).toBe('x'.repeat(10000));expect(f.calls).toBe(0);
 f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow(/full/);f.cache.setFrozen(false);expect((await f.core.getTask(f.task.id)).artifacts[0].revisions).toHaveLength(1);
});
it('the actual inline recovery and Files controls expose earlier instruction text without treating it as document edits or running it',async()=>{
 const f=await controllerFixture(),raw='Earlier unsent α 👋 instructions';f.controller.edit(raw);await f.cache.flush();await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Advanced document',content:'Advanced body.',sourceRefs:[]});await f.refresh();
 const status=createControlledRenderer(()=>createElement(RevisionInstructionsStatus,{controller:f.controller,cache:f.cache}));status.render();
 expect(status.find(node=>node.type==='textarea').props).toMatchObject({readOnly:true,value:raw});expect(status.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ')).toContain('will not run automatically');
 const files=createControlledRenderer(()=>createElement(LearningDraftReview,{task:f.task,cache:f.cache}));files.render();const text=files.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(' ');
 expect(text).toContain('Revision instructions');expect(text).toContain(raw);expect(text).toContain('will not be sent or applied automatically');expect(f.calls).toBe(0);expect(f.task.requests.filter(request=>request.id!==f.originRequestId)).toEqual([]);
 status.find(node=>node.type==='button'&&node.children.some(child=>child.props.text==='Discard earlier revision instructions')).props.onClick();await f.cache.flush();await Promise.resolve();expect(f.controller.snapshot().raw.text).toBe('');expect(f.calls).toBe(0);
});
it('a failed save of a newer intentionally emptied instruction never refills older saved text',async()=>{
 const f=await controllerFixture();f.controller.edit('Earlier saved instructions');await f.cache.flush();f.faults.tombstone='reject-before';f.faults.raw='reject-before';
 expect(f.controller.edit('').kind).toBe('accepted');await expect(f.cache.flush()).rejects.toThrow();expect(f.controller.snapshot().raw.text).toBe('');expect(f.calls).toBe(0);
});
it('an uninterrupted quit drains the confirmed request and its exact instruction tombstone before success',async()=>{
 const f=await controllerFixture(),hold=gate();f.script.run=async()=>{hold.enter();await hold.waiting;};f.controller.edit('Exact pending instructions');const sending=f.controller.submit();await hold.entered;
 f.cache.setFrozen(true);let saved=false;const quit=f.cache.flushForQuit().then(()=>{saved=true;});await Promise.resolve();expect(saved).toBe(false);hold.release();expect(await sending).toBe(true);await quit;expect(saved).toBe(true);expect(f.controller.snapshot().raw.text).toBe('');expect(f.calls).toBe(1);f.cache.setFrozen(false);
});
it('a stale recovery Discard button cannot erase another mirror’s newer instruction generation',async()=>{
 const f=await controllerFixture(),oldTask=f.task,oldBase=f.base;f.controller.edit('Earlier instructions shown in recovery');await f.cache.flush();await f.core.saveArtifact(f.task.id,{artifactId:f.saved.artifactId,expectedRevision:1,title:'Advanced document',content:'New committed body.',sourceRefs:[]});await f.refresh();
 const status=createControlledRenderer(()=>createElement(RevisionInstructionsStatus,{controller:f.controller,cache:f.cache}));status.render();const discard=status.find(node=>node.type==='button'&&node.children.some(child=>child.props.text==='Discard earlier revision instructions'));
 const mirror=createRevisionInstructionsController({...f.options,task:()=>oldTask,base:()=>oldBase});expect(mirror.edit('Newer mirror instructions must survive').kind).toBe('accepted');discard.props.onClick();await f.cache.flush();await Promise.resolve();expect(f.controller.snapshot().raw.text).toBe('Newer mirror instructions must survive');expect(f.calls).toBe(0);
});
it('the actual revision input render and change handler allow newer typing during its own request while Send stays blocked and all holds remain strict',async()=>{
 const f=await controllerFixture(),hold=gate();let stopped=0;f.script.run=async()=>{hold.enter();await hold.waiting;};f.controller.edit('Submitted g1');const sending=f.controller.submit();await hold.entered;
 const render=(requestId=f.lastSubmission!.requestId)=>{let input:any;const renderer=createControlledRenderer(()=>createElement(function Input(){const revision=RevisionInstructionsInput({controller:f.controller,cache:f.cache,busy:true,dirty:false,conflict:false,stale:false,connection:{provider:'Codex (temporary)',configured:true,endpoint:'fixture://no-network',model:'scripted',state:'ready',detail:'Scripted unit boundary',specialized:{sam:'',computer:''}},runningRequestId:requestId,onStop:()=>{stopped++;},onConfigure:()=>{throw Error('No configuration route.');}});input=Composer(revision.props.children[1].props).props.children[1].props.children.props;return null;}));renderer.render();return input;};
 const input=render();expect(input.disabled).toBe(false);expect(input.streaming).toBe(true);expect(input.submitDisabled).toBe(true);input.onValueChange('  Newer public-input g2 α 👋  ');input.onSubmit('Another Send must not run');expect(f.calls).toBe(1);expect(f.controller.snapshot().raw.text).toBe('  Newer public-input g2 α 👋  ');
 const foreign=render('different-request');expect(foreign.disabled).toBe(true);expect(foreign.streaming).toBe(false);
 f.cache.setFrozen(true);const frozen=render();expect(frozen.disabled).toBe(true);frozen.onValueChange('Rejected stale frozen edit');expect(f.controller.snapshot().raw.text).toBe('  Newer public-input g2 α 👋  ');f.cache.setFrozen(false);
 input.onStop();expect(stopped).toBe(1);hold.release();expect(await sending).toBe(true);await f.cache.flush();expect(f.controller.snapshot().raw.text).toBe('  Newer public-input g2 α 👋  ');expect(f.controller.snapshot().form.status).toBe('recovery');const stale=render(f.lastSubmission!.requestId);expect(stale.disabled).toBe(true);expect(stale.streaming).toBe(false);input.onStop();expect(stopped).toBe(1);
});
it('checking a failed old tombstone releases the held UI when a different mirror has already saved newer instructions on the read new revision',async()=>{
 const f=await controllerFixture();f.controller.edit('Confirmed original instructions');await f.cache.flush();f.faults.tombstone='reject-before';
 f.faults.onTombstone=()=>{const currentMirror=createRevisionInstructionsController(f.options);expect(currentMirror.edit('New instructions after reading v2').kind).toBe('accepted');};
 expect(await f.controller.submit()).toBe(false);expect(f.controller.snapshot().raw.text).toBe('New instructions after reading v2');expect(f.controller.snapshot().pendingClear).toBe(true);expect(await f.controller.check()).toBe(true);expect(f.controller.snapshot().raw.text).toBe('New instructions after reading v2');expect(f.controller.snapshot().pendingClear).toBe(false);expect(f.controller.snapshot().held).toBe(false);expect(f.calls).toBe(1);
});
it('over-limit instructions stay exact and durable without dispatch, while the existing trimmed16000-unit boundary still submits',async()=>{
 const f=await controllerFixture(),raw='  '+'👋'.repeat(8001)+'  ';expect(raw.trim().length).toBe(16002);expect(new TextEncoder().encode(raw.trim()).length).toBe(32004);expect(f.controller.edit(raw).kind).toBe('accepted');await f.cache.flush();
 expect(await f.controller.submit(raw.trim())).toBe(false);expect(f.calls).toBe(0);expect(f.controller.snapshot().raw.text).toBe(raw);expect(f.controller.snapshot().message).toContain('too long to send');
 f.cache.setFrozen(true);await f.cache.flushForQuit();await f.restart();const cache=f.makeCache();await cache.load();const reopened=createRevisionInstructionsController({...f.options,cache});expect(reopened.snapshot().raw.text).toBe(raw);
 const valid='  '+'👋'.repeat(8000)+'  ';expect(valid.trim().length).toBe(16000);expect(reopened.edit(valid).kind).toBe('accepted');expect(await reopened.submit(valid.trim())).toBe(true);expect(f.calls).toBe(1);expect(f.task.requests.find(request=>request.id===f.lastSubmission!.requestId)!.prompt).toBe(valid.trim());
});
it('the unchanged generic raw limit counts UTF-16 units separately from its UTF-8 JSON byte limit',async()=>{
 const f=await controllerFixture(),raw='👋'.repeat(16384);expect(raw.length).toBe(32768);expect(new TextEncoder().encode(raw).length).toBe(65536);expect(f.controller.edit(raw).kind).toBe('accepted');await f.cache.flush();
 expect(f.controller.edit(raw+'👋')).toMatchObject({kind:'rejected',reason:'text-too-long'});expect(f.controller.snapshot().raw.text).toBe(raw);expect(f.calls).toBe(0);
});
