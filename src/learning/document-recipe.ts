import {Schema} from 'effect';

const text=(max:number)=>Schema.String.pipe(Schema.maxLength(max));
const note=text(200).pipe(Schema.minLength(1),Schema.filter(value=>value.trim().length>0));
const field=Schema.String.pipe(Schema.pattern(/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/));
const rev=Schema.Int.pipe(Schema.between(0,500));
const Step=Schema.Union(Schema.Struct({kind:Schema.Literal('text'),text:text(2000)}),Schema.Struct({kind:Schema.Literal('field'),name:field}));
const Receipt=Schema.Struct({step:Step,before:text(20000),after:text(20000)});
const Recording=Schema.Struct({input:text(8000),name:note,intent:note,steps:Schema.Array(Receipt).pipe(Schema.maxItems(16))});
const Expected=Schema.Union(Schema.Struct({kind:Schema.Literal('output'),text:text(20000)}),Schema.Struct({kind:Schema.Literal('stopped')}));
const Check=Schema.Struct({input:text(8000),expected:Expected});
const Definition=Schema.Struct({name:note,intent:note,template:text(8000),observation:Schema.NullOr(Recording),exceptions:Schema.Array(Schema.Struct({contains:text(160).pipe(Schema.minLength(1)),reason:note})).pipe(Schema.maxItems(8)),checks:Schema.Array(Check).pipe(Schema.maxItems(12))});
const Shape=Schema.Struct({kind:Schema.Literal('document-recipe'),revision:rev,draft:Definition,recording:Schema.NullOr(Recording),versions:Schema.Array(Schema.Struct({version:Schema.Int.pipe(Schema.between(1,20)),definition:Definition})).pipe(Schema.maxItems(20)),activeVersion:Schema.NullOr(Schema.Int.pipe(Schema.between(1,20))),activationHistory:Schema.Array(Schema.Int.pipe(Schema.between(1,20))).pipe(Schema.maxItems(40))});
export type DocumentRecipeState=typeof Shape.Type;
export type DocumentRecipeDefinition=typeof Definition.Type;
export type DocumentRecipeRecording=typeof Recording.Type;
export const DocumentRecipeDataSchema=Schema.Struct({kind:Schema.Literal('document-recipe'),schemaVersion:Schema.Literal(1),id:Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/)),title:note});
export const DocumentRecipeActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('document-recipe-start'),name:note,intent:note,input:text(8000),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-add'),step:Step,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-finish','document-recipe-cancel','document-recipe-save-version','document-recipe-rollback'),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-edit'),name:note,intent:note,template:text(8000),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-exception'),contains:text(160).pipe(Schema.minLength(1)),reason:note,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-remove-exception'),index:Schema.Int.pipe(Schema.between(0,7)),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-check'),...Check.fields,expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-remove-check'),index:Schema.Int.pipe(Schema.between(0,11)),expectedRevision:rev}),
 Schema.Struct({kind:Schema.Literal('document-recipe-activate'),version:Schema.Int.pipe(Schema.between(1,20)),expectedRevision:rev}),
);
export type DocumentRecipeAction=typeof DocumentRecipeActionSchema.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
export function documentRecipeFields(input:string):Readonly<Record<string,string>>{
 if(input.length>8000)throw Error('Use labelled notes up to 8,000 characters.');
 const pairs:Record<string,string>={};
 for(const line of input.split(/\r?\n/)){
  if(!line.trim())continue;
  const match=/^([A-Za-z][A-Za-z0-9 _-]{0,39}):[ \t]?(.*)$/.exec(line);
  if(!match||match[2].length>1000)throw Error('Use one Name: value per line, with values up to 1,000 characters.');
  const name=match[1].trim();if(Object.hasOwn(pairs,name))throw Error('Each field name must appear once. Duplicate labels need your review.');
  Object.defineProperty(pairs,name,{value:match[2],enumerable:true,configurable:true,writable:true});
 }
 if(!Object.keys(pairs).length||Object.keys(pairs).length>6)throw Error('Use one to six uniquely named fields.');
 return pairs;
}
function templateFields(template:string){
 if(!template.trim())throw Error('Add a document layout first.');
 const names=[...template.matchAll(/\{\{([^{}]+)\}\}/g)].map(match=>decode(field,match[1]));
 if(!names.length||/[{}]{2}/.test(template.replace(/\{\{([^{}]+)\}\}/g,'')))throw Error('Use at least one exact {{Field name}} and close every placeholder.');
 return names;
}
function recordingTemplate(recording:DocumentRecipeRecording){return recording.steps.map(({step})=>step.kind==='field'?`{{${step.name}}}`:step.text).join('');}
function replay(recording:DocumentRecipeRecording){
 const fields=documentRecipeFields(recording.input);let current='';
 for(const receipt of recording.steps){
  if(receipt.step.kind==='text'&&/[{}]{2}/.test(receipt.step.text))throw Error('Literal text cannot contain double braces; insert a named field instead.');
  if(receipt.step.kind==='field'&&!Object.hasOwn(fields,receipt.step.name))throw Error('Choose a field present in the demonstration.');
  const next=current+(receipt.step.kind==='text'?receipt.step.text:fields[receipt.step.name]);
  if(next.length>20000||receipt.before!==current||receipt.after!==next)throw Error('The demonstrated action and its before/after result do not agree.');
  current=next;
 }
 return current;
}
export type DocumentRecipeResult={kind:'output';text:string}|{kind:'stopped'|'invalid';reason:string};
export function runDocumentRecipe(definition:DocumentRecipeDefinition,input:string):DocumentRecipeResult{
 try{
  const exception=definition.exceptions.find(item=>input.includes(item.contains));if(exception)return {kind:'stopped',reason:exception.reason};
  const names=templateFields(definition.template),fields=documentRecipeFields(input);
  for(const name of names)if(!Object.hasOwn(fields,name)||fields[name].length===0)return {kind:'stopped',reason:`Required field “${name}” is missing or empty. No document was produced.`};
  const output=definition.template.replace(/\{\{([^{}]+)\}\}/g,(_match,name:string)=>fields[name]);
  if(output.length>20000)return {kind:'invalid',reason:'The complete document exceeds 20,000 characters. No partial output was produced.'};
  return {kind:'output',text:output};
 }catch(cause){return {kind:'invalid',reason:cause instanceof Error?cause.message:'Review the labelled notes and template.'};}
}
export function documentRecipeSuite(definition:DocumentRecipeDefinition){
 const cases=definition.checks.map(check=>{const result=runDocumentRecipe(definition,check.input);return {...check,result,passed:check.expected.kind==='output'?result.kind==='output'&&result.text===check.expected.text:result.kind==='stopped'};});
 const origin=definition.observation;
 let problem='';try{
  if(!origin)throw Error('Finish a local document demonstration first.');replay(origin);
  const allowed=documentRecipeFields(origin.input);for(const name of templateFields(definition.template))if(!Object.hasOwn(allowed,name))throw Error(`Field “${name}” was not present in the demonstration.`);
  if(!cases.some(item=>item.input!==origin.input&&item.expected.kind==='output'))throw Error('Declare a distinct success check with its exact expected document.');
  if(!cases.some(item=>item.expected.kind==='stopped'&&item.input!==origin.input))throw Error('Declare a separate stopped-input check and its exception or missing required field.');
  if(cases.some(item=>!item.passed))throw Error('Every declared check must pass before saving.');
 }catch(cause){problem=cause instanceof Error?cause.message:'Review this document recipe.';}
 return {cases,ready:!problem,problem};
}
function validateState(state:DocumentRecipeState){
 if(state.recording)replay(state.recording);if(state.draft.observation)replay(state.draft.observation);
 if(new Set(state.draft.checks.map(item=>item.input)).size!==state.draft.checks.length)throw Error('Checks need distinct exact inputs.');
 state.versions.forEach((version,index)=>{if(version.version!==index+1||!documentRecipeSuite(version.definition).ready)throw Error('Saved document recipe versions must keep their checked definitions.');});
 if([state.activeVersion,...state.activationHistory].some(version=>version!==null&&!state.versions.some(item=>item.version===version)))throw Error('The active document recipe version is unavailable.');
 return true;
}
export const DocumentRecipeStateSchema=Shape.pipe(Schema.filter(state=>{try{return validateState(state);}catch{return false;}}));
function initial():DocumentRecipeState{return {kind:'document-recipe',revision:0,draft:{name:'Document recipe',intent:'Compose a new document from labelled notes.',template:'',observation:null,exceptions:[],checks:[]},recording:null,versions:[],activeVersion:null,activationHistory:[]};}
function parseState(value:unknown){return decode(DocumentRecipeStateSchema,value);}
function update(value:unknown,actionValue:unknown):DocumentRecipeState{
 const state=parseState(value),action=decode(DocumentRecipeActionSchema,actionValue);
 if(action.expectedRevision!==state.revision)throw Error('This document recipe changed. Reload it before applying another edit.');
 if(state.revision===500)throw Error('This recipe reached its edit limit. Create a new recipe.');
 let next:DocumentRecipeState={...state,revision:state.revision+1};
 if(state.recording&&!['document-recipe-add','document-recipe-finish','document-recipe-cancel'].includes(action.kind))throw Error('Finish or cancel the demonstration before editing the recipe.');
 switch(action.kind){
  case 'document-recipe-start':documentRecipeFields(action.input);next={...next,recording:{name:action.name,intent:action.intent,input:action.input,steps:[]}};break;
  case 'document-recipe-add':{
   if(!state.recording)throw Error('Start a local demonstration first.');if(state.recording.steps.length>=16)throw Error('A document demonstration supports up to sixteen insertion actions.');
   const fields=documentRecipeFields(state.recording.input),before=replay(state.recording);
   if(action.step.kind==='field'&&!Object.hasOwn(fields,action.step.name))throw Error('Choose a demonstrated field.');
   const after=before+(action.step.kind==='text'?action.step.text:fields[action.step.name]);
   next={...next,recording:{...state.recording,steps:[...state.recording.steps,{step:action.step,before,after}]}};break;
  }
  case 'document-recipe-finish':{
   if(!state.recording?.steps.length)throw Error('Insert text and a field before finishing.');const template=recordingTemplate(state.recording);templateFields(template);const output=replay(state.recording);
   next={...next,recording:null,draft:{name:state.recording.name,intent:state.recording.intent,template,observation:state.recording,exceptions:[],checks:[{input:state.recording.input,expected:{kind:'output',text:output}}]}};break;
  }
  case 'document-recipe-cancel':next={...next,recording:null};break;
  case 'document-recipe-edit':next={...next,draft:{...state.draft,name:action.name,intent:action.intent,template:action.template}};break;
  case 'document-recipe-exception':if(state.draft.exceptions.length>=8)throw Error('Keep up to eight exceptions.');next={...next,draft:{...state.draft,exceptions:[...state.draft.exceptions,{contains:action.contains,reason:action.reason}]}};break;
  case 'document-recipe-remove-exception':next={...next,draft:{...state.draft,exceptions:state.draft.exceptions.filter((_,index)=>index!==action.index)}};break;
  case 'document-recipe-check':{
   const checks=state.draft.checks.filter(item=>item.input!==action.input);if(checks.length>=12)throw Error('Keep up to twelve declared checks.');next={...next,draft:{...state.draft,checks:[...checks,{input:action.input,expected:action.expected}]}};break;
  }
  case 'document-recipe-remove-check':next={...next,draft:{...state.draft,checks:state.draft.checks.filter((_,index)=>index!==action.index)}};break;
  case 'document-recipe-save-version':{
   const suite=documentRecipeSuite(state.draft);if(!suite.ready)throw Error(suite.problem);if(state.versions.length>=20)throw Error('This recipe supports up to twenty saved versions.');
   if(state.versions.some(item=>JSON.stringify(item.definition)===JSON.stringify(state.draft)))throw Error('This exact checked definition is already saved.');next={...next,versions:[...state.versions,{version:state.versions.length+1,definition:structuredClone(state.draft)}]};break;
  }
  case 'document-recipe-activate':if(!state.versions.some(item=>item.version===action.version))throw Error('Choose a checked saved version.');if(state.activeVersion===action.version)throw Error('This version is already active.');if(state.activationHistory.length>=40)throw Error('This recipe reached its activation limit.');next={...next,activeVersion:action.version,activationHistory:[...state.activationHistory,...(state.activeVersion===null?[]:[state.activeVersion])]};break;
  case 'document-recipe-rollback':{const previous=state.activationHistory.at(-1);if(previous===undefined)throw Error('No earlier active version is available.');next={...next,activeVersion:previous,activationHistory:state.activationHistory.slice(0,-1)};break;}
 }
 return parseState(next);
}
export const documentRecipe={initial,parseState,update,text:(_data:unknown,stateValue:unknown)=>{const state=parseState(stateValue);return `Local document recipe. ${state.versions.length} checked version(s); ${state.activeVersion===null?'inactive':`active version ${state.activeVersion}`}. Local teaching examples, template, fields, checks and outputs are excluded from automatic AI context. No browser or OS actions were recorded.`;}};
