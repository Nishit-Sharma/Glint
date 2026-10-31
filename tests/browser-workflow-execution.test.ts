import {afterAll,afterEach,beforeAll,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {saveBrowserWorkflow} from '../src/core/browser-workflow-host';
import {browserWorkflowStarter,browserWorkflowRequest,type BrowserWorkflow} from '../src/shared/browser-workflow';
import {executeBrowserWorkflow,type BrowserWorkflowControls} from '../src/host/browser/authored-workflow';
import {workflowSite} from './browser-workflow-site';

let site:Awaited<ReturnType<typeof workflowSite>>;const cleanups:(()=>Promise<unknown>)[]=[];
beforeAll(async()=>{site=await workflowSite();});afterAll(async()=>{await site.close();});afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
async function fixture(definition?:BrowserWorkflow){const directory=await mkdtemp(join(tmpdir(),'glint-browser-workflow-'));cleanups.push(()=>rm(directory,{recursive:true,force:true}));const core=await createCompanion({dataDir:directory});cleanups.push(()=>core.close());const task=await core.createTask({title:'Disposable browser workflow'}),saved=await saveBrowserWorkflow(core,{taskId:task.id,requestId:'save-workflow',definition:definition??{...browserWorkflowStarter,origin:site.origin}}),revision=saved.task.artifacts[0].revisions[0];return {core,task,directory,workflow:{artifactId:saved.artifactId,revision:revision.revision,digest:revision.digest}};}
const approved=(log:string[]):BrowserWorkflowControls=>({headless:true,authorizeStart:async()=>{log.push('fresh-browser');},approveAction:async current=>{log.push(current.proposal.intent.kind);return {approved:true,...(current.review.write?{write:current.review.write}:{})};}});
it('runs three saved steps on two independent real Chromium targets with different values and fresh control IDs',async()=>{
 const f=await fixture(),approvals:string[]=[],before=site.effects.length;
 for(const [index,title,delivery] of [['teach','Harbor lights','courier'],['fresh','Juniper inventory','post']]){
  const result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'run-'+index,workflow:f.workflow,url:site.origin+'/requests/'+index,inputs:{title,delivery}},approved(approvals));expect(result.status,result.error).toBe('completed');
  const replay=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'run-'+index,workflow:f.workflow,url:site.origin+'/requests/'+index,inputs:{title,delivery}},approved(approvals));expect(replay.id).toBe(result.id);expect(replay.status).toBe('completed');
 }
 expect(site.effects.slice(before)).toEqual([{target:'/requests/teach',title:'Harbor lights',delivery:'courier'},{target:'/requests/fresh',title:'Juniper inventory',delivery:'post'}]);expect(approvals).toEqual(['fresh-browser','fill','fill','click','fresh-browser','fill','fill','click']);
 const saved=await f.core.getTask(f.task.id),[first,second]=saved.session!.runs;expect(first.browserId).not.toBe(second.browserId);expect(first.initialObservation.targets.find(item=>item.label==='Request title')!.value).toBe('');expect(second.initialObservation.targets.find(item=>item.label==='Request title')!.value).toBe('');expect(first.operations).toHaveLength(3);expect(second.operations).toHaveLength(3);expect(new Set([...first.operations,...second.operations].map(operation=>operation.intent.targetId)).size).toBe(6);expect(second.operations[2].receipt?.status).toBe(200);expect(saved.artifacts.at(-1)!.revisions[0].content).toContain('All 3 authored steps');
},30000);
it('denying an action retires it and performs no form write',async()=>{
 const f=await fixture(),before=site.effects.length;const result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'deny',workflow:f.workflow,url:site.origin+'/requests/deny',inputs:{title:'Declined',delivery:'courier'}},{headless:true,authorizeStart:async()=>{},approveAction:async()=>({approved:false})});expect(result.status).toBe('failed');expect(site.effects).toHaveLength(before);const task=await f.core.getTask(f.task.id);expect(task.session!.runs[0].operations).toHaveLength(1);expect(task.session!.runs[0].operations[0].status).toBe('retired');
});
it('a failed post-check stops before selecting or submitting',async()=>{
 const definition=JSON.parse(JSON.stringify(browserWorkflowStarter));definition.origin=site.origin;definition.steps[0].after=[{kind:'text',contains:'This result was not observed'}];const f=await fixture(definition),log:string[]=[],before=site.effects.length,result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'failed-check',workflow:f.workflow,url:site.origin+'/requests/failed-check',inputs:{title:'Unmet check',delivery:'courier'}},approved(log));expect(result.status).toBe('failed');expect(result.error).toContain('Visible page check failed');expect(log).toEqual(['fresh-browser','fill']);expect(site.effects).toHaveLength(before);
});
it('a missing intended submission field never reaches write approval',async()=>{
 const definition=JSON.parse(JSON.stringify(browserWorkflowStarter));definition.origin=site.origin;if(definition.steps[2].action.kind!=='click')throw Error('Expected submit');definition.steps[2].action.fields=definition.steps[2].action.fields.slice(0,1);const f=await fixture(definition),log:string[]=[],before=site.effects.length,result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'mismatch',workflow:f.workflow,url:site.origin+'/requests/mismatch',inputs:{title:'Wrong expected fields',delivery:'courier'}},approved(log));expect(result.status).toBe('failed');expect(log).toEqual(['fresh-browser','fill','fill']);expect(site.effects).toHaveLength(before);expect((await f.core.getTask(f.task.id)).session!.runs[0].operations.filter(operation=>operation.status==='retired').length).toBeGreaterThan(0);
});
it('a saved workflow edit while approval is pending retires its older action',async()=>{
 const f=await fixture(),before=site.effects.length,result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'edit-pending',workflow:f.workflow,url:site.origin+'/requests/edit-pending',inputs:{title:'Superseded',delivery:'courier'}},{headless:true,authorizeStart:async()=>{},approveAction:async()=>{await saveBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'edit-workflow',artifact:f.workflow,definition:{...browserWorkflowStarter,origin:site.origin,name:'New workflow revision'}});return {approved:true};}});expect(result.status).toBe('failed');expect(result.error).toContain('changed');expect(site.effects).toHaveLength(before);const run=(await f.core.getTask(f.task.id)).session!.runs[0];expect(run.operations[0].status).toBe('retired');expect(run.operations[0].result).toBeUndefined();
});
it('executes an authored choice step when the valid ordinary dropdown exposes its current options',async()=>{
 const definition:BrowserWorkflow={...browserWorkflowStarter,origin:site.origin,steps:browserWorkflowStarter.steps.map((step,index)=>index===1?{...step,name:'Choose delivery',action:{kind:'select',target:{role:'select',label:'Delivery'},value:'{{delivery}}'},after:[{kind:'value',target:{role:'select',label:'Delivery'},equals:'{{delivery}}'}]}:index===2?{...step,before:step.before.map(check=>check.kind==='value'&&check.target.label==='Delivery'?{...check,target:{role:'select',label:'Delivery'}}:check),action:{kind:'click',target:{role:'button',label:'Save draft'},fields:[{target:{role:'text',label:'Request title'},value:'{{title}}'},{target:{role:'select',label:'Delivery'},value:'{{delivery}}'}]}}:step)};
 const f=await fixture(definition),log:string[]=[],before=site.effects.length,result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'valid-choice',workflow:f.workflow,url:site.origin+'/requests/choice',inputs:{title:'Valid dropdown target',delivery:'courier'}},approved(log));expect(result.status,result.error).toBe('completed');expect(log).toEqual(['fresh-browser','fill','select','click']);expect(site.effects.slice(before)).toEqual([{target:'/requests/choice',title:'Valid dropdown target',delivery:'courier'}]);
});

it('restores outcomes only for the exact artifact, revision and digest after a durable reopen',async()=>{
 const f=await fixture(),savedCopy=await saveBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'same-name-copy',definition:{...browserWorkflowStarter,origin:site.origin}}),copyRevision=savedCopy.task.artifacts.find(artifact=>artifact.id===savedCopy.artifactId)!.revisions[0],copyRef={artifactId:savedCopy.artifactId,revision:copyRevision.revision,digest:copyRevision.digest};
 expect(copyRef.artifactId).not.toBe(f.workflow.artifactId);expect(copyRef.digest).toBe(f.workflow.digest);
 const result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'exact-owner',workflow:f.workflow,url:site.origin+'/requests/exact-owner',inputs:{title:'Exact owner',delivery:'courier'}},approved([]));expect(result.status,result.error).toBe('completed');
 await f.core.close();const reopened=await createCompanion({dataDir:f.directory});cleanups.push(()=>reopened.close());const task=await reopened.getTask(f.task.id);expect(browserWorkflowRequest(task,f.workflow)?.id).toBe('exact-owner');expect(browserWorkflowRequest(task,copyRef)).toBeUndefined();expect(browserWorkflowRequest(task,{...f.workflow,revision:2})).toBeUndefined();expect(browserWorkflowRequest(task,{...f.workflow,digest:'changed'})).toBeUndefined();
 expect(task.session!.runs[0].workflow).toEqual(f.workflow);
});

it('rejects an out-of-prefix authored form before write approval or any destination request',async()=>{
 const f=await fixture(),log:string[]=[],before=site.effects.length,requestsBefore=site.requests.length,result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'outside-form',workflow:f.workflow,url:site.origin+'/requests/outside-form',inputs:{title:'Stay within the reviewed path',delivery:'courier'}},approved(log));
 expect(result.status).toBe('failed');expect(result.error).toContain('path outside this workflow');expect(log).toEqual(['fresh-browser','fill','fill']);expect(site.effects).toHaveLength(before);expect(site.requests.slice(requestsBefore).some(request=>request.includes('/outside/'))).toBe(false);
});

it('fresh storage preserves observed website field defaults until a reviewed authored fill changes them',async()=>{
 const f=await fixture(),controls=approved([]);let first=true;
 const result=await executeBrowserWorkflow(f.core,{taskId:f.task.id,requestId:'page-defaults',workflow:f.workflow,url:site.origin+'/requests/defaults',inputs:{title:'Reviewed replacement',delivery:'courier'}},{...controls,approveAction:async current=>{if(first){first=false;expect(current.observation.targets.find(target=>target.label==='Request title')?.value).toBe('Website title');expect(current.observation.targets.find(target=>target.label==='Delivery')?.value).toBe('Website delivery');}return controls.approveAction(current);}});
 expect(result.status,result.error).toBe('completed');const run=(await f.core.getTask(f.task.id)).session!.runs[0];expect(run.initialObservation.targets.find(target=>target.label==='Request title')?.value).toBe('Website title');expect(run.operations[0].result?.targets.find(target=>target.label==='Request title')?.value).toBe('Reviewed replacement');
});
