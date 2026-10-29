import {Schema} from 'effect';
import {pickingHelper,pickingDefinition,pickingContext,contextTable,recordingStep,nextPickingDefinition,attemptPayload,PickingOwnerSchema,observationPayload,type PickingOwner,type PickingState,type PickingObservation,type PickingAction} from '../learning/picking-helper';
import {parseTableSnapshot,parseTableRequest,runTableProcedure,type TableProcedureV2} from '../learning/semantic-table-procedure';
import type {SemanticStep} from '../learning/semantic-procedure';
import {pickingCanonical,pickingDigest} from '../shared/picking-digest';

/** Only module-state supplies this owner after rereading the actual task/artifact.
 * No renderer field can supply a receipt, result or host-ownership assertion. */
export function admitPickingAction(ownerValue:PickingOwner,value:unknown,actionValue:unknown):PickingState{
 const owner=Schema.decodeUnknownSync(PickingOwnerSchema,{onExcessProperty:'error'})(ownerValue),original=pickingHelper.parseState(owner.helperId,value),action=pickingHelper.parseAction(actionValue);
 if(original.owner&&pickingCanonical(original.owner)!==pickingCanonical(owner))throw Error('The host picking owner changed.');
 const state:PickingState={...original,owner};
 if(action.kind==='picking-inspect'){if(!state.attempts.some(a=>a.id===action.runId))throw Error('No saved receipt exists for that exact local run.');return original;}
 // Terminal receipts are observations, never lifecycle/target restoration commands.
 if(action.kind==='picking-apply'||action.kind==='picking-cancel'){
  const previous=state.attempts.find(a=>a.id===action.runId);if(previous&&previous.status!=='prepared')return original;
 }
 if(action.kind==='picking-prepare'){
  const previous=state.attempts.find(a=>a.id===action.runId);
  if(previous){const context=pickingContext(state,action.contextId),release=state.releases.find(r=>r.digest===action.releaseDigest);if(!release||previous.payloadDigest!==pickingDigest(attemptPayload(state,context,release,action.generation,action.targetRevision,action.note??'')))throw Error('The run identity has a different payload.');return original;}
 }
 if(action.expectedRevision!==state.revision||state.revision>=500)throw Error('This picking helper changed or reached its revision limit.');
 const pending=state.attempts.filter(a=>a.status==='prepared').length,settling=action.kind==='picking-apply'||action.kind==='picking-cancel'?1:0,added=action.kind==='picking-prepare'?1:0;
 if(state.revision+1+pending+added-settling>500)throw Error('Keep the remaining revision capacity for settling prepared runs.');
 let next:PickingState={...state,revision:state.revision+1};
 if(action.kind==='picking-context'){
  if(!state.candidate||state.contexts.length>=8||state.recording)throw Error('Choose a candidate and finish recording before creating a context.');
  const definition=pickingDefinition(state.candidate.definition),table=parseTableSnapshot(definition,{...parseTableSnapshot(definition,action.table),id:'table'+next.revision}),request=parseTableRequest(definition,action.request),context={id:'context'+next.revision,definition,table,request,target:{id:'manifest'+next.revision,revision:0,value:null}};
  next={...next,contexts:[...state.contexts,context],currentContextId:context.id};
 }else if(action.kind==='picking-record-start'){
  if(state.recording||state.observations.length>=8)throw Error('Finish the open recording or use a new helper at the recording limit.');
  const context=pickingContext(state,action.contextId);next={...next,currentContextId:context.id,recording:{id:'recording'+next.revision,contextId:context.id,selectedRow:null,output:{},events:[]}};
 }else if(action.kind==='picking-select-row'||action.kind==='picking-copy'||action.kind==='picking-literal'){
  if(!state.recording)throw Error('Start recording these app actions first.');const context=pickingContext(state,state.recording.contextId);
  const step=action.kind==='picking-select-row'?{kind:'select-row' as const,rowId:action.rowId}:action.kind==='picking-copy'?{kind:'copy' as const,source:action.source,field:action.field,output:action.output}:{kind:'literal' as const,output:action.output,value:action.value};
  next={...next,recording:recordingStep(context,state.recording,step)};
 }else if(action.kind==='picking-record-cancel'){if(!state.recording)throw Error('No recording is open.');next={...next,recording:null};}
 else if(action.kind==='picking-record-stop'){
  const recording=state.recording;if(!recording||!recording.events.length)throw Error('Record actual local actions before stopping.');const context=pickingContext(state,recording.contextId),output=recording.output;
  if(context.definition.body.output.fields.some(f=>!Object.hasOwn(output,f.name))||Object.keys(output).length!==context.definition.body.output.fields.length)throw Error('Copy every declared output field before applying the observed manifest.');
  const row=context.table.rows.find(r=>r.id===recording.selectedRow),lastFor=(field:string)=>[...recording.events].reverse().find(e=>(e.step.kind==='copy'||e.step.kind==='literal')&&e.step.output===field),keyCopy=lastFor('itemKey'),labelCopy=lastFor('label'),stockIndex=context.definition.table.columns.findIndex(c=>c.kind==='integer'),privateIndex=context.definition.table.columns.findIndex(c=>c.kind==='boolean');
  const rowValue=(event:ReturnType<typeof lastFor>)=>{const step=event?.step;return step?.kind==='copy'&&step.source==='row'?row?.values[context.definition.table.columns.findIndex(c=>c.id===step.field)]:undefined;};
  const quantity=context.request.quantity,available=row?.values[stockIndex];
  if(!row||context.request.reviewed!==true||!['pickup','courier'].includes(String(context.request.delivery))||row.values[privateIndex]===true||typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000||typeof available!=='number'||available<quantity||available>10000||output.itemKey!==context.request.key||rowValue(keyCopy)!==output.itemKey||rowValue(labelCopy)!==output.label||output.quantity!==quantity)throw Error('The local manifest outcome must match the reviewed request, selected row and available quantity. Repair the recording before finishing.');
  const targetRevision=context.target.revision+1,payload={id:'observation'+next.revision,kind:'observed-app-actions' as const,admission:'owned-module-host' as const,physicalGestureVerified:false as const,recordingId:recording.id,owner,contextId:context.id,events:recording.events,output,targetRevision},observation:PickingObservation={...payload,digest:pickingDigest(payload)};
  next={...next,contexts:state.contexts.map(c=>c.id===context.id?{...c,target:{...c.target,revision:targetRevision,value:output}}:c),recording:null,observations:[...state.observations,observation]};
 }else if(action.kind==='picking-propose'){
  const observation=state.observations.at(-1);if(!observation||!state.candidate)throw Error('Complete an observed action sequence before proposing bindings.');
  const context=pickingContext(state,observation.contextId),definition=structuredClone(state.candidate.definition),assignments=new Map<string,Set<string>>();
  const visit=(step:SemanticStep)=>{if(step.kind==='assign'){if(step.value.kind==='input'){const fields=assignments.get(step.field)??new Set<string>();fields.add(step.value.field);assignments.set(step.field,fields);}visit(step.next);}else if(step.kind==='branch'){visit(step.then);visit(step.else);}};visit(definition.body.root);
  const rowCopies=[...observation.events].reverse().filter(e=>e.step.kind==='copy'&&e.step.source==='row');
  const bindings=definition.lookup.bindings.map(binding=>{const copy=rowCopies.find(e=>e.step.kind==='copy'&&assignments.get(e.step.output)?.size===1&&assignments.get(e.step.output)?.has(binding.input));return copy?.step.kind==='copy'?{...binding,column:copy.step.field}:binding;});
  const keyCopy=rowCopies.find(e=>e.step.kind==='copy'&&e.step.output==='itemKey');
  if(!keyCopy||keyCopy.step.kind!=='copy'||observation.output.itemKey!==context.request[definition.lookup.keyInput])throw Error('The observed key does not support that proposed request binding. Review the example.');
  let proposed:TableProcedureV2=pickingDefinition({...definition,lookup:{...definition.lookup,column:keyCopy.step.field,bindings}});
  const computed=runTableProcedure(proposed,contextTable(context,proposed),context.request),visited=new Set(computed.trace.map(t=>t.stepId)),literals=[...observation.events].reverse().filter(e=>e.step.kind==='literal');
  const infer=(step:SemanticStep):SemanticStep=>{if(step.kind==='assign'){const event=visited.has(step.id)?literals.find(e=>e.step.kind==='literal'&&e.step.output===step.field):undefined;return {...step,...(event?.step.kind==='literal'?{value:{kind:'literal' as const,value:event.step.value}}:{}),next:infer(step.next)};}return step.kind==='branch'?{...step,then:infer(step.then),else:infer(step.else)}:step;};
  proposed=nextPickingDefinition(state,{...proposed,body:{...proposed.body,root:infer(proposed.body.root)}});
  const proposedReason='Observed row and field-copy actions support these proposed key/projection bindings. Stock, protection and delivery rules are declared and must be checked.';
  next={...next,candidateHistory:[...state.candidateHistory,{atRevision:next.revision,candidate:state.candidate}],candidate:{definition:proposed,observationId:observation.id,proposedReason,currentReason:proposedReason}};
 }else if(action.kind==='picking-prepare'){
  if(state.recording||state.attempts.length>=20)throw Error('Finish recording or inspect the receipt limit before another run.');
  const release=state.releases.find(r=>r.digest===action.releaseDigest),context=pickingContext(state,action.contextId);
  if(!release||state.activation.digest!==release.digest||state.activation.generation!==action.generation||state.currentContextId!==context.id||context.target.revision!==action.targetRevision)throw Error('The active generation, current context or target changed.');
  const result=runTableProcedure(release.definition,contextTable(context,release.definition),context.request),attempt={id:action.runId,payloadDigest:pickingDigest(attemptPayload(state,context,release,action.generation,action.targetRevision,action.note??'')),releaseDigest:release.digest,generation:action.generation,contextId:context.id,targetRevision:action.targetRevision,note:action.note??'',result,status:result.status==='completed'?'prepared' as const:'failed' as const,preparedAtRevision:next.revision,settledAtRevision:result.status==='completed'?null:next.revision,targetRevisionAfter:null,targetDigest:null};
  next={...next,attempts:[...state.attempts,attempt]};
 }else if(action.kind==='picking-apply'||action.kind==='picking-cancel'){
  const attempt=state.attempts.find(a=>a.id===action.runId);if(!attempt)throw Error('Inspect the actual run before another action.');const context=pickingContext(state,attempt.contextId),release=state.releases.find(r=>r.digest===attempt.releaseDigest)!;
  if(action.kind==='picking-cancel')next={...next,attempts:state.attempts.map(a=>a.id===attempt.id?{...a,status:'cancelled',settledAtRevision:next.revision}:a)};
  else if(state.activation.generation!==attempt.generation||state.activation.digest!==attempt.releaseDigest||state.currentContextId!==context.id||context.target.revision!==attempt.targetRevision){next={...next,attempts:state.attempts.map(a=>a.id===attempt.id?{...a,status:'retired',settledAtRevision:next.revision}:a)};}
  else{
   const result=runTableProcedure(release.definition,contextTable(context,release.definition),context.request);if(result.status!=='completed'||pickingCanonical(result)!==pickingCanonical(attempt.result))throw Error('The exact run outcome changed before its local commit.');
   const target={...context.target,revision:context.target.revision+1,value:result.output};
   next={...next,contexts:state.contexts.map(c=>c.id===context.id?{...c,target}:c),attempts:state.attempts.map(a=>a.id===attempt.id?{...a,status:'completed',settledAtRevision:next.revision,targetRevisionAfter:target.revision,targetDigest:pickingDigest(target.value)}:a)};
  }
 }else return pickingHelper.update(owner.helperId,state,action);
 return pickingHelper.parseState(owner.helperId,next);
}
