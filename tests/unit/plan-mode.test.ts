import {expect,test,vi} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {composeOrdinaryRequest,dispatchOrdinaryRequest} from '../../src/host/ordinary-request-composition';
import {taskResponseMode,readTaskResponseModeCommand} from '../../src/shared/task-response-mode';
import type {Task,RequestContext} from '../../src/core/types';
import type {QueuedFollowup} from '../../src/shared/queued-followup';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(check:(core:Awaited<ReturnType<typeof createCompanion>>,directory:string)=>Promise<void>){const directory=await mkdtemp(join(tmpdir(),'glint-plan-mode-')),core=await createCompanion({dataDir:directory});try{await check(core,directory);}finally{await core.close();await rm(directory,{recursive:true,force:true});}}

test('legacy task mode defaults to ordinary and mode commands reject malformed or excess fields',()=>{
 expect(taskResponseMode()).toEqual({mode:'ordinary',revision:0});expect(taskResponseMode({})).toEqual({mode:'ordinary',revision:0});
 expect(readTaskResponseModeCommand({type:'response-mode.set',taskId:'owner',expectedRevision:0,mode:'plan'})).toMatchObject({mode:'plan'});
 for(const change of [{mode:'procedure'},{expectedRevision:-1},{expectedRevision:0.5},{execute:true},{taskId:''}])expect(()=>readTaskResponseModeCommand({type:'response-mode.set',taskId:'owner',expectedRevision:0,mode:'plan',...change})).toThrow();
});

test('per-task Plan survives list/open/switch and store reopen while every draft/source/history byte stays intact',async()=>fixture(async(core,directory)=>{
 const a=await core.createTask({title:'A'}),b=await core.createTask({title:'B'});await core.saveComposerDraft(a.id,0,{text:'  Unsent\nexact question  ',kind:'experiment'});await core.putSource(a.id,{kind:'text',label:'Reference',role:'fact',content:'Keep source bytes'});await core.checkpoint(a.id,'Keep activity');const before=await core.getTask(a.id),draft=before.session!;
 const saved=await core.setTaskResponseMode(a.id,0,'plan');expect(taskResponseMode(saved.session)).toEqual({mode:'plan',revision:1});expect(saved.session).toEqual({...draft,revision:draft.revision+1,responseMode:{mode:'plan',revision:1}});expect(saved.sources).toEqual(before.sources);expect(saved.requests).toEqual(before.requests);expect(saved.checkpoints).toEqual(before.checkpoints);expect(saved.artifacts).toEqual(before.artifacts);
 expect(taskResponseMode((await core.listTasks()).find(task=>task.id===a.id)!.session).mode).toBe('plan');expect(taskResponseMode((await core.getTask(b.id)).session).mode).toBe('ordinary');expect(taskResponseMode((await core.getTask(a.id)).session).mode).toBe('plan');
 await expect(core.setTaskResponseMode(a.id,0,'ordinary')).rejects.toThrow(/changed|revision/i);expect((await core.getTask(a.id)).session?.draft).toBe(before.session?.draft);await core.close();const reopened=await createCompanion({dataDir:directory});try{const current=await reopened.getTask(a.id);expect(taskResponseMode(current.session)).toEqual({mode:'plan',revision:1});expect(current.session?.draft).toBe(before.session?.draft);expect(current.session?.draftKind).toBe('experiment');expect(current.session?.draftRevision).toBe(before.session?.draftRevision);expect(current.sources).toEqual(before.sources);expect(current.checkpoints).toEqual(before.checkpoints);}finally{await reopened.close();}
 const persisted=JSON.parse(await readFile(join(directory,'tasks.json'),'utf8'));expect(JSON.stringify(persisted)).toContain('"mode":"plan"');
}));

test('actual ordinary dispatch uses recorded planning-only guidance and a held request is unaffected by a later toggle',async()=>fixture(async core=>{
 const task=await core.createTask({title:'Plan owner'});await core.setTaskResponseMode(task.id,0,'plan');const entered=deferred(),release=deferred(),calls:Parameters<typeof composeOrdinaryRequest>[0][]=[],provider=vi.fn(async (input:Parameters<typeof composeOrdinaryRequest>[0])=>{calls.push(input);return 'Synthetic plan text';});let captured:RequestContext|undefined;
 const run=core.runRequest({taskId:task.id,requestId:'held-plan',kind:'explain',prompt:'Review this change',sourceIds:[]},async context=>{captured=context;entered.resolve();await release.promise;await dispatchOrdinaryRequest({run:provider},{prompt:'Review this change',sources:[],taskHistory:context.taskHistory,responseMode:context.responseMode},{signal:context.signal});return {title:'Plan',content:'Synthetic response'};});await entered.promise;await core.setTaskResponseMode(task.id,1,'ordinary');release.resolve();await run;
 expect(captured?.responseMode).toBe('plan');expect(captured?.task.session).not.toHaveProperty('responseMode');expect(calls).toHaveLength(1);expect(calls[0].prompt).toContain('Plan mode');expect(calls[0].prompt).toMatch(/planning.only|plan only/i);expect(calls[0].prompt).toContain('Review this change');expect((await core.getTask(task.id)).requests[0].responseMode).toBe('plan');expect((await core.getTask(task.id)).requests[0].prompt).toBe('Review this change');
 await core.runRequest({taskId:task.id,requestId:'ordinary-next',kind:'explain',prompt:'Next question',sourceIds:[]},async context=>{expect(context.responseMode).toBe('ordinary');const request=composeOrdinaryRequest({prompt:'Next question',sources:[],taskHistory:context.taskHistory,responseMode:context.responseMode});expect(request.prompt).toBe('Next question');return {title:'Ordinary',content:'Synthetic ordinary response'};});
 const requests=(await core.getTask(task.id)).requests;expect(requests.map(request=>request.responseMode)).toEqual(['plan','ordinary']);expect(requests[0].responseMode).toBe('plan');
}));

test('host-captured mode is preserved across pre-record awaits, while specialized requests keep their original route',async()=>fixture(async core=>{
 const task=await core.createTask({title:'Snapshots'});await core.setTaskResponseMode(task.id,0,'plan');await core.setTaskResponseMode(task.id,1,'ordinary');
 await core.runRequest({taskId:task.id,requestId:'captured-before-await',kind:'create',prompt:'Draft an approach',sourceIds:[],responseMode:'plan'},async context=>{expect(context.responseMode).toBe('plan');return {title:'Plan',content:'Synthetic'};});
 await core.setTaskResponseMode(task.id,2,'plan');for(const kind of ['browser','procedure','experiment']){await core.runRequest({taskId:task.id,requestId:kind,kind,prompt:'Specialized inert fixture',sourceIds:[]},async context=>{expect(context.responseMode).toBeUndefined();return {title:'Existing route',content:'No external action'};});}
 expect((await core.getTask(task.id)).requests.filter(request=>['browser','procedure','experiment'].includes(request.kind)).every(request=>request.responseMode===undefined)).toBe(true);
 await expect(core.runRequest({taskId:task.id,requestId:'bad-mode-route',kind:'procedure',prompt:'Not an ordinary request',sourceIds:[],responseMode:'plan'},async()=>({title:'Never',content:'Never'}))).rejects.toThrow(/ordinary|mode/i);
}));

test('queued and held ordinary follow-ups keep their originally reviewed mode after a later task toggle',async()=>fixture(async core=>{
 const task=await core.createTask({title:'Queued plan'});await core.setTaskResponseMode(task.id,0,'plan');const basis=await core.queuedFollowupBasis(task.id,[],[]),scope=createHash('sha256').update('synthetic-reviewed-plan').digest('hex');const item:QueuedFollowup={id:'queued-plan',revision:1,prompt:'Plan the next step',kind:'explain',createdAt:'2026-11-02T00:00:00Z',sourceRefs:[],status:'queued',basis,scope,precedingRequestIds:[],responseMode:'plan'};await core.saveQueuedFollowup(task.id,item,0);await core.setTaskResponseMode(task.id,1,'ordinary');
 const saved=(await core.getTask(task.id)).session!.queuedFollowups![0];expect(saved.responseMode).toBe('plan');await core.runRequest({taskId:task.id,requestId:item.id,kind:item.kind,prompt:item.prompt,sourceIds:[],responseMode:saved.responseMode,queuedFollowup:{id:item.id,revision:1,basis,scope}},async context=>{expect(context.responseMode).toBe('plan');expect(composeOrdinaryRequest({prompt:item.prompt,sources:[],taskHistory:context.taskHistory,responseMode:context.responseMode}).prompt).toContain('Plan mode');return {title:'Queued plan',content:'Synthetic'};});expect((await core.getTask(task.id)).requests[0].responseMode).toBe('plan');
}));

test('the existing no-dispatch ordinary preview exposes the same saved mode used by real request composition',async()=>fixture(async core=>{
 const task=await core.createTask({title:'Inspect plan'});await core.setTaskResponseMode(task.id,0,'plan');const preview=await core.previewInstructionRequest(task.id,0,[]);expect(preview.responseMode).toBe('plan');expect(composeOrdinaryRequest({prompt:'Inspect only',sources:[],taskHistory:preview.taskHistory,responseMode:preview.responseMode}).prompt).toContain('Plan mode');
 const ordinary={prompt:'unchanged bytes',sources:[] as const};expect(composeOrdinaryRequest({prompt:ordinary.prompt,sources:[],responseMode:'ordinary'})).toEqual({prompt:ordinary.prompt,sources:[]});
}));
