import {Schema} from 'effect';
import type {WorkflowCase} from './workflow-lab';

/** Deterministic bounded experiments over a saved finite workflow. Nothing here executes a real procedure. */
export const workflowEngineLimits=Object.freeze({flags:3,guardTerms:3,variants:3,variantRules:24,rulesPerPair:4,properties:8,fixtures:8,fixtureSteps:12,maxDepth:12,defaultDepth:6,minBudget:100,maxBudget:50000,defaultBudget:20000,repairCandidates:64,repairEventSteps:200000});
export const PRACTICE_VARIANT_ID='practice';
const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const label=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(160));
const note=Schema.String.pipe(Schema.maxLength(800));
const integer=Schema.Number.pipe(Schema.filter(Number.isSafeInteger));
const GuardTermSchema=Schema.Struct({flagId:id,equals:Schema.Boolean});
const FlagSetSchema=Schema.Struct({flagId:id,value:Schema.Boolean});
export const WorkflowEngineRuleSchema=Schema.Struct({id,fromStateId:id,eventId:id,toStateId:id,enabled:Schema.Boolean,guard:Schema.Array(GuardTermSchema).pipe(Schema.maxItems(workflowEngineLimits.guardTerms)),sets:Schema.Array(FlagSetSchema).pipe(Schema.maxItems(workflowEngineLimits.guardTerms))});
export type WorkflowEngineRule=typeof WorkflowEngineRuleSchema.Type;
const VariantSchema=Schema.Struct({id,label,origin:Schema.Literal('user','muse-proposed'),note,rules:Schema.Array(WorkflowEngineRuleSchema).pipe(Schema.minItems(1),Schema.maxItems(workflowEngineLimits.variantRules))});
export type WorkflowVariant=typeof VariantSchema.Type;
const terminal=Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(8));
export const WorkflowPropertySchema=Schema.Union(
 Schema.Struct({id,kind:Schema.Literal('reachable'),stateId:id}),
 Schema.Struct({id,kind:Schema.Literal('never'),stateId:id}),
 Schema.Struct({id,kind:Schema.Literal('never-follows'),stateId:id,afterStateId:id,unlessStateId:Schema.NullOr(id)}),
 Schema.Struct({id,kind:Schema.Literal('deterministic')}),
 Schema.Struct({id,kind:Schema.Literal('complete')}),
 Schema.Struct({id,kind:Schema.Literal('no-dead-end'),terminalStateIds:terminal}),
 Schema.Struct({id,kind:Schema.Literal('terminates'),terminalStateIds:terminal}),
);
export type WorkflowProperty=typeof WorkflowPropertySchema.Type;
const FixtureSchema=Schema.Struct({id,label,initialStateId:id,eventIds:Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(workflowEngineLimits.fixtureSteps)),expectedFinalStateId:Schema.NullOr(id)});
export type WorkflowFixture=typeof FixtureSchema.Type;
const AssumptionsSchema=Schema.Struct({
 initialStateIds:Schema.Array(id).pipe(Schema.minItems(1),Schema.maxItems(8)),
 maxDepth:integer.pipe(Schema.between(1,workflowEngineLimits.maxDepth)),
 budget:integer.pipe(Schema.between(workflowEngineLimits.minBudget,workflowEngineLimits.maxBudget)),
 allowedEvents:Schema.Array(Schema.Struct({stateId:id,eventIds:Schema.Array(id).pipe(Schema.maxItems(8))})).pipe(Schema.maxItems(8)),
 ignored:Schema.Array(Schema.Struct({stateId:id,eventId:id})).pipe(Schema.maxItems(64)),
});
export type WorkflowAssumptions=typeof AssumptionsSchema.Type;
export const WorkflowExperimentSchema=Schema.Struct({
 schemaVersion:Schema.Literal(1),assumptions:AssumptionsSchema,
 flags:Schema.Array(Schema.Struct({id,label,initial:Schema.Boolean})).pipe(Schema.maxItems(workflowEngineLimits.flags)),
 variants:Schema.Array(VariantSchema).pipe(Schema.maxItems(workflowEngineLimits.variants)),
 properties:Schema.Array(WorkflowPropertySchema).pipe(Schema.maxItems(workflowEngineLimits.properties)),
 fixtures:Schema.Array(FixtureSchema).pipe(Schema.maxItems(workflowEngineLimits.fixtures)),
 comparison:Schema.NullOr(Schema.Struct({leftId:id,rightId:id})),
});
export type WorkflowExperiment=typeof WorkflowExperimentSchema.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
function unique(values:readonly string[],message:string){if(new Set(values).size!==values.length)throw Error(message);}

export function defaultWorkflowExperiment(input:WorkflowCase):WorkflowExperiment{
 return {schemaVersion:1,assumptions:{initialStateIds:[input.initialStateId],maxDepth:workflowEngineLimits.defaultDepth,budget:workflowEngineLimits.defaultBudget,allowedEvents:[],ignored:[]},flags:[],variants:[],properties:[],fixtures:[],comparison:null};
}
export function practiceVariantRules(input:WorkflowCase):WorkflowEngineRule[]{
 return input.rules.map(rule=>({...rule,guard:[],sets:[]}));
}
export function validateWorkflowExperiment(input:WorkflowCase,value:unknown):WorkflowExperiment{
 const experiment=decode(WorkflowExperimentSchema,value);
 const states=new Set(input.states.map(s=>s.id)),events=new Set(input.events.map(e=>e.id)),flags=new Set(experiment.flags.map(f=>f.id));
 const state=(stateId:string)=>{if(!states.has(stateId))throw Error('Experiment states must belong to this workflow.');};
 const event=(eventId:string)=>{if(!events.has(eventId))throw Error('Experiment events must belong to this workflow.');};
 const {assumptions}=experiment;
 unique(assumptions.initialStateIds,'Each initial state is listed once.');assumptions.initialStateIds.forEach(state);
 unique(assumptions.allowedEvents.map(a=>a.stateId),'Each state lists its possible events once.');
 for(const allowed of assumptions.allowedEvents){state(allowed.stateId);unique(allowed.eventIds,'Each possible event is listed once per state.');allowed.eventIds.forEach(event);}
 unique(assumptions.ignored.map(i=>i.stateId+':'+i.eventId),'Each ignored state and event pair is listed once.');
 for(const ignored of assumptions.ignored){state(ignored.stateId);event(ignored.eventId);}
 unique(experiment.flags.map(f=>f.id),'Flag identities must be unique.');
 unique(experiment.variants.map(v=>v.id),'Variant identities must be unique.');
 if(experiment.variants.some(v=>v.id===PRACTICE_VARIANT_ID))throw Error('The practice variant is reserved for the current practice rules.');
 for(const variant of experiment.variants){
  unique(variant.rules.map(r=>r.id),'Variant rule identities must be unique.');
  for(const rule of variant.rules){
   state(rule.fromStateId);state(rule.toStateId);event(rule.eventId);
   if(rule.guard.some(t=>!flags.has(t.flagId))||rule.sets.some(t=>!flags.has(t.flagId)))throw Error('Rule guards and effects must use declared flags.');
   unique(rule.guard.map(t=>t.flagId),'A guard tests each flag once.');unique(rule.sets.map(t=>t.flagId),'A rule sets each flag once.');
  }
  const pairs=new Map<string,number>();for(const rule of variant.rules)pairs.set(rule.fromStateId+':'+rule.eventId,(pairs.get(rule.fromStateId+':'+rule.eventId)??0)+1);
  if([...pairs.values()].some(count=>count>workflowEngineLimits.rulesPerPair))throw Error(`A state and event can have at most ${workflowEngineLimits.rulesPerPair} candidate rules.`);
 }
 unique(experiment.properties.map(p=>p.id),'Property identities must be unique.');
 for(const property of experiment.properties){
  switch(property.kind){
   case 'reachable':case 'never':state(property.stateId);break;
   case 'never-follows':state(property.stateId);state(property.afterStateId);if(property.unlessStateId!==null)state(property.unlessStateId);if(new Set([property.stateId,property.afterStateId,property.unlessStateId]).size!==3)throw Error('A follows property needs three different states.');break;
   case 'deterministic':case 'complete':break;
   case 'no-dead-end':case 'terminates':unique(property.terminalStateIds,'Each terminal state is listed once.');property.terminalStateIds.forEach(state);break;
   default:{const never:never=property;throw Error(`Unknown property ${String(never)}`);}
  }
 }
 unique(experiment.fixtures.map(f=>f.id),'Fixture identities must be unique.');
 for(const fixture of experiment.fixtures){state(fixture.initialStateId);fixture.eventIds.forEach(event);if(fixture.expectedFinalStateId!==null)state(fixture.expectedFinalStateId);}
 const variantIds=new Set([PRACTICE_VARIANT_ID,...experiment.variants.map(v=>v.id)]);
 if(experiment.comparison&&(!variantIds.has(experiment.comparison.leftId)||!variantIds.has(experiment.comparison.rightId)||experiment.comparison.leftId===experiment.comparison.rightId))throw Error('Compare two different saved variants.');
 return experiment;
}

export type WorkflowModel={readonly input:WorkflowCase;readonly experiment:WorkflowExperiment;readonly variantId:string;readonly variantLabel:string;readonly rules:readonly WorkflowEngineRule[]};
export function workflowVariants(input:WorkflowCase,experiment:WorkflowExperiment):WorkflowModel[]{
 return [{input,experiment,variantId:PRACTICE_VARIANT_ID,variantLabel:'Current practice rules',rules:practiceVariantRules(input)},...experiment.variants.map(v=>({input,experiment,variantId:v.id,variantLabel:v.label,rules:v.rules}))];
}
export function workflowModel(input:WorkflowCase,experiment:WorkflowExperiment,variantId:string):WorkflowModel{
 const model=workflowVariants(input,experiment).find(m=>m.variantId===variantId);
 if(!model)throw Error('Choose a saved variant.');
 return model;
}

type Flags=Readonly<Record<string,boolean>>;
const stateLabel=(input:WorkflowCase,stateId:string)=>input.states.find(s=>s.id===stateId)?.label??stateId;
const eventLabel=(input:WorkflowCase,eventId:string)=>input.events.find(e=>e.id===eventId)?.label??eventId;
function initialFlags(experiment:WorkflowExperiment):Flags{return Object.fromEntries(experiment.flags.map(f=>[f.id,f.initial]));}
export function eventPossible(experiment:WorkflowExperiment,stateId:string,eventId:string){const allowed=experiment.assumptions.allowedEvents.find(a=>a.stateId===stateId);return !allowed||allowed.eventIds.includes(eventId);}
function possibleEvents(model:WorkflowModel,stateId:string){return model.input.events.map(e=>e.id).filter(eventId=>eventPossible(model.experiment,stateId,eventId));}
const ignoredPair=(experiment:WorkflowExperiment,stateId:string,eventId:string)=>experiment.assumptions.ignored.some(i=>i.stateId===stateId&&i.eventId===eventId);

export type GuardTermResult={readonly flagId:string;readonly flagLabel:string;readonly expected:boolean;readonly actual:boolean;readonly passed:boolean};
export type RuleCandidate={readonly ruleId:string;readonly toStateId:string;readonly toStateLabel:string;readonly enabled:boolean;readonly guard:readonly GuardTermResult[];readonly matched:boolean};
export type StepOutcome='applied'|'no-rule'|'guard-failed'|'ignored'|'ambiguous';
export type TraceStep={readonly index:number;readonly eventId:string;readonly eventLabel:string;readonly beforeStateId:string;readonly beforeStateLabel:string;readonly beforeFlags:Flags;readonly candidates:readonly RuleCandidate[];readonly matchedRuleIds:readonly string[];readonly outcome:StepOutcome;readonly afterStateId:string;readonly afterStateLabel:string;readonly afterFlags:Flags;readonly outsideAssumptions:boolean;readonly explanation:string};
export type WorkflowTrace={readonly origin:'deterministic';readonly variantId:string;readonly initialStateId:string;readonly steps:readonly TraceStep[];readonly finalStateId:string;readonly finalStateLabel:string;readonly finalFlags:Flags;readonly haltedAtStep:number|null;readonly unrunEventIds:readonly string[]};

function flagText(model:WorkflowModel,flags:Flags){return model.experiment.flags.length?' ['+model.experiment.flags.map(f=>`${f.label}=${flags[f.id]?'yes':'no'}`).join(', ')+']':'';}
function step(model:WorkflowModel,stateId:string,flags:Flags,eventId:string,index:number):TraceStep{
 const {input,experiment}=model,flagLabel=(flagId:string)=>experiment.flags.find(f=>f.id===flagId)?.label??flagId;
 const candidates=model.rules.filter(r=>r.fromStateId===stateId&&r.eventId===eventId).map((rule):RuleCandidate=>{
  const guard=rule.guard.map(term=>({flagId:term.flagId,flagLabel:flagLabel(term.flagId),expected:term.equals,actual:flags[term.flagId]??false,passed:(flags[term.flagId]??false)===term.equals}));
  return {ruleId:rule.id,toStateId:rule.toStateId,toStateLabel:stateLabel(input,rule.toStateId),enabled:rule.enabled,guard,matched:rule.enabled&&guard.every(t=>t.passed)};
 });
 const matched=candidates.filter(c=>c.matched),enabled=candidates.filter(c=>c.enabled),ignored=ignoredPair(experiment,stateId,eventId);
 const outcome:StepOutcome=matched.length>1?'ambiguous':matched.length===1?'applied':ignored?'ignored':enabled.length?'guard-failed':'no-rule';
 let afterStateId=stateId,afterFlags=flags;
 if(outcome==='applied'){const rule=model.rules.find(r=>r.id===matched[0].ruleId)!;afterStateId=rule.toStateId;afterFlags={...flags,...Object.fromEntries(rule.sets.map(s=>[s.flagId,s.value]))};}
 const before=stateLabel(input,stateId),event=eventLabel(input,eventId),after=stateLabel(input,afterStateId);
 const explanation=outcome==='applied'?`Rule ${matched[0].ruleId} matched; ${before} → ${after}.`:outcome==='ambiguous'?`Ambiguous: ${matched.length} rules matched (${matched.map(m=>m.ruleId).join(', ')}). The model has no deterministic next state, so the trace stops here.`:outcome==='ignored'?`${event} is explicitly ignored in ${before}; the state stays ${before}.`:outcome==='guard-failed'?`No rule matched: ${enabled.length} enabled rule(s) exist for ${before} + ${event}, but every guard was false. The state stays ${before}.`:`No rule matched: there is no enabled rule for ${before} + ${event}. The state stays ${before}.`;
 return {index,eventId,eventLabel:event,beforeStateId:stateId,beforeStateLabel:before,beforeFlags:flags,candidates,matchedRuleIds:matched.map(m=>m.ruleId),outcome,afterStateId,afterStateLabel:after,afterFlags,outsideAssumptions:!eventPossible(experiment,stateId,eventId),explanation};
}
export function traceWorkflow(model:WorkflowModel,initialStateId:string,eventIds:readonly string[]):WorkflowTrace{
 if(!model.input.states.some(s=>s.id===initialStateId)||eventIds.length>workflowEngineLimits.fixtureSteps||eventIds.some(id=>!model.input.events.some(e=>e.id===id)))throw Error('A trace needs a declared starting state and at most 12 declared events.');
 let stateId=initialStateId,flags=initialFlags(model.experiment),haltedAtStep:number|null=null;const steps:TraceStep[]=[];
 for(const [offset,eventId] of eventIds.entries()){
  const next=step(model,stateId,flags,eventId,offset+1);steps.push(next);
  if(next.outcome==='ambiguous'){haltedAtStep=next.index;break;}
  stateId=next.afterStateId;flags=next.afterFlags;
 }
 return {origin:'deterministic',variantId:model.variantId,initialStateId,steps,finalStateId:stateId,finalStateLabel:stateLabel(model.input,stateId),finalFlags:flags,haltedAtStep,unrunEventIds:haltedAtStep===null?[]:eventIds.slice(haltedAtStep)};
}

type Node={readonly stateId:string;readonly flags:Flags;readonly phase:number;readonly initialStateId:string;readonly parent:Node|null;readonly eventId:string|null;readonly depth:number};
export type PropertyVerdict='violated'|'witness-found'|'none-within-bounds'|'not-reached-within-bounds';
export type PropertyResult={readonly propertyId:string;readonly description:string;readonly verdict:PropertyVerdict;readonly counterexample:{readonly initialStateId:string;readonly eventIds:readonly string[];readonly trace:WorkflowTrace;readonly reason:string}|null;readonly bounds:{readonly maxDepth:number;readonly completedDepth:number;readonly budget:number;readonly stepsExplored:number;readonly configurationsVisited:number;readonly budgetExhausted:boolean;readonly ambiguousStops:number};readonly summary:string};
export function describeProperty(input:WorkflowCase,property:WorkflowProperty):string{
 const s=(stateId:string)=>stateLabel(input,stateId);
 switch(property.kind){
  case 'reachable':return `${s(property.stateId)} is reachable`;
  case 'never':return `Never reach ${s(property.stateId)}`;
  case 'never-follows':return property.unlessStateId===null?`${s(property.stateId)} never follows ${s(property.afterStateId)}`:`${s(property.stateId)} never follows ${s(property.afterStateId)} without ${s(property.unlessStateId)} in between`;
  case 'deterministic':return 'Deterministic: no event matches more than one rule';
  case 'complete':return 'Complete: every possible event is handled or explicitly ignored';
  case 'no-dead-end':return `An enabled rule remains possible outside ${property.terminalStateIds.map(s).join(', ')}`;
  case 'terminates':return `Every run reaches ${property.terminalStateIds.map(s).join(' or ')} within the depth bound`;
  default:{const never:never=property;return String(never);}
 }
}
const flagKey=(model:WorkflowModel,flags:Flags)=>model.experiment.flags.map(f=>flags[f.id]?'1':'0').join('');
function phaseAfterEntering(property:WorkflowProperty,phase:number,stateId:string){
 // Violation is path state too; merging an armed arrival with a safe arrival loses witnesses.
 if(property.kind==='never-follows'){if(phase===2)return 2;if(stateId===property.stateId&&phase===1)return 2;if(stateId===property.unlessStateId)return 0;if(stateId===property.afterStateId)return 1;return phase;}
 if(property.kind==='terminates')return phase||Number(property.terminalStateIds.includes(stateId));
 return 0;
}
function path(node:Node){const events:string[]=[];for(let current:Node|null=node;current?.eventId;current=current.parent)events.unshift(current.eventId);return events;}

/** Layered breadth-first exploration: every configuration reached by some event sequence of length k is in layer k. */
export function checkWorkflowProperty(model:WorkflowModel,property:WorkflowProperty):PropertyResult{
 const {maxDepth,budget,initialStateIds}=model.experiment.assumptions,description=describeProperty(model.input,property);
 let stepsExplored=0,configurationsVisited=0,completedDepth=0,ambiguousStops=0,budgetExhausted=false;
 const finish=(verdict:PropertyVerdict,found:{node:Node;extra?:string;reason:string}|null):PropertyResult=>{
  const bounds={maxDepth,completedDepth,budget,stepsExplored,configurationsVisited,budgetExhausted,ambiguousStops};
  const eventIds=found?[...path(found.node),...(found.extra?[found.extra]:[])]:[];
  const counterexample=found?{initialStateId:found.node.initialStateId,eventIds,trace:traceWorkflow(model,found.node.initialStateId,eventIds),reason:found.reason}:null;
  const scope=`depth ${completedDepth}${budgetExhausted?` of ${maxDepth} (step budget ${budget} exhausted)`:''}; ${stepsExplored} event steps explored over ${configurationsVisited} visited configurations (equivalent state, flags and property history are merged)`;
  const ambiguity=ambiguousStops?` ${ambiguousStops} ambiguous step(s) stopped their sequences and were not extended.`:'';
  const length=counterexample?.eventIds.length??0;
  const summary=verdict==='violated'?`Violated. Shortest counterexample (${length} event${length===1?'':'s'}): ${counterexample!.reason}`:verdict==='witness-found'?`Witness found: reached after ${length} event${length===1?'':'s'}.`:verdict==='not-reached-within-bounds'?`Not reached up to ${scope}. This does not prove it is unreachable with longer sequences.${ambiguity}`:`No violation found up to ${scope}; not a proof for longer sequences.${ambiguity}`;
  return {propertyId:property.id,description,verdict,counterexample,bounds,summary:verdict==='violated'||verdict==='witness-found'?`${summary} Assumptions: ${assumptionText(model)}`:summary};
 };
 const configuration=(node:Node)=>`${node.stateId}|${flagKey(model,node.flags)}|${node.phase}`;
 const inspect=(node:Node):PropertyResult|null=>{
  const name=stateLabel(model.input,node.stateId);
  if(property.kind==='reachable'&&node.stateId===property.stateId)return finish('witness-found',{node,reason:`reaches ${name}.`});
  if(property.kind==='never'&&node.stateId===property.stateId)return finish('violated',{node,reason:`reaches ${name}.`});
  if(property.kind==='never-follows'&&node.phase===2)return finish('violated',{node,reason:`reaches ${name} after ${stateLabel(model.input,property.afterStateId)}${property.unlessStateId?` without passing ${stateLabel(model.input,property.unlessStateId)}`:''}.`});
  if(property.kind==='terminates'&&node.phase===0&&(node.depth===maxDepth||possibleEvents(model,node.stateId).length===0))return finish('violated',{node,reason:`The run ${node.depth===maxDepth?'reaches the depth bound':'has no possible next event'} in ${name} without reaching ${property.terminalStateIds.map(s=>stateLabel(model.input,s)).join(' or ')}.`});
  return null;
 };
 let layer:Node[]=[];
 const seen=new Set<string>();
 for(const stateId of initialStateIds){const flags=initialFlags(model.experiment),node:Node={stateId,flags,phase:phaseAfterEntering(property,0,stateId),initialStateId:stateId,parent:null,eventId:null,depth:0},key=configuration(node);if(!seen.has(key)){seen.add(key);layer.push(node);}}
 for(let depth=0;layer.length&&depth<=maxDepth;depth++){
  configurationsVisited+=layer.length;
  for(const node of layer){const found=inspect(node);if(found)return found;}
  const next:Node[]=[],nextSeen=property.kind==='terminates'?new Set<string>():seen;
  for(const node of layer){
   if(property.kind==='terminates'&&node.phase===1)continue;
   if(depth===maxDepth&&property.kind!=='no-dead-end')continue;
   let applied=false,ambiguous=false;
   for(const eventId of possibleEvents(model,node.stateId)){
    if(stepsExplored>=budget){budgetExhausted=true;break;}
    stepsExplored++;
    const result=step(model,node.stateId,node.flags,eventId,depth+1);
    if(result.outcome==='ambiguous'){
     if(property.kind==='deterministic')return finish('violated',{node,extra:eventId,reason:`${result.eventLabel} in ${result.beforeStateLabel} matches ${result.matchedRuleIds.length} rules (${result.matchedRuleIds.join(', ')}).`});
     ambiguousStops++;ambiguous=true;continue;
    }
    applied ||= result.outcome==='applied';
    if(property.kind==='complete'&&(result.outcome==='no-rule'||result.outcome==='guard-failed'))return finish('violated',{node,extra:eventId,reason:`${result.eventLabel} can occur in ${result.beforeStateLabel} but no rule matched and it is not explicitly ignored.`});
    if(depth===maxDepth)continue;
    const child:Node={stateId:result.afterStateId,flags:result.afterFlags,phase:phaseAfterEntering(property,node.phase,result.afterStateId),initialStateId:node.initialStateId,parent:node,eventId,depth:depth+1};
    // Inspect before a later branch can exhaust the budget and discard this frontier.
    const found=inspect(child);if(found)return found;
    const key=configuration(child);
    if(nextSeen.has(key))continue;
    nextSeen.add(key);next.push(child);
   }
   if(budgetExhausted)break;
   if(property.kind==='no-dead-end'&&!property.terminalStateIds.includes(node.stateId)&&!applied&&!ambiguous)return finish('violated',{node,reason:`${stateLabel(model.input,node.stateId)} is not terminal and no possible event applies an enabled rule. Explicitly ignored events only preserve the state.`});
  }
  if(budgetExhausted)break;
  completedDepth=Math.min(depth+1,maxDepth);
  layer=next;
 }
 return finish(property.kind==='reachable'?'not-reached-within-bounds':'none-within-bounds',null);
}
export function assumptionText(model:WorkflowModel):string{
 const {input,experiment}=model,a=experiment.assumptions,s=(stateId:string)=>stateLabel(input,stateId),e=(eventId:string)=>eventLabel(input,eventId);
 const possible=a.allowedEvents.length?a.allowedEvents.map(x=>`${s(x.stateId)}: ${x.eventIds.map(e).join(', ')||'no events'}`).join('; ')+'; other states: every event':'every event can occur in every state';
 const flags=experiment.flags.length?experiment.flags.map(f=>`${f.label} starts ${f.initial?'yes':'no'}`).join(', '):'no flags';
 return `variant ${model.variantLabel}; start in ${a.initialStateIds.map(s).join(' or ')}; ${flags}; possible events: ${possible}; explicitly ignored: ${a.ignored.map(i=>`${s(i.stateId)} + ${e(i.eventId)}`).join(', ')||'none'}; maximum depth ${a.maxDepth}; step budget ${a.budget}.`;
}
export function checkWorkflowProperties(model:WorkflowModel):PropertyResult[]{return model.experiment.properties.map(p=>checkWorkflowProperty(model,p));}

export type FixtureResult={readonly fixtureId:string;readonly label:string;readonly trace:WorkflowTrace;readonly expectedFinalStateId:string|null;readonly passed:boolean|null};
export function runWorkflowFixture(model:WorkflowModel,fixture:WorkflowFixture):FixtureResult{
 const trace=traceWorkflow(model,fixture.initialStateId,fixture.eventIds);
 return {fixtureId:fixture.id,label:fixture.label,trace,expectedFinalStateId:fixture.expectedFinalStateId,passed:fixture.expectedFinalStateId===null?null:trace.haltedAtStep===null&&trace.finalStateId===fixture.expectedFinalStateId};
}
const stepKey=(s:TraceStep)=>JSON.stringify([s.outcome,s.afterStateId,s.afterFlags]);
export function firstDivergence(left:WorkflowTrace,right:WorkflowTrace):number|null{
 for(let index=0;index<Math.max(left.steps.length,right.steps.length);index++){const a=left.steps[index],b=right.steps[index];if(!a||!b||stepKey(a)!==stepKey(b))return index+1;}
 return null;
}
export type VariantCheck={readonly variantId:string;readonly variantLabel:string;readonly fixtures:readonly FixtureResult[];readonly properties:readonly PropertyResult[];readonly label:string};
export function checkWorkflowVariant(model:WorkflowModel):VariantCheck{
 const fixtures=model.experiment.fixtures.map(f=>runWorkflowFixture(model,f)),properties=checkWorkflowProperties(model);
 const expected=fixtures.filter(f=>f.passed!==null),passed=expected.filter(f=>f.passed).length,violated=properties.filter(p=>p.verdict==='violated'),notReached=properties.filter(p=>p.verdict==='not-reached-within-bounds'),clean=properties.length-violated.length-notReached.length;
 const depth=model.experiment.assumptions.maxDepth;
 const label=`${model.variantLabel}: ${expected.length?`${passed} of ${expected.length} fixture sequence(s) reached their expected final state`:'no fixture has an expected final state'}${fixtures.length>expected.length?` (${fixtures.length-expected.length} fixture(s) without expectations were traced only)`:''}. ${properties.length?`Properties within depth ${depth}: ${clean} reached or no violation found, ${violated.length} violated${notReached.length?`, ${notReached.length} not reached`:''}.`:'No properties stated.'} Only these listed fixtures and bounded checks were run; this is not a guarantee for other sequences.`;
 return {variantId:model.variantId,variantLabel:model.variantLabel,fixtures,properties,label};
}
export type VariantComparison={readonly left:VariantCheck;readonly right:VariantCheck;readonly fixtures:readonly {readonly fixtureId:string;readonly label:string;readonly left:FixtureResult;readonly right:FixtureResult;readonly divergesAtStep:number|null}[];readonly properties:readonly {readonly propertyId:string;readonly description:string;readonly left:PropertyResult;readonly right:PropertyResult;readonly changed:boolean}[]};
export function compareWorkflowVariants(input:WorkflowCase,experiment:WorkflowExperiment,leftId:string,rightId:string):VariantComparison{
 const left=checkWorkflowVariant(workflowModel(input,experiment,leftId)),right=checkWorkflowVariant(workflowModel(input,experiment,rightId));
 return {left,right,
  fixtures:left.fixtures.map((l,index)=>{const r=right.fixtures[index];return {fixtureId:l.fixtureId,label:l.label,left:l,right:r,divergesAtStep:firstDivergence(l.trace,r.trace)};}),
  properties:left.properties.map((l,index)=>{const r=right.properties[index];return {propertyId:l.propertyId,description:l.description,left:l,right:r,changed:l.verdict!==r.verdict};}),
 };
}

const ProposalSchema=Schema.Struct({label,note,rules:VariantSchema.fields.rules});
/** Parses a pasted proposed rule set (for example a Muse suggestion). Admission only validates shape; checks still decide what passed. */
export function readWorkflowRepairProposal(input:WorkflowCase,experiment:WorkflowExperiment,variantId:string,origin:WorkflowVariant['origin'],text:string):WorkflowVariant{
 let value:unknown;
 try{value=JSON.parse(text);}catch{throw Error('The proposal must be JSON with label, note and rules.');}
 const proposal=decode(ProposalSchema,value),variant:WorkflowVariant={id:variantId,origin,...proposal};
 validateWorkflowExperiment(input,{...experiment,variants:[...experiment.variants.filter(v=>v.id!==variantId),variant],comparison:null});
 return variant;
}

export function workflowRepairGoals(input:WorkflowCase,experiment:WorkflowExperiment){
 return [...experiment.properties.map(property=>({id:'property:'+property.id,label:describeProperty(input,property)})),...experiment.fixtures.filter(fixture=>fixture.expectedFinalStateId!==null).map(fixture=>({id:'fixture:'+fixture.id,label:`${fixture.label}: finish in ${stateLabel(input,fixture.expectedFinalStateId!)}`}))];
}
type RepairStatus='found'|'already-satisfied'|'exhausted'|'candidate-limit'|'event-limit';
export type WorkflowRepairSearch={readonly status:RepairStatus;readonly goal:string;readonly candidatesChecked:number;readonly candidatesAvailable:number;readonly eventSteps:number;readonly inconclusiveCandidates:number;readonly baselineInconclusive:boolean;readonly baseline:VariantCheck|null;readonly check:VariantCheck|null;readonly variant:WorkflowVariant|null;readonly change:{readonly before:WorkflowEngineRule;readonly after:WorkflowEngineRule}|null};
function propertySatisfied(experiment:WorkflowExperiment,result:PropertyResult){
 return !result.bounds.budgetExhausted&&!result.bounds.ambiguousStops&&(experiment.properties.find(property=>property.id===result.propertyId)?.kind==='reachable'?result.verdict==='witness-found':result.verdict==='none-within-bounds');
}
/** Search only one existing rule's destination or enabled bit. Proposed rules
 * remain hypothetical; passing all declared checks is bounded evidence only. */
export function findWorkflowRepair(input:WorkflowCase,raw:WorkflowExperiment,goalId:string,variantId:string):WorkflowRepairSearch{
 const experiment=validateWorkflowExperiment(input,raw),goal=workflowRepairGoals(input,experiment).find(goal=>goal.id===goalId);if(!goal)throw Error('Choose a saved property or a sequence test with an expected final state.');
 if(experiment.variants.length>=workflowEngineLimits.variants)throw Error('Remove a saved alternative before searching for another.');
 const rules=practiceVariantRules(input),candidates=rules.flatMap(before=>[...input.states.filter(state=>state.id!==before.toStateId).map(state=>({before,after:{...before,toStateId:state.id}})),{before,after:{...before,enabled:!before.enabled}}]);
 let candidatesChecked=0,eventSteps=0,inconclusiveCandidates=0,baseline:VariantCheck|null=null;
 const inconclusive=(check:VariantCheck)=>check.properties.some(result=>result.bounds.budgetExhausted||result.bounds.ambiguousStops>0)||check.fixtures.some(result=>result.trace.haltedAtStep!==null);
 const allChecksPass=(check:VariantCheck)=>check.properties.every(result=>propertySatisfied(experiment,result))&&check.fixtures.every(result=>result.trace.haltedAtStep===null&&result.passed!==false);
 const finish=(status:RepairStatus,variant:WorkflowVariant|null=null,check:VariantCheck|null=null,change:WorkflowRepairSearch['change']=null):WorkflowRepairSearch=>({status,goal:goal.label,candidatesChecked,candidatesAvailable:candidates.length,eventSteps,inconclusiveCandidates,baselineInconclusive:baseline?inconclusive(baseline):false,baseline,variant,check,change});
 // Reserve the worst-case cost before each complete check; actual work is charged
 // afterward. Bounds/fixtures are never reduced to fit the remaining allowance.
 const reservation=experiment.properties.length*(experiment.assumptions.budget+workflowEngineLimits.fixtureSteps)+experiment.fixtures.reduce((sum,fixture)=>sum+fixture.eventIds.length,0);
 const evaluate=(model:WorkflowModel)=>{if(eventSteps+reservation>workflowEngineLimits.repairEventSteps)return null;const check=checkWorkflowVariant(model);eventSteps+=check.properties.reduce((sum,result)=>sum+result.bounds.stepsExplored+(result.counterexample?.trace.steps.length??0),0)+check.fixtures.reduce((sum,result)=>sum+result.trace.steps.length,0);return check;};
 const meetsGoal=(check:VariantCheck)=>check.properties.some(result=>goalId==='property:'+result.propertyId&&propertySatisfied(experiment,result))||check.fixtures.some(result=>goalId==='fixture:'+result.fixtureId&&result.passed===true);
 baseline=evaluate(workflowModel(input,experiment,PRACTICE_VARIANT_ID));if(!baseline)return finish('event-limit');if(meetsGoal(baseline)&&allChecksPass(baseline))return finish('already-satisfied');
 for(const change of candidates){
  if(candidatesChecked===workflowEngineLimits.repairCandidates)return finish('candidate-limit');
  const variant:WorkflowVariant={id:variantId,label:'Local goal candidate',origin:'user',note:`Generated locally for saved goal ${goalId}: ${goal.label.slice(0,300)}${goal.label.length>300?'…':''}. Single-rule search; all saved checks must pass within their bounds.`,rules:rules.map(rule=>rule.id===change.before.id?change.after:rule)};
  const proposed=validateWorkflowExperiment(input,{...experiment,variants:[...experiment.variants,variant]}),check=evaluate(workflowModel(input,proposed,variantId));if(!check)return finish('event-limit');candidatesChecked++;if(inconclusive(check))inconclusiveCandidates++;
  if(meetsGoal(check)&&allChecksPass(check))return finish('found',{...variant,note:`${variant.note} Checked ${candidatesChecked} candidate(s), ${eventSteps} total event steps. Search limits ${workflowEngineLimits.repairCandidates} candidates/${workflowEngineLimits.repairEventSteps} event steps; no guarantee beyond saved fixtures/depth.`},check,change);
 }
 return finish('exhausted');
}

export function workflowExperimentText(input:WorkflowCase,experiment:WorkflowExperiment):string{
 const s=(stateId:string)=>stateLabel(input,stateId),e=(eventId:string)=>eventLabel(input,eventId);
 const traceText=(trace:WorkflowTrace)=>trace.steps.map(t=>`  ${t.index}. ${t.eventLabel}: ${t.beforeStateLabel} → ${t.afterStateLabel} (${t.outcome})`).join('\n');
 const variants=workflowVariants(input,experiment).map(model=>{
  const check=checkWorkflowVariant(model);
  return `Variant ${model.variantLabel}${model.variantId===PRACTICE_VARIANT_ID?'':` (${experiment.variants.find(v=>v.id===model.variantId)!.origin==='muse-proposed'?'Muse-proposed, unverified':'user-proposed'})`}\n${model.variantId===PRACTICE_VARIANT_ID?'':`Proposal note: ${experiment.variants.find(v=>v.id===model.variantId)!.note}\n`}Assumptions: ${assumptionText(model)}\n${check.fixtures.map(f=>`Fixture ${f.label}: final ${f.trace.finalStateLabel}${f.expectedFinalStateId?` (expected ${s(f.expectedFinalStateId)}: ${f.passed?'passed':'failed'})`:''}${f.trace.haltedAtStep?`; stopped at ambiguous step ${f.trace.haltedAtStep}`:''}`).join('\n')}\n${check.properties.map(p=>`${p.description}: ${p.summary}${p.counterexample?`\n  Start ${s(p.counterexample.initialStateId)}; events ${p.counterexample.eventIds.map(e).join(' → ')||'(none)'}\n${traceText(p.counterexample.trace)}`:''}`).join('\n')}\n${check.label}`;
 });
 return `Bounded workflow experiment (computed; not a proof beyond the stated bounds)\n${variants.join('\n\n')}`;
}
