import {expect,test} from 'vitest';
import {tableWorkflow,runTableWorkflow,tableWorkflowSuite,workflowTableCsv,tableWorkflowReport,tableWorkflowStepText,type TableWorkflowStep} from '../../src/learning/table-workflow';
import {marked} from 'marked';
import {tableInputTargets,tableInputContract,type TableInputValues} from '../../src/learning/table-workflow-inputs';
import {pickingDigest} from '../../src/shared/picking-digest';
import {tableWorkflowFixture,demoCsv,freshCsv,stopCsv} from '../support/table-workflow.fixture';

import {ready2,queued3,readyExpected,queuedExpected,namedFixture} from '../support/table-workflow-inputs.fixture';

test('explicit typed inputs bind cloned literal slots while original actions and checked versions stay frozen',async()=>{
 const f=await namedFixture();try{
  const state=await f.read();expect(state.draft.observation).toEqual(f.original.draft.observation);expect(state.versions[0]).toEqual(f.original.versions[0]);
  expect(tableInputContract(state.draft.steps,state.draft.bindings)).toEqual([{name:'Status',kind:'text'},{name:'Rate',kind:'number'}]);
  const before=structuredClone(state.draft),ready=runTableWorkflow(state.draft,freshCsv,ready2),queued=runTableWorkflow(state.draft,freshCsv,queued3);
  if(ready.status!=='completed'||queued.status!=='completed')throw Error();expect(workflowTableCsv(ready.table)).toBe(readyExpected);expect(workflowTableCsv(queued.table)).toBe(queuedExpected);expect(queued.table.rows[0].records).toEqual([4]);expect(queued.trace[0].step).toMatchObject({value:'queued'});expect(queued.trace[1].step).toMatchObject({right:{kind:'number',value:3}});expect(state.draft).toEqual(before);
  expect(tableWorkflowSuite(state.draft).ready).toBe(false);await expect(f.act({kind:'table-workflow-save-version'})).rejects.toThrow();await f.check();expect(tableWorkflowSuite((await f.read()).draft).ready).toBe(true);await f.act({kind:'table-workflow-save-version'});expect((await f.read()).activeVersion).toBe(1);await f.act({kind:'table-workflow-activate',version:2});const sourceRef=await f.source(freshCsv,'fresh');await f.act({kind:'table-workflow-run',activeVersion:2,sourceRef,inputs:queued3});expect((await f.read()).lastRun?.inputs).toEqual(queued3);await f.act({kind:'table-workflow-rollback'});await f.act({kind:'table-workflow-run',activeVersion:1,sourceRef});const old=(await f.read()).lastRun!;expect(old.inputs).toBeUndefined();if(old.result.status!=='completed')throw Error();expect(workflowTableCsv(old.result.table)).toBe('team,total\nNorth,32\nSouth,6\n');
 }finally{await f.close();}
});

test('missing, unknown, duplicate, invalid numeric and stale bindings stop before exceptions or any table processing',async()=>{
 const f=await namedFixture();try{
  const draft=(await f.read()).draft;
  for(const inputs of [[],[{name:'Status',value:'ready'}],[...ready2,{name:'Unknown',value:'x'}],[...ready2,{name:'Rate',value:'2'}],[{name:'Status',value:'ready'},{name:'Rate',value:'NaN'}],[{name:'Status',value:''},{name:'Rate',value:'2'}],[{name:'Status',value:'ready'},{name:'Rate',value:'1000000000001'}]]){const result=runTableWorkflow(draft,stopCsv,inputs);expect(result).toMatchObject({status:'invalid-input',trace:[]});expect(result).not.toHaveProperty('table');}
  expect(runTableWorkflow(draft,'bad,csv\nshort',[]).status).toBe('invalid');
  const changed=structuredClone(draft.steps) as TableWorkflowStep[];if(changed[0].kind!=='filter')throw Error();changed[0]={...changed[0],column:'team'};await f.act({kind:'table-workflow-edit',name:draft.name,intent:draft.intent,steps:changed});const stale=runTableWorkflow((await f.read()).draft,freshCsv,ready2);expect(stale).toMatchObject({status:'invalid-input',reason:expect.stringContaining('exact applied step'),trace:[]});expect(tableWorkflowSuite((await f.read()).draft).ready).toBe(false);expect((await f.read()).versions[0]).toEqual(f.original.versions[0]);
 }finally{await f.close();}
});

test('declared checks require genuinely different resolved inputs, not numeric spelling or array ordering',async()=>{
 const f=await namedFixture();try{
  await f.check();let draft=(await f.read()).draft;
  const only=draft.checks.filter(check=>check.expected.kind!=='output');
  draft={...draft,checks:[...only,{input:freshCsv,inputs:ready2,expected:{kind:'output',csv:readyExpected}},{input:demoCsv,inputs:[{name:'Rate',value:'2.0'},{name:'Status',value:'ready'}],expected:{kind:'output',csv:'team,total\nNorth,10\nSouth,2\n'}}]};expect(tableWorkflowSuite(draft)).toMatchObject({ready:false,issue:expect.stringContaining('two different')});
  const original=(await f.read()).draft.checks[0];await f.act({kind:'table-workflow-check',input:original.input,inputs:[{name:'Status',value:'queued'},{name:'Rate',value:'4'}],expected:{kind:'output',csv:'team,total\nNorth,36\n'},replaces:pickingDigest(original)});expect((await f.read()).draft.checks.some(check=>pickingDigest(check)===pickingDigest(original))).toBe(false);await expect(f.act({kind:'table-workflow-check',input:original.input,inputs:ready2,expected:original.expected,replaces:pickingDigest(original)})).rejects.toThrow(/original declared check/);
 }finally{await f.close();}
});

test('only eligible literal targets can be bound; unknown authority and forged receipts are refused',async()=>{
 const f=await namedFixture();try{
  const state=await f.read(),step=state.draft.steps[1];await expect(f.act({kind:'table-workflow-bind-input',name:'Qty',stepIndex:1,slot:'left-number',expectedStepDigest:pickingDigest(step)})).rejects.toThrow(/unsupported/);
  await expect(f.act({kind:'table-workflow-bind-input',name:'Again',stepIndex:0,slot:'filter-value',expectedStepDigest:pickingDigest(state.draft.steps[0])})).rejects.toThrow(/only one/);
  await expect(f.act({kind:'table-workflow-bind-input',name:' Wrong ',stepIndex:0,slot:'filter-value',expectedStepDigest:pickingDigest(state.draft.steps[0])})).rejects.toThrow();
  await expect(f.act({kind:'table-workflow-edit',name:'Forged',intent:'No',steps:state.draft.steps,bindings:state.draft.bindings})).rejects.toThrow();
  const forged=structuredClone(state);(forged.draft.observation!.actions[0].step as {value:string}).value='queued';expect(()=>tableWorkflow.parseState(f.owner.helperId,forged)).toThrow();
 }finally{await f.close();}
});

test('reports keep multiline named text, headers and arbitrary backtick delimiters literal without changing trace or output',async()=>{
 const f=await tableWorkflowFixture();try{
  const group='team\n# FORGED_HEADER\n`````',output='total\n## FORGED_OUTPUT\n`````````',status='ready\n## FORGED_INPUT\n```````',other='queued\n# OTHER_INPUT\n~~~';
  const csv=(value:string,qty:number)=>[ [group,'status','qty'],['North',value,String(qty)] ].map(row=>row.map(cell=>'"'+cell.replaceAll('"','""')+'"').join(',')).join('\n')+'\n';
  const demo=csv(status,2),fresh=csv(status,4),alternate=csv(other,3),steps:TableWorkflowStep[]=[{kind:'filter',column:'status',operator:'eq',value:status},{kind:'calculate',output,left:{kind:'column',column:'qty'},operator:'multiply',right:{kind:'number',value:2}},{kind:'summarize',groupBy:group,column:output,output:'sum'}];
  const sourceRef=await f.source(demo);await f.act({kind:'table-workflow-start',name:'Bound report',intent:'Preserve exact local values.',sourceRef});for(const step of steps)await f.act({kind:'table-workflow-step',step});await f.act({kind:'table-workflow-finish',confirmed:'reviewed-inactive-table-workflow'});await f.act({kind:'table-workflow-exception',contains:'HOLD',reason:'Leave for review.'});
  const plainResult=runTableWorkflow((await f.read()).draft,fresh);if(plainResult.status!=='completed')throw Error();await f.act({kind:'table-workflow-check',input:fresh,expected:{kind:'output',csv:workflowTableCsv(plainResult.table)}});await f.act({kind:'table-workflow-check',input:csv('HOLD',1),expected:{kind:'stopped'}});await f.act({kind:'table-workflow-save-version'});await f.act({kind:'table-workflow-activate',version:1});await f.act({kind:'table-workflow-run',activeVersion:1,sourceRef:await f.source(fresh,'plain-multiline')});const plain=await f.read(),plainBefore=structuredClone(plain.lastRun),plainTokens=marked.lexer(tableWorkflowReport(plain));expect(plainTokens.flatMap(token=>token.type==='heading'&&'text'in token?[token.text]:[])).toEqual(['Bound report','Exact selected source','Performed workflow','Complete output table','Source-record provenance']);expect(plainTokens.some(token=>token.type==='code'&&token.text.includes(status)&&token.text.includes(output))).toBe(true);expect(plain.lastRun).toEqual(plainBefore);
  for(const [stepIndex,slot,name]of [[0,'filter-value','Status'],[1,'right-number','Rate']]as const){const target=tableInputTargets(steps).find(item=>item.stepIndex===stepIndex&&item.slot===slot)!;await f.act({kind:'table-workflow-bind-input',name,stepIndex,slot,expectedStepDigest:target.stepDigest});}
  for(const _check of (await f.read()).draft.checks)await f.act({kind:'table-workflow-remove-check',index:0});
  for(const [input,inputs]of [[fresh,[{name:'Status',value:status},{name:'Rate',value:'2'}]],[alternate,[{name:'Status',value:other},{name:'Rate',value:'3'}]]]as const){const result=runTableWorkflow((await f.read()).draft,input,inputs);if(result.status!=='completed')throw Error();await f.act({kind:'table-workflow-check',input,inputs,expected:{kind:'output',csv:workflowTableCsv(result.table)}});}
  await f.act({kind:'table-workflow-check',input:csv('HOLD',1),inputs:[{name:'Status',value:status},{name:'Rate',value:'2'}],expected:{kind:'stopped'}});await f.act({kind:'table-workflow-check',input:fresh,inputs:[],expected:{kind:'invalid-input'}});await f.act({kind:'table-workflow-save-version'});await f.act({kind:'table-workflow-activate',version:2});await f.act({kind:'table-workflow-run',activeVersion:2,sourceRef:await f.source(fresh,'multiline-fresh'),inputs:[{name:'Status',value:status},{name:'Rate',value:'2'}]});
  const state=await f.read(),before=structuredClone(state.lastRun),report=tableWorkflowReport(state),tokens=marked.lexer(report),headings=tokens.flatMap(token=>token.type==='heading'&&'text'in token?[token.text]:[]);
  expect(headings).toEqual(['Bound report','Exact selected source','Explicit named inputs','Performed workflow','Checked input bindings','Complete output table','Source-record provenance']);
  const run=state.lastRun!;if(run.result.status!=='completed')throw Error();const outputCsv=workflowTableCsv(run.result.table),descriptions=run.result.trace.map(({step},index)=>`${index+1}. ${tableWorkflowStepText(step)}`).join('\n');expect(tokens.some(token=>token.type==='code'&&token.text===descriptions)).toBe(true);expect(tokens.some(token=>token.type==='code'&&token.text===outputCsv)).toBe(true);expect(report).toContain(status);expect(report).toContain(output);expect(state.lastRun).toEqual(before);expect((await f.read()).lastRun).toEqual(before);
  await f.act({kind:'table-workflow-run',activeVersion:2,sourceRef:await f.source(alternate,'tilde-fresh'),inputs:[{name:'Status',value:other},{name:'Rate',value:'3'}]});const tilde=await f.read(),tildeReport=tableWorkflowReport(tilde),tildeTokens=marked.lexer(tildeReport);expect(tildeTokens.flatMap(token=>token.type==='heading'&&'text'in token?[token.text]:[])).toEqual(headings);expect(tildeTokens.some(token=>token.type==='code'&&token.text===`Status: ${other}`)).toBe(true);expect(tilde.lastRun?.result.status).toBe('completed');
 }finally{await f.close();}
});
