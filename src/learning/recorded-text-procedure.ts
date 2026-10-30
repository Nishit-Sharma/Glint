import {helperStudio,type HelperData,type HelperState} from './reusable-helper';
import {applyHelperOperation} from './text-operation';
import {parseSemanticProcedure,type SemanticStep} from './semantic-procedure';
import {createSemanticRecording} from './semantic-demonstration';
import {semanticHelper} from './semantic-helper';

export type RecordedTextOrigin=NonNullable<HelperData['recordedText']>;
/** Convert only the recorded local actions. Exceptions and later manual edits are not inferred. */
export function recordedTextOrigin(source:RecordedTextOrigin['source'],data:HelperData,value:unknown,observationId:string):RecordedTextOrigin{
 const state=helperStudio.parseState(data,value) as HelperState;
 if(state.recording)throw Error('Finish or cancel the current demonstration before proposing a separate helper.');
 if(state.draft.exceptions.length)throw Error('Text exceptions cannot be transferred automatically. Keep this helper, or review a new recording without exceptions before proposing typed steps.');
 const observation=state.observations?.find(item=>item.id===observationId);
 if(!observation)throw Error('Record and finish a new local demonstration first. Earlier declared examples are not recorded actions.');
 const origin={kind:'owned-local-text-actions' as const,physicalGestureVerified:false as const,effectAuthority:'none' as const,source,observation};
 recordedTextProcedure(origin);return origin;
}
export function recordedTextProcedure(origin:RecordedTextOrigin){
 const observation=origin.observation;
 if(observation.atRevision>origin.source.stateRevision||observation.id!==`observed-${observation.atRevision}`)throw Error('The recorded text receipt differs from its source revision.');
 if(!observation.steps.length||observation.steps.length>6)throw Error('A staged proposal supports one to six recorded text operations. Keep this helper for longer demonstrations.');
 let current=observation.input;
 if(current.length>160)throw Error('The staged text editor supports up to 160 characters in each recorded input and intermediate result. The original helper keeps its larger text.');
 for(const step of observation.steps){
  if(step.before!==current||applyHelperOperation(current,step.operation)!==step.after)throw Error('The original recorded action and result no longer agree.');
  current=step.after;
  if(current.length>160)throw Error('The staged text editor supports up to 160 characters in each recorded input and intermediate result. The original helper keeps its larger text.');
 }
 const fields=observation.steps.map((_,index)=>({name:`text${index+1}`,kind:'string' as const,minLength:0,maxLength:160}));
 let root:SemanticStep={kind:'return',id:'staged-done',intent:'Return the checked procedure results.'};
 for(let index=fields.length-1;index>=0;index--)root={kind:'assign',id:`stage-${index+1}`,intent:`Apply recorded ${observation.steps[index].operation.kind}.`,field:fields[index].name,value:{kind:'text-transform',operation:observation.steps[index].operation,input:index===0?{kind:'input',field:'text'}:{kind:'output',field:fields[index-1].name}},next:root};
 return parseSemanticProcedure({schemaVersion:1,id:'recorded-text-helper',version:1,intent:'Apply the reviewed local text operations in their recorded order to a new text parameter.',target:'local-record',input:{name:'recorded-text',fields:[{name:'text',kind:'string',minLength:0,maxLength:160}]},output:{name:'staged-result',fields},preconditions:[],postconditions:fields.map((field,index)=>({id:`staged-result-${index+1}`,reason:`${field.name} must satisfy its declared type and bounds.`,predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:field.name},right:{kind:'output',field:field.name}}})),root});
}
export function initialRecordedTextHelper(data:HelperData){
 if(!data.recordedText)throw Error('The recorded text proposal is unavailable.');
 const procedure=recordedTextProcedure(data.recordedText);
 return semanticHelper.parseState(data.id,{...semanticHelper.initial(data.id),definitions:[{procedure}],draftVersion:1,recordings:[createSemanticRecording({helperId:data.id,atRevision:0},{recordingId:'derived-original',procedure,input:{text:data.recordedText.observation.input}})]});
}
