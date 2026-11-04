import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Schema} from 'effect';
import {createCompanion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {editModule} from '../../src/core/module-state';
import {tableWorkflow,TableWorkflowActionSchema,type TableWorkflowStep} from '../../src/learning/table-workflow';
export const demoCsv='team,status,qty,price\nNorth,ready,2,5\nNorth,ready,3,4\nSouth,queued,1,100\nSouth,ready,1,7\n';
export const freshCsv='team,status,qty,price\nNorth,ready,4,8\nSouth,ready,1,6\nNorth,queued,9,20\n';
export const stopCsv='team,status,qty,price\nNorth,HOLD,4,8\n';
export const steps:TableWorkflowStep[]=[{kind:'filter',column:'status',operator:'eq',value:'ready'},{kind:'calculate',output:'amount',left:{kind:'column',column:'qty'},operator:'multiply',right:{kind:'column',column:'price'}},{kind:'summarize',groupBy:'team',column:'amount',output:'total'}];
export const demoExpected='team,total\nNorth,22\nSouth,7\n',freshExpected='team,total\nNorth,32\nSouth,6\n';
export async function tableWorkflowFixture(){
 const directory=await mkdtemp(join(tmpdir(),'table-workflow-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Owned table workflow'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create-table-workflow'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error('Expected existing helper owner');const data=module.data,owner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version,helperId:data.id};
 await editModule(core,{...owner,action:{kind:'begin-table-workflow',expectedRevision:0}});
 const read=async()=>tableWorkflow.parseState(data.id,(await core.getTask(task.id)).session?.moduleStates.find(item=>item.artifactId===artifact.id&&item.moduleId===module.id)?.state);
 const act=async(value:Record<string,unknown>)=>{const action=Schema.decodeUnknownSync(TableWorkflowActionSchema,{onExcessProperty:'error'})({...value,expectedRevision:(await read()).revision});await editModule(core,{...owner,action});return read();};
 const source=async(content=demoCsv,id='orders')=>{const task=await core.putSource(owner.taskId,{id,kind:'text',role:'fact',label:'Selected local orders',content}),item=task.sources.find(item=>item.id===id)!,version=item.versions.at(-1)!;return {sourceId:id,version:version.version,digest:version.digest};};
 const teach=async()=>{const sourceRef=await source();await act({kind:'table-workflow-start',name:'Ready orders by team',intent:'Keep ready orders, calculate each amount, then group totals.',sourceRef});for(const step of steps)await act({kind:'table-workflow-step',step});await act({kind:'table-workflow-finish',confirmed:'reviewed-inactive-table-workflow'});await act({kind:'table-workflow-exception',contains:'HOLD',reason:'Leave held orders for explicit review.'});await act({kind:'table-workflow-check',input:freshCsv,expected:{kind:'output',csv:freshExpected}});await act({kind:'table-workflow-check',input:stopCsv,expected:{kind:'stopped'}});await act({kind:'table-workflow-save-version'});return act({kind:'table-workflow-activate',version:1});};
 return {directory,core,task,artifact,data,owner,read,act,source,teach,close:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
