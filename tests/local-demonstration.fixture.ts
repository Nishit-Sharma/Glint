import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {createTextHelper} from '../src/core/text-helper-host';
import {editModule} from '../src/core/module-state';
import {initialModuleState,parseModuleAnswer} from '../src/core/interactive-modules';
import {semanticHelper} from '../src/learning/semantic-helper';
import type {ProcedureStage} from '../src/learning/staged-procedure';
export const demoInput={label:'  PRIVATE Box  ',quantity:3,size:4};
export const demoStart={kind:'start-semantic-demonstration',name:'private-workflow',intent:'PRIVATE mixed local workflow.',inputs:[{name:'label',kind:'string'},{name:'quantity',kind:'number'},{name:'size',kind:'number'}],input:demoInput};
export const demoSteps:Exclude<ProcedureStage,{kind:'decide'}>[]=[
 {kind:'assign',label:'Clean the label.',field:{name:'clean',kind:'string'},value:{source:'text-transform',operation:{kind:'trim'},input:{source:'input',value:'label'}}},
 {kind:'assign',label:'Calculate the total.',field:{name:'total',kind:'number'},value:{source:'calculate',operator:'multiply',left:{source:'input',value:'quantity'},right:{source:'input',value:'size'}}},
 {kind:'checkpoint',label:'Check the calculated total.',condition:{source:'output',field:'total',operator:'gte',value:'0'},reason:'Negative totals need review.'},
 {kind:'assign',label:'Reuse the earlier cleaned label.',field:{name:'labelCopy',kind:'string'},value:{source:'output',value:'clean'}},
];
export async function localDemonstrationFixture(){
 const directory=await mkdtemp(join(tmpdir(),'local-demonstration-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Owned local workflow'}),created=await createTextHelper(core,{taskId:task.id,requestId:'new-helper'}),artifact=created.task.artifacts[0],revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error();
 const data=module.data,owner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:data.id};
 await editModule(core,{...owner,action:{kind:'begin-semantic-helper',expectedRevision:0}});
 const read=async()=>semanticHelper.parseState(data.id,(await core.getTask(task.id)).session?.moduleStates.find(item=>item.artifactId===artifact.id)?.state??initialModuleState(data));
 const act=async(action:Record<string,unknown>)=>{await editModule(core,{...owner,action:{...action,expectedRevision:(await read()).revision} as never});return read();};
 const record=async()=>{await act(demoStart);for(const stage of demoSteps)await act({kind:'perform-semantic-demonstration-step',stage});return read();};
 const finish=async()=>{await record();return act({kind:'finish-semantic-demonstration',confirmed:'reviewed-inactive-local-procedure'});};
 return {directory,core,owner,data,read,act,record,finish,close:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
