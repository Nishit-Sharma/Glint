import { Schema } from 'effect';
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
function parse(value: unknown): WorkflowData {
  const data = decode(WorkflowDataSchema, value);
  validateWorkflowCase(data.practice); validateWorkflowCase(data.transfer);
  if (data.practice.id === data.transfer.id || normalizedPath(data.practice) === normalizedPath(data.transfer)) throw Error('The transfer must exercise a distinct state and event path.');
  unique(data.citations.map(value => value.id), 'Workflow citation identities must be unique.');
  unique(data.ruleOrigins.map(value => value.ruleId), 'Each practice rule needs one original interpretation.');
  if (data.ruleOrigins.length !== data.practice.rules.length || data.ruleOrigins.some(value => !data.practice.rules.some(rule => rule.id === value.ruleId))) throw Error('Every practice rule needs an explicit original interpretation.');
  if (data.ruleOrigins.some(value => value.citationId !== null && !data.citations.some(citation => citation.id === value.citationId))) throw Error('A rule citation must identify an included citation.');
  if (data.ruleOrigins.some(value => value.interpretation !== undefined && (data.basis.kind !== 'reviewed-source' || value.citationId === null))) throw Error('Rule interpretation classification requires an admitted reviewed source citation.');
  if (data.basis.kind === 'local-sample' && (data.citations.length || data.ruleOrigins.some(value => value.citationId !== null))) throw Error('A local sample cannot claim observed citations.');
  if (data.basis.kind === 'reviewed-source') {
    const basis = data.basis;
    unique(basis.sourceRefs.map(value => value.sourceId), 'Each reviewed source identity must be unique.');
    if (data.ruleOrigins.some(value => value.citationId === null)) throw Error('Every reviewed rule needs an explicit included source citation.');
    if (data.citations.some(value => !basis.sourceRefs.some(ref => ref.sourceId === value.sourceRef.sourceId && ref.version === value.sourceRef.version && ref.digest === value.sourceRef.digest))) throw Error('Every citation must match an exact reviewed source reference.');
    if (data.citations.some(value => value.location.end <= value.location.start || value.location.end - value.location.start !== value.location.quote.length)) throw Error('A citation needs an ordered exact-length text range and nonempty quote.');
  }
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
function changedResult(original: WorkflowCase, current: WorkflowResult) {
  const before = evaluate(original), changedSteps: { readonly index: number; readonly before: WorkflowStep | null; readonly after: WorkflowStep | null }[] = [];
  for (let offset = 0; offset < Math.max(before.steps.length, current.steps.length); offset++) {
    const prior = before.steps[offset] ?? null, next = current.steps[offset] ?? null;
    if (JSON.stringify(prior) !== JSON.stringify(next)) changedSteps.push({ index: offset + 1, before: prior, after: next });
  }
  return { originalFinalStateId: before.finalStateId, originalFinalStateLabel: before.finalStateLabel, currentFinalStateId: current.finalStateId, currentFinalStateLabel: current.finalStateLabel, originalBlockedCount: before.blockedCount, currentBlockedCount: current.blockedCount, changedSteps, summary: changedSteps.length ? `Compared with the original inputs, ${changedSteps.length} step(s) changed. Final state: ${before.finalStateLabel} → ${current.finalStateLabel}. Blocked events: ${before.blockedCount} → ${current.blockedCount}.` : 'The trace matches the original inputs; no event outcome changed.' };
}
function observe(dataValue: unknown, stateValue: unknown) {
  const data = parse(dataValue), state = parseState(data, stateValue), inTransfer = state.active === 'transfer';
  const problem = inTransfer ? data.transfer : state.practice;
  const guess = inTransfer ? state.transfer.kind === 'reviewed' ? state.transfer.prediction : null : state.practicePrediction;
  const result = guess ? evaluate(problem) : null;
  const phase = inTransfer ? guess ? 'transfer-reviewed' as const : 'transfer-predict' as const : guess ? 'practice-reviewed' as const : 'practice-predict' as const;
  return { origin: inTransfer ? 'synthetic-transfer' as const : data.basis.kind === 'local-sample' ? 'local-sample' as const : 'reviewed-source' as const, revision: state.revision, mode: state.mode, phase, problem, result, assessment: result && guess ? assess(problem, result, guess) : null, change: result && !inTransfer ? changedResult(data.practice, result) : null, canStartTransfer: !inTransfer && (state.transfer.kind !== 'not-started' || Boolean(state.practicePrediction && behavior(state.practice) !== behavior(data.practice) && normalizedPath(state.practice) !== normalizedPath(data.transfer))), transferStarted: state.transfer.kind !== 'not-started', assumptions: data.assumptions, ruleOrigins: data.ruleOrigins, citations: data.citations, editNotes: state.editNotes, basis: data.basis };
}
function readable(dataValue: unknown, stateValue?: unknown): string {
  const data = parse(dataValue), state = stateValue === undefined ? initial(data) : parseState(data, stateValue), view = observe(data, state);
  const rules = view.problem.rules.map(value => `${stateLabel(view.problem, value.fromStateId)} + ${eventLabel(view.problem, value.eventId)} → ${stateLabel(view.problem, value.toStateId)} (${value.enabled ? 'enabled' : 'disabled'})`).join('\n');
  const citationNumber=(id:string)=>data.citations.findIndex(value=>value.id===id)+1;
  const origins = data.ruleOrigins.map(value => {const rule=data.practice.rules.find(rule=>rule.id===value.ruleId)!;return `Original rule ${stateLabel(data.practice,rule.fromStateId)} + ${eventLabel(data.practice,rule.eventId)} → ${stateLabel(data.practice,rule.toStateId)}${value.interpretation==='source-stated'?' (Source-stated rule)':value.interpretation==='user-interpreted'?' (Your interpretation)':''}: ${value.reason}${value.citationId ? ` [Citation ${citationNumber(value.citationId)}]` : ' (declared interpretation; no source citation)'}`;}).join('\n');
  const sourceName=(ref:typeof data.citations[number]['sourceRef'])=>`Text source ${data.basis.kind==='reviewed-source'?data.basis.sourceRefs.findIndex(value=>value.sourceId===ref.sourceId&&value.version===ref.version&&value.digest===ref.digest)+1:1}, version ${ref.version}`;
  const citations = data.citations.map((value,index) => `Citation ${index+1} — ${sourceName(value.sourceRef)}; characters ${value.location.start}–${value.location.end}: “${value.location.quote}”`).join('\n');
  const basis=data.basis.kind==='local-sample'?`Local worked example, lesson version ${data.version}.`:`Reviewed text interpretation, lesson version ${data.version}; source artifact revision ${data.basis.artifact.revision}. ${data.basis.sourceRefs.map(sourceName).join('; ')}`;
  const prior=view.origin==='synthetic-transfer'&&state.transfer.kind!=='not-started'?`\nPractice before transfer: ${assess(state.transfer.practiceAtStart,evaluate(state.transfer.practiceAtStart),state.transfer.practicePredictionAtStart).correction}\nRecorded practice reasoning (ungraded): ${state.transfer.practicePredictionAtStart.reasoning||'(none)'}`:'';
  const trace = view.result ? `\nComputed trace:\n${view.result.steps.map(value => `${value.index}. ${value.eventLabel}: ${value.fromStateLabel} → ${value.toStateLabel} (${value.status})`).join('\n')}` : '';
  const corrections = state.editNotes.map(value => `Revision ${value.revision}: ${value.detail} User reason: ${value.reason}`).join('\n');
  return `${data.title}\n${view.problem.title}\nOrigin: ${view.origin}. ${view.origin === 'local-sample' ? 'Illustrative local sample; not an observed real procedure.' : view.origin === 'synthetic-transfer' ? 'Separate synthetic transfer; not a real procedure.' : 'Human-reviewed interpretation of the exact bound source; not automatic procedure inference.'}\nBasis: ${basis}\nExplanation mode: ${state.mode}; revision: ${state.revision}\nStart: ${stateLabel(view.problem, view.problem.initialStateId)}\nEvents: ${view.problem.eventIds.map(value => eventLabel(view.problem, value)).join(' → ')}\nRules:\n${rules}\nMissing or disabled rules block the event and preserve the current state. No external actions execute.\nAssumptions:\n${data.assumptions.join('\n') || '(none declared)'}\n${origins}\n${citations}\nUser corrections and experiments:\n${corrections || '(none)'}\n\n${view.assessment?.correction ?? 'Predict the final state and blocked-event count to reveal the computed trace.'}${view.assessment ? `\nRecorded reasoning (ungraded input): ${view.assessment.reasoning}` : ''}${trace}${prior}${view.change ? `\n${view.change.summary}` : ''}\nThe first submitted transfer answer is retained. No claim of human learning is made.`;
}
export const workflowLab = Object.freeze({ kind: 'workflow-lab', schemaVersion: 1, parse, parseState, parseAction: (value: unknown) => decode(WorkflowActionSchema, value), initial, update, observe, text: readable });
