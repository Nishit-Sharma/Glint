import {Schema} from 'effect';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const short=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(160));
const input=Schema.String.pipe(Schema.maxLength(4_000));
const output=Schema.String.pipe(Schema.maxLength(16_000));
const rev=Schema.Int.pipe(Schema.between(0,500));
export const HelperOperationSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('trim','collapse-spaces','lowercase','uppercase')}),
 Schema.Struct({kind:Schema.Literal('replace-literal'),find:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80)),replacement:Schema.String.pipe(Schema.maxLength(80))}),
);
export type HelperOperation=typeof HelperOperationSchema.Type;
const textExamples=Schema.Array(Schema.Struct({before:Schema.String.pipe(Schema.maxLength(1000)),after:Schema.String.pipe(Schema.maxLength(1000))})).pipe(Schema.minItems(2),Schema.maxItems(2));
export type TextExampleProposal={id:string;operations:HelperOperation[];outputs:string[]};
const exception=Schema.Struct({id,contains:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80)),behavior:Schema.Literal('preserve','abstain'),reason:short});
const expected=Schema.Union(Schema.Struct({kind:Schema.Literal('output'),text:output}),Schema.Struct({kind:Schema.Literal('abstain')}));
const step=Schema.Struct({operation:HelperOperationSchema,before:output,after:output});
const runResult=Schema.Union(Schema.Struct({kind:Schema.Literal('output'),text:output,exceptionId:Schema.NullOr(id),trace:Schema.Array(step).pipe(Schema.maxItems(8))}),Schema.Struct({kind:Schema.Literal('abstain'),reason:short,exceptionId:id,trace:Schema.Array(step).pipe(Schema.maxItems(8))}));
const testCase=Schema.Struct({id,label:short,role:Schema.Literal('example','counterexample'),input,expected,demonstration:Schema.optional(Schema.Array(step).pipe(Schema.minItems(1),Schema.maxItems(8)))});
const definition=Schema.Struct({name:short,description:short,invocation:short,operations:Schema.Array(HelperOperationSchema).pipe(Schema.maxItems(8)),exceptions:Schema.Array(exception).pipe(Schema.maxItems(8)),tests:Schema.Array(testCase).pipe(Schema.maxItems(20))});
export type HelperDefinition=typeof definition.Type;
const version=Schema.Struct({version:Schema.Int.pipe(Schema.between(1,20)),savedAtRevision:rev,changeNote:short,definition});
export const HelperDataSchema=Schema.Struct({kind:Schema.Literal('helper-studio'),schemaVersion:Schema.Literal(1),id,title:short,description:short});
export type HelperData=typeof HelperDataSchema.Type;
export const HelperStateSchema=Schema.Struct({kind:Schema.Literal('helper-studio'),helperId:id,revision:rev,draft:definition,versions:Schema.Array(version).pipe(Schema.maxItems(20)),activeVersion:Schema.NullOr(Schema.Int.pipe(Schema.between(1,20))),recording:Schema.NullOr(Schema.Struct({input,current:output,steps:Schema.Array(step).pipe(Schema.maxItems(8))})),lastRun:Schema.optional(Schema.NullOr(Schema.Struct({version:Schema.Int.pipe(Schema.between(1,20)),input,result:runResult})))});
export type HelperState=typeof HelperStateSchema.Type;
export const HelperActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('apply-example-proposal'),examples:textExamples,proposalId:id,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('start-demonstration'),input,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('demonstrate-step'),operation:HelperOperationSchema,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('finish-demonstration','cancel-demonstration','clear-operations'),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('append-operation'),operation:HelperOperationSchema,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('set-details'),name:short,description:short,invocation:short,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('add-exception'),exception,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('remove-exception'),id,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('add-test'),test:testCase,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('remove-test'),id,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('save-version'),changeNote:short,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('activate-version','restore-version'),version:Schema.Int.pipe(Schema.between(1,20)),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('deactivate'),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('run-active'),input,expectedRevision:rev}),
);
export type HelperAction=typeof HelperActionSchema.Type;
function decode<A,I>(schema:Schema.Schema<A,I>,value:unknown):A{return Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);}
function operation(value:string,op:HelperOperation):string {
 let result:string;
 switch(op.kind){
  case 'trim':result=value.trim();break;
  case 'collapse-spaces':result=value.replace(/[ \t]+/g,' ');break;
  case 'lowercase':result=value.toLowerCase();break;
  case 'uppercase':result=value.toUpperCase();break;
  case 'replace-literal':result=value.split(op.find).join(op.replacement);break;
 }
 if(result.length>16_000)throw Error('The output exceeds the local text limit.');
 return result;
}
/** Pasted pairs constrain a closed formatting family; they are not observations. */
export function proposeHelperFromExamples(value:unknown):TextExampleProposal[]{
 const examples=decode(textExamples,value);
 if(examples[0].before===examples[1].before)throw Error(examples[0].after===examples[1].after?'Use two different inputs.':'The same input has conflicting expected outputs.');
 if(examples.every(example=>example.before===example.after))throw Error('Show at least one changed output before proposing steps.');
 const proposals:TextExampleProposal[]=[];
 for(const trim of [false,true])for(const collapse of [false,true])for(const casing of [null,'lowercase','uppercase'] as const){
  const operations:HelperOperation[]=[];if(trim)operations.push({kind:'trim'});if(collapse)operations.push({kind:'collapse-spaces'});if(casing)operations.push({kind:casing});if(!operations.length)continue;
  const outputs=examples.map(example=>operations.reduce((text,step)=>operation(text,step),example.before));
  if(outputs.every((text,index)=>text===examples[index].after))proposals.push({id:operations.map(step=>step.kind).join('-'),operations,outputs});
 }
 return proposals;
}
function execute(data:HelperDefinition,value:string){
 const special=data.exceptions.find(rule=>value.includes(rule.contains));
 if(special?.behavior==='abstain')return {kind:'abstain' as const,reason:special.reason,exceptionId:special.id,trace:[]};
 if(special)return {kind:'output' as const,text:value,exceptionId:special.id,trace:[]};
 const trace:{operation:HelperOperation;before:string;after:string}[]=[];
 let text=value;
 for(const op of data.operations){const before=text;text=operation(text,op);trace.push({operation:op,before,after:text});}
 return {kind:'output' as const,text,exceptionId:null,trace};
}
function unique(values:readonly string[]){if(new Set(values).size!==values.length)throw Error('Test and exception identities must be unique.');}
function validateDefinition(data:HelperDefinition){
 unique(data.tests.map(t=>t.id));unique(data.exceptions.map(t=>t.id));unique(data.exceptions.map(t=>t.contains));
 for(const test of data.tests){
  if(!test.demonstration)continue;
  let current=test.input;
  for(const event of test.demonstration){
   if(event.before!==current||operation(current,event.operation)!==event.after)throw Error('The demonstration action/result trace is inconsistent.');
   current=event.after;
  }
 }
}
export function checkHelper(value:unknown){
 const data=decode(definition,value);validateDefinition(data);
 const cases=data.tests.map(test=>{
  try{const actual=execute(data,test.input);const passed=actual.kind===test.expected.kind&&(actual.kind!=='output'||test.expected.kind!=='output'||actual.text===test.expected.text);return {id:test.id,label:test.label,role:test.role,passed,expected:test.expected,actual,error:null};}
  catch(cause){return {id:test.id,label:test.label,role:test.role,passed:false,expected:test.expected,actual:null,error:cause instanceof Error?cause.message:'Could not execute this test.'};}
 });
 const exampleInputs=new Set(data.tests.filter(t=>t.role==='example').map(t=>t.input));
 const coverageIssues:string[]=[];
 if(data.operations.length===0)coverageIssues.push('Add at least one transformation.');
 if(exampleInputs.size===0)coverageIssues.push('Add an example.');
 if(!data.tests.some(t=>t.role==='counterexample'&&!exampleInputs.has(t.input)))coverageIssues.push('Add a counterexample with different input.');
 for(const rule of data.exceptions)if(!cases.some(c=>c.actual?.exceptionId===rule.id))coverageIssues.push(`Exercise exception ${rule.id} in a check.`);
 const covered=coverageIssues.length===0;
 return {passed:covered&&cases.every(c=>c.passed),covered,coverageIssues,cases};
}
function parseState(dataValue:unknown,value:unknown):HelperState{
 const data=decode(HelperDataSchema,dataValue),state=decode(HelperStateSchema,value);
 if(state.helperId!==data.id)throw Error('This helper state belongs to a different helper.');
 validateDefinition(state.draft);
 state.versions.forEach((v,index)=>{validateDefinition(v.definition);if(v.version!==index+1||v.savedAtRevision>state.revision||!checkHelper(v.definition).passed)throw Error('Saved helper versions must be ordered, tested immutable snapshots.');});
 if(state.activeVersion!==null&&!state.versions.some(v=>v.version===state.activeVersion))throw Error('The active helper version is unavailable.');
 if(state.lastRun){const run=state.lastRun,saved=state.versions.find(v=>v.version===run.version);if(!saved||JSON.stringify(execute(saved.definition,run.input))!==JSON.stringify(run.result))throw Error('Saved helper output does not match its exact input and version.');}
 if(state.recording){let current=state.recording.input;for(const event of state.recording.steps){if(event.before!==current||operation(current,event.operation)!==event.after)throw Error('Invalid recording trace.');current=event.after;}if(current!==state.recording.current)throw Error('Recording output does not match its actions.');}
 return state;
}
function initial(dataValue:unknown):HelperState{
 const data=decode(HelperDataSchema,dataValue);
 return {kind:'helper-studio',helperId:data.id,revision:0,draft:{name:data.title,description:data.description,invocation:'Clean this pasted label',operations:[],exceptions:[],tests:[]},versions:[],activeVersion:null,recording:null};
}
function update(dataValue:unknown,stateValue:unknown,actionValue:unknown):HelperState{
 const state=parseState(dataValue,stateValue),action=decode(HelperActionSchema,actionValue);
 if(action.expectedRevision!==state.revision)throw Error('This helper changed. Reload it before applying the correction.');
 if(state.revision>=500)throw Error('The helper reached its local revision limit.');
 let next:HelperState={...state,revision:state.revision+1,lastRun:null};
 if(action.kind==='start-demonstration'){
  if(state.recording)throw Error('Finish or cancel the current demonstration first.');
  next={...next,recording:{input:action.input,current:action.input,steps:[]}};
 } else if(action.kind==='demonstrate-step'){
  if(!state.recording)throw Error('Start an explicit demonstration first.');
  const after=operation(state.recording.current,action.operation);
  next={...next,recording:{...state.recording,current:after,steps:[...state.recording.steps,{operation:action.operation,before:state.recording.current,after}]}};
 } else if(action.kind==='finish-demonstration'){
  if(!state.recording?.steps.length)throw Error('Demonstrate at least one transformation.');
  next={...next,recording:null,draft:{...state.draft,operations:state.recording.steps.map(event=>event.operation),tests:[...state.draft.tests,{id:`demo-${state.revision}`,label:'Recorded local demonstration',role:'example',input:state.recording.input,expected:{kind:'output',text:state.recording.current},demonstration:state.recording.steps}]}};
 } else if(action.kind==='cancel-demonstration')next={...next,recording:null};
 else {
  if(state.recording)throw Error('Finish or cancel the demonstration before changing this helper.');
  switch(action.kind){
   case 'apply-example-proposal':{
    const proposed=proposeHelperFromExamples(action.examples).find(proposal=>proposal.id===action.proposalId);
    if(!proposed)throw Error('Choose a matching proposal for these exact examples.');
    if(state.draft.tests.length+2>20)throw Error('Make room for two declared checks before applying this proposal.');
    next={...next,draft:{...state.draft,operations:proposed.operations,tests:[...state.draft.tests,...action.examples.map((example,index)=>({id:`declared-${next.revision}-${index+1}`,label:`Pasted before/after example ${index+1}`,role:'example' as const,input:example.before,expected:{kind:'output' as const,text:example.after}}))]}};break;
   }
   case 'append-operation':next={...next,draft:{...state.draft,operations:[...state.draft.operations,action.operation]}};break;
   case 'clear-operations':next={...next,draft:{...state.draft,operations:[]}};break;
   case 'set-details':next={...next,draft:{...state.draft,name:action.name,description:action.description,invocation:action.invocation}};break;
   case 'add-exception':next={...next,draft:{...state.draft,exceptions:[...state.draft.exceptions,action.exception]}};break;
   case 'remove-exception':next={...next,draft:{...state.draft,exceptions:state.draft.exceptions.filter(value=>value.id!==action.id)}};break;
   case 'add-test':next={...next,draft:{...state.draft,tests:[...state.draft.tests.filter(t=>t.id!==action.test.id),action.test]}};break;
   case 'remove-test':next={...next,draft:{...state.draft,tests:state.draft.tests.filter(t=>t.id!==action.id)}};break;
   case 'save-version':{
    if(!checkHelper(state.draft).passed)throw Error('Pass the example and counterexample tests before saving a version.');
    next={...next,versions:[...state.versions,{version:state.versions.length+1,savedAtRevision:next.revision,changeNote:action.changeNote,definition:state.draft}]};break;
   }
   case 'activate-version':case 'restore-version':{
    const saved=state.versions.find(v=>v.version===action.version);if(!saved)throw Error('That saved version is unavailable.');
    next=action.kind==='activate-version'?{...next,activeVersion:saved.version}:{...next,draft:saved.definition};break;
   }
   case 'deactivate':next={...next,activeVersion:null};break;
   case 'run-active':{
    const saved=state.versions.find(v=>v.version===state.activeVersion);if(!saved)throw Error('Activate a saved version before running this helper.');
    next={...next,lastRun:{version:saved.version,input:action.input,result:execute(saved.definition,action.input)}};break;
   }
  }
 }
 return parseState(dataValue,next);
}
export function runHelper(stateValue:unknown,inputValue:unknown,hostValue:unknown){
 decode(Schema.Struct({capability:Schema.Literal('local-text')}),hostValue);
 const header=decode(HelperStateSchema,stateValue);
 const state=parseState({kind:'helper-studio',schemaVersion:1,id:header.helperId,title:'Local helper',description:'Local text transformation'},stateValue);
 const text=decode(input,inputValue),active=state.versions.find(v=>v.version===state.activeVersion);
 if(!active)throw Error('Activate a saved version before running this helper.');
 return {...execute(active.definition,text),helperId:state.helperId,version:active.version};
}
/** A saved result is evidence of what ran, not an automatic expected answer. */
export function textRunCheckReview(dataValue:unknown,stateValue:unknown){
 const state=parseState(dataValue,stateValue),run=state.lastRun;
 if(!run)throw Error('Run the active helper before reviewing a fresh input.');
 if(state.recording)throw Error('Finish or cancel the demonstration first.');
 if(state.draft.tests.length>=20)throw Error('Make room for another declared check first.');
 if(state.draft.tests.some(check=>check.input===run.input))throw Error('This exact input already has a draft check. Review or edit that check.');
 const choices=run.result.kind==='output'?[{id:'saved-output',label:'Use this saved exact output as my expectation'},{id:'different-output',label:'Write a different exact output'},{id:'abstain',label:'Expect abstention instead'}]:[{id:'saved-abstention',label:'Use this saved abstention as my expectation'},{id:'different-output',label:'Expect exact text instead'}];
 return {binding:JSON.stringify([state.helperId,state.revision,run.version,run.input]),run,choices};
}
export function textRunCheckFields(dataValue:unknown,stateValue:unknown,requestValue:unknown){
 const state=parseState(dataValue,stateValue),request=decode(Schema.Struct({expectedRevision:rev,runVersion:Schema.Int.pipe(Schema.between(1,20)),runInput:input,choice:Schema.Literal('saved-output','saved-abstention','different-output','abstain')}),requestValue);
 if(state.revision!==request.expectedRevision)throw Error('This helper changed. Review the current saved run first.');
 const review=textRunCheckReview(dataValue,state);
 if(review.run.version!==request.runVersion||review.run.input!==request.runInput)throw Error('This is not the current saved run.');
 if(!review.choices.some(choice=>choice.id===request.choice))throw Error('Choose an expected outcome offered for this run.');
 const abstain=request.choice==='saved-abstention'||request.choice==='abstain';
 return {editingTest:'',testInput:review.run.input,testOutput:request.choice==='saved-output'&&review.run.result.kind==='output'?review.run.result.text:'',testKind:abstain?'abstain' as const:'output' as const,testRole:'counterexample' as const};
}
/** Read-only trial of two immutable checked versions; activation and state stay untouched. */
export function compareSavedHelperVersions(dataValue:unknown,stateValue:unknown,requestValue:unknown){
 const state=parseState(dataValue,stateValue),request=decode(Schema.Struct({referenceVersion:Schema.Int.pipe(Schema.between(1,20)),candidateVersion:Schema.Int.pipe(Schema.between(1,20)),input}),requestValue);
 if(request.referenceVersion===request.candidateVersion)throw Error('Choose two different saved versions.');
 const reference=state.versions.find(saved=>saved.version===request.referenceVersion),candidate=state.versions.find(saved=>saved.version===request.candidateVersion);
 if(!reference||!candidate)throw Error('Choose two available saved versions.');
 const trial=(saved:typeof reference)=>{try{const result=execute(saved.definition,request.input);return {version:saved.version,changeNote:saved.changeNote,result,error:null,exception:saved.definition.exceptions.find(rule=>rule.id===result.exceptionId)??null};}catch(cause){return {version:saved.version,changeNote:saved.changeNote,result:null,error:cause instanceof Error?cause.message:'This version could not compute the input.',exception:null};}};
 const before=trial(reference),after=trial(candidate),visible=(result:NonNullable<typeof before.result>)=>result.kind==='output'?{kind:result.kind,text:result.text}:{kind:result.kind,reason:result.reason};
 return {helperId:state.helperId,input:request.input,reference:before,candidate:after,sameOutcome:before.result&&after.result?JSON.stringify(visible(before.result))===JSON.stringify(visible(after.result)):null};
}
export function discoverHelper(dataValue:unknown,stateValue:unknown,query=''){
 const data=decode(HelperDataSchema,dataValue),state=parseState(data,stateValue),active=state.versions.find(v=>v.version===state.activeVersion);
 if(!active)return null;
 const d=active.definition;
 if(query&&!`${d.name} ${d.description} ${d.invocation}`.toLowerCase().includes(query.toLowerCase()))return null;
 return {id:data.id,name:d.name,description:d.description,invocation:d.invocation,version:active.version,example:d.tests.find(t=>t.role==='example'),scope:'Pasted text in this helper only'};
}
function quotedText(label:string,value:string){
 const longest=Math.max(0,...(value.match(/`+/g)??[]).map(run=>run.length));
 const fence='`'.repeat(Math.max(3,longest+1));
 return `${label}\n\n${fence}text\n${value}\n${fence}`;
}
function operationText(value:HelperOperation):string{
 switch(value.kind){
  case 'trim':return 'Trim edges — remove whitespace at the beginning and end.';
  case 'collapse-spaces':return 'Collapse spaces and tabs — replace each consecutive group with one space.';
  case 'lowercase':return 'Convert to lowercase.';
  case 'uppercase':return 'Convert to uppercase.';
  case 'replace-literal':return ['Replace exact text — replace every literal match, with no pattern matching.',quotedText('Find',value.find),quotedText('Replace with',value.replacement)].join('\n\n');
 }
}
function operationsText(values:readonly HelperOperation[]){return values.length?values.map((value,index)=>`${index+1}. ${operationText(value)}`).join('\n\n'):'No operations yet.';}
function exceptionsText(values:HelperDefinition['exceptions']){
 return ['First matching exception wins, before any text operation.',...values.map((value,index)=>[
  `Exception ${index+1}: ${value.behavior==='preserve'?'Preserve the original input.':'Abstain and leave the input for manual handling.'}`,
  quotedText('If the input contains this exact text',value.contains),quotedText('Reason',value.reason),
 ].join('\n\n')),...(!values.length?['No exceptions.']:[])].join('\n\n');
}
function demonstrationText(input:string,steps:ReadonlyArray<typeof step.Type>){
 return [quotedText('Recorded input',input),...steps.map((event,index)=>[
  `Recorded step ${index+1}: ${operationText(event.operation)}`,
  quotedText('Before this step',event.before),quotedText('After this step',event.after),
 ].join('\n\n')),quotedText('Recorded result',steps.at(-1)?.after??input)].join('\n\n');
}
function helperText(dataValue:unknown,stateValue?:unknown){
 const data=decode(HelperDataSchema,dataValue),state=stateValue===undefined?initial(data):parseState(data,stateValue),suite=checkHelper(state.draft);
 const active=state.versions.find(version=>version.version===state.activeVersion),run=state.lastRun;
 const latestRun:string[]=[];
 if(run){
  const definition=state.versions.find(saved=>saved.version===run.version)!.definition;
  const exception=definition.exceptions.find(rule=>rule.id===run.result.exceptionId);
  latestRun.push(`## Latest run — version ${run.version}`,`Last run used version ${run.version}. This result belongs to that saved definition.`,quotedText('Run input',run.input),run.result.kind==='output'?quotedText('Run result',run.result.text):['Abstained.',quotedText('Reason',run.result.reason)].join('\n\n'),exception?quotedText('Applied exception reason',exception.reason):'No exception matched.');
 }else latestRun.push('## Latest run','No run is recorded for the current state.');
 const sections=[
  '# Text helper',quotedText('Helper name',state.draft.name),quotedText('Description',state.draft.description),
  quotedText('Discovery label (used to find this helper, not a chat command)',state.draft.invocation),
  'Scope: deterministic operations on pasted text in this helper. Input is limited to 4,000 characters; output is limited to 16,000 characters. No screen, browser or generated-code execution.',
  `Active version: ${state.activeVersion??'none'}.`,
  ...latestRun,
  '## Saved versions',
  ...state.versions.map(saved=>[
   `Version ${saved.version} — ${saved.version===state.activeVersion?'active':'inactive saved version'}. Saved after all ${saved.definition.tests.length} checks passed.`,
   quotedText('Change note',saved.changeNote),
  ].join('\n\n')),
  ...(!state.versions.length?['No saved versions.']:[]),
  '## Active saved definition',
  ...(active?[
   quotedText('Saved helper name',active.definition.name),quotedText('Saved description',active.definition.description),quotedText('Saved discovery label',active.definition.invocation),
   'Active version operations',operationsText(active.definition.operations),'Active version exceptions',exceptionsText(active.definition.exceptions),
  ]:['Activate a tested saved version before running it.']),
  '## Current draft',
  'Draft edits take effect in a run only after a tested version is saved and activated.',
  'Draft operations',operationsText(state.draft.operations),'Draft exceptions',exceptionsText(state.draft.exceptions),
 ];
 if(state.recording)sections.push('## Demonstration in progress','This recording has not been added as a draft example.',demonstrationText(state.recording.input,state.recording.steps));
 for(const [index,test] of state.draft.tests.entries())if(test.demonstration)sections.push(
  `## Recorded demonstration for check ${index+1}`,
  'These are the originally recorded operations and results. The current check expectation appears separately below.',
  demonstrationText(test.input,test.demonstration),
 );
 sections.push('## Current draft checks',`Draft tests: ${suite.passed?'passed':'not passed'}. ${suite.cases.filter(check=>check.passed).length} / ${suite.cases.length} passing. Required coverage: ${suite.covered?'met':'not yet met'}.`,'Saving requires at least one operation, an example, a counterexample with different input, and a check that exercises each exception.');
 for(const [index,check] of suite.cases.entries()){
  const test=state.draft.tests[index];
  sections.push(
   `Check ${index+1} — ${check.role==='example'?'Example':'Counterexample'} — ${check.passed?'Pass':'Fail'}`,
   quotedText('Check label',test.label),quotedText('Check input',test.input),
   check.expected.kind==='output'?quotedText('Expected result',check.expected.text):'Expected result: Abstain.',
   check.actual?.kind==='output'?quotedText('Computed result',check.actual.text):check.actual?.kind==='abstain'?['Computed result: Abstained.',quotedText('Reason',check.actual.reason)].join('\n\n'):quotedText('Check could not run',check.error??'No result.'),
  );
 }
 return sections.join('\n\n');
}
export const helperStudio=Object.freeze({kind:'helper-studio',schemaVersion:1,parse:(value:unknown)=>decode(HelperDataSchema,value),parseState,parseAction:(value:unknown)=>decode(HelperActionSchema,value),initial,update,text:helperText});
