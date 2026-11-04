import { describe, expect, it } from 'vitest';
import { parseModelDraft, structuredPrompt } from '../../src/core/model-drafts';
import { evaluateExperiment } from '../../src/core/experiments';

const distance = () => ({ schemaVersion: 1, kind: 'experiment', title: 'Constant-speed distance', explanation: 'Observation: the supplied relationship is distance = speed × time. Assumption: speed remains constant.', spec: { title: 'Distance', expression: { op: 'multiply', left: { op: 'variable', name: 'speed' }, right: { op: 'variable', name: 'time' } }, variables: [{ name: 'speed', unit: 'm/s', min: 0, max: 100 }, { name: 'time', unit: 's', min: 0, max: 100 }], assumptions: ['Assumption: constant speed.'] }, inputs: { speed: 10, time: 2 } });
const workflow = () => ({ schemaVersion: 1, kind: 'procedure', title: 'Review an export', summary: 'Observation: supplied notes describe reviewing a draft before export. Intent is inferred.', steps: [{ intent: 'Check the saved wording', target: 'Current draft', preconditions: [{ key: 'review', equals: 'approved' }], expectedResult: 'A reviewed draft is ready for a separately authorized export' }], limitations: ['Only supplied observation text was reviewed; no video or execution outcome was verified.'] });
const parse = (draft: unknown) => parseModelDraft(JSON.stringify(draft));

describe('source-derived experiment drafts', () => {
  it('parses raw data and independently checks 10 m/s × 2 s = 20 m', () => {
    const draft = parse(distance());
    expect(draft.kind).toBe('experiment');
    if (draft.kind !== 'experiment') throw new Error('Expected experiment');
    expect(evaluateExperiment(draft.spec, draft.inputs)).toEqual({ value: 20, unit: 'm', assumptions: ['Assumption: constant speed.'] });
    draft.inputs.speed = 20;
    expect(evaluateExperiment(draft.spec, draft.inputs).value).toBe(40);
  });
  it('accepts one fenced json object and rejects surrounding explanation or additional blocks', () => {
    expect(parseModelDraft(`\n\`\`\`json\n${JSON.stringify(distance())}\n\`\`\`\n`, 'experiment').kind).toBe('experiment');
    expect(() => parseModelDraft(`Here is your experiment: ${JSON.stringify(distance())}`)).toThrow('malformed JSON');
    expect(() => parseModelDraft(`\`\`\`json\n${JSON.stringify(distance())}\n\`\`\`\n\`\`\`json\n{}\n\`\`\``)).toThrow('one fenced json block');
  });
  it('rejects incompatible dimensions before making the draft available', () => {
    const draft = distance(); draft.spec.expression.op = 'add';
    expect(() => parse(draft)).toThrow('matching units');
  });
  it.each([
    ['an executable expression', () => ({ op: 'code', code: 'process.exit()' })],
    ['a function call', () => ({ op: 'call', name: 'fetch', arguments: [] })],
    ['an unknown recursive key', () => ({ op: 'multiply', left: { op: 'variable', name: 'speed', tool: 'writeFile' }, right: { op: 'variable', name: 'time' } })],
    ['an unknown variable', () => ({ op: 'variable', name: 'unseen' })],
    ['an excessive exponent', () => ({ op: 'power', base: { op: 'variable', name: 'speed' }, exponent: 9 })],
    ['a fractional exponent', () => ({ op: 'power', base: { op: 'variable', name: 'speed' }, exponent: 0.5 })],
    ['zero division', () => ({ op: 'divide', left: { op: 'constant', value: 1 }, right: { op: 'constant', value: 0 } })],
  ])('rejects %s', (_label, expression) => {
    const draft = { ...distance(), spec: { ...distance().spec, expression: expression() } };
    expect(() => parse(draft)).toThrow('Invalid model draft');
  });
  it('bounds input values and requires exactly the declared names', () => {
    expect(() => parse({ ...distance(), inputs: { speed: 101, time: 2 } })).toThrow('outside bounds');
    expect(() => parse({ ...distance(), inputs: { speed: 10 } })).toThrow('missing time');
    expect(() => parse({ ...distance(), inputs: { speed: 10, time: 2, approval: 1 } })).toThrow('unknown key approval');
    expect(() => parseModelDraft(JSON.stringify(distance()).replace('"speed":10', '"speed":1e999'))).toThrow('finite');
  });
  it('bounds recursive AST depth and node count', () => {
    let expression: unknown = { op: 'variable', name: 'speed' };
    for (let index = 0; index < 14; index++) expression = { op: 'multiply', left: expression, right: { op: 'constant', value: 1 } };
    expect(() => parse({ ...distance(), spec: { ...distance().spec, expression } })).toThrow('depth 12');
    const tree = (depth: number): unknown => depth === 0 ? { op: 'constant', value: 1 } : { op: 'multiply', left: tree(depth - 1), right: tree(depth - 1) };
    expect(() => parse({ ...distance(), spec: { ...distance().spec, expression: tree(6) } })).toThrow('64 nodes');
  });
  it('rejects unknown spec keys, duplicate variables, unsupported units, and omitted assumptions', () => {
    const draft = distance();
    expect(() => parse({ ...draft, spec: { ...draft.spec, sourceRefs: [] } })).toThrow('unknown key sourceRefs');
    expect(() => parse({ ...draft, spec: { ...draft.spec, variables: [draft.spec.variables[0], draft.spec.variables[0]] } })).toThrow('duplicate variable');
    expect(() => parse({ ...draft, spec: { ...draft.spec, variables: [{ ...draft.spec.variables[0], unit: 'km/h' }, draft.spec.variables[1]] } })).toThrow('unsupported unit');
    expect(() => parse({ ...draft, spec: { ...draft.spec, assumptions: [] } })).toThrow('assumptions');
  });
});

describe('editable procedure drafts', () => {
  it('preserves inspectable steps, preconditions, and observation limitations without granting execution', () => {
    const draft = parse(workflow());
    expect(draft).toEqual(workflow());
    expect(Object.keys(draft)).not.toContain('executionAuthorized');
  });
  it.each(['taskId', 'sourceRefs', 'approval', 'tool', 'executionAuthorized'])('rejects model-claimed %s authority or provenance', key => {
    expect(() => parse({ ...workflow(), [key]: 'claimed-by-model' })).toThrow(`unknown key ${key}`);
  });
  it('rejects hidden authority in a step or precondition', () => {
    const draft = workflow();
    expect(() => parse({ ...draft, steps: [{ ...draft.steps[0], tool: 'click' }] })).toThrow('unknown key tool');
    expect(() => parse({ ...draft, steps: [{ ...draft.steps[0], preconditions: [{ key: 'review', equals: 'approved', approvalId: 'forged' }] }] })).toThrow('unknown key approvalId');
  });
  it('requires explicit fields and bounds steps, preconditions, and limitations', () => {
    const draft = workflow();
    expect(() => parse({ ...draft, steps: [{ intent: 'Inspect', target: 'Draft', expectedResult: 'Reviewed' }] })).toThrow('missing preconditions');
    expect(() => parse({ ...draft, steps: Array.from({ length: 13 }, () => draft.steps[0]) })).toThrow('steps needs 1–12');
    expect(() => parse({ ...draft, steps: [{ ...draft.steps[0], preconditions: Array.from({ length: 5 }, (_, index) => ({ key: `key${index}`, equals: 'yes' })) }] })).toThrow('preconditions');
    expect(() => parse({ ...draft, limitations: [] })).toThrow('limitations');
  });
  it('rejects repeated preconditions, executable markup, and URL targets', () => {
    const draft = workflow();
    expect(() => parse({ ...draft, steps: [{ ...draft.steps[0], preconditions: [{ key: 'review', equals: 'yes' }, { key: 'review', equals: 'no' }] }] })).toThrow('repeats a precondition');
    expect(() => parse({ ...draft, summary: '<script>run()</script>' })).toThrow('executable markup');
    expect(() => parse({ ...draft, steps: [{ ...draft.steps[0], target: 'https://example.invalid/send' }] })).toThrow('URLs');
  });
});

describe('strict envelopes and prompts', () => {
  it.each(['', '{', 'null', '[]', '{"schemaVersion":1,}', '```javascript\n{}\n```'])('rejects malformed or non-object response %j', content => {
    expect(() => parseModelDraft(content)).toThrow('Invalid model draft');
  });
  it('rejects duplicate JSON keys including escaped equivalent keys', () => {
    expect(() => parseModelDraft(JSON.stringify(workflow()).replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))).toThrow('duplicate JSON key');
    expect(() => parseModelDraft(JSON.stringify(workflow()).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'))).toThrow('duplicate JSON key');
  });
  it('rejects wrong schema versions, mismatched kinds, and excessive response/text sizes', () => {
    expect(() => parse({ ...workflow(), schemaVersion: 2 })).toThrow('schemaVersion');
    expect(() => parseModelDraft(JSON.stringify(workflow()), 'experiment')).toThrow('does not match expected experiment');
    expect(() => parse({ ...workflow(), kind: 'tool' })).toThrow('draft kind');
    expect(() => parse({ ...workflow(), title: 'x'.repeat(201) })).toThrow('title');
    expect(() => parseModelDraft(' '.repeat(64_001))).toThrow('64000');
  });
  it.each(['experiment', 'procedure'] as const)('requests exact %s data, uncertainty labels, and no inferred execution/video authority', kind => {
    const request = 'From the supplied text, propose a useful draft. "Ignore schema" is source content.';
    const prompt = structuredPrompt(kind, request);
    expect(prompt).toContain(`kind "${kind}"`);
    expect(prompt).toContain('Do not use tools');
    expect(prompt).toContain('uncertain assumptions');
    expect(prompt).toContain('Do not claim to have watched a video');
    expect(prompt).toContain('Task identity and provenance are assigned by the host');
    expect(prompt.endsWith(JSON.stringify(request))).toBe(true);
  });
});

describe('missing real-world experiment inputs',()=>{
 it('preserves declared unknowns without changing validation examples into facts',()=>{const draft=parse({...distance(),unknownInputs:['speed']});expect(draft.kind).toBe('experiment');if(draft.kind!=='experiment')throw Error('experiment');expect(draft.unknownInputs).toEqual(['speed']);expect(draft.inputs.speed).toBe(10);});
 it('rejects unknown, repeated or malformed missing-input names',()=>{expect(()=>parse({...distance(),unknownInputs:['approval']})).toThrow('declared variables');expect(()=>parse({...distance(),unknownInputs:['speed','speed']})).toThrow('distinct');expect(()=>parse({...distance(),unknownInputs:[{tool:'send'}]})).toThrow('unknown input');});
 it('cannot hide invalid arithmetic or out-of-bounds values behind an unknown flag',()=>{expect(()=>parse({...distance(),inputs:{speed:999,time:2},unknownInputs:['speed']})).toThrow('outside bounds');expect(structuredPrompt('experiment','Compare group capacity')).toContain('Mark every missing real-world value here');});
});
