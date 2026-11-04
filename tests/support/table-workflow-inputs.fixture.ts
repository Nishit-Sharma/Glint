import {tableInputTargets,type TableInputValues} from '../../src/learning/table-workflow-inputs';
import type {TableWorkflowStep} from '../../src/learning/table-workflow';
import {tableWorkflowFixture,freshCsv,stopCsv} from './table-workflow.fixture';
export const ready2:TableInputValues=[{name:'Status',value:'ready'},{name:'Rate',value:'2'}];
export const queued3:TableInputValues=[{name:'Status',value:'queued'},{name:'Rate',value:'3'}];
export const readyExpected='team,total\nNorth,8\nSouth,2\n',queuedExpected='team,total\nNorth,27\n';
export async function namedFixture(){
 const f=await tableWorkflowFixture();await f.teach();const original=structuredClone(await f.read());
 const steps=structuredClone(original.draft.steps) as TableWorkflowStep[];if(steps[1].kind!=='calculate')throw Error();steps[1]={...steps[1],right:{kind:'number',value:2}};
 await f.act({kind:'table-workflow-edit',name:original.draft.name,intent:original.draft.intent,steps});
 for(const [stepIndex,slot,name] of [[0,'filter-value','Status'],[1,'right-number','Rate']]as const){const target=tableInputTargets(steps).find(item=>item.stepIndex===stepIndex&&item.slot===slot)!;await f.act({kind:'table-workflow-bind-input',stepIndex,slot,name,expectedStepDigest:target.stepDigest});}
 return {...f,original,async check(){
  for(const old of (await f.read()).draft.checks)await f.act({kind:'table-workflow-remove-check',index:0});
  await f.act({kind:'table-workflow-check',input:freshCsv,inputs:ready2,expected:{kind:'output',csv:readyExpected}});
  await f.act({kind:'table-workflow-check',input:freshCsv,inputs:queued3,expected:{kind:'output',csv:queuedExpected}});
  await f.act({kind:'table-workflow-check',input:stopCsv,inputs:ready2,expected:{kind:'stopped'}});
  await f.act({kind:'table-workflow-check',input:freshCsv,inputs:[{name:'Status',value:'ready'},{name:'Rate',value:''}],expected:{kind:'invalid-input'}});
 }};
}

