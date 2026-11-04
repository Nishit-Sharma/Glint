import {currentAnswerOrigin} from '../support/current-answer-origin.fixture';
import {editModule} from '../../src/core/module-state';
import {afterEach,beforeEach,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion,type Task} from '../../src/core/companion';
import {emptyTaskSession,readComposerDraft,type ComposerDraft} from '../../src/core/task-session';

let core:Companion,dataDir:string;
beforeEach(async()=>{dataDir=await mkdtemp(join(tmpdir(),'companion-composer-draft-'));core=await createCompanion({dataDir});});
afterEach(async()=>{await core.close();await rm(dataDir,{recursive:true,force:true});});
function pendingSubmission(taskId:string,requestId:string,submittedDraft:ComposerDraft){
 let entered!:()=>void,finish!:(value:{title:string;content:string})=>void;
 const started=new Promise<void>(resolve=>entered=resolve);
 const request=core.runRequest({taskId,requestId,kind:'browser',prompt:submittedDraft.text.trim(),sourceIds:[],submittedDraft},async()=>{entered();return new Promise(resolve=>finish=resolve);});
 return{started,request,complete:()=>finish({title:'Answer',content:'Grounded answer.'})};
}

it('persists exact composer text and kind across store restart',async()=>{
 const task=await core.createTask({title:'Durable draft'}),value={text:'  Explain 日本語 👩🏽‍🚀\nwithout trimming.  ',kind:'experiment' as const};
 expect(await core.saveComposerDraft(task.id,0,value)).toEqual({...value,revision:1});
 await core.close();core=await createCompanion({dataDir});
 expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual({...value,revision:1});
});

it('defaults legacy drafts and saves across unrelated session changes without replacing them',async()=>{
 const task=await core.createTask({title:'Legacy and independent state'});
 expect(readComposerDraft()).toEqual({text:'',kind:'explain',revision:0});
 await core.replaceSession(task.id,0,{...emptyTaskSession(),draft:'Legacy unsent text'});
 expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual({text:'Legacy unsent text',kind:'explain',revision:0});
 const first=await core.saveComposerDraft(task.id,0,{text:'First edit',kind:'create'}),session=(await core.getTask(task.id)).session!;
 const browserContext={origin:'https://owned.example',url:'https://owned.example/page',requestId:'browser'},moduleStates=[{artifactId:'answer',artifactRevision:1,moduleId:'plan',state:{kind:'plan',revision:1,checkedIds:['first']}}];
 await core.replaceSession(task.id,session.revision,{...session,contextRevision:7,browserContext,moduleStates});
 const saved=await core.saveComposerDraft(task.id,first.revision,{text:'Second edit',kind:'procedure'}),after=(await core.getTask(task.id)).session!;
 expect(saved).toEqual({text:'Second edit',kind:'procedure',revision:2});expect(after.browserContext).toEqual(browserContext);expect(after.moduleStates).toEqual(moduleStates);expect(after.contextRevision).toBe(7);expect(after.revision).toBe(session.revision+2);
});

it('counts identical user edits and rejects stale draft acknowledgements',async()=>{
 const task=await core.createTask({title:'Draft epochs'}),value={text:'Same text',kind:'explain' as const};
 await core.saveComposerDraft(task.id,0,value);expect(await core.saveComposerDraft(task.id,1,value)).toEqual({...value,revision:2});
 await expect(core.saveComposerDraft(task.id,1,{text:'Stale save',kind:'create'})).rejects.toThrow('changed');
 expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual({...value,revision:2});
});

it('consumes the exact submitted whitespace and Unicode draft only with a successful artifact commit',async()=>{
 const task=await core.createTask({title:'Consume submitted intent'}),submitted=await core.saveComposerDraft(task.id,0,{text:'  Explain 日本語 👩🏽‍🚀\n  ',kind:'create'});
 const request=await core.runRequest({taskId:task.id,requestId:'submission',kind:'browser',prompt:submitted.text.trim(),sourceIds:[],submittedDraft:submitted},async()=>({title:'Answer',content:'Grounded answer.'}));
 expect(request.status).toBe('completed');const after=await core.getTask(task.id);expect(after.artifacts).toHaveLength(1);expect(readComposerDraft(after.session)).toEqual({text:'',kind:'create',revision:1});
});

it('keeps unsent draft content out of ordinary provider context while preserving browser and module state',async()=>{
 const task=await core.createTask({title:'Draft privacy'}),original=await currentAnswerOrigin(core,task.id,'composer-plan-origin',{title:'Current plan',mimeType:'application/vnd.window-companion.modules+json',content:JSON.stringify({schemaVersion:1,markdown:'A current saved plan.',modules:[{id:'plan',version:1,data:{kind:'plan',schemaVersion:1,title:'Current plan',purpose:'Retain the saved choice.',items:[{id:'chosen',title:'Chosen step',detail:'Keep the saved completion.'}]},provenance:[]}]})},[]);
 await editModule(core,{taskId:task.id,artifactId:original.artifactId,artifactRevision:1,moduleId:'plan',action:{kind:'check',itemId:'chosen',checked:true,expectedRevision:0}});
 const draft=await core.saveComposerDraft(task.id,0,{text:'DISTINCTIVE UNSENT PRIVATE DRAFT 日本語 🦉',kind:'procedure'}),session=(await core.getTask(task.id)).session!,moduleStates=session.moduleStates;
 expect(moduleStates).toMatchObject([{artifactId:original.artifactId,artifactRevision:1,moduleId:'plan',state:{kind:'plan',revision:1,checkedIds:['chosen']}}]);
 const browserContext={origin:'https://owned.example',url:'https://owned.example/page',requestId:'previous-browser'};
 await core.replaceSession(task.id,session.revision,{...session,browserContext,moduleStates,contextRevision:9});const before=(await core.getTask(task.id)).session!;
 let observed:Task|undefined;
 await core.runRequest({taskId:task.id,requestId:'ordinary',kind:'explain',prompt:'This is the approved question.',sourceIds:[]},async context=>{observed=context.task;return{title:'Answer',content:'Only approved content.'};});
 expect(JSON.stringify(observed)).not.toContain(draft.text);expect(observed!.session).not.toHaveProperty('draftKind');expect(observed!.session).not.toHaveProperty('draftRevision');expect(observed!.session?.draft).toBe('');
 expect(observed!.session?.browserContext).toEqual(browserContext);expect(observed!.session?.moduleStates).toEqual(moduleStates);expect(observed!.session?.contextRevision).toBe(9);expect(observed!.session?.revision).toBe(before.revision);
 expect((await core.getTask(task.id)).requests.at(-1)?.status).toBe('completed');expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(draft);
});

it('withholds dangling module state from ordinary context while preserving its local bytes and unsent draft',async()=>{
 const task=await core.createTask({title:'Dangling state privacy'}),draft=await core.saveComposerDraft(task.id,0,{text:'PRIVATE UNSENT DRAFT',kind:'procedure'}),session=(await core.getTask(task.id)).session!,moduleStates=[{artifactId:'answer',artifactRevision:1,moduleId:'plan',state:{kind:'plan',revision:1,checkedIds:['DANGLING_MODULE_SECRET']}}];
 await core.replaceSession(task.id,session.revision,{...session,moduleStates});let observed:Task|undefined;
 await core.runRequest({taskId:task.id,requestId:'dangling-context',kind:'explain',prompt:'Only the approved question.',sourceIds:[]},async context=>{observed=context.task;return {title:'Answer',content:'Approved response.'};});
 expect(observed!.session?.moduleStates).toEqual([]);expect(JSON.stringify(observed)).not.toContain('DANGLING_MODULE_SECRET');expect(JSON.stringify(observed)).not.toContain(draft.text);
 const saved=await core.getTask(task.id);expect(saved.session!.moduleStates).toEqual(moduleStates);expect(readComposerDraft(saved.session)).toEqual(draft);
});

it.each(['before-completion','after-completion'] as const)('a newer save survives either serialization order (%s)',async order=>{
 const task=await core.createTask({title:'Save ordering'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Original question',kind:'explain'}),pending=pendingSubmission(task.id,'ordering',submitted);await pending.started;
 const newer={text:'Newer unsent draft',kind:'procedure' as const};
 if(order==='before-completion')await core.saveComposerDraft(task.id,submitted.revision,newer);
 pending.complete();expect((await pending.request).status).toBe('completed');
 if(order==='after-completion')await core.saveComposerDraft(task.id,submitted.revision,newer);
 expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual({...newer,revision:2});
});

it.each(['kind-only','away-and-back','identical-edit'] as const)('a newer user edit prevents old completion clearing (%s)',async edit=>{
 const task=await core.createTask({title:'Newer edit ownership'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Keep this exact text',kind:'explain'}),pending=pendingSubmission(task.id,'old-request',submitted);await pending.started;
 const latest=edit==='kind-only'?await core.saveComposerDraft(task.id,1,{text:submitted.text,kind:'create'}):edit==='identical-edit'?await core.saveComposerDraft(task.id,1,{text:submitted.text,kind:submitted.kind}):await(async()=>{await core.saveComposerDraft(task.id,1,{text:'Edited away',kind:'explain'});return core.saveComposerDraft(task.id,2,{text:submitted.text,kind:submitted.kind});})();
 pending.complete();expect((await pending.request).status).toBe('completed');expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(latest);
});

it('a stale but valid submitted token does not block its old request or consume a newer draft',async()=>{
 const task=await core.createTask({title:'Stale submission'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Original approved question',kind:'explain'}),newer=await core.saveComposerDraft(task.id,1,{text:'NEVER SEND THIS NEWER UNSENT TEXT',kind:'procedure'});
 let contextText='';const request=await core.runRequest({taskId:task.id,requestId:'already-submitted',kind:'browser',prompt:submitted.text.trim(),submittedDraft:submitted,sourceIds:[]},async context=>{contextText=JSON.stringify(context.task);return{title:'Answer',content:'Answer to the original question.'};});
 expect(request.status).toBe('completed');expect(contextText).not.toContain(newer.text);expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(newer);
});

it('a mismatching prompt cannot consume an otherwise current submitted draft token',async()=>{
 const task=await core.createTask({title:'Bound prompt'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Preserve this user draft',kind:'create'});
 const request=await core.runRequest({taskId:task.id,requestId:'different-prompt',kind:'explain',prompt:'A different approved question',submittedDraft:submitted,sourceIds:[]},async()=>({title:'Answer',content:'Different answer.'}));
 expect(request.status).toBe('completed');expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(submitted);
});

it('completion preserves unrelated session changes and another task draft',async()=>{
 const task=await core.createTask({title:'Context preservation'}),other=await core.createTask({title:'Other task'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Question A',kind:'create'}),pending=pendingSubmission(task.id,'merge-session',submitted);await pending.started;
 const session=(await core.getTask(task.id)).session!,browserContext={origin:'https://owned.example',url:'https://owned.example/current',requestId:'different-browser'},moduleStates=[{artifactId:'answer',artifactRevision:1,moduleId:'plan',state:{kind:'plan',revision:1,checkedIds:['retained']}}];
 await core.replaceSession(task.id,session.revision,{...session,contextRevision:13,browserContext,moduleStates});const otherDraft=await core.saveComposerDraft(other.id,0,{text:'Unrelated task draft',kind:'procedure'});
 pending.complete();expect((await pending.request).status).toBe('completed');const after=(await core.getTask(task.id)).session!;expect(readComposerDraft(after)).toEqual({text:'',kind:'create',revision:1});expect(after.browserContext).toEqual(browserContext);expect(after.moduleStates).toEqual(moduleStates);expect(after.contextRevision).toBe(13);expect(readComposerDraft((await core.getTask(other.id)).session)).toEqual(otherDraft);
});

it.each(['runner-failed','artifact-failed','cancelled'] as const)('unsuccessful requests preserve the submitted draft (%s)',async mode=>{
 const task=await core.createTask({title:'Failed draft ownership'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Keep this request for recovery',kind:'explain'});
 if(mode==='cancelled'){const pending=pendingSubmission(task.id,'failure',submitted);await pending.started;await core.cancelRequest(task.id,'failure');pending.complete();expect((await pending.request).status).toBe('cancelled');}
 else{const request=await core.runRequest({taskId:task.id,requestId:'failure',kind:'explain',prompt:submitted.text.trim(),sourceIds:[],submittedDraft:submitted},async()=>{if(mode==='runner-failed')throw Error('Synthetic provider failure');return{title:'',content:'Invalid artifact'};});expect(request.status).toBe('failed');}
 const after=await core.getTask(task.id);expect(readComposerDraft(after.session)).toEqual(submitted);expect(after.artifacts).toEqual([]);
});

it.each(['brief','explain','revise'] as const)('requests without a composer token do not consume matching text (%s)',async kind=>{
 const task=await core.createTask({title:'Noncomposer request'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Keep this matching text',kind:'explain'}),artifact=kind==='revise'?await currentAnswerOrigin(core,task.id,'composer-revise-origin',{title:'Existing answer',content:'Existing text'},[]):undefined;
 const request=await core.runRequest({taskId:task.id,requestId:'automatic',kind,prompt:submitted.text.trim(),sourceIds:[],...(artifact?{artifactId:artifact.artifactId,expectedRevision:1}:{})},async()=>({title:'Answer',content:'Requested output.'}));
 expect(request.status).toBe('completed');expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(submitted);
});

it('replaying a completed request cannot consume a later draft or create another artifact',async()=>{
 const task=await core.createTask({title:'Replay intent'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Submitted once',kind:'create'}),input={taskId:task.id,requestId:'same-request',kind:'browser',prompt:submitted.text.trim(),sourceIds:[],submittedDraft:submitted};
 const first=await core.runRequest(input,async()=>({title:'Answer',content:'One answer'}));const newer=await core.saveComposerDraft(task.id,submitted.revision,{text:'Later unsent draft',kind:'procedure'});
 await core.close();core=await createCompanion({dataDir});
 const replay=await core.runRequest(input,async()=>{throw Error('Replay must not run');});expect(replay).toEqual(first);expect((await core.getTask(task.id)).artifacts).toHaveLength(1);expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(newer);
 await expect(core.runRequest({...input,prompt:newer.text.trim(),submittedDraft:newer},async()=>({title:'Changed replay',content:'Not allowed'}))).rejects.toThrow('different payload');expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(newer);
});

it('accepts an explicit empty user edit and rejects invalid or oversized saves without changing it',async()=>{
 const task=await core.createTask({title:'Draft validation'}),empty=await core.saveComposerDraft(task.id,0,{text:'',kind:'explain'});expect(empty).toEqual({text:'',kind:'explain',revision:1});
 for(const value of [{text:'x'.repeat(100001),kind:'explain'},{text:'Null\0byte',kind:'create'},{text:'Wrong kind',kind:'browser'},{text:'Extra field',kind:'create',approve:true}])await expect(core.saveComposerDraft(task.id,1,value as never)).rejects.toThrow('Composer draft');
 for(const epoch of [-1,1.5,NaN,Number.MAX_SAFE_INTEGER+1])await expect(core.saveComposerDraft(task.id,epoch,{text:'Bad epoch',kind:'create'})).rejects.toThrow('changed');
 expect(readComposerDraft((await core.getTask(task.id)).session)).toEqual(empty);
});

it('rejects malformed submitted tokens before recording or running a request',async()=>{
 const task=await core.createTask({title:'Submission validation'}),submitted=await core.saveComposerDraft(task.id,0,{text:'Safe stored draft',kind:'explain'});let runs=0;
 const tokens=[{...submitted,revision:-1},{...submitted,revision:Number.MAX_SAFE_INTEGER+1},{...submitted,text:'bad\0text'},{...submitted,kind:'browser'},{...submitted,approve:true}];
 for(const [index,token] of tokens.entries())await expect(core.runRequest({taskId:task.id,requestId:'invalid-'+index,kind:'explain',prompt:'Safe stored draft',sourceIds:[],submittedDraft:token as never},async()=>{runs++;return{title:'Not run',content:'No'};})).rejects.toThrow('Submitted composer draft');
 const after=await core.getTask(task.id);expect(runs).toBe(0);expect(after.requests).toEqual([]);expect(after.artifacts).toEqual([]);expect(readComposerDraft(after.session)).toEqual(submitted);
});
