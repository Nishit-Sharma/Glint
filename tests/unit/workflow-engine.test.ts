import {expect,test} from 'vitest';
import {workflowExample} from '../../src/learning/workflow-example';
import {workflowLab,type WorkflowCase} from '../../src/learning/workflow-lab';
import {defaultWorkflowExperiment,practiceVariantRules,validateWorkflowExperiment,workflowModel,traceWorkflow,checkWorkflowProperty,compareWorkflowVariants,readWorkflowRepairProposal,type WorkflowExperiment,type WorkflowProperty} from '../../src/learning/workflow-engine';
const input:WorkflowCase={id:'adversarial',title:'Synthetic graph',states:['start','armed','reset','bad'].map(id=>({id,label:id})),events:['a','b','c'].map(id=>({id,label:id})),initialStateId:'start',eventIds:['a'],rules:[{id:'r1',fromStateId:'start',eventId:'a',toStateId:'armed',enabled:true},{id:'r2',fromStateId:'armed',eventId:'b',toStateId:'bad',enabled:true},{id:'r3',fromStateId:'armed',eventId:'a',toStateId:'reset',enabled:true},{id:'r4',fromStateId:'reset',eventId:'b',toStateId:'bad',enabled:true}]};
const follows:WorkflowProperty={id:'history',kind:'never-follows',stateId:'bad',afterStateId:'armed',unlessStateId:'reset'};
function model(experiment:WorkflowExperiment=defaultWorkflowExperiment(input),variant='practice'){return workflowModel(input,validateWorkflowExperiment(input,experiment),variant);}
test('never-follows retains armed history after merging with safe paths, and returns a replayable shortest witness',()=>{
 const exp=defaultWorkflowExperiment(input),m=model({...exp,assumptions:{...exp.assumptions,initialStateIds:['bad','start','reset']}}),r=checkWorkflowProperty(m,follows);
 expect(r.verdict).toBe('violated');expect(r.counterexample?.initialStateId).toBe('start');expect(r.counterexample?.eventIds).toEqual(['a','b']);expect(r.counterexample?.trace.finalStateId).toBe('bad');
});
test('unless resets prior history, later after re-arms it, and initial after is included',()=>{
 const exp=defaultWorkflowExperiment(input),restricted={...exp,assumptions:{...exp.assumptions,allowedEvents:[{stateId:'start',eventIds:['a']},{stateId:'armed',eventIds:['a']},{stateId:'reset',eventIds:['b']},{stateId:'bad',eventIds:[]}]}};
 expect(checkWorkflowProperty(model(restricted),follows).verdict).toBe('none-within-bounds');
 expect(checkWorkflowProperty(model({...exp,assumptions:{...exp.assumptions,initialStateIds:['armed']}}),follows).counterexample?.eventIds).toEqual(['b']);
 const loop={...input,rules:[...input.rules,{id:'rearm',fromStateId:'reset',eventId:'c',toStateId:'armed',enabled:true}]};
 const m=workflowModel(loop,validateWorkflowExperiment(loop,{...exp,assumptions:{...exp.assumptions,initialStateIds:['reset']}}),'practice');
 expect(checkWorkflowProperty(m,follows).counterexample?.eventIds).toEqual(['c','b']);
});
test('unconditional never-follows permits initial target but catches a subsequent armed arrival',()=>{
 const exp=defaultWorkflowExperiment(input),m=model({...exp,assumptions:{...exp.assumptions,initialStateIds:['bad','armed']}});
 expect(checkWorkflowProperty(m,{...follows,unlessStateId:null}).counterexample?.eventIds).toEqual(['b']);
});
test('flags distinguish configurations, failed guards and effects are explained, and ambiguous traces halt',()=>{
 const exp=defaultWorkflowExperiment(input),rules=practiceVariantRules(input).map(r=>r.id==='r1'?{...r,toStateId:'start',sets:[{flagId:'ready',value:true}]}:r.id==='r2'?{...r,fromStateId:'start',guard:[{flagId:'ready',equals:true}]}:r);
 const e={...exp,flags:[{id:'ready',label:'Ready flag',initial:false}],variants:[{id:'guarded',label:'Guarded',origin:'user' as const,note:'Synthetic',rules}]},m=model(e,'guarded');
 expect(traceWorkflow(m,'start',['b','a','b']).steps.map(s=>s.outcome)).toEqual(['guard-failed','applied','applied']);
 expect(checkWorkflowProperty(m,{id:'bad',kind:'never',stateId:'bad'}).counterexample?.eventIds).toEqual(['a','b']);
 const ambiguous=model({...e,variants:[{...e.variants[0],rules:[...rules,{...rules[0],id:'duplicate'}]}]},'guarded'),trace=traceWorkflow(ambiguous,'start',['a','b']);
 expect(trace.haltedAtStep).toBe(1);expect(trace.unrunEventIds).toEqual(['b']);expect(trace.finalStateId).toBe('start');expect(trace.steps[0].candidates).toHaveLength(2);
 expect(checkWorkflowProperty(ambiguous,{id:'det',kind:'deterministic'}).verdict).toBe('violated');
 expect(checkWorkflowProperty(ambiguous,{id:'reach',kind:'reachable',stateId:'bad'}).summary).toContain('ambiguous');
});
test('deduplication merges equivalent state/flags/history rather than enumerating exponential stutter paths',()=>{
 const r=checkWorkflowProperty(model(),{id:'safe',kind:'never',stateId:'start'});expect(r.counterexample?.eventIds).toEqual([]);
 const exp=defaultWorkflowExperiment(input),r2=checkWorkflowProperty(model({...exp,assumptions:{...exp.assumptions,initialStateIds:['bad'],maxDepth:12}}),{id:'reach',kind:'reachable',stateId:'armed'});
 expect(r2.verdict).toBe('not-reached-within-bounds');expect(r2.bounds.stepsExplored).toBe(3);expect(r2.bounds.configurationsVisited).toBe(1);expect(r2.summary).toContain('not prove');
});
test('a witness reached by the last permitted event is not discarded when another branch would exhaust the budget',()=>{
 // Isolate the one-step frontier edge with a smaller internal budget; admission still enforces >=100.
 const m=model(),r=checkWorkflowProperty({...m,experiment:{...m.experiment,assumptions:{...m.experiment.assumptions,budget:1}}},{id:'reach',kind:'reachable',stateId:'armed'});
 expect(r.verdict).toBe('witness-found');expect(r.counterexample?.eventIds).toEqual(['a']);expect(r.bounds.stepsExplored).toBe(1);
});
test('termination checks repeated configurations at each depth and finite runs with no possible next event',()=>{
 const e=defaultWorkflowExperiment(input),terminal:WorkflowProperty={id:'end',kind:'terminates',terminalStateIds:['bad']};
 const r=checkWorkflowProperty(model({...e,assumptions:{...e.assumptions,maxDepth:3}}),terminal);
 expect(r.verdict).toBe('violated');expect(r.counterexample?.eventIds).toHaveLength(3);
 const blocked=checkWorkflowProperty(model({...e,assumptions:{...e.assumptions,allowedEvents:[{stateId:'start',eventIds:[]}]}}),terminal);
 expect(blocked.verdict).toBe('violated');expect(blocked.counterexample?.eventIds).toEqual([]);expect(blocked.summary).toContain('no possible next event');
 expect(checkWorkflowProperty(model({...e,assumptions:{...e.assumptions,initialStateIds:['bad']}}),terminal).verdict).toBe('none-within-bounds');
});
test('dead-end scans obey budget, ignore terminal states and do not call ambiguity a dead end',()=>{
 const e=defaultWorkflowExperiment(input),p:WorkflowProperty={id:'dead',kind:'no-dead-end',terminalStateIds:['bad']};
 const r=checkWorkflowProperty(model(),p);expect(r.verdict).toBe('none-within-bounds');
 const budget=model({...e,assumptions:{...e.assumptions,initialStateIds:['reset']}}),limited=checkWorkflowProperty({...budget,experiment:{...budget.experiment,assumptions:{...budget.experiment.assumptions,budget:1}}},p);
 expect(limited.verdict).toBe('none-within-bounds');expect(limited.bounds.budgetExhausted).toBe(true);expect(limited.bounds.stepsExplored).toBe(1);
 const end=checkWorkflowProperty(model({...e,assumptions:{...e.assumptions,allowedEvents:[{stateId:'start',eventIds:[]}]}}),p);expect(end.verdict).toBe('violated');
});
test('allowed events and explicit ignored pairs affect completeness; manual out-of-assumption traces are disclosed',()=>{
 const e=defaultWorkflowExperiment(input),m=model({...e,assumptions:{...e.assumptions,allowedEvents:input.states.map(s=>({stateId:s.id,eventIds:['c']})),ignored:input.states.map(s=>({stateId:s.id,eventId:'c'}))}});
 expect(checkWorkflowProperty(m,{id:'complete',kind:'complete'}).verdict).toBe('none-within-bounds');
 expect(traceWorkflow(m,'start',['a']).steps[0].outsideAssumptions).toBe(true);
 expect(()=>traceWorkflow(m,'unknown',['a'])).toThrow();expect(()=>traceWorkflow(m,'start',['unknown'])).toThrow();
});
test('variant repair comparison checks fixtures and properties without replacing practice or treating admission as proof',()=>{
 const e=defaultWorkflowExperiment(input),proposal=readWorkflowRepairProposal(input,e,'repair','muse-proposed',JSON.stringify({label:'Proposed repair',note:'Unverified suggestion',rules:practiceVariantRules(input).map(r=>r.id==='r2'?{...r,toStateId:'reset'}:r)}));
 const exp=validateWorkflowExperiment(input,{...e,variants:[proposal],properties:[follows],fixtures:[{id:'f',label:'Unsafe path',initialStateId:'start',eventIds:['a','b'],expectedFinalStateId:'reset'}],comparison:{leftId:'practice',rightId:'repair'}}),c=compareWorkflowVariants(input,exp,'practice','repair');
 expect(c.fixtures[0].divergesAtStep).toBe(2);expect(c.left.fixtures[0].passed).toBe(false);expect(c.right.fixtures[0].passed).toBe(true);expect(c.properties[0].changed).toBe(true);expect(c.right.label).toContain('not a guarantee');expect(input.rules[1].toStateId).toBe('bad');
 for(const value of [{...e,approved:true},{...e,assumptions:{...e.assumptions,budget:1}},{...e,properties:[{...follows,stateId:'unknown'}]},{...e,variants:[{...proposal,id:'practice'}]}])expect(()=>validateWorkflowExperiment(input,value)).toThrow();
 expect(()=>readWorkflowRepairProposal(input,e,'repair','user','{"label":"oops","note":"", "rules":[],"approved":true}')).toThrow();
});
test('bounded monitor agrees with an independent exhaustive path oracle over adversarial finite graphs',()=>{
 let seed=137;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let sample=0;sample<36;sample++){
  const rules=input.states.flatMap(s=>input.events.map(e=>({id:s.id+'-'+e.id,fromStateId:s.id,eventId:e.id,toStateId:input.states[(random()>>>16)%4].id,enabled:random()%5!==0}))),graph={...input,rules},exp={...defaultWorkflowExperiment(graph),assumptions:{...defaultWorkflowExperiment(graph).assumptions,maxDepth:5,initialStateIds:[input.states[(random()>>>16)%4].id]}};
  let paths=[{state:exp.assumptions.initialStateIds[0],armed:exp.assumptions.initialStateIds[0]==='armed',events:[] as string[]}],shortest:number|null=null;
  for(let depth=1;depth<=5&&shortest===null;depth++){
   const next:typeof paths=[];
   for(const p of paths)for(const e of input.events){const rule=rules.find(r=>r.enabled&&r.fromStateId===p.state&&r.eventId===e.id),state=rule?.toStateId??p.state,events=[...p.events,e.id];if(state==='bad'&&p.armed){shortest=depth;break;}next.push({state,armed:state==='reset'?false:state==='armed'?true:p.armed,events});}
   paths=next;
  }
  const result=checkWorkflowProperty(workflowModel(graph,validateWorkflowExperiment(graph,exp),'practice'),follows);
  expect(result.verdict==='violated',`graph ${sample}`).toBe(shortest!==null);if(shortest!==null)expect(result.counterexample?.eventIds.length).toBe(shortest);
 }
});
test('optional persisted experiment keeps legacy states intact and cannot bypass prediction or transfer',()=>{
 const data=workflowExample,initial=workflowLab.initial(data),before=JSON.stringify(initial),exp=defaultWorkflowExperiment(data.practice);
 expect(workflowLab.parseState(data,JSON.parse(before))).toEqual(initial);expect('experiment' in initial).toBe(false);
 expect(()=>workflowLab.update(data,initial,{kind:'set-experiment',experiment:exp,expectedRevision:0})).toThrow(/prediction/);
 const reviewed=workflowLab.update(data,initial,{kind:'predict',finalStateId:'draft',blockedCount:1,reasoning:'Synthetic',expectedRevision:0}),saved=workflowLab.update(data,reviewed,{kind:'set-experiment',experiment:exp,expectedRevision:1});
 expect(workflowLab.parseState(data,JSON.parse(JSON.stringify(saved))).experiment).toEqual(exp);expect(workflowLab.text(data,saved)).toContain('Bounded workflow experiment');expect(workflowLab.text(data,saved)).not.toContain('Available');
 expect(()=>workflowLab.update(data,saved,{kind:'set-experiment',experiment:exp,expectedRevision:1})).toThrow(/changed/);
});
