import {workflowImageCitationMarkdown} from './workflow-image-citation';
import { Schema } from 'effect';
import {windowImageRegionIsBounded} from '../shared/window-image-evidence';
import { WorkflowBasisSchema, WorkflowCitationSchema, WorkflowRuleOriginSchema } from './workflow-grounding';

export const workflowLimits = Object.freeze({ states: 8, events: 8, rules: 24, steps: 12, revisions: 500 });
const id = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const label = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));
const reason = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(800));
const integer = Schema.Number.pipe(Schema.filter(Number.isSafeInteger));
const revision = integer.pipe(Schema.between(0, workflowLimits.revisions));
const named = Schema.Struct({ id, label });
const rule = Schema.Struct({ id, fromStateId: id, eventId: id, toStateId: id, enabled: Schema.Boolean });
export const WorkflowCaseSchema = Schema.Struct({
  id, title: label,
  states: Schema.Array(named).pipe(Schema.minItems(2), Schema.maxItems(workflowLimits.states)),
  events: Schema.Array(named).pipe(Schema.minItems(1), Schema.maxItems(workflowLimits.events)),
  rules: Schema.Array(rule).pipe(Schema.minItems(1), Schema.maxItems(workflowLimits.rules)),
  initialStateId: id,
  eventIds: Schema.Array(id).pipe(Schema.minItems(1), Schema.maxItems(workflowLimits.steps)),
});
export type WorkflowCase = typeof WorkflowCaseSchema.Type;
const prediction = Schema.Struct({ finalStateId: id, blockedCount: integer.pipe(Schema.between(0, workflowLimits.steps)), reasoning: Schema.String.pipe(Schema.maxLength(800)) });
export type WorkflowPrediction = typeof prediction.Type;
const mode = Schema.Literal('quick', 'deep', 'visual');
const editNote = Schema.Struct({ revision, kind: Schema.Literal('set-rule', 'set-initial', 'set-sequence'), reason, detail: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(4000)) });
const transferStart = { startedRevision: revision, practiceAtStart: WorkflowCaseSchema, practicePredictionAtStart: prediction };
const transfer = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('not-started') }),
  Schema.Struct({ kind: Schema.Literal('predict'), ...transferStart }),
  Schema.Struct({ kind: Schema.Literal('reviewed'), ...transferStart, prediction }),
);
export const WorkflowDataSchema = Schema.Struct({
  kind: Schema.Literal('workflow-lab'), schemaVersion: Schema.Literal(1), id,
  version: integer.pipe(Schema.positive()), title: label, basis: WorkflowBasisSchema,
  assumptions: Schema.Array(reason).pipe(Schema.maxItems(16)),
  ruleOrigins: Schema.Array(WorkflowRuleOriginSchema).pipe(Schema.maxItems(workflowLimits.rules)),
  citations: Schema.Array(WorkflowCitationSchema).pipe(Schema.maxItems(48)),
  practice: WorkflowCaseSchema, transfer: WorkflowCaseSchema,
});
export type WorkflowData = typeof WorkflowDataSchema.Type;
export const WorkflowStateSchema = Schema.Struct({
  kind: Schema.Literal('workflow-lab'), revision, lessonId: id, lessonVersion: integer.pipe(Schema.positive()), basis: WorkflowBasisSchema,
  practice: WorkflowCaseSchema, practiceEdits: revision, editNotes: Schema.Array(editNote).pipe(Schema.maxItems(workflowLimits.revisions)),
  practicePrediction: Schema.NullOr(prediction), transfer, active: Schema.Literal('practice', 'transfer'), mode,
});
export type WorkflowState = typeof WorkflowStateSchema.Type;
export const WorkflowActionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('set-rule'), ruleId: id, toStateId: id, enabled: Schema.Boolean, reason, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('set-initial'), initialStateId: id, reason, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('set-sequence'), eventIds: WorkflowCaseSchema.fields.eventIds, reason, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('predict'), ...prediction.fields, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('set-mode'), mode, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('start-transfer'), expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('return-practice'), expectedRevision: revision }),
);
export type WorkflowAction = typeof WorkflowActionSchema.Type;

function decode<A, I>(schema: Schema.Schema<A, I>, value: unknown): A { return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value); }
function unique(values: readonly string[], message: string) { if (new Set(values).size !== values.length) throw Error(message); }
function stateLabel(input: WorkflowCase, stateId: string) { return input.states.find(value => value.id === stateId)!.label; }
function eventLabel(input: WorkflowCase, eventId: string) { return input.events.find(value => value.id === eventId)!.label; }
export function validateWorkflowCase(input: WorkflowCase) {
  unique(input.states.map(value => value.id), 'Workflow state identities must be unique.');
  unique(input.events.map(value => value.id), 'Workflow event identities must be unique.');
  unique(input.rules.map(value => value.id), 'Workflow rule identities must be unique.');
  unique(input.rules.map(value => `${value.fromStateId}:${value.eventId}`), 'One state and event can have only one rule, including disabled rules.');
  const states = new Set(input.states.map(value => value.id)), events = new Set(input.events.map(value => value.id));
  if (!states.has(input.initialStateId)) throw Error('The initial state must belong to this workflow.');
  if (input.eventIds.some(value => !events.has(value))) throw Error('Every event in the sequence must belong to this workflow.');
  if (input.rules.some(value => !states.has(value.fromStateId) || !states.has(value.toStateId) || !events.has(value.eventId))) throw Error('Every rule must use this workflow’s declared states and events.');
}
/**
 * Conservative pedagogic distinctness, not arbitrary graph isomorphism:
 * a held-out workflow must exercise a different normalized executed path.
 * Labels, declaration order and unused rules do not make the path unseen.
 */
function normalizedPath(input: WorkflowCase) {
  const states = new Map<string, number>(), events = new Map<string, number>();
  const rank = (identities: Map<string, number>, value: string) => {
    const existing = identities.get(value);
    if (existing !== undefined) return existing;
    const next = identities.size; identities.set(value, next); return next;
  };
  rank(states, input.initialStateId);
  return JSON.stringify(evaluate(input).steps.map(step => [rank(events, step.eventId), rank(states, step.fromStateId), rank(states, step.toStateId), step.status]));
}
export function workflowPathsDiffer(left: WorkflowCase, right: WorkflowCase): boolean {
  return normalizedPath(left) !== normalizedPath(right);
}
function parse(value: unknown): WorkflowData {
  const data = decode(WorkflowDataSchema, value);
  validateWorkflowCase(data.practice); validateWorkflowCase(data.transfer);
  if (data.practice.id === data.transfer.id || normalizedPath(data.practice) === normalizedPath(data.transfer)) throw Error('The transfer must exercise a distinct state and event path.');
  unique(data.citations.map(value => value.id), 'Workflow citation identities must be unique.');
  unique(data.ruleOrigins.map(value => value.ruleId), 'Each practice rule needs one original interpretation.');
  if (data.ruleOrigins.length !== data.practice.rules.length || data.ruleOrigins.some(value => !data.practice.rules.some(rule => rule.id === value.ruleId))) throw Error('Every practice rule needs an explicit original interpretation.');
  if (data.ruleOrigins.some(value => value.citationId !== null && !data.citations.some(citation => citation.id === value.citationId))) throw Error('A rule citation must identify an included citation.');
  if (data.ruleOrigins.some(value => value.interpretation !== undefined && ((data.basis.kind !== 'reviewed-source' && data.basis.kind !== 'reviewed-window') || value.citationId === null))) throw Error('Rule interpretation classification requires an admitted reviewed source citation.');
  if (data.basis.kind === 'local-sample' && (data.citations.length || data.ruleOrigins.some(value => value.citationId !== null))) throw Error('A local sample cannot claim observed citations.');
  if (data.basis.kind === 'reviewed-source' || data.basis.kind === 'reviewed-window') {
    const basis = data.basis;
    unique(basis.sourceRefs.map(value => value.sourceId), 'Each reviewed source identity must be unique.');
    if (data.ruleOrigins.some(value => value.citationId === null)) throw Error('Every reviewed rule needs an explicit included source citation.');
    if (data.citations.some(value => !basis.sourceRefs.some(ref => ref.sourceId === value.sourceRef.sourceId && ref.version === value.sourceRef.version && ref.digest === value.sourceRef.digest))) throw Error('Every citation must match an exact reviewed source reference.');
    if (basis.kind==='reviewed-source'&&data.citations.some(value => value.location.kind!=='text-range'||value.location.end <= value.location.start || value.location.end - value.location.start !== value.location.quote.length)) throw Error('A citation needs an ordered exact-length text range and nonempty quote.');
  }
  if(data.basis.kind==='reviewed-window'){
    const basis=data.basis,capture=basis.capture;
    if(!Number.isFinite(Date.parse(capture.capturedAt))||new Date(capture.capturedAt).toISOString()!==capture.capturedAt||!Number.isFinite(Date.parse(capture.previewExpiresAt))||new Date(capture.previewExpiresAt).toISOString()!==capture.previewExpiresAt||Date.parse(capture.previewExpiresAt)-Date.parse(capture.capturedAt)!==300000)throw Error('Invalid frozen image capture provenance.');
    for(const citation of data.citations){
      if(citation.location.kind!=='image-region'||!('original' in citation)||!windowImageRegionIsBounded(citation.location)||!windowImageRegionIsBounded(citation.original))throw Error('Invalid reviewed image evidence.');
      const unchanged=JSON.stringify(citation.location)===JSON.stringify(citation.original);
      if((citation.classification==='confirmed-transcription')!==unchanged)throw Error('Image correction classification differs from its evidence.');
    }
    if(data.ruleOrigins.some(origin=>origin.interpretation!=='reviewed-image-interpretation'||!origin.imageCitationIds||new Set(origin.imageCitationIds).size!==origin.imageCitationIds.length||origin.citationId!==origin.imageCitationIds[0]||origin.imageCitationIds.some(id=>!data.citations.some(citation=>citation.id===id))))throw Error('Every image rule needs an explicit reviewed image interpretation.');
    unique(basis.issueReviews.map(issue=>issue.id),'Duplicate reviewed image issue.');
    const used=new Set([...basis.names.map(name=>name.citationId),...data.ruleOrigins.flatMap(origin=>'imageCitationIds' in origin?origin.imageCitationIds:[])]);
    for(const issue of basis.issueReviews){unique(issue.citationIds,'Duplicate image issue citation.');if(issue.disposition==='excluded'&&(!issue.citationIds.length||issue.citationIds.some(id=>used.has(id))))throw Error('Excluded image ambiguity still affects this model.');}
    unique(basis.names.map(name=>name.category+':'+name.id),'Duplicate image name interpretation.');
    if(basis.names.length!==data.practice.states.length+data.practice.events.length)throw Error('Every image state/event needs reviewed evidence.');
    for(const name of basis.names){const entries=name.category==='states'?data.practice.states:data.practice.events,entry=entries.find(entry=>entry.id===name.id),citation=data.citations.find(c=>c.id===name.citationId);if(!entry||!citation||name.classification==='reviewed-transcription'&&entry.label!==citation.location.quote)throw Error('Invalid reviewed image name interpretation.');}
  }else if(data.citations.some(citation=>citation.location.kind!=='text-range')||data.ruleOrigins.some(origin=>origin.interpretation==='reviewed-image-interpretation'||'imageCitationIds' in origin))throw Error('Image evidence requires a reviewed window basis.');
  return data;
}
function immutableCase(input: WorkflowCase) {
  return JSON.stringify({ id: input.id, title: input.title, states: input.states, events: input.events, rules: input.rules.map(value => ({ id: value.id, fromStateId: value.fromStateId, eventId: value.eventId })) });
}
function validatePractice(data: WorkflowData, input: WorkflowCase) {
  validateWorkflowCase(input);
  if (immutableCase(input) !== immutableCase(data.practice)) throw Error('Saved practice cannot replace state, event or rule identities.');
}
function validatePrediction(input: WorkflowCase, guess: WorkflowPrediction) {
  if (!input.states.some(value => value.id === guess.finalStateId)) throw Error('The predicted state must belong to this workflow.');
  if (guess.blockedCount > input.eventIds.length) throw Error('Blocked events cannot exceed the event sequence length.');
}
export type WorkflowStep = { readonly index: number; readonly eventId: string; readonly eventLabel: string; readonly fromStateId: string; readonly fromStateLabel: string; readonly toStateId: string; readonly toStateLabel: string; readonly ruleId: string | null; readonly status: 'applied' | 'blocked' };
export type WorkflowResult = { readonly origin: 'deterministic'; readonly caseId: string; readonly finalStateId: string; readonly finalStateLabel: string; readonly blockedCount: number; readonly steps: readonly WorkflowStep[] };
function evaluate(input: WorkflowCase): WorkflowResult {
  let current = input.initialStateId;
  const steps = input.eventIds.map((eventId, offset): WorkflowStep => {
    const fromStateId = current;
    const selected = input.rules.find(value => value.fromStateId === current && value.eventId === eventId && value.enabled);
    if (selected) current = selected.toStateId;
    return { index: offset + 1, eventId, eventLabel: eventLabel(input, eventId), fromStateId, fromStateLabel: stateLabel(input, fromStateId), toStateId: current, toStateLabel: stateLabel(input, current), ruleId: selected?.id ?? null, status: selected ? 'applied' : 'blocked' };
  });
  return { origin: 'deterministic', caseId: input.id, finalStateId: current, finalStateLabel: stateLabel(input, current), blockedCount: steps.filter(value => value.status === 'blocked').length, steps };
}
export const evaluateWorkflowCase = evaluate;
function behavior(input: WorkflowCase) { const result = evaluate(input); return JSON.stringify(result.steps.map(value => [value.eventId, value.fromStateId, value.toStateId, value.status])); }
function parseState(dataValue: unknown, value: unknown): WorkflowState {
  const data = parse(dataValue), state = decode(WorkflowStateSchema, value);
  if (state.lessonId !== data.id || state.lessonVersion !== data.version || JSON.stringify(state.basis) !== JSON.stringify(data.basis)) throw Error('Saved state belongs to another lesson version or source basis.');
  validatePractice(data, state.practice);
  if (state.practiceEdits !== state.editNotes.length || state.practiceEdits > state.revision) throw Error('Every practice edit needs a recorded correction note and revision.');
  if (state.practiceEdits === 0 && JSON.stringify(state.practice) !== JSON.stringify(data.practice)) throw Error('Changed rules require a recorded edit.');
  if (state.editNotes.some((value, index) => value.revision < 1 || value.revision > state.revision || (index > 0 && value.revision <= state.editNotes[index - 1].revision))) throw Error('Correction notes must have increasing committed revisions.');
  if (state.practicePrediction) validatePrediction(state.practice, state.practicePrediction);
  let minimum = state.practiceEdits + (state.practicePrediction ? 1 : 0);
  if (state.transfer.kind !== 'not-started') {
    validatePractice(data, state.transfer.practiceAtStart); validatePrediction(state.transfer.practiceAtStart, state.transfer.practicePredictionAtStart);
    if (behavior(state.transfer.practiceAtStart) === behavior(data.practice)) throw Error('Transfer requires a behavior-changing practice edit and review.');
    if (normalizedPath(state.transfer.practiceAtStart) === normalizedPath(data.transfer)) throw Error('Transfer requires a distinct held-out event and transition path.');
    if (state.transfer.startedRevision < 3 || state.transfer.startedRevision > state.revision) throw Error('Saved transfer start exceeds its lesson stage.');
    const startedRevision = state.transfer.startedRevision;
    if (!state.editNotes.some(value => value.revision < startedRevision)) throw Error('Transfer requires an earlier recorded practice change.');
    minimum += 1;
    if (state.transfer.kind === 'reviewed') { validatePrediction(data.transfer, state.transfer.prediction); minimum++; if (state.revision <= state.transfer.startedRevision) throw Error('A transfer prediction must follow its start revision.'); }
  } else if (state.active === 'transfer') throw Error('An unstarted transfer cannot be active.');
  if (state.revision < minimum) throw Error('Saved lesson stage exceeds its committed revision.');
  return state;
}
function initial(value: unknown): WorkflowState {
  const data = parse(value);
  return { kind: 'workflow-lab', revision: 0, lessonId: data.id, lessonVersion: data.version, basis: data.basis, practice: data.practice, practiceEdits: 0, editNotes: [], practicePrediction: null, transfer: { kind: 'not-started' }, active: 'practice', mode: 'quick' };
}
function update(dataValue: unknown, stateValue: unknown, actionValue: unknown): WorkflowState {
  const data = parse(dataValue), state = parseState(data, stateValue), action = decode(WorkflowActionSchema, actionValue);
  if (action.expectedRevision !== state.revision) throw Error('This workflow changed. Reload its current state before applying this action.');
  if (state.revision === workflowLimits.revisions) throw Error('This experiment reached its revision limit. Create a new lesson version.');
  const nextRevision = state.revision + 1;
  if (action.kind === 'set-mode') {
    if (action.mode === state.mode) throw Error('This explanation mode is already selected.');
    return { ...state, revision: nextRevision, mode: action.mode };
  }
  if (action.kind === 'return-practice' && state.active === 'transfer') return { ...state, revision: nextRevision, active: 'practice' };
  if (action.kind === 'start-transfer' && state.active === 'practice') {
    if (state.transfer.kind !== 'not-started') return { ...state, revision: nextRevision, active: 'transfer' };
    if (!state.practicePrediction || behavior(state.practice) === behavior(data.practice)) throw Error('Change what happens, then predict and inspect the result before transfer.');
    if (normalizedPath(state.practice) === normalizedPath(data.transfer)) throw Error('The practice now follows this challenge path. A distinct held-out path is required.');
    return { ...state, revision: nextRevision, active: 'transfer', transfer: { kind: 'predict', startedRevision: nextRevision, practiceAtStart: state.practice, practicePredictionAtStart: state.practicePrediction } };
  }
  if (action.kind === 'predict') {
    const guess = { finalStateId: action.finalStateId, blockedCount: action.blockedCount, reasoning: action.reasoning };
    if (state.active === 'practice' && !state.practicePrediction) {
      validatePrediction(state.practice, guess);
      return { ...state, revision: nextRevision, practicePrediction: guess };
    }
    if (state.active === 'transfer' && state.transfer.kind === 'predict') {
      validatePrediction(data.transfer, guess);
      return { ...state, revision: nextRevision, transfer: { ...state.transfer, kind: 'reviewed', prediction: guess } };
    }
  }
  if (action.kind === 'set-rule' || action.kind === 'set-initial' || action.kind === 'set-sequence') {
    if (state.active !== 'practice') throw Error('The held-out transfer cannot be edited. Return to practice.');
    let practice: WorkflowCase, detail: string;
    if (action.kind === 'set-rule') {
      const selected = state.practice.rules.find(value => value.id === action.ruleId);
      if (!selected) throw Error('Choose a rule from this workflow.');
      if (!state.practice.states.some(value => value.id === action.toStateId)) throw Error('The rule target must belong to this workflow.');
      practice = { ...state.practice, rules: state.practice.rules.map(value => value.id === action.ruleId ? { ...value, toStateId: action.toStateId, enabled: action.enabled } : value) };
      detail = `${stateLabel(practice, selected.fromStateId)} + ${eventLabel(practice, selected.eventId)}: ${stateLabel(practice, selected.toStateId)} → ${stateLabel(practice, action.toStateId)}; ${action.enabled ? 'enabled' : 'disabled'}.`;
    } else if (action.kind === 'set-initial') {
      practice = { ...state.practice, initialStateId: action.initialStateId };
      validateWorkflowCase(practice);
      detail = `Start: ${stateLabel(practice, state.practice.initialStateId)} → ${stateLabel(practice, action.initialStateId)}.`;
    } else {
      practice = { ...state.practice, eventIds: action.eventIds };
      validateWorkflowCase(practice);
      detail = `Event sequence: ${practice.eventIds.map(value => eventLabel(practice, value)).join(' → ')}.`;
    }
    validateWorkflowCase(practice);
    if (JSON.stringify(practice) === JSON.stringify(state.practice)) throw Error('Choose a change that alters the practice inputs.');
    return { ...state, revision: nextRevision, practice, practiceEdits: state.practiceEdits + 1, editNotes: [...state.editNotes, { revision: nextRevision, kind: action.kind, reason: action.reason, detail }], practicePrediction: null };
  }
  throw Error('This action is not available at the current experiment stage.');
}
function assess(input: WorkflowCase, result: WorkflowResult, guess: WorkflowPrediction) {
  const stateCorrect = guess.finalStateId === result.finalStateId, blockedCorrect = guess.blockedCount === result.blockedCount;
  const score = Number(stateCorrect) + Number(blockedCorrect);
  const details = result.steps.map(step => step.status === 'blocked' ? `Step ${step.index}: ${step.eventLabel} is blocked in ${step.fromStateLabel}; the state stays ${step.toStateLabel}.` : `Step ${step.index}: ${step.eventLabel} moves ${step.fromStateLabel} → ${step.toStateLabel}.`).join(' ');
  return { score, maxScore: 2 as const, correct: score === 2, predictedFinalStateId: guess.finalStateId, predictedBlockedCount: guess.blockedCount, reasoning: guess.reasoning, correction: `Final state: ${result.finalStateLabel} (you predicted ${stateLabel(input, guess.finalStateId)}). Blocked events: ${result.blockedCount} (you predicted ${guess.blockedCount}). ${details} The two answers are checked; reasoning and human learning are not evaluated.` };
}
function changedResult(before: WorkflowResult, current: WorkflowResult) {
  const changedSteps: { readonly index: number; readonly before: WorkflowStep | null; readonly after: WorkflowStep | null }[] = [];
  for (let offset = 0; offset < Math.max(before.steps.length, current.steps.length); offset++) {
    const prior = before.steps[offset] ?? null, next = current.steps[offset] ?? null;
    if (JSON.stringify(prior) !== JSON.stringify(next)) changedSteps.push({ index: offset + 1, before: prior, after: next });
  }
  return { originalFinalStateId: before.finalStateId, originalFinalStateLabel: before.finalStateLabel, currentFinalStateId: current.finalStateId, currentFinalStateLabel: current.finalStateLabel, originalBlockedCount: before.blockedCount, currentBlockedCount: current.blockedCount, changedSteps, summary: changedSteps.length ? `Compared with the original inputs, ${changedSteps.length} step(s) changed. Final state: ${before.finalStateLabel} → ${current.finalStateLabel}. Blocked events: ${before.blockedCount} → ${current.blockedCount}.` : 'The trace matches the original inputs; no event outcome changed.' };
}
type CausalEvidence={readonly originalRule:string;readonly classification:string;readonly reason:string;readonly citationNumber:number;readonly citation:WorkflowData['citations'][number]};
type CausalStep={readonly kind:'unchanged'|'rule-change'|'upstream-state'|'starting-state'|'event-sequence'|'added-step'|'synthetic';readonly before:WorkflowStep|null;readonly after:WorkflowStep;readonly explanation:string;readonly evidence:readonly CausalEvidence[];readonly sourceNote:string};
const ruleText=(problem:WorkflowCase,value:WorkflowCase['rules'][number])=>`${stateLabel(problem,value.fromStateId)} + ${eventLabel(problem,value.eventId)} → ${stateLabel(problem,value.toStateId)} (${value.enabled?'enabled':'disabled'})`;
function causalExplanation(data:WorkflowData,state:WorkflowState,problem:WorkflowCase,result:WorkflowResult,before:WorkflowResult|null){
 const synthetic=state.active==='transfer';
 const ruleChanges=synthetic?[]:state.practice.rules.flatMap(current=>{const original=data.practice.rules.find(rule=>rule.id===current.id)!;return current.toStateId===original.toStateId&&current.enabled===original.enabled?[]:[{ruleId:current.id,original:ruleText(data.practice,original),current:ruleText(state.practice,current)}];});
 function evidenceFor(identities:readonly string[]):CausalEvidence[]{
  if(data.basis.kind==='local-sample')return [];
  return [...new Set(identities)].flatMap(ruleId=>{
   const original=data.practice.rules.find(rule=>rule.id===ruleId),current=problem.rules.find(rule=>rule.id===ruleId);
   if(!original||!current)return [];
   if(synthetic&&(current.fromStateId!==original.fromStateId||current.eventId!==original.eventId||current.toStateId!==original.toStateId||current.enabled!==original.enabled||stateLabel(problem,current.fromStateId)!==stateLabel(data.practice,original.fromStateId)||stateLabel(problem,current.toStateId)!==stateLabel(data.practice,original.toStateId)||eventLabel(problem,current.eventId)!==eventLabel(data.practice,original.eventId)))return [];
   const origin=data.ruleOrigins.find(origin=>origin.ruleId===ruleId)!;
   const citationIds=origin.interpretation==='reviewed-image-interpretation'?origin.imageCitationIds:origin.citationId?[origin.citationId]:[];
   return citationIds.map(citationId=>{const index=data.citations.findIndex(citation=>citation.id===citationId);return {originalRule:ruleText(data.practice,original),classification:origin.interpretation==='source-stated'?'Source-stated rule':origin.interpretation==='user-interpreted'?'Your interpretation':origin.interpretation==='reviewed-image-interpretation'?'Reviewed image interpretation':'Reviewed interpretation (classification not saved)',reason:origin.reason,citationNumber:index+1,citation:data.citations[index]};});
  });
 }
 const steps=result.steps.map((after,index):CausalStep=>{
  const prior=before?.steps[index]??null,currentRule=problem.rules.find(rule=>rule.fromStateId===after.fromStateId&&rule.eventId===after.eventId),oldRule=prior?data.practice.rules.find(rule=>rule.fromStateId===prior.fromStateId&&rule.eventId===prior.eventId):undefined;
  const unchanged=!!prior&&JSON.stringify(prior)===JSON.stringify(after);
  const kind:CausalStep['kind']=synthetic?'synthetic':unchanged?'unchanged':!prior?'added-step':prior.eventId!==after.eventId?'event-sequence':prior.fromStateId!==after.fromStateId?index===0?'starting-state':'upstream-state':'rule-change';
  const outcome=after.status==='applied'?`The enabled ${after.fromStateLabel} + ${after.eventLabel} rule moves to ${after.toStateLabel}.`:currentRule?`The ${after.fromStateLabel} + ${after.eventLabel} rule is disabled in the current model, so this event is blocked and stays in ${after.toStateLabel}.`:`This model has no rule for ${after.fromStateLabel} + ${after.eventLabel}, so this event is blocked and stays in ${after.toStateLabel}.`;
  const comparison=kind==='unchanged'?'The event, incoming state and outcome are unchanged from the original practice.':kind==='upstream-state'?`The preceding path now reaches ${after.fromStateLabel} instead of ${prior!.fromStateLabel}; this changes which rule can match.`:kind==='starting-state'?`The chosen starting state is now ${after.fromStateLabel} instead of ${prior!.fromStateLabel}.`:kind==='event-sequence'?`The event at this position changed from ${prior!.eventLabel} to ${after.eventLabel}.`:kind==='added-step'?'This event position was added after the original sequence.':kind==='rule-change'?`With the same incoming state and event, the original outcome was ${prior!.toStateLabel} (${prior!.status}); the local rule choice changed that outcome.`:'This is a separate synthetic challenge, not a newly observed source event.';
  const evidence=evidenceFor([...(currentRule?[currentRule.id]:[]),...(oldRule?[oldRule.id]:[])]);
  return {kind,before:prior,after,explanation:`${outcome} ${comparison}`,evidence,sourceNote:synthetic?evidence.length?'Challenge start and events are synthetic. These quotations support unchanged original rule interpretations, not an observed execution.':'Synthetic challenge rules are supplied test inputs; no exact original reviewed rule is linked to this step.':data.basis.kind==='local-sample'?'Illustrative local sample; no reviewed source evidence.':evidence.length?'The quotations support the original reviewed rule interpretations. Later local edits are hypothetical.':'No original source rule is linked to this state/event. Missing-rule blocking is a finite-model convention, not a claim about the real source.'};
 });
 const unpairedOriginalSteps=(before?.steps.slice(result.steps.length)??[]).map(step=>({...step,comparison:`Original position ${step.index} has no corresponding current position. Its original event ${step.eventLabel} led ${step.fromStateLabel} → ${step.toStateLabel} (${step.status}). This compares positions; ${step.eventLabel} may still appear elsewhere in the current sequence.`}));
 return {scope:synthetic?'synthetic-transfer' as const:'practice' as const,steps,unpairedOriginalSteps,ruleChanges,edits:synthetic?[]:state.editNotes,unchanged:synthetic?null:{startingState:state.practice.initialStateId===data.practice.initialStateId,eventSequence:JSON.stringify(state.practice.eventIds)===JSON.stringify(data.practice.eventIds),ruleCount:data.practice.rules.length-ruleChanges.length,stepIndices:steps.filter(step=>step.kind==='unchanged').map(step=>step.after.index)},limit:'This explains the saved finite sequential model only. It does not establish HDL timing, concurrent signal behavior, hardware execution or human understanding.'};
}
// Historic generated titles are presentation labels, not evidence of prior exposure.
// Keep artifact bytes and arbitrary user-authored titles unchanged.
export function workflowTransferDisplayTitle(data:WorkflowData):string {
 const {id,title}=data.transfer;
 if(id==='equipment-checkout'&&title==='Unseen equipment checkout sample')return 'Equipment checkout sample';
 if((id==='contextual-transfer'||id==='contextual-transfer-v1')&&title==='Unseen start or event challenge')return 'Starting state or event challenge';
 if((id==='contextual-transfer'||id==='contextual-transfer-v1')&&title==='Unseen additional event challenge')return 'Additional event challenge';
 return title;
}
function observe(dataValue: unknown, stateValue: unknown) {
  const data = parse(dataValue), state = parseState(data, stateValue), inTransfer = state.active === 'transfer';
  const problem = inTransfer ? data.transfer : state.practice;
  const guess = inTransfer ? state.transfer.kind === 'reviewed' ? state.transfer.prediction : null : state.practicePrediction;
  const result = guess ? evaluate(problem) : null;
  const before=result&&!inTransfer?evaluate(data.practice):null;
  const phase = inTransfer ? guess ? 'transfer-reviewed' as const : 'transfer-predict' as const : guess ? 'practice-reviewed' as const : 'practice-predict' as const;
  const transferBlock = inTransfer || state.transfer.kind !== 'not-started' ? null : !state.practicePrediction ? 'prediction' as const : behavior(state.practice) === behavior(data.practice) ? 'unchanged' as const : normalizedPath(state.practice) === normalizedPath(data.transfer) ? 'matching-path' as const : null;
  return { transferBlock, origin: inTransfer ? 'synthetic-transfer' as const : data.basis.kind === 'local-sample' ? 'local-sample' as const : 'reviewed-source' as const, revision: state.revision, mode: state.mode, phase, problem, result, assessment: result && guess ? assess(problem, result, guess) : null, change: result && before ? changedResult(before, result) : null, causal:result?causalExplanation(data,state,problem,result,before):null, canStartTransfer: !inTransfer && (state.transfer.kind !== 'not-started' || Boolean(state.practicePrediction && behavior(state.practice) !== behavior(data.practice) && normalizedPath(state.practice) !== normalizedPath(data.transfer))), transferStarted: state.transfer.kind !== 'not-started', assumptions: data.assumptions, ruleOrigins: data.ruleOrigins, citations: data.citations, editNotes: state.editNotes, basis: data.basis };
}
function firstTransfer(dataValue: unknown, stateValue: unknown) {
  const data = parse(dataValue), state = parseState(data, stateValue);
  if (state.transfer.kind !== 'reviewed') return null;
  const {prediction, practiceAtStart, practicePredictionAtStart, startedRevision} = state.transfer;
  const result = evaluate(data.transfer);
  return {title: workflowTransferDisplayTitle(data), startedRevision, prediction: {...prediction}, predictedStateLabel: stateLabel(data.transfer, prediction.finalStateId), result, assessment: assess(data.transfer, result, prediction), practiceAtStart: {title: practiceAtStart.title, prediction: {...practicePredictionAtStart}, result: evaluate(practiceAtStart)}};
}
function readable(dataValue: unknown, stateValue?: unknown): string {
  const data = parse(dataValue), state = stateValue === undefined ? initial(data) : parseState(data, stateValue), view = observe(data, state);
  const rules = view.problem.rules.map(value => `${stateLabel(view.problem, value.fromStateId)} + ${eventLabel(view.problem, value.eventId)} → ${stateLabel(view.problem, value.toStateId)} (${value.enabled ? 'enabled' : 'disabled'})`).join('\n');
  const citationNumber=(id:string)=>data.citations.findIndex(value=>value.id===id)+1;
  const origins = data.ruleOrigins.map(value => {const rule=data.practice.rules.find(rule=>rule.id===value.ruleId)!;return `Original rule ${stateLabel(data.practice,rule.fromStateId)} + ${eventLabel(data.practice,rule.eventId)} → ${stateLabel(data.practice,rule.toStateId)}${value.interpretation==='source-stated'?' (Source-stated rule)':value.interpretation==='user-interpreted'?' (Your interpretation)':value.interpretation==='reviewed-image-interpretation'?' (Reviewed image interpretation)':''}: ${value.reason}${value.citationId ? ` [Citation ${citationNumber(value.citationId)}]` : ' (declared interpretation; no source citation)'}`;}).join('\n');
  const sourceName=(ref:typeof data.citations[number]['sourceRef'])=>`${data.basis.kind==='reviewed-window'?'Window source':'Text source'} ${data.basis.kind!=='local-sample'?data.basis.sourceRefs.findIndex(value=>value.sourceId===ref.sourceId&&value.version===ref.version&&value.digest===ref.digest)+1:1}, version ${ref.version}`;
  const citations = data.citations.map((value,index) => `Citation ${index+1} — ${sourceName(value.sourceRef)}; ${'original' in value?workflowImageCitationMarkdown(value):`characters ${value.location.start}–${value.location.end}: “${value.location.quote}”`}`).join('\n');
  const basis=data.basis.kind==='local-sample'?`Local worked example, lesson version ${data.version}.`:`${data.basis.kind==='reviewed-window'?'Reviewed frozen transcription from a historical capture. Pixels are not stored/restored; this is not HDL simulation.':'Reviewed text interpretation'}, lesson version ${data.version}; source artifact revision ${data.basis.artifact.revision}. ${data.basis.sourceRefs.map(sourceName).join('; ')}`;
  const imageIssues=data.basis.kind==='reviewed-window'?data.basis.issueReviews.map(issue=>`Original ${issue.originalKind}: ${issue.originalReason} Review disposition (${issue.disposition}): ${issue.reason}`).join('\n'):'';
  const prior=view.origin==='synthetic-transfer'&&state.transfer.kind!=='not-started'?`\nPractice before transfer: ${assess(state.transfer.practiceAtStart,evaluate(state.transfer.practiceAtStart),state.transfer.practicePredictionAtStart).correction}\nRecorded practice reasoning (ungraded): ${state.transfer.practicePredictionAtStart.reasoning||'(none)'}`:'';
  const trace = view.result ? `\nComputed trace:\n${view.result.steps.map(value => `${value.index}. ${value.eventLabel}: ${value.fromStateLabel} → ${value.toStateLabel} (${value.status})`).join('\n')}` : '';
  const corrections = state.editNotes.map(value => `Revision ${value.revision}: ${value.detail} User reason: ${value.reason}`).join('\n');
  const causal=view.causal?`\nWhy these events lead here (computed finite model)\nQuotes describe the original reviewed rules; local changes are hypothetical.\n${view.causal.ruleChanges.map(change=>`Local rule choice: ${change.original} → ${change.current}.`).join('\n')}${view.causal.unchanged?`\nStarting state ${view.causal.unchanged.startingState?'unchanged':'changed'}; event sequence ${view.causal.unchanged.eventSequence?'unchanged':'changed'}. ${view.causal.unchanged.ruleCount} rule definitions unchanged. Unchanged trace steps: ${view.causal.unchanged.stepIndices.join(', ')||'none'}.`:''}\n${view.causal.steps.map(step=>`Step ${step.after.index}: ${step.after.eventLabel}. ${step.explanation}\n${step.sourceNote}\n${step.evidence.map(item=>`${item.classification}. Original reviewed rule: ${item.originalRule}. Recorded interpretation reason: ${item.reason}\nCitation ${item.citationNumber} — ${sourceName(item.citation.sourceRef)}; ${'original' in item.citation?workflowImageCitationMarkdown(item.citation):`“${item.citation.location.quote}”`}`).join('\n')}`).join('\n')}\n${view.causal.unpairedOriginalSteps.map(step=>step.comparison).join('\n')}\n${view.causal.limit}`:'';
  const first=state.transfer;
  const savedFirst=state.active==='practice'&&first.kind==='reviewed'?`\n\nSaved first transfer attempt (retained, not a new attempt)\nEarlier exposure is not tracked for this lesson.\nOriginal lesson and source basis: ${basis}\nTransfer started at lesson revision ${first.startedRevision}. Separate synthetic challenge: ${workflowTransferDisplayTitle(data)}.\nYour first answer: ${stateLabel(data.transfer,first.prediction.finalStateId)}; ${first.prediction.blockedCount} blocked ${first.prediction.blockedCount===1?'event':'events'}.\nYour first reasoning (ungraded): ${first.prediction.reasoning||'(none)'}\nPractice at transfer start (frozen inputs, not current practice): ${first.practiceAtStart.title}\nStart: ${stateLabel(first.practiceAtStart,first.practiceAtStart.initialStateId)}\nEvents: ${first.practiceAtStart.eventIds.map(value=>eventLabel(first.practiceAtStart,value)).join(' → ')}\nRules at transfer start:\n${first.practiceAtStart.rules.map(value=>`${stateLabel(first.practiceAtStart,value.fromStateId)} + ${eventLabel(first.practiceAtStart,value.eventId)} → ${stateLabel(first.practiceAtStart,value.toStateId)} (${value.enabled?'enabled':'disabled'})`).join('\n')}\nOriginal practice answer: ${stateLabel(first.practiceAtStart,first.practicePredictionAtStart.finalStateId)}; ${first.practicePredictionAtStart.blockedCount} blocked events.\nOriginal practice reasoning (ungraded): ${first.practicePredictionAtStart.reasoning||'(none)'}\nThese are the stored first inputs and answers. This section does not rerun or replace the attempt.`:'';
  return `${data.title}\n${view.origin==='synthetic-transfer'?workflowTransferDisplayTitle(data):view.problem.title}\nOrigin: ${view.origin}. ${view.origin === 'local-sample' ? 'Illustrative local sample; not an observed real procedure.' : view.origin === 'synthetic-transfer' ? 'Separate synthetic transfer; earlier exposure is not tracked and this is not a real procedure.' : 'Human-reviewed interpretation of the exact bound source; not automatic procedure inference.'}\nBasis: ${basis}\nExplanation mode: ${state.mode}; revision: ${state.revision}\nStart: ${stateLabel(view.problem, view.problem.initialStateId)}\nEvents: ${view.problem.eventIds.map(value => eventLabel(view.problem, value)).join(' → ')}\nRules:\n${rules}\nMissing or disabled rules block the event and preserve the current state. No external actions execute.\nAssumptions:\n${data.assumptions.join('\n') || '(none declared)'}\n${origins}\n${citations}${imageIssues?'\n'+imageIssues:''}\nUser corrections and experiments:\n${corrections || '(none)'}\n\n${view.assessment?.correction ?? 'Predict the final state and blocked-event count to reveal the computed trace.'}${view.assessment ? `\nRecorded reasoning (ungraded input): ${view.assessment.reasoning}` : ''}${trace}${prior}${view.change ? `\n${view.change.summary}` : ''}${causal}${savedFirst}\nThe first submitted transfer answer is retained. No claim of human learning is made.`;
}
export const workflowLab = Object.freeze({ kind: 'workflow-lab', schemaVersion: 1, parse, parseState, parseAction: (value: unknown) => decode(WorkflowActionSchema, value), initial, update, observe, firstTransfer, text: readable });
