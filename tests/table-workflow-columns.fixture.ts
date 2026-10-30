import {tableColumnTargets} from '../src/learning/table-workflow-columns';
import {tableWorkflowInput} from '../src/learning/table-workflow';
import {tableWorkflowFixture,freshCsv,freshExpected,stopCsv} from './table-workflow.fixture';
export const originalColumns=[{name:'Group',column:'team'},{name:'State',column:'status'},{name:'Count',column:'qty'},{name:'Price',column:'price'}];
export const alternateColumns=[{name:'Group',column:'region'},{name:'State',column:'state'},{name:'Count',column:'units'},{name:'Price',column:'unit price'}];
export const alternateCsv='region,state,units,unit price\nEast,ready,3,4\nWest,ready,2,5\nEast,queued,1,99\n';
export const alternateExpected='region,total\nEast,12\nWest,10\n';
export async function columnFixture(){
 const f=await tableWorkflowFixture();await f.teach();const original=structuredClone(await f.read());
 for(const mapping of originalColumns){const target=tableColumnTargets(original.draft.steps,tableWorkflowInput(original.draft.observation!.source.content).headers).find(item=>item.column===mapping.column)!;await f.act({kind:'table-workflow-bind-column',name:mapping.name,column:mapping.column,expectedTargetsDigest:target.targetsDigest});}
 return {...f,original,async check(){for(const old of (await f.read()).draft.checks)await f.act({kind:'table-workflow-remove-check',index:0});await f.act({kind:'table-workflow-check',input:freshCsv,columns:originalColumns,expected:{kind:'output',csv:freshExpected}});await f.act({kind:'table-workflow-check',input:alternateCsv,columns:alternateColumns,expected:{kind:'output',csv:alternateExpected}});await f.act({kind:'table-workflow-check',input:stopCsv,columns:originalColumns,expected:{kind:'stopped'}});await f.act({kind:'table-workflow-check',input:alternateCsv,columns:[],expected:{kind:'invalid-input'}});}};
}
