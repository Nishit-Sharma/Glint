import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {workflowLab,type WorkflowData} from '../src/learning/workflow-lab';
import {workflowExample} from '../src/learning/workflow-example';
import {WorkflowLab} from '../src/renderer/src/components/WorkflowLab';

const sourceA='Idle + Start -> Busy\nBusy + Ack -> Done\nBusy + Reset -> Idle';
const sourceB='When a Done controller receives Reset, it returns to Idle.';
const refA={sourceId:'owned-rules',version:1,digest:'rules-v1'},refB={sourceId:'owned-note',version:2,digest:'note-v2'};
const states=[{id:'idle',label:'Idle'},{id:'busy',label:'Busy'},{id:'done',label:'Done'}];
const events=[{id:'start',label:'Start'},{id:'ack',label:'Ack'},{id:'reset',label:'Reset'}];
const rules=[{id:'idle-start',fromStateId:'idle',eventId:'start',toStateId:'busy',enabled:true},{id:'busy-ack',fromStateId:'busy',eventId:'ack',toStateId:'done',enabled:true},{id:'busy-reset',fromStateId:'busy',eventId:'reset',toStateId:'idle',enabled:true},{id:'done-reset',fromStateId:'done',eventId:'reset',toStateId:'idle',enabled:true}];
const literalQuotes=['Idle + Start -> Busy','Busy + Ack -> Done','Busy + Reset -> Idle'];
export const hardwareModel:WorkflowData={kind:'workflow-lab',schemaVersion:1,id:'owned-finite-controller',version:1,title:'Owned sequential controller abstraction',basis:{kind:'reviewed-source',contextDigest:'owned-finite-basis',taskId:'owned-task',artifact:{artifactId:'owned-basis',revision:3,digest:'basis-v3'},sourceRefs:[refA,refB]},practice:{id:'owned-practice',title:'Reviewed controller sequence',states,events,rules,initialStateId:'idle',eventIds:['start','ack','reset','ack']},transfer:{id:'owned-unseen',title:'Separate synthetic condition',states,events,rules,initialStateId:'busy',eventIds:['start','reset','ack']},assumptions:['One event at a time. No clock or signal scheduling is modeled.'],citations:[...literalQuotes.map((quote,index)=>({id:'quote-'+index,sourceRef:refA,location:{kind:'text-range' as const,start:sourceA.indexOf(quote),end:sourceA.indexOf(quote)+quote.length,quote}})),{id:'quote-reset-note',sourceRef:refB,location:{kind:'text-range',start:0,end:sourceB.length,quote:sourceB}}],ruleOrigins:rules.map((rule,index)=>({ruleId:rule.id,citationId:index<3?'quote-'+index:'quote-reset-note',interpretation:index<3?'source-stated':'user-interpreted',reason:index<3?'Reviewed literal transition.':'Corrected the prose interpretation to Idle after rereading the reset note.'}))};

test('Deep projection connects the quoted interpretation, hypothetical rule change and actual downstream trace from the same model',()=>{
 let state=workflowLab.initial(hardwareModel);
 state=workflowLab.update(hardwareModel,state,{kind:'set-rule',ruleId:'done-reset',toStateId:'busy',enabled:true,reason:'Try restarting Busy after reset.',expectedRevision:0});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'done',blockedCount:0,reasoning:'The last Ack can now run from Busy.',expectedRevision:1});
 const before=JSON.stringify({data:hardwareModel,state}),view=workflowLab.observe(hardwareModel,state);
 expect(view).toHaveProperty('causal');
 const causal=view.causal!;
 expect(causal.unchanged).toEqual({startingState:true,eventSequence:true,ruleCount:3,stepIndices:[1,2]});
 expect(causal.steps[2]).toMatchObject({kind:'rule-change',before:{fromStateLabel:'Done',toStateLabel:'Idle'},after:{fromStateLabel:'Done',toStateLabel:'Busy'},evidence:[{classification:'Your interpretation',citationNumber:4,citation:{sourceRef:refB,location:{quote:sourceB}}}]});
 expect(causal.steps[3]).toMatchObject({kind:'upstream-state',before:{fromStateLabel:'Idle',status:'blocked'},after:{fromStateLabel:'Busy',toStateLabel:'Done',status:'applied'},evidence:[{classification:'Source-stated rule',citationNumber:2,citation:{location:{quote:'Busy + Ack -> Done'}}}]});
 expect(causal.edits).toEqual(state.editNotes);
 expect(workflowLab.text(hardwareModel,state)).toContain('Why these events lead here (computed finite model)');
 expect(JSON.stringify({data:hardwareModel,state})).toBe(before);
});

test('the actual Deep renderer exposes the computed causes and exact original quoted interpretation without a new action',()=>{
 let state=workflowLab.initial(hardwareModel);
 state=workflowLab.update(hardwareModel,state,{kind:'set-rule',ruleId:'done-reset',toStateId:'busy',enabled:true,reason:'Try restarting Busy after reset.',expectedRevision:0});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'done',blockedCount:0,reasoning:'Ack follows the changed reset.',expectedRevision:1});
 state=workflowLab.update(hardwareModel,state,{kind:'set-mode',mode:'deep',expectedRevision:2});
 const actions:unknown[]=[],before=JSON.stringify(state);
 const html=renderToStaticMarkup(createElement(WorkflowLab,{data:hardwareModel,state,onAction:action=>{actions.push(action);}}));
 expect(html).toContain('aria-label="Computed workflow explanation"');
 expect(html).toContain('When a Done controller receives Reset, it returns to Idle.');
 expect(html).toContain('Your interpretation');
 expect(html).toContain('Try restarting Busy after reset.');
 expect(html).toContain('preceding path now reaches Busy instead of Idle');
 expect(html).toContain('Unchanged trace steps: 1, 2');
 expect(html).toContain('HDL timing');
 expect(actions).toEqual([]);expect(JSON.stringify(state)).toBe(before);
});

test('Deep withholds computed causes before each current prediction, including the first synthetic transfer',()=>{
 let state=workflowLab.initial(hardwareModel);
 state=workflowLab.update(hardwareModel,state,{kind:'set-mode',mode:'deep',expectedRevision:0});
 expect(workflowLab.observe(hardwareModel,state).causal).toBeNull();
 expect(renderToStaticMarkup(createElement(WorkflowLab,{data:hardwareModel,state,onAction:()=>{throw Error('No render action');}}))).not.toContain('Computed workflow explanation');
 state=workflowLab.update(hardwareModel,state,{kind:'set-rule',ruleId:'done-reset',toStateId:'busy',enabled:true,reason:'Try a changed reset.',expectedRevision:1});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'done',blockedCount:0,reasoning:'Practice first.',expectedRevision:2});
 state=workflowLab.update(hardwareModel,state,{kind:'start-transfer',expectedRevision:3});
 expect(workflowLab.observe(hardwareModel,state).causal).toBeNull();
 expect(workflowLab.text(hardwareModel,state)).not.toContain('Your first answer:');
 expect(renderToStaticMarkup(createElement(WorkflowLab,{data:hardwareModel,state,onAction:()=>{throw Error('No render action');}}))).not.toContain('Computed workflow explanation');
});

test('disabled and missing rules explain the finite blocking convention without inventing a source rule',()=>{
 let state=workflowLab.initial(hardwareModel);
 state=workflowLab.update(hardwareModel,state,{kind:'set-rule',ruleId:'busy-ack',toStateId:'done',enabled:false,reason:'Try disabling Ack in Busy.',expectedRevision:0});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'idle',blockedCount:2,reasoning:'Ack can be blocked in two different ways.',expectedRevision:1});
 const causal=workflowLab.observe(hardwareModel,state).causal!;
 expect(causal.steps[1].explanation).toContain('rule is disabled in the current model');
 expect(causal.steps[1].evidence[0]).toMatchObject({originalRule:'Busy + Ack → Done (enabled)',classification:'Source-stated rule'});
 expect(causal.steps[3].explanation).toContain('no rule for Idle + Ack');
 expect(causal.steps[3].evidence).toEqual([]);
 expect(causal.steps[3].sourceNote).toContain('finite-model convention, not a claim about the real source');
});

test('starting-state and event edits are identified separately from hypothetical rule changes',()=>{
 let state=workflowLab.initial(hardwareModel);
 state=workflowLab.update(hardwareModel,state,{kind:'set-initial',initialStateId:'busy',reason:'Start partway through the abstraction.',expectedRevision:0});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'idle',blockedCount:2,reasoning:'Test the alternative start.',expectedRevision:1});
 let causal=workflowLab.observe(hardwareModel,state).causal!;
 expect(causal.steps[0].kind).toBe('starting-state');expect(causal.ruleChanges).toEqual([]);
 expect(causal.unchanged).toMatchObject({startingState:false,eventSequence:true,ruleCount:4});
 state=workflowLab.update(hardwareModel,state,{kind:'set-sequence',eventIds:['reset','start'],reason:'Choose different events.',expectedRevision:2});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'busy',blockedCount:0,reasoning:'Reset then Start.',expectedRevision:3});
 causal=workflowLab.observe(hardwareModel,state).causal!;
 expect(causal.steps[0].kind).toBe('event-sequence');expect(causal.unchanged?.eventSequence).toBe(false);expect(causal.unpairedOriginalSteps.map(step=>step.index)).toEqual([3,4]);
});

test('a synthetic challenge cites only exactly matching original rules and keeps its synthetic execution label',()=>{
 let state=workflowLab.initial(hardwareModel);
 state=workflowLab.update(hardwareModel,state,{kind:'set-rule',ruleId:'done-reset',toStateId:'busy',enabled:true,reason:'Change practice before the independent task.',expectedRevision:0});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'done',blockedCount:0,reasoning:'Practice.',expectedRevision:1});
 state=workflowLab.update(hardwareModel,state,{kind:'start-transfer',expectedRevision:2});
 state=workflowLab.update(hardwareModel,state,{kind:'predict',finalStateId:'done',blockedCount:0,reasoning:'First synthetic answer.',expectedRevision:3});
 const causal=workflowLab.observe(hardwareModel,state).causal!;
 expect(causal.scope).toBe('synthetic-transfer');expect(causal.unchanged).toBeNull();expect(causal.ruleChanges).toEqual([]);
 expect(causal.steps[1].evidence[0].citation.location.quote).toBe('Busy + Reset -> Idle');
 expect(causal.steps[1].sourceNote).toContain('not an observed execution');
 const renamed={...hardwareModel,transfer:{...hardwareModel.transfer,states:hardwareModel.transfer.states.map(value=>({...value,label:'Different '+value.label}))}};
 const other=workflowLab.observe(renamed,{...state,basis:renamed.basis}).causal!;
 expect(other.steps.every(step=>step.evidence.length===0)).toBe(true);
});

test('local examples and invalid source contracts never become verified source explanations',()=>{
 let sample=workflowLab.initial(workflowExample);
 sample=workflowLab.update(workflowExample,sample,{kind:'predict',finalStateId:'draft',blockedCount:1,reasoning:'Local sample only.',expectedRevision:0});
 const causal=workflowLab.observe(workflowExample,sample).causal!;
 expect(causal.steps.every(step=>step.evidence.length===0&&step.sourceNote.includes('no reviewed source evidence'))).toBe(true);
 expect(causal.limit).toContain('does not establish HDL timing');
 const contradictory={...hardwareModel,practice:{...hardwareModel.practice,rules:[...hardwareModel.practice.rules,{...hardwareModel.practice.rules[0],id:'contradiction',toStateId:'done'}]}};
 expect(()=>workflowLab.observe(contradictory,workflowLab.initial(hardwareModel))).toThrow(/one rule/i);
 const missing={...hardwareModel,citations:hardwareModel.citations.slice(0,3)};
 expect(()=>workflowLab.observe(missing,workflowLab.initial(hardwareModel))).toThrow(/included citation/);
 expect(()=>workflowLab.parse({...hardwareModel,clockPeriodNs:10})).toThrow();
});

for(const eventIds of [['ack','reset'],['reset','ack'],['reset','reset']]){
 test(`sequence-position comparison does not claim retained Reset was removed after choosing ${eventIds.join(', ')}`,()=>{
  const data:WorkflowData={...hardwareModel,practice:{...hardwareModel.practice,eventIds:['start','ack','reset']}};
  let state=workflowLab.initial(data);
  state=workflowLab.update(data,state,{kind:'set-sequence',eventIds,reason:'Shift or reorder retained events.',expectedRevision:0});
  state=workflowLab.update(data,state,{kind:'predict',finalStateId:'idle',blockedCount:2,reasoning:'Both events block from Idle.',expectedRevision:1});
  state=workflowLab.update(data,state,{kind:'set-mode',mode:'deep',expectedRevision:2});
  const before=JSON.stringify({data,state}),notes=workflowLab.text(data,state);
  const html=renderToStaticMarkup(createElement(WorkflowLab,{data,state,onAction:()=>{throw Error('No inspection action');}}));
  expect(notes).not.toContain('was removed from the chosen');
  expect(html).not.toContain('was removed from the chosen');
  expect(html).not.toContain('Event removed');
  expect(notes).toContain('Original position 3 has no corresponding current position.');
  expect(html).toContain('Original position 3 has no corresponding current position.');
  expect(notes).toContain('Reset may still appear elsewhere in the current sequence.');
  expect(workflowLab.observe(data,state).problem.eventIds).toEqual(eventIds);
  expect(JSON.stringify({data,state})).toBe(before);
 });
}
