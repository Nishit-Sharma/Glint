import { Schema } from 'effect';

export const limits = Object.freeze({ rowsPerTable: 12, columnsPerTable: 4, outputRows: 144, revisions: 500 });
const id = Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160));
const integer = Schema.Number.pipe(Schema.filter(Number.isSafeInteger));
const revision = integer.pipe(Schema.between(0, limits.revisions));
const cell = Schema.Union(Schema.Null, Schema.String.pipe(Schema.maxLength(160)), integer, Schema.Boolean);
const column = Schema.Struct({ id, label: text, type: Schema.Literal('string', 'integer', 'boolean') });
const row = Schema.Struct({ id, values: Schema.Array(cell).pipe(Schema.minItems(1), Schema.maxItems(limits.columnsPerTable)) });
const table = Schema.Struct({
  id, title: text,
  columns: Schema.Array(column).pipe(Schema.minItems(1), Schema.maxItems(limits.columnsPerTable)),
  rows: Schema.Array(row).pipe(Schema.maxItems(limits.rowsPerTable)),
});
const join = Schema.Struct({ mode: Schema.Literal('INNER', 'LEFT'), leftColumnId: id, rightColumnId: id });
const joinCase = Schema.Struct({ id, title: text, left: table, right: table, join });
const source = Schema.Struct({ sourceId: id, version: integer.pipe(Schema.positive()), digest: text });
const prediction = Schema.Struct({
  count: integer.pipe(Schema.between(0, limits.outputRows)),
  reasoning: Schema.String.pipe(Schema.maxLength(800)),
});
const deterministicOrigin: 'deterministic' = 'deterministic';

export const JoinLessonSchema = Schema.Struct({
  kind: Schema.Literal('join-lab'), schemaVersion: Schema.Literal(1), id,
  version: integer.pipe(Schema.positive()), title: text, source,
  practice: joinCase, transfer: joinCase,
});
export type JoinLesson = typeof JoinLessonSchema.Type;
export type JoinCase = typeof joinCase.Type;
export type Table = typeof table.Type;
export type Cell = typeof cell.Type;
type Prediction = typeof prediction.Type;

export const JoinStateSchema = Schema.Struct({
  kind: Schema.Literal('join-lab'), revision,
  lessonId: id, lessonVersion: integer.pipe(Schema.positive()), source,
  practice: joinCase, practiceEdits: revision,
  undoPractice: Schema.optional(joinCase),
  phase: Schema.Union(
    Schema.Struct({ kind: Schema.Literal('practice-predict') }),
    Schema.Struct({ kind: Schema.Literal('practice-reviewed'), prediction }),
    Schema.Struct({ kind: Schema.Literal('transfer-predict'), practicePrediction: prediction }),
    Schema.Struct({ kind: Schema.Literal('transfer-reviewed'), practicePrediction: prediction, prediction }),
  ),
});
export type JoinState = typeof JoinStateSchema.Type;
export const JoinActionSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('edit-row'), side: Schema.Literal('left', 'right'), rowId: id, values: row.fields.values, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('set-keys'), leftColumnId: id, rightColumnId: id, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('set-mode'), mode: Schema.Literal('INNER', 'LEFT'), expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('predict'), ...prediction.fields, expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('start-transfer'), expectedRevision: revision }),
  Schema.Struct({ kind: Schema.Literal('undo-practice'), expectedRevision: revision }),
);
export type JoinAction = typeof JoinActionSchema.Type;

function decode<A, I>(schema: Schema.Schema<A, I>, value: unknown): A {
  return Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value);
}
function unique(ids: readonly string[]) {
  if (new Set(ids).size !== ids.length) throw Error('Every lesson case, table, column and row needs a unique identity.');
}
function keyIndex(input: JoinCase, side: 'left' | 'right') {
  return input[side].columns.findIndex(candidate => candidate.id === (side === 'left' ? input.join.leftColumnId : input.join.rightColumnId));
}
export function validateJoinCase(input: JoinCase) {
  for (const current of [input.left, input.right]) {
    unique([current.id, ...current.columns.map(value => value.id), ...current.rows.map(value => value.id)]);
    for (const currentRow of current.rows) {
      if (currentRow.values.length !== current.columns.length) throw Error('Every row must have exactly one value per column.');
      current.columns.forEach((currentColumn, index) => {
        const value = currentRow.values[index];
        if (value === null) return;
        const valid = currentColumn.type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value) : typeof value === currentColumn.type;
        if (!valid) throw Error(`Cell ${currentRow.id}/${currentColumn.id} must be ${currentColumn.type} or NULL. No coercion is performed.`);
      });
    }
  }
  const leftKey = input.left.columns[keyIndex(input, 'left')];
  const rightKey = input.right.columns[keyIndex(input, 'right')];
  if (!leftKey || !rightKey) throw Error('Join keys must identify existing columns on the correct side.');
  if (leftKey.type !== rightKey.type) throw Error('Join keys must have the same declared type. No coercion is performed.');
}
function sameValue(left: Cell, right: Cell) {
  return left !== null && right !== null && left === right;
}
function matchingStructure(input: JoinCase) {
  const leftIndex = keyIndex(input, 'left'), rightIndex = keyIndex(input, 'right');
  return JSON.stringify({
    mode: input.join.mode,
    leftNulls: input.left.rows.map(value => value.values[leftIndex] === null),
    rightNulls: input.right.rows.map(value => value.values[rightIndex] === null),
    matches: input.left.rows.map(left => input.right.rows.map(right => sameValue(left.values[leftIndex], right.values[rightIndex]))),
  });
}
export function validateLesson(data: JoinLesson) {
  const cases = [data.practice, data.transfer];
  unique([data.id, ...cases.flatMap(input => [input.id, ...[input.left, input.right].flatMap(current => [current.id, ...current.columns.map(value => value.id), ...current.rows.map(value => value.id)])])]);
  cases.forEach(validateJoinCase);
  if (matchingStructure(data.practice) === matchingStructure(data.transfer)) throw Error('The separate challenge must differ in join mode or matching structure.');
}
function parse(value: unknown): JoinLesson {
  const data = decode(JoinLessonSchema, value);
  validateLesson(data);
  return data;
}
function tableIdentity(input: Table) {
  return { id: input.id, title: input.title, columns: input.columns.map(value => [value.id, value.label, value.type]), rowIds: input.rows.map(value => value.id) };
}
function parseState(data: JoinLesson, value: unknown): JoinState {
  const state = decode(JoinStateSchema, value);
  if (state.lessonId !== data.id || state.lessonVersion !== data.version || state.source.sourceId !== data.source.sourceId || state.source.version !== data.source.version || state.source.digest !== data.source.digest) throw Error('Saved state belongs to another lesson version or source.');
  if (state.practice.id !== data.practice.id || state.practice.title !== data.practice.title || ['left', 'right'].some(side => {
    const current = side === 'left' ? state.practice.left : state.practice.right;
    const original = side === 'left' ? data.practice.left : data.practice.right;
    return JSON.stringify(tableIdentity(current)) !== JSON.stringify(tableIdentity(original));
  })) throw Error('Saved state cannot replace lesson identities or columns.');
  validateJoinCase(state.practice);
  if (state.undoPractice) {
    const previous = state.undoPractice;
    validateJoinCase(previous);
    if (previous.id !== data.practice.id || previous.title !== data.practice.title || ['left', 'right'].some(side => JSON.stringify(tableIdentity(side === 'left' ? previous.left : previous.right)) !== JSON.stringify(tableIdentity(side === 'left' ? data.practice.left : data.practice.right)))) throw Error('Undo cannot replace lesson identities.');
  }
  if (state.practiceEdits > state.revision) throw Error('Saved edit count exceeds its revision.');
  if (state.practiceEdits === 0 && JSON.stringify(state.practice) !== JSON.stringify(data.practice)) throw Error('Changed practice values require a recorded edit.');
  const minimumStageSteps = { 'practice-predict': 0, 'practice-reviewed': 1, 'transfer-predict': 2, 'transfer-reviewed': 3 };
  if (state.revision < state.practiceEdits + minimumStageSteps[state.phase.kind]) throw Error('Saved lesson stage exceeds its revision.');
  if ((state.phase.kind === 'transfer-predict' || state.phase.kind === 'transfer-reviewed') && state.practiceEdits === 0) throw Error('Transfer requires an edited practice example.');
  if ((state.phase.kind === 'transfer-predict' || state.phase.kind === 'transfer-reviewed') && (matchingStructure(state.practice) === matchingStructure(data.practice) || matchingStructure(state.practice) === matchingStructure(data.transfer))) throw Error('Transfer requires a changed relationship and a distinct challenge.');
  return state;
}
function initial(value: unknown): JoinState {
  const data = parse(value);
  return { kind: 'join-lab', revision: 0, lessonId: data.id, lessonVersion: data.version, source: data.source, practice: data.practice, practiceEdits: 0, phase: { kind: 'practice-predict' } };
}

type Pair = {
  readonly id: string;
  readonly provenance: { readonly leftTableId: string; readonly leftRowId: string; readonly rightTableId: string; readonly rightRowId: string | null };
  readonly leftValues: readonly Cell[];
  readonly rightValues: readonly Cell[];
  readonly kind: 'matched' | 'left-unmatched';
};
type Contribution = { readonly leftRowId: string; readonly key: Cell; readonly matchingRightRowIds: readonly string[]; readonly outputCount: number; readonly reason: 'matches' | 'null-key' | 'no-match' };
type Observation = { readonly origin: 'deterministic'; readonly caseId: string; readonly rowCount: number; readonly rows: readonly Pair[]; readonly contributions: readonly Contribution[] };
type JoinKeys = Pick<JoinCase['join'],'leftColumnId'|'rightColumnId'>;
export type LastJoinEdit =
  | {kind:'mode';before:JoinCase['join']['mode'];after:JoinCase['join']['mode']}
  | {kind:'keys';before:JoinKeys;after:JoinKeys}
  | {kind:'cell';side:'left'|'right';rowId:string;columnId:string;before:Cell;after:Cell};
type RowContribution = Omit<Contribution,'leftRowId'>;
export type LastJoinChange = {
  beforeCount:number;afterCount:number;addedPairIds:string[];removedPairIds:string[];changedPairIds:string[];
  edits:LastJoinEdit[];rows:{leftRowId:string;before:RowContribution;after:RowContribution}[];
};
function evaluate(input: JoinCase): Observation {
  const rows: Pair[] = [], contributions: Contribution[] = [];
  const leftIndex = keyIndex(input, 'left'), rightIndex = keyIndex(input, 'right');
  for (const left of input.left.rows) {
    const key = left.values[leftIndex];
    const matches = input.right.rows.filter(right => sameValue(key, right.values[rightIndex]));
    for (const right of matches) rows.push({
      id: `${left.id}:${right.id}`, kind: 'matched',
      provenance: { leftTableId: input.left.id, leftRowId: left.id, rightTableId: input.right.id, rightRowId: right.id },
      leftValues: left.values, rightValues: right.values,
    });
    if (matches.length === 0 && input.join.mode === 'LEFT') rows.push({
      id: `${left.id}:@unmatched`, kind: 'left-unmatched',
      provenance: { leftTableId: input.left.id, leftRowId: left.id, rightTableId: input.right.id, rightRowId: null },
      leftValues: left.values, rightValues: input.right.columns.map(() => null),
    });
    contributions.push({ leftRowId: left.id, key, matchingRightRowIds: matches.map(right => right.id), outputCount: matches.length || (input.join.mode === 'LEFT' ? 1 : 0), reason: key === null ? 'null-key' : matches.length ? 'matches' : 'no-match' });
  }
  return { origin: 'deterministic', caseId: input.id, rowCount: rows.length, rows, contributions };
}
function assess(observation: Observation, guess: Prediction, mode: JoinCase['join']['mode']) {
  const details = observation.contributions.map(value => {
    if (value.reason === 'matches') return `${value.leftRowId} matches ${value.matchingRightRowIds.join(', ')} and contributes ${value.outputCount} row(s).`;
    const reason = value.reason === 'null-key' ? 'has a NULL key; equality is unknown even against NULL' : 'has no equal non-NULL right key';
    return `${value.leftRowId} ${reason}, contributing ${value.outputCount}${mode === 'LEFT' ? ' null-extended row(s)' : ' rows under INNER'}.`;
  });
  return {
    origin: deterministicOrigin, predictedCount: guess.count, actualCount: observation.rowCount,
    correct: guess.count === observation.rowCount, difference: observation.rowCount - guess.count,
    reasoning: guess.reasoning,
    correction: `${guess.count === observation.rowCount ? 'Correct.' : `You predicted ${guess.count}; the actual count is ${observation.rowCount}.`} ${details.join(' ')} Each equal pair is kept; duplicate keys are not deduplicated. Right-side NULL keys never satisfy equality.`,
  };
}
function update(dataValue: unknown, stateValue: unknown, actionValue: unknown): JoinState {
  const data = parse(dataValue), state = parseState(data, stateValue), action = decode(JoinActionSchema, actionValue);
  if (action.expectedRevision !== state.revision) throw Error('This lesson changed. Reload its current state before applying this action.');
  if (state.revision === limits.revisions) throw Error('This lesson reached its revision limit. Create a new module version.');
  if (action.kind === 'predict' && state.phase.kind === 'practice-predict') return {
    ...state, revision: state.revision + 1,
    phase: { kind: 'practice-reviewed', prediction: { count: action.count, reasoning: action.reasoning } },
  };
  if (action.kind === 'predict' && state.phase.kind === 'transfer-predict') return {
    ...state, revision: state.revision + 1,
    phase: { kind: 'transfer-reviewed', practicePrediction: state.phase.practicePrediction, prediction: { count: action.count, reasoning: action.reasoning } },
  };
  if (action.kind === 'start-transfer' && state.phase.kind === 'practice-reviewed' && state.practiceEdits > 0) {
    if (matchingStructure(data.practice) === matchingStructure(state.practice)) throw Error('Change a join relationship, then predict and inspect its result before transfer.');
    if (matchingStructure(data.transfer) === matchingStructure(state.practice)) throw Error('This challenge now matches your practice relationship. Start a new lesson with a distinct challenge.');
    return { ...state, revision: state.revision + 1, phase: { kind: 'transfer-predict', practicePrediction: state.phase.prediction } };
  }
  if (action.kind === 'undo-practice' && state.undoPractice && (state.phase.kind === 'practice-predict' || state.phase.kind === 'practice-reviewed')) {
    const {undoPractice, ...previous} = state;
    return { ...previous, revision: state.revision + 1, practiceEdits: state.practiceEdits + 1, practice: undoPractice, phase: { kind: 'practice-predict' } };
  }
  if (action.kind === 'edit-row' || action.kind === 'set-keys' || action.kind === 'set-mode') {
    if (state.phase.kind !== 'practice-predict' && state.phase.kind !== 'practice-reviewed') throw Error('The separate challenge cannot be edited.');
    let practice: JoinCase;
    if (action.kind === 'edit-row') {
      const current = state.practice[action.side];
      if (!current.rows.some(value => value.id === action.rowId)) throw Error('The row is not on the selected side.');
      const replacement = { ...current, rows: current.rows.map(value => value.id === action.rowId ? { ...value, values: action.values } : value) };
      practice = { ...state.practice, [action.side]: replacement };
    } else if (action.kind === 'set-keys') {
      practice = { ...state.practice, join: { ...state.practice.join, leftColumnId: action.leftColumnId, rightColumnId: action.rightColumnId } };
    } else {
      practice = { ...state.practice, join: { ...state.practice.join, mode: action.mode } };
    }
    validateJoinCase(practice);
    if (JSON.stringify(practice) === JSON.stringify(state.practice)) throw Error('Choose a change that alters the example.');
    return { ...state, revision: state.revision + 1, practiceEdits: state.practiceEdits + 1, undoPractice: state.practice, practice, phase: { kind: 'practice-predict' } };
  }
  throw Error('This action is not available at the current lesson stage.');
}
function observe(dataValue: unknown, stateValue: unknown) {
  const data = parse(dataValue), state = parseState(data, stateValue);
  const inTransfer = state.phase.kind === 'transfer-predict' || state.phase.kind === 'transfer-reviewed';
  const problem = inTransfer ? data.transfer : state.practice;
  const guess = state.phase.kind === 'practice-reviewed' || state.phase.kind === 'transfer-reviewed' ? state.phase.prediction : null;
  const observation = guess ? evaluate(problem) : null;
  const practiceObservation = inTransfer ? evaluate(state.practice) : null;
  return {
    origin: deterministicOrigin, revision: state.revision, source: data.source, phase: state.phase.kind, problem,
    observation,
    assessment: observation && guess ? assess(observation, guess, problem.join.mode) : null,
    change: observation && !inTransfer ? changedResult(data.practice, observation) : null,
    lastChange: observation && !inTransfer && state.undoPractice ? lastAppliedChange(state.undoPractice,state.practice,observation) : null,
    practiceReview: practiceObservation && (state.phase.kind === 'transfer-predict' || state.phase.kind === 'transfer-reviewed') ? {
      observation: practiceObservation, assessment: assess(practiceObservation, state.phase.practicePrediction, state.practice.join.mode),
      change: changedResult(data.practice, practiceObservation),
      lastChange: state.undoPractice ? lastAppliedChange(state.undoPractice,state.practice,practiceObservation) : null,
    } : null,
  };
}
function changedResult(original: JoinCase, current: Observation) {
  const before = evaluate(original);
  return {
    originalCount: before.rowCount, currentCount: current.rowCount,
    addedPairIds: current.rows.filter(value => !before.rows.some(previous => previous.id === value.id)).map(value => value.id),
    removedPairIds: before.rows.filter(value => !current.rows.some(next => next.id === value.id)).map(value => value.id),
    changedPairIds: current.rows.filter(value => before.rows.some(previous => previous.id === value.id && JSON.stringify(previous) !== JSON.stringify(value))).map(value => value.id),
  };
}
/** Derived only from the existing validated Undo snapshot. No result is stored,
 * and the caller reveals it only after the current practice prediction. */
function lastAppliedChange(before:JoinCase,after:JoinCase,current:Observation):LastJoinChange {
  const previous=evaluate(before),delta=changedResult(before,current),edits:LastJoinEdit[]=[];
  if(before.join.mode!==after.join.mode)edits.push({kind:'mode',before:before.join.mode,after:after.join.mode});
  if(before.join.leftColumnId!==after.join.leftColumnId||before.join.rightColumnId!==after.join.rightColumnId)edits.push({kind:'keys',before:{leftColumnId:before.join.leftColumnId,rightColumnId:before.join.rightColumnId},after:{leftColumnId:after.join.leftColumnId,rightColumnId:after.join.rightColumnId}});
  for(const side of ['left','right'] as const)for(const row of after[side].rows){
    const old=before[side].rows.find(value=>value.id===row.id)!;
    after[side].columns.forEach((column,index)=>{if(old.values[index]!==row.values[index])edits.push({kind:'cell',side,rowId:row.id,columnId:column.id,before:old.values[index],after:row.values[index]});});
  }
  const rows:LastJoinChange['rows']=[];
  for(const next of current.contributions){
    const prior=previous.contributions.find(value=>value.leftRowId===next.leftRowId)!;
    const {leftRowId,...oldContribution}=prior,{leftRowId:_,...newContribution}=next;
    const changedValues=current.rows.some(row=>row.provenance.leftRowId===leftRowId&&delta.changedPairIds.includes(row.id));
    if(JSON.stringify(oldContribution)!==JSON.stringify(newContribution)||changedValues)rows.push({leftRowId,before:oldContribution,after:newContribution});
  }
  return {beforeCount:previous.rowCount,afterCount:current.rowCount,addedPairIds:delta.addedPairIds,removedPairIds:delta.removedPairIds,changedPairIds:delta.changedPairIds,edits,rows};
}
/** Human-readable projection of computed practice differences, never a model
 * explanation or a reading of a newer source. */
export function describeLastJoinChange(problem:JoinCase,change:LastJoinChange) {
  const rowName=(side:'left'|'right',id:string)=>`${problem[side].title} row ${problem[side].rows.findIndex(row=>row.id===id)+1}`;
  const columnName=(side:'left'|'right',id:string)=>`${problem[side].title}.${problem[side].columns.find(column=>column.id===id)!.label}`;
  const value=(cell:Cell)=>cell===null?'NULL':typeof cell==='string'?JSON.stringify(cell):String(cell);
  const keys=(keys:JoinKeys)=>`${columnName('left',keys.leftColumnId)} = ${columnName('right',keys.rightColumnId)}`;
  const pairName=(id:string)=>{const [left,right]=id.split(':');return `${rowName('left',left)} → ${right==='@unmatched'?'No matching right row (NULL-extended)':rowName('right',right)}`;};
  const matches=(row:RowContribution)=>row.matchingRightRowIds.length?row.matchingRightRowIds.map(id=>rowName('right',id)).join(', '):row.outputCount?'No matching right row (NULL-extended)':'No output row';
  const contribution=(row:RowContribution)=>`${value(row.key)} ${row.reason==='matches'?`matches ${matches(row)}`:row.reason==='null-key'?'is NULL and never satisfies equality':'has no equal non-NULL right key'}; ${row.outputCount} output row(s)${row.reason!=='matches'&&row.outputCount?' because LEFT preserves the unmatched left row':''}`;
  return {
    summary:`Last applied practice change: ${change.beforeCount} → ${change.afterCount} output rows.`,
    effects:`Added ${change.addedPairIds.length}, removed ${change.removedPairIds.length}, changed displayed values in ${change.changedPairIds.length} pair(s).`,
    edits:change.edits.map(edit=>edit.kind==='mode'?`Join type: ${edit.before} → ${edit.after}.`:edit.kind==='keys'?`Join keys: ${keys(edit.before)} → ${keys(edit.after)}.`:`${rowName(edit.side,edit.rowId)}, ${problem[edit.side].columns.find(column=>column.id===edit.columnId)!.label}: ${value(edit.before)} → ${value(edit.after)}.`),
    rows:change.rows.map(row=>({label:rowName('left',row.leftRowId),before:contribution(row.before),after:contribution(row.after),beforePairs:matches(row.before),afterPairs:matches(row.after)})),
    unchanged:problem.left.rows.filter(row=>!change.rows.some(changed=>changed.leftRowId===row.id)).map(row=>rowName('left',row.id)),
    added:change.addedPairIds.map(pairName),removed:change.removedPairIds.map(pairName),changed:change.changedPairIds.map(pairName),
  };
}
function readable(dataValue: unknown, stateValue?: unknown): string {
  const data = parse(dataValue), state = stateValue === undefined ? initial(data) : parseState(data, stateValue);
  const view = observe(data, state);
  const tables = [view.problem.left, view.problem.right].map(current => `${current.title} (${current.id})\nColumns: ${current.columns.map(value => `${value.id} ${value.label} (${value.type})`).join(', ')}\n${current.rows.map(value => `${value.id}: ${JSON.stringify(value.values)}`).join('\n') || '(empty)'}`).join('\n\n');
  const pairs = view.observation ? `\nPaired row identities (${view.observation.rowCount}):\n${view.observation.rows.map(value => `${value.id} (${value.kind})`).join('\n') || '(none)'}` : '';
  const delta = view.change ?? view.practiceReview?.change;
  const change = delta ? `\nOriginal count: ${delta.originalCount}; current count: ${delta.currentCount}. Added pairs: ${delta.addedPairIds.join(', ') || '(none)'}. Removed pairs: ${delta.removedPairIds.join(', ') || '(none)'}. Changed pair values: ${delta.changedPairIds.join(', ') || '(none)'}.` : '';
  const practiceReview = view.practiceReview ? `\nPractice correction: ${view.practiceReview.assessment.correction}\nRecorded practice reasoning (ungraded input): ${JSON.stringify(view.practiceReview.assessment.reasoning)}` : '';
  const reasoning = view.assessment ? `\nRecorded reasoning (ungraded input): ${JSON.stringify(view.assessment.reasoning)}` : '';
  const lastChange=view.lastChange??view.practiceReview?.lastChange;
  const last=lastChange?describeLastJoinChange(state.practice,lastChange):null;
  const lastText=last?[last.summary,'Hypothetical local practice edits; the original supplied practice data is unchanged.',...last.edits,last.effects,...last.rows.map(row=>`${row.label}: before ${row.before}; after ${row.after}.`),...(last.unchanged.length?[`Unchanged output contributions: ${last.unchanged.join(', ')}.`]:[]),...last.added.map(pair=>`Added: ${pair}.`),...last.removed.map(pair=>`Removed: ${pair}.`),...last.changed.map(pair=>`Displayed values changed: ${pair}.`)].join('\n\n'):'';
  return `${data.title}\n${view.problem.title}\n${view.phase.startsWith('transfer')?'Separate synthetic challenge. Earlier exposure is not tracked.\n':''}Source: ${data.source.sourceId} version ${data.source.version}; digest ${data.source.digest}\nObservation revision: ${state.revision}\n${view.problem.join.mode} equality join on ${view.problem.join.leftColumnId} = ${view.problem.join.rightColumnId}.\n\n${tables}\n\n${view.assessment?.correction ?? 'Predict the result count to reveal paired rows.'}${reasoning}${pairs}${practiceReview}${change}${lastText?'\n'+lastText:''}\nNULL never matches under ordinary equality. Duplicate matches each produce a row. Types must agree; no coercion. Count correctness is checked; reasoning and human learning are not evaluated.`;
}

export const joinLab = Object.freeze({
  kind: 'join-lab', schemaVersion: 1, parse,
  parseAction: (value: unknown) => decode(JoinActionSchema, value),
  parseState: (dataValue: unknown, value: unknown) => parseState(parse(dataValue), value),
  initial, update, observe, text: readable,
});
