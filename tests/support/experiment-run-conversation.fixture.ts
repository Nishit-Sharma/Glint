import {saveSourceFormula} from '../../src/core/source-formula-host';
import {saveExperimentRun,experimentRunRequest} from '../../src/core/experiment-runs-host';
import type {ExperimentRunInput} from '../../src/learning/experiment-runs';
import {sourceFormulaFixture} from './source-formula.fixture';
/** One real formula and one real saved run through the actual core: 5 USD/s × 4 s + 2 USD = 22 USD, baseline 14 USD. */
export async function savedRunFixture(close:Array<()=>Promise<void>>){
 const f=await sourceFormulaFixture();close.push(f.close);
 const model=await saveSourceFormula(f.core,{input:f.input}),input:ExperimentRunInput={shareWithTask:true,taskId:f.task.id,basis:{artifactId:model.artifactId,revision:model.revision,digest:model.digest},sourceRefs:[f.input.sourceRef],title:f.preview.draft.title,spec:f.preview.draft.spec,inputs:{rate:5,time:4,fee:2},baseline:{rate:3,time:4,fee:2}};
 const saved=await saveExperimentRun(f.core,{input});if(saved.kind!=='saved')throw Error('run not saved');
 const task=await f.core.getTask(f.task.id),request=task.requests.find(item=>item.id===experimentRunRequest(input,0).requestId)!,artifact=task.artifacts.find(item=>item.id===saved.artifactId)!;
 return {f,input,task,request,artifact};
}
/** Fragments that only appear when a stored run packet or its internal request is shown as conversation text. */
export const leaked=(text:string)=>['{"','{&quot;','"requestId"','requestId','experiment-run-v1','"digest"','Save an explicitly requested deterministic experiment run.'].filter(fragment=>text.includes(fragment));
