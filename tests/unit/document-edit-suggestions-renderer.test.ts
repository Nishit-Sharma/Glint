import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion,type Companion} from '../../src/core/companion';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {createRevisionInstructionsController} from '../../src/renderer/src/revision-instructions-controller';
import {createDocumentSuggestionsController,documentSuggestionBlocked} from '../../src/renderer/src/document-edit-suggestions-controller';
import {createSavedDocumentDraftController} from '../../src/renderer/src/saved-document-draft-controller';
import {DocumentEditSuggestions} from '../../src/renderer/src/components/DocumentEditSuggestions';
import {prepareDocumentSuggestions} from '../../src/host/document-edit-suggestions';
import type {Command} from '../../src/shared/bridge';
import type {Task} from '../../src/core/types';
const cores:Companion[]=[];afterEach(async()=>{for(const core of cores.splice(0))await core.close();});
function gate(){let enter!:()=>void,release!:()=>void;return {entered:new Promise<void>(done=>{enter=done;}),waiting:new Promise<void>(done=>{release=done;}),enter:()=>enter(),release:()=>release()};}
const text=(node:any):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'suggestion-renderer-')),core=await createCompanion({dataDir:directory});cores.push(core);const created=await core.createTask({title:'Synthetic review UI'}),sourced=await core.putSource(created.id,{kind:'text',role:'fact',label:'Correction reference',content:'first and last'}),source=sourced.sources[0],refs=[{sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest}],generated=await core.runRequest({taskId:created.id,requestId:'review-original',kind:'create',prompt:'Write the original review document.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs},async()=>({title:'Review document',content:'old\nkeep\nold\n',mimeType:'text/markdown'}));
 expect(generated.status,generated.error).toBe('completed');const original=(await core.getTask(created.id)).artifacts.find(artifact=>artifact.id===generated.artifactId)!,saved={artifactId:original.id,revision:original.revisions[0]};let task=await core.getTask(created.id),blocked=false,current=true,calls=0,lose=false,loseBefore=false,scope='original',readOnly=false,surfaceEpoch=0,surface='workspace',stops=0;const commands:Command[]=[];let rawGate:ReturnType<typeof gate>|undefined,resultGate:ReturnType<typeof gate>|undefined;
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),actualCache=createLearningDrafts({read:()=>store.read(),save:async(...args)=>{if(rawGate){rawGate.enter();await rawGate.waiting;}return store.save(...args);}});let cacheState:Partial<ReturnType<typeof actualCache.getSnapshot>>={};const cache={...actualCache,getSnapshot:()=>({...actualCache.getSnapshot(),...cacheState})};await cache.load();
 const instructions=createRevisionInstructionsController({cache,artifactId:saved.artifactId,task:()=>task,base:()=>task.artifacts[0].revisions.at(-1)!,scope:()=>task.id,isCurrent:()=>current,send:async()=>{throw Error('Ordinary revision is outside this synthetic suggestion test.');}});
 instructions.edit('  Change first and last, keep α🙂 instructions exact.  ');
 const document=createSavedDocumentDraftController({cache,artifactId:saved.artifactId,task:()=>task,base:()=>task.artifacts[0].revisions.at(-1)!,isCurrent:()=>current,scope:()=>scope,send:async()=>{throw Error('Document editing is outside this suggestion fixture.');},onSaved:()=>{}});
 const canDecide=(choice:'accept'|'reject'|'accept-all'|'reject-all'|'undo')=>!documentSuggestionBlocked(cache,document.snapshot(),task,{dirty:blocked,conflict:false,readOnly,busy:false},choice==='accept'||choice==='accept-all'||choice==='undo');
 const viewScope=()=>scope+':'+surfaceEpoch+':'+surface,viewCurrent=()=>current&&surface==='workspace';
 const controller=createDocumentSuggestionsController({cache,artifactId:saved.artifactId,instructions:()=>instructions.snapshot(),task:()=>task,isCurrent:viewCurrent,scope:viewScope,blocked:()=>!canDecide('accept'),send:async submission=>{
  calls++;const command:Extract<Command,{type:'model.run'}>={type:'model.run',taskId:task.id,requestId:submission.requestId,kind:'revise',artifactId:saved.artifactId,prompt:submission.prompt,revisionBasis:submission.basis,sourceIds:submission.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:submission.sourceRefs,suggestEdits:true},plan=await prepareDocumentSuggestions(core,task,command,()=>{});
  await core.runRequest(plan!.request,async ctx=>plan!.bind(ctx.task).finish(JSON.stringify({content:'first\nkeep\nlast\n',evidence:[{reason:'Reference says first.',anchors:[{...refs[0],start:0,quote:'first'}]},{reason:'Reference says last.',anchors:[{...refs[0],start:10,quote:'last'}]}]})));task=await core.getTask(task.id);if(resultGate){resultGate.enter();await resultGate.waiting;}return task;
 }});
 const invoke=async(command:Command)=>{commands.push(command);if(command.type==='document-suggestions.decide'){if(loseBefore){loseBefore=false;return;}try{task=await core.decideDocumentEditSuggestions(command);}catch{task=await core.getTask(task.id);return;}if(lose){lose=false;return;}return task;}if(command.type==='document-suggestions.inspect'){const result=await core.inspectDocumentEditSuggestionDecision(command.decision);task=result.task;return result;}if(command.type==='tasks.get'){task=await core.getTask(task.id);return task;}throw Error('Unexpected synthetic UI command.');};
 const render=createControlledRenderer(()=>createElement(DocumentEditSuggestions,{task,artifactId:saved.artifactId,controller,canSuggest:instructions.snapshot().canSubmit,blocked:!canDecide('reject'),busy:false,isCurrent:viewCurrent,scope:viewScope,canDecide,invoke,runningRequestId:controller.snapshot().activeRequestId,onStop:()=>{stops++;}}));
 const button=(label:string)=>{render.render();return render.find(node=>node.type==='button'&&text(node)===label);};
 return {core,saved,controller,instructions,document,cache,render,button,commands,invoke,get task(){return task},get calls(){return calls},get stops(){return stops},holdCache:(state:Partial<ReturnType<typeof actualCache.getSnapshot>>)=>{cacheState=state;},block:()=>{blocked=true;},unblock:()=>{blocked=false;},lose:()=>{lose=true;},loseBefore:()=>{loseBefore=true;},retarget:()=>{scope+='-next';},surface:(mode:string)=>{surfaceEpoch++;surface=mode;},readOnly:()=>{readOnly=true;},holdRaw:()=>{rawGate=gate();return rawGate;},holdResult:()=>{resultGate=gate();return resultGate;}};
}
it('renders actual in-document exact edits and preserves raw instructions while own partial acceptance keeps remaining controls enabled',async()=>{
 const f=await fixture(),raw=f.instructions.snapshot().raw.text;expect(await f.controller.submit()).toBe(true);expect(f.calls).toBe(1);expect(f.instructions.snapshot().raw.text).toBe(raw);expect(f.task.artifacts[0].revisions).toHaveLength(1);
 f.render.render();expect(f.render.nodes().some(node=>node.props['aria-label']==='Change 1')).toBe(true);expect(f.render.nodes().some(node=>node.props['aria-label']==='Following context')).toBe(true);
 await f.button('Accept change 1').props.onClick();
 expect(f.button('Accept change 2').props.disabled).toBe(false);expect(f.task.artifacts[0].revisions.at(-1)?.content).toBe('first\nkeep\nold\n');expect(f.instructions.snapshot().raw.text).toBe(raw);
 await f.button('Accept all remaining').props.onClick();expect(f.task.artifacts[0].revisions.at(-1)?.content).toBe('first\nkeep\nlast\n');
});
it('blocks dirty/frozen launch without touching input and exposes durable check after a lost decision reply',async()=>{
 const f=await fixture(),raw=f.instructions.snapshot().raw.text;f.block();expect(await f.controller.submit()).toBe(false);expect(f.calls).toBe(0);expect(f.button('Suggest edits from revision instructions').props.disabled).toBe(true);f.unblock();f.cache.setFrozen(true);expect(await f.controller.submit()).toBe(false);f.cache.setFrozen(false);expect(await f.controller.submit()).toBe(true);expect(f.instructions.snapshot().raw.text).toBe(raw);
 f.lose();await f.button('Accept change 1').props.onClick();expect(f.button('Retry exact decision')).toBeTruthy();await f.button('Check saved review').props.onClick();expect(f.task.artifacts[0].revisions).toHaveLength(2);f.render.render();expect(f.render.nodes().some(node=>node.type==='button'&&text(node)==='Retry exact decision')).toBe(false);
});
it('reconciles a definitively stale unapplied decision before enabling current review, while preserving exact original intent',async()=>{
 const f=await fixture();await f.controller.submit();const old=f.button('Accept change 2'),proposal=f.task.artifacts[1].revisions.at(-1)!;
 await f.core.decideDocumentEditSuggestions({type:'document-suggestions.decide',taskId:f.task.id,proposal:{artifactId:f.task.artifacts[1].id,revision:proposal.revision,digest:proposal.digest},intentId:'concurrent-reject',choice:'reject',index:0});
 await old.props.onClick();const attempted=f.commands.find(item=>item.type==='document-suggestions.decide');expect(attempted).toBeTruthy();expect(f.button('Accept change 2').props.disabled).toBe(true);
 await f.button('Check saved review').props.onClick();expect(f.commands.find(item=>item.type==='document-suggestions.inspect')).toMatchObject({decision:attempted});expect(f.button('Accept change 2').props.disabled).toBe(false);
 await f.button('Accept change 2').props.onClick();expect(f.task.artifacts[0].revisions.at(-1)?.content).toBe('old\nkeep\nlast\n');
});
it('does not infer failure from event absence on the same CAS basis, and retries the original exact intent once',async()=>{
 const f=await fixture();await f.controller.submit();f.loseBefore();await f.button('Accept change 1').props.onClick();await f.button('Check saved review').props.onClick();
 const first=f.commands.find(item=>item.type==='document-suggestions.decide');expect(f.button('Retry exact decision')).toBeTruthy();await f.button('Retry exact decision').props.onClick();
 const decisions=f.commands.filter(item=>item.type==='document-suggestions.decide');expect(decisions).toEqual([first,first]);expect(f.task.artifacts[0].revisions).toHaveLength(2);
});
it.each(['raw','frozen','read-only','epoch','unready','cache-error','maintenance','surface','surface-return'] as const)('rechecks live %s guard when a previously rendered Accept callback is invoked',async change=>{
 const f=await fixture();await f.controller.submit();const old=f.button('Accept change 1'),raw=f.instructions.snapshot().raw.text;
 if(change==='raw')f.document.edit({content:'  Unsaved α🙂 exact raw document  '});if(change==='frozen')f.cache.setFrozen(true);if(change==='read-only')f.readOnly();if(change==='epoch')f.retarget();if(change==='unready')f.holdCache({ready:false});if(change==='cache-error')f.holdCache({error:'Unavailable raw cache'});if(change==='maintenance')f.holdCache({maintenance:true});if(change==='surface')f.surface('companion');if(change==='surface-return'){f.surface('companion');f.surface('workspace');}
 await old.props.onClick();expect(f.commands.filter(item=>item.type==='document-suggestions.decide')).toEqual([]);expect(f.task.artifacts[0].revisions).toHaveLength(1);expect(f.instructions.snapshot().raw.text).toBe(raw);
 if(change==='raw')expect(f.document.snapshot().raw.content).toBe('  Unsaved α🙂 exact raw document  ');
});
it.each(['navigation','surface','surface-return'] as const)('captures %s epoch through instruction flush and response delivery without clearing raw input',async change=>{
 const f=await fixture();f.document.snapshot();await f.cache.flush();const raw=f.instructions.snapshot().raw.text+'newer';f.instructions.edit(raw);await f.cache.flush();const flush=f.holdRaw();f.instructions.edit(raw+'!');const sending=f.controller.submit();await Promise.race([flush.entered,sending.then(()=>{throw Error('Submission ended before raw flush gate: '+f.controller.snapshot().message);})]);if(change==='navigation')f.retarget();else{f.surface('companion');if(change==='surface-return')f.surface('workspace');}flush.release();expect(await sending).toBe(false);expect(f.calls).toBe(0);expect(f.instructions.snapshot().raw.text).toBe(raw+'!');
 const g=await fixture(),reply=g.holdResult(),generating=g.controller.submit();await reply.entered;if(change==='navigation')g.retarget();else{g.surface('companion');if(change==='surface-return')g.surface('workspace');}reply.release();expect(await generating).toBe(false);expect(g.controller.snapshot().message).toBe('');expect(g.instructions.snapshot().raw.text).toContain('Change first and last');
});
it('keeps the complete review inside the accepted document scroll owner and uses one-column change pairs on narrow screens',async()=>{
 const app=await readFile('src/renderer/src/App.tsx','utf8'),mount=app.indexOf('<DocumentEditSuggestions'),scroll=app.lastIndexOf('className="document-scroll"',mount),formEnd=app.indexOf('</form>',mount),css=await readFile('src/renderer/src/components/document-edit-suggestions.css','utf8');
 expect(scroll).toBeGreaterThan(0);expect(mount).toBeGreaterThan(scroll);expect(app.slice(mount,formEnd)).toMatch(/<\/div>\s*$/);expect(css).toContain('@media(max-width:600px)');expect(css).toContain('grid-template-columns:minmax(0,1fr)');
});
it('wires suggestion-only authority to actual root surface intent, mode and continuation refs without changing old controller scopes',async()=>{
 const app=await readFile('src/renderer/src/App.tsx','utf8'),caller=app.slice(app.indexOf('<ArtifactEditor'),app.indexOf(' saveDocument=',app.indexOf('<ArtifactEditor')));
 expect(caller).toContain('suggestionScope={[workflowReviewNavigation,workflowReviewActivation,workflowReviewEpoch,documentSuggestionSurfaceEpoch,documentSuggestionSurface]');
 for(const guard of ['surfaceIntentEpoch.current===documentSuggestionSurfaceEpoch','surfaceModeRef.current===documentSuggestionSurface',"documentSuggestionSurface==='workspace'",'workflowContinuation.current.epoch===workflowReviewEpoch'])expect(caller).toContain(guard);
 expect(caller).toContain("scope={newQuestionEpoch.current+':'+incomingActivationEpoch.current}");
 expect(app).toContain('isCurrent:()=>latestDocument.current.suggestionCurrent(),scope:()=>latestDocument.current.suggestionScope');
 const mount=app.slice(app.indexOf('<DocumentEditSuggestions'),app.indexOf('/>',app.indexOf('<DocumentEditSuggestions')));expect(mount).toContain('scope={()=>latestDocument.current.suggestionScope}');expect(mount).toContain('isCurrent={suggestionCurrent}');
});
it('prevents a captured hidden-surface Suggest or Stop callback from reaching the producer or current root request',async()=>{
 const f=await fixture(),suggest=f.button('Suggest edits from revision instructions');f.surface('companion');await suggest.props.onClick();expect(f.calls).toBe(0);
 const g=await fixture(),reply=g.holdResult(),request=g.controller.submit();await reply.entered;const stop=g.button('Stop suggestions');g.surface('companion');g.surface('workspace');await stop.props.onClick();expect(g.stops).toBe(0);reply.release();await request;
});
it('holds decisions for every unknown/recovery document state even when no readable raw draft is present',async()=>{
 const f=await fixture(),view=f.document.snapshot(),flags={dirty:false,conflict:false,readOnly:false,busy:false};
 for(const state of [{...f.cache.getSnapshot(),ready:false},{...f.cache.getSnapshot(),error:'Unavailable cache'},{...f.cache.getSnapshot(),maintenance:true},{...f.cache.getSnapshot(),frozen:true}]){
  const cache={...f.cache,getSnapshot:()=>state};expect(documentSuggestionBlocked(cache,view,f.task,flags)).toBe(true);expect(documentSuggestionBlocked(cache,view,f.task,flags,false)).toBe(true);
 }
 for(const status of ['loading','unavailable','recovery'] as const)expect(documentSuggestionBlocked(f.cache,{...view,held:false,form:{...view.form,status}},f.task,flags,false)).toBe(true);
 expect(documentSuggestionBlocked(f.cache,{...view,held:true,changed:false},f.task,flags)).toBe(true);
 expect(documentSuggestionBlocked(f.cache,{...view,held:true,changed:true},f.task,flags)).toBe(true);expect(documentSuggestionBlocked(f.cache,{...view,held:true,changed:true},f.task,flags,false)).toBe(false);
});

it('renders quoted evidence and reconciles exact undo without replaying accepted text',async()=>{
 const f=await fixture();await f.controller.submit();f.render.render();expect(f.render.nodes().some(node=>node.props['aria-label']==='Evidence for change 1')).toBe(true);expect(f.render.nodes().some(node=>node.type==='blockquote'&&text(node)==='first')).toBe(true);
 await f.button('Accept change 1').props.onClick();await f.button('Reject all remaining').props.onClick();const captured=f.button('Undo latest accepted changes');f.lose();await captured.props.onClick();expect(f.task.artifacts[0].revisions).toHaveLength(3);expect(f.task.artifacts[0].revisions.at(-1)?.content).toBe(f.saved.revision.content);await f.button('Check saved review').props.onClick();expect(f.task.artifacts[0].revisions).toHaveLength(3);expect(f.commands.filter(command=>command.type==='document-suggestions.decide'&&command.choice==='undo')).toHaveLength(1);
});
it('invalidates captured undo callbacks on surface changes and blocks undo during raw document edits',async()=>{
 const f=await fixture();await f.controller.submit();await f.button('Accept all remaining').props.onClick();const undo=f.button('Undo latest accepted changes');f.block();expect(f.button('Undo latest accepted changes').props.disabled).toBe(true);f.unblock();f.surface('companion');await undo.props.onClick();expect(f.task.artifacts[0].revisions).toHaveLength(2);expect(f.commands.filter(command=>command.type==='document-suggestions.decide'&&command.choice==='undo')).toHaveLength(0);
});
