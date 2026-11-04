import {currentAnswerOrigin} from './current-answer-origin.fixture';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,expect,test} from 'vitest';
import {createCompanion,type Companion} from '../src/core/companion';
import {admitJoinExtraction,createGroundedJoinArtifact,groundedJoinExplanationContext,stageSafeModuleHistory} from '../src/core/grounded-join-host';
import {parseModule,parseModuleAnswer} from '../src/core/interactive-modules';
import {parseBrowserPlan} from '../src/host/browser/coordinator';
import {groundedJoin} from '../src/learning/grounded-join';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {extractionFixture} from './grounded-join-fixture';

let root:string,core:Companion;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'grounded-review-fix-'));core=await createCompanion({dataDir:root});});
afterEach(async()=>{await core.close();await rm(root,{recursive:true,force:true});});
async function fixture(cited=false){
 const f=extractionFixture(),task=await core.createTask({title:'Owned join provenance fixture'});
 const reason=cited?'The source explicitly specifies INNER equality on Team.':f.proposal.extraction.join.reason;
 const location={kind:'text-range' as const,start:f.content.length,end:f.content.length+reason.length,quote:reason};
 const content=cited?f.content+reason:f.content;
 const proposal=cited?{...f.proposal,extraction:{...f.proposal.extraction,join:{kind:'mapped' as const,keys:{mode:'INNER' as const,leftColumnId:'p-key',rightColumnId:'p-rkey'},reason,citationId:'join-condition'}},citations:[...f.proposal.citations,{id:'join-condition',source:'S1',location}]}:f.proposal;
 await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned synthetic source',content});
 const basis=await currentAnswerOrigin(core,task.id,'review-corrections-origin',{title:'Source basis',content:'Frozen source basis'},(await core.getTask(task.id)).sources.map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest})));
 const input={id:'reviewed-join',title:'Review the join premise',version:1,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},proposal,transfer:f.transfer};
 return {taskId:task.id,input,reason,data:admitJoinExtraction(await core.getTask(task.id),input)};
}
test('model browser plans cannot submit full host-bound modules while host storage still reads them',async()=>{
 const f=await fixture();
 const forged={...f.data,basis:f.data.basis.kind==='observed-source'?{...f.data.basis,taskId:'model-fabricated-task',artifact:{...f.data.basis.artifact,digest:'unchecked-basis'}}:f.data.basis};
 expect(parseModule(forged).kind).toBe('grounded-join');
 expect(()=>parseBrowserPlan(JSON.stringify({kind:'answer',markdown:'Model answer',modules:[forged]}))).toThrow();
 const admitted=await createGroundedJoinArtifact(core,{...f.input,taskId:f.taskId,requestId:'host-admitted'});
 expect(admitted.status).toBe('completed');
 const task=await core.getTask(f.taskId),artifact=task.artifacts.find(a=>a.id===admitted.artifactId)!;
 expect(parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0].data.kind).toBe('grounded-join');
});
test.each([false,true])('accepted join premise retains origin, reason and citation in every projection (cited=%s)',async cited=>{
 const f=await fixture(cited),request=await createGroundedJoinArtifact(core,{...f.input,taskId:f.taskId,requestId:'preserve-premise'});
 const target={taskId:f.taskId,artifactId:request.artifactId!,artifactRevision:1,moduleId:f.input.id};
 await editModule(core,{...target,action:{kind:'accept-extraction',expectedRevision:0}});
 const task=await core.getTask(f.taskId),state=task.session!.moduleStates[0].state;
 const view=groundedJoin.observe(f.data,state),context=groundedJoinExplanationContext(task,{...target,stateRevision:1});
 expect(view).toHaveProperty('joinMapping.origin',cited?'source-cited':'proposed-assumption');
 expect(view).toHaveProperty('joinMapping.reason',f.reason);
 expect(view).toHaveProperty('joinMapping.citationId',cited?'join-condition':null);
 expect(context).toHaveProperty('joinMapping',view.joinMapping);
 if(cited)expect(view).toHaveProperty('joinMapping.citation.location.quote',f.reason);
 else expect(view.assumptions.join(' ')).toContain(f.reason);
 expect(groundedJoin.text(f.data,state)).toContain(f.reason);
 expect(stageSafeModuleHistory(task,target.artifactId,1)).toContain(f.reason);
 const saved=await saveModuleDocument(core,{...target,sessionRevision:task.session!.revision});
 const content=(await core.getTask(f.taskId)).artifacts.find(a=>a.id===saved.artifactId)!.revisions[0].content;
 expect(content).toContain(f.reason);
 if(cited){expect(content).toContain('Source-cited mapping');expect(content).toContain('Citation');expect(content).not.toContain('join-condition');}
});
test('user key correction remains distinct from the original proposed mapping',async()=>{
 const f=await fixture();let state=groundedJoin.initial(f.data);
 state=groundedJoin.update(f.data,state,{kind:'correct-keys',keys:{mode:'LEFT',leftColumnId:'p-key',rightColumnId:'p-rkey'},reason:'I want to preserve unmatched members.',expectedRevision:0});
 state=groundedJoin.update(f.data,state,{kind:'accept-extraction',expectedRevision:1});
 const view=groundedJoin.observe(f.data,state);
 expect(view).toHaveProperty('joinMapping.reason',f.reason);
 expect(view).toHaveProperty('joinMapping.keys.mode','INNER');
 expect(view).toHaveProperty('userJoinCorrection.reason','I want to preserve unmatched members.');
 expect(view.lab?.problem.join.mode).toBe('LEFT');
 expect(groundedJoin.text(f.data,state)).toContain('I want to preserve unmatched members.');
});
