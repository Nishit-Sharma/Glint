import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {helperStudio,type HelperData} from '../../src/learning/reusable-helper';
import {recordedTextOrigin,initialRecordedTextHelper} from '../../src/learning/recorded-text-procedure';
import {semanticHelper,type SemanticHelperState} from '../../src/learning/semantic-helper';
import {stagedDraftFromProcedure,stagedProcedure} from '../../src/renderer/src/staged-semantic-procedure';
import {TypedSemanticHelperStudio} from '../../src/renderer/src/components/TypedSemanticHelperStudio';
import {projectTaskDialogue} from '../../src/core/task-dialogue';
import {taskContext} from '../../src/host/browser/coordinator';
import {MODULE_MIME} from '../../src/shared/module-contract';
import type {Task} from '../../src/core/types';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
function setup(note:string|null){
 const original:HelperData={kind:'helper-studio',schemaVersion:1,id:'source-helper',title:'Original',description:'Local actions'};let source=helperStudio.initial(original);
 for(const action of [{kind:'start-demonstration',input:' River dock '},{kind:'demonstrate-step',operation:{kind:'trim'}},{kind:'demonstrate-step',operation:{kind:'uppercase'}},{kind:'finish-demonstration'}])source=helperStudio.update(original,source,{...action,expectedRevision:source.revision});
 const origin=recordedTextOrigin({taskId:'task',artifactId:'source',artifactRevision:1,artifactDigest:'a'.repeat(64),moduleId:'source-module',moduleVersion:1,helperId:original.id,stateRevision:source.revision},original,source,source.observations![0].id),data:HelperData={kind:'helper-studio',schemaVersion:1,id:'target-helper',title:'Derived',description:'Review local stages',recordedText:origin};
 let state=initialRecordedTextHelper(data);const act=(action:Record<string,unknown>)=>{state=semanticHelper.update(data.id,state,{...action,expectedRevision:state.revision});};
 const initialRecording=structuredClone(state.recordings[0]),draft=stagedDraftFromProcedure(state.definitions[0].procedure)!;
 if(note!==null){draft.stages[1].label=note;act({kind:'replace-semantic-procedure',procedure:stagedProcedure(draft,state.definitions[0].procedure.id),rationales:[],corrections:[],examples:[]});}
 const evidence=(lower:boolean)=>({rationales:[{id:'recorded-reason',kind:'inferred-rationale',stepId:'stage-2',basis:[{recordingId:initialRecording.recordingId,traceStepId:'stage-2'}],reason:'Use the actual closed operation on the local input.'}],corrections:[],examples:[{id:'different',role:'held-out',input:{text:' North desk '},expected:{status:'completed',output:{text1:'North desk',text2:lower?'north desk':'NORTH DESK'}}},{id:'wrong-type',role:'counterexample',input:{text:0},expected:{status:'invalid-input',stage:'input'}}]});
 act({kind:'set-semantic-evidence',...evidence(false)});act({kind:'save-semantic-version',changeNote:'Original uppercase'});act({kind:'activate-semantic-version',version:1});const first=structuredClone(state.versions[0]);
 const stage=draft.stages[1];if(stage.kind!=='assign'||stage.value.source!=='text-transform')throw Error();stage.value.operation={kind:'lowercase'};
 act({kind:'replace-semantic-procedure',procedure:stagedProcedure(draft,state.definitions[0].procedure.id),rationales:[],corrections:[],examples:[]});act({kind:'correct-semantic-recording-expectation',recordingId:initialRecording.recordingId,expected:{status:'completed',output:{text1:'River dock',text2:'river dock'}},reason:'Use lowercase in the later version without changing the saved step note.'});act({kind:'set-semantic-evidence',...evidence(true)});act({kind:'save-semantic-version',changeNote:'Lowercase operation, preserved note'});act({kind:'activate-semantic-version',version:2});act({kind:'run-semantic-active',input:{text:' South pier '}});
 return {data,source,origin,first,initialRecording,get state(){return state;},act};
}
function render(data:HelperData,state:SemanticHelperState){const r=createControlledRenderer(()=>createElement(TypedSemanticHelperStudio,{data,state,onAction:()=>{}}));r.render();return r;}
function result(r:ReturnType<typeof render>,summary:string){return r.find(node=>node.type==='details'&&node.children.some(child=>child.type==='summary'&&text(child)===summary));}
function secondTrace(result:Node){return result.children.find(node=>node.type==='ol')!.children[1];}

test.each([null,'Keep this intentional note about uppercase exports.'])('actual text operation is authoritative while copied or authored step note %s remains separately identified across v2 and rollback',note=>{
 const f=setup(note),savedNote=note??'Apply recorded uppercase.',before=structuredClone(f.state),r=render(f.data,f.state),v2=result(r,'Version 2 typed result'),step=secondTrace(v2);
 expect(f.state.lastRun?.result).toMatchObject({status:'completed',output:{text2:'south pier'}});expect(text(step).startsWith('Text operation: Lowercase')).toBe(true);expect(step.children.find(child=>child.type==='p')&&text(step.children.find(child=>child.type==='p')!)).toBe('Saved step note: '+savedNote);expect(text(step)).toContain('text1: South pier');expect(text(v2)).toContain('text2south pier');
 // The original recording uses its own original immutable operation and note.
 const observed=result(r,'Recorded example · completed'),originalStep=secondTrace(observed);expect(text(originalStep).startsWith('Text operation: Uppercase')).toBe(true);expect(text(originalStep)).toContain('Saved step note: Apply recorded uppercase.');expect(f.state).toEqual(before);expect(f.state.recordings[0]).toEqual(f.initialRecording);expect(f.state.versions[0]).toEqual(f.first);
 const draft=stagedDraftFromProcedure(f.state.definitions.at(-1)!.procedure)!;expect(draft.stages[1].label).toBe(savedNote);expect(f.data.recordedText).toEqual(f.origin);
 f.act({kind:'activate-semantic-version',version:1});f.act({kind:'run-semantic-active',input:{text:' South pier '}});const rollback=secondTrace(result(render(f.data,f.state),'Version 1 typed result'));expect(text(rollback).startsWith('Text operation: Uppercase')).toBe(true);expect(text(rollback)).toContain('Saved step note: '+savedNote);expect(f.state.lastRun?.result).toMatchObject({output:{text2:'SOUTH PIER'}});expect(f.state.recordings[0]).toEqual(f.initialRecording);expect(f.state.versions[0]).toEqual(f.first);
 // Rendering more precise local details must not bypass the separate model/browser projection.
 const task:Task={id:'task',title:'Public task',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'target',revisions:[{revision:1,title:'Derived',content:JSON.stringify({schemaVersion:1,markdown:'Local helper',modules:[{id:'target-module',version:1,data:f.data,provenance:[]}]}),mimeType:MODULE_MIME,sourceRefs:[],digest:'b'.repeat(64),createdAt:'time'}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{revision:1,draft:'',runs:[],moduleStates:[{artifactId:'target',artifactRevision:1,moduleId:'target-module',state:f.state as never}]}};
 for(const context of [projectTaskDialogue(task,'not-sent',[]),taskContext(task,'not-sent')])for(const value of ['River dock','South pier',savedNote,'SOUTH PIER'])expect(context).not.toContain(value);
});


test('replacement trace identifies exact literal parameters and an unreturned out-of-range result without rewriting its note',()=>{
 const data:HelperData={kind:'helper-studio',schemaVersion:1,id:'replacement-helper',title:'Replacement',description:'Local only'};
 for(const stopped of [false,true]){
  const operation={kind:'replace-literal' as const,find:stopped?'x':'.*',replacement:stopped?'y'.repeat(80):'$&'},procedure=stagedProcedure({format:'staged-record-v1',name:'literal-text',intent:'Review exact local replacement.',inputs:[{name:'text',kind:'string'}],requirements:[],stages:[{kind:'assign',label:'Keep this original user note.',field:{name:'result',kind:'string'},value:{source:'text-transform',input:{source:'input',value:'text'},operation}}]});
  let state=semanticHelper.initial(data.id);state=semanticHelper.update(data.id,state,{kind:'set-semantic-procedure',procedure,expectedRevision:state.revision});state=semanticHelper.update(data.id,state,{kind:'record-semantic-input',input:{text:stopped?'xxx':'A.*B'},expectedRevision:state.revision});const before=structuredClone(state),shown=result(render(data,state),'Recorded example · '+(stopped?'abstained':'completed')),step=shown.children.find(node=>node.type==='ol')!.children[0];
  expect(text(step).startsWith('Text operation: Replace exact text'+(stopped?': not computed':''))).toBe(true);expect(text(step)).toContain('Saved step note: Keep this original user note.');const parameters=step.children.find(node=>node.type==='p'&&node.children.some(child=>child.type==='code'))!,codes=parameters.children.filter(node=>node.type==='code');expect(codes.map(text)).toEqual([JSON.stringify(operation.find),JSON.stringify(operation.replacement)]);expect(codes.every(node=>node.props.className==='semantic-exact-value')).toBe(true);expect(state).toEqual(before);
  expect(state.recordings[0].result).toMatchObject(stopped?{status:'abstained',code:'output-contract',output:{}}:{status:'completed',output:{result:'A$&B'}});
 }
});
