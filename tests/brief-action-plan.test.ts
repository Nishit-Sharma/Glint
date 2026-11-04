import {currentAnswerOrigin} from './current-answer-origin.fixture';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {createCompanion,type Companion} from '../src/core/companion';
import {prepareBriefActionPlan} from '../src/host/brief-action-plan';
import type {Command} from '../src/shared/bridge';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {groundedJoin} from '../src/learning/grounded-join';
import {MODULE_MIME} from '../src/shared/module-contract';
import {extractionFixture} from './grounded-join-fixture';
let core:Companion,dir:string;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'brief-plan-'));core=await createCompanion({dataDir:dir});});
afterEach(async()=>{await core.close();await rm(dir,{recursive:true,force:true});});
async function fixture(ambiguous=true){
 const f=extractionFixture(ambiguous),created=await core.createTask({title:'Visible tables'});
 const task=await core.putSource(created.id,{id:'tables',kind:'text',role:'fact',label:'Members and invitations',content:f.content});
 const source=task.sources[0],refs=[{sourceId:source.id,version:source.currentVersion,digest:source.versions[0].digest}];
 const action={label:'Explore the join',outcome:'Review a transcription and predict pairs.',requestKind:'experiment' as const,seedPrompt:'Use these two tables for a reviewed join experiment.',sourceRefs:refs,capability:'sql-join' as const};
 const saved=await currentAnswerOrigin(core,task.id,'fixture-brief-origin:'+task.id,{title:'Screen brief',mimeType:'application/json',content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Two tables show Team values.',actions:[action]})},refs);
 const command:Extract<Command,{type:'model.run'}>={type:'model.run',taskId:task.id,requestId:'deliberate-attempt',kind:action.requestKind,prompt:action.seedPrompt,sourceIds:refs.map(r=>r.sourceId),expectedSourceRefs:refs,briefAction:{artifact:{artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},actionIndex:0}};
 return {...f,command,task:await core.getTask(task.id),action,originRequestId:saved.requestId};
}
test('one caller request publishes an admitted reviewed module and identical replay needs no second run',async()=>{
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 expect(plan.request.requestId).toBe('deliberate-attempt');
 expect(plan.request.expectedArtifacts).toEqual([f.command.briefAction!.artifact]);
 const result=await core.runRequest(plan.request,async ctx=>{
  const bound=plan.bind(ctx);if(bound.kind!=='join-extraction')throw Error('Expected join policy');
  expect(bound.prompt).toContain('S1');expect(bound.prompt).not.toContain('Shipments');expect(bound.prompt).not.toContain('transfer-a');
  expect(bound.progress).not.toContain('schemaVersion');
  return bound.finish(JSON.stringify(f.proposal));
 });
 expect(result.status).toBe('completed');
 const saved=await core.getTask(f.task.id),answer=saved.artifacts.find(a=>a.id===result.artifactId)!.revisions[0];
 expect(answer.mimeType).toBe(MODULE_MIME);
 expect(parseModuleAnswer(JSON.parse(answer.content)).modules[0].data).toMatchObject({kind:'grounded-join',basis:{artifact:f.command.briefAction!.artifact},extraction:{left:{rows:expect.arrayContaining([{id:'practice-b',cells:expect.arrayContaining([expect.objectContaining({kind:'needs-correction'})])}])}}});
 const replayPlan=prepareBriefActionPlan(saved,f.command)!;
 expect(await core.runRequest(replayPlan.request,async()=>{throw Error('Replay ran provider');})).toEqual(result);
 expect((await core.getTask(f.task.id)).requests.filter(request=>request.id!==f.originRequestId)).toHaveLength(1);
});

test('changed caller intent, selection and saved authority are rejected before a request exists',async()=>{
 const f=await fixture(),c=f.command;
 expect(prepareBriefActionPlan(f.task,{...c,briefAction:undefined})).toBeUndefined();
 for(const changed of [
  {...c,prompt:c.prompt+' Changed'}, {...c,kind:'create' as const}, {...c,sourceIds:[]}, {...c,expectedSourceRefs:[]},
  {...c,expectedSourceRefs:[{...c.expectedSourceRefs![0],digest:'forged'}]}, {...c,artifactId:c.briefAction!.artifact.artifactId},
  {...c,taskId:'another-task'}, {...c,briefAction:{...c.briefAction!,actionIndex:1}},
  {...c,briefAction:{...c.briefAction!,artifact:{...c.briefAction!.artifact,digest:'forged'}}},
 ])expect(()=>prepareBriefActionPlan(f.task,changed)).toThrow('Brief action unavailable');
 for(const selection of [{...c.briefAction,capability:'sql-join'},{...c.briefAction,actionIndex:0.5},{...c.briefAction,artifact:{...c.briefAction!.artifact,approval:true}}])expect(()=>prepareBriefActionPlan(f.task,{...c,briefAction:selection as typeof c.briefAction})).toThrow('Brief action unavailable');
 const forged=structuredClone(f.task);forged.artifacts[0].revisions[0].content=JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Two tables.',actions:[{...f.action,transfer:f.transfer}]});
 expect(()=>prepareBriefActionPlan(forged,c)).toThrow('saved action');
 expect((await core.getTask(f.task.id)).requests.filter(request=>request.id!==f.originRequestId)).toEqual([]);
});

test('changed saved action or request payload cannot reuse the caller id, while a new deliberate id is separate',async()=>{
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 const result=await core.runRequest(plan.request,async ctx=>{const bound=plan.bind(ctx);if(bound.kind!=='join-extraction')throw Error();return bound.finish('{"schemaVersion":1,"kind":"unsupported-source","reason":"The table is too sparse to read."}');});
 expect(result.status).toBe('completed');
 const current=await core.getTask(f.task.id),revision=current.artifacts[0].revisions[0];
 const updated=await core.saveArtifact(f.task.id,{artifactId:current.artifacts[0].id,expectedRevision:1,title:revision.title,sourceRefs:revision.sourceRefs,mimeType:revision.mimeType,content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Two tables.',actions:[{...f.action,seedPrompt:'A changed reviewed join request.'}]})});
 const changed={...f.command,prompt:'A changed reviewed join request.',briefAction:{artifact:{artifactId:updated.artifactId,revision:2,digest:updated.revision.digest},actionIndex:0}};
 const newPlan=prepareBriefActionPlan(await core.getTask(f.task.id),changed)!;
 await expect(core.runRequest(newPlan.request,async()=>{throw Error('Must not execute');})).rejects.toThrow('different payload');
 const newAttempt=prepareBriefActionPlan(await core.getTask(f.task.id),{...changed,requestId:'another-deliberate-attempt'})!;
 expect(newAttempt.request.requestId).toBe('another-deliberate-attempt');
 expect(newAttempt.request.executionScope).not.toEqual(newPlan.request.executionScope);
});

test('basis changes before start or during the runner cannot publish an extraction',async()=>{
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 const changed=await core.saveArtifact(f.task.id,{artifactId:f.command.briefAction!.artifact.artifactId,expectedRevision:1,title:'Changed basis',content:'Changed before start.'});
 await expect(core.runRequest(plan.request,async()=>{throw Error('Must not execute');})).rejects.toThrow('cited artifact changed');
 expect((await core.getTask(f.task.id)).requests.filter(request=>request.id!==f.originRequestId)).toEqual([]);
 expect(changed.revision.revision).toBe(2);
 const g=await fixture(),live=prepareBriefActionPlan(g.task,g.command)!;
 const result=await core.runRequest(live.request,async ctx=>{
  const bound=live.bind(ctx);if(bound.kind!=='join-extraction')throw Error();
  const output=bound.finish(JSON.stringify(g.proposal));
  await core.saveArtifact(g.task.id,{artifactId:g.command.briefAction!.artifact.artifactId,expectedRevision:1,title:'Changed basis',content:'Changed before publication.'});return output;
 });
 expect(result.status).toBe('failed');expect(result.error).toContain('cited artifact changed');
 expect((await core.getTask(g.task.id)).artifacts).toHaveLength(1);
});

test('outbound handle order and admission use exactly the same frozen two-source snapshot',async()=>{
 const f=await fixture();
 await core.putSource(f.task.id,{id:'second',kind:'text',role:'fact',label:'Second visible source',content:'Additional visible table explanation.'});
 const task=await core.getTask(f.task.id),second=task.sources[1],ref={sourceId:second.id,version:1,digest:second.versions[0].digest},all=[...f.action.sourceRefs,ref];
 const saved=await core.saveArtifact(task.id,{artifactId:f.command.briefAction!.artifact.artifactId,expectedRevision:1,title:'Two-source brief',mimeType:'application/json',sourceRefs:all,content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Two supplied sources.',actions:[{...f.action,sourceRefs:[ref,...f.action.sourceRefs]}]})});
 const command={...f.command,sourceIds:['second','tables'],expectedSourceRefs:[ref,...f.action.sourceRefs],briefAction:{actionIndex:0,artifact:{artifactId:saved.artifactId,revision:2,digest:saved.revision.digest}}};
 const current=await core.getTask(task.id),plan=prepareBriefActionPlan(current,command)!;
 expect(plan.request.sourceIds).toEqual(['tables','second']);
 expect(()=>plan.bind({task:current,sourceRefs:[ref,...f.action.sourceRefs]})).toThrow('source order');
 const reordered=structuredClone(current);reordered.sources.reverse();
 expect(()=>plan.bind({task:reordered,sourceRefs:all})).toThrow('source context');
 const result=await core.runRequest(plan.request,async ctx=>{const bound=plan.bind(ctx);if(bound.kind!=='join-extraction')throw Error();
  expect(bound.prompt).toContain('"handle":"S1","kind":"text","label":"Members and invitations"');
  expect(bound.prompt).toContain('"handle":"S2","kind":"text","label":"Second visible source"');return bound.finish(JSON.stringify(f.proposal));});
 expect(result.status).toBe('completed');
 for(const mutate of [(t:typeof current)=>{t.sources[1].freshness='refresh-required';},(t:typeof current)=>{t.sources[1].versions[0].role='style';},(t:typeof current)=>{t.sources[1].currentVersion=2;}]){const invalid=structuredClone(current);mutate(invalid);expect(()=>prepareBriefActionPlan(invalid,command)).toThrow();}
});

test('ordinary saved actions keep ordinary response policy and cannot acquire SQL through caller fields',async()=>{
 const f=await fixture(),brief=f.task.artifacts[0].revisions[0];
 const {capability,...withoutCapability}=f.action;
 const ordinary={...withoutCapability,requestKind:'explain' as const};
 const saved=await core.saveArtifact(f.task.id,{artifactId:f.task.artifacts[0].id,expectedRevision:1,title:brief.title,mimeType:brief.mimeType,sourceRefs:brief.sourceRefs,content:JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Visible tables.',actions:[ordinary]})});
 const task=await core.getTask(f.task.id),plan=prepareBriefActionPlan(task,{...f.command,kind:'explain',briefAction:{artifact:{artifactId:saved.artifactId,revision:2,digest:saved.revision.digest},actionIndex:0}})!;
 expect(plan.bind({task,sourceRefs:ordinary.sourceRefs})).toEqual({kind:'ordinary'});
 expect(plan.request.expectedArtifacts).toHaveLength(1);
});

test('unreadable values, unknown types and ambiguous keys remain user review requirements',async()=>{
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 const result=await core.runRequest(plan.request,async ctx=>{
  const bound=plan.bind(ctx);if(bound.kind!=='join-extraction')throw Error();
  const p=f.proposal;
  return bound.finish(JSON.stringify({...p,extraction:{...p.extraction,left:{...p.extraction.left,columns:p.extraction.left.columns.map((c,i)=>i===0?{...c,type:'unknown',typeCitationId:null}:c)},join:{kind:'ambiguous',reason:'No join condition is visible.'}}}));
 });
 expect(result.status).toBe('completed');
 const task=await core.getTask(f.task.id),data=parseModuleAnswer(JSON.parse(task.artifacts.find(a=>a.id===result.artifactId)!.revisions[0].content)).modules[0].data;
 const initial=groundedJoin.initial(data);expect(groundedJoin.observe(data,initial)).toMatchObject({ready:false,lab:null,missing:expect.arrayContaining([expect.stringContaining('unreadable'),expect.stringContaining('choose the column type'),expect.stringContaining('both keys explicitly')])});
 expect(()=>groundedJoin.update(data,initial,{kind:'accept-extraction',expectedRevision:0})).toThrow('Resolve the extraction');
});

test('model host data or invented cells fail without publishing a raw proposal',async()=>{
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 const bound=plan.bind({task:f.task,sourceRefs:f.action.sourceRefs});if(bound.kind!=='join-extraction')throw Error();
 const p=f.proposal;
 for(const forbidden of [{...p,transfer:f.transfer},{...p,basis:f.command.briefAction!.artifact},{...p,corrections:[]},{...p,results:[]},{...p,extraction:{...p.extraction,left:{...p.extraction.left,rows:[{id:'invented',cells:[{kind:'provided',value:'fabricated'},{kind:'provided',value:'fabricated'}]}]}}}])expect(()=>bound.finish(JSON.stringify(forbidden))).toThrow();
 const changed=structuredClone(f.task);changed.artifacts[0].revisions[0].content=JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Visible tables.',actions:[{...f.action,seedPrompt:'Changed without a matching current basis.'}]});
 expect(()=>plan.bind({task:changed,sourceRefs:f.action.sourceRefs})).toThrow('saved action changed');
 const result=await core.runRequest(plan.request,async ctx=>{const response=plan.bind(ctx);if(response.kind!=='join-extraction')throw Error();return response.finish('{"schemaVersion":1,"extraction":');});
 expect(result.status).toBe('failed');expect(result.error).not.toContain('"extraction"');
 expect((await core.getTask(f.task.id)).artifacts).toHaveLength(1);
});

test('a fully readable practice colliding with the trusted transfer fails explicitly',async()=>{
 const f=await fixture(false),plan=prepareBriefActionPlan(f.task,f.command)!,p=f.proposal;
 const left=p.extraction.left.rows,right=p.extraction.right.rows;
 const collision={...p,extraction:{...p.extraction,left:{...p.extraction.left,rows:[left[0],{...left[0],id:'duplicate-key-row'},left[1],left[2]]},right:{...p.extraction.right,rows:[right[0],right[1],right[3],right[2]]},join:{...p.extraction.join,keys:{...p.extraction.join.keys,mode:'LEFT'}}}};
 const result=await core.runRequest(plan.request,async ctx=>{const bound=plan.bind(ctx);if(bound.kind!=='join-extraction')throw Error();return bound.finish(JSON.stringify(collision));});
 expect(result.status).toBe('failed');expect(result.error).toContain('separate challenge must differ');
 expect((await core.getTask(f.task.id)).artifacts).toHaveLength(1);
});

test('source version races fail at request start and at final publication',async()=>{
 const f=await fixture(),plan=prepareBriefActionPlan(f.task,f.command)!;
 await core.putSource(f.task.id,{id:'tables',kind:'text',role:'fact',label:'Changed source',content:'Changed before start.'});
 await expect(core.runRequest(plan.request,async()=>{throw Error('Must not execute');})).rejects.toThrow('Selected source versions changed');
 const g=await fixture(),live=prepareBriefActionPlan(g.task,g.command)!;
 const result=await core.runRequest(live.request,async ctx=>{const bound=live.bind(ctx);if(bound.kind!=='join-extraction')throw Error();const output=bound.finish(JSON.stringify(g.proposal));await core.putSource(g.task.id,{id:'tables',kind:'text',role:'fact',label:'Changed source',content:'Changed before commit.'});return output;});
 expect(result.status).toBe('cancelled');
 expect((await core.getTask(g.task.id)).artifacts).toHaveLength(1);
});
