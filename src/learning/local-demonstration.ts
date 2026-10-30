import {Schema} from 'effect';
import {DemonstratedStageSchema,StagedFieldSchema,stagedProcedure,type StagedProcedureDraft,type ProcedureStage} from './staged-procedure';
import {runSemanticProcedure,type SemanticRecord,type SemanticRunResult} from './semantic-procedure';

const id=Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{1,80}$/));
const revision=Schema.Int.pipe(Schema.between(0,500));
const note=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500),Schema.filter(value=>value.trim().length>0));
const scalar=Schema.Union(Schema.String.pipe(Schema.maxLength(160)),Schema.Number.pipe(Schema.between(-1e6,1e6)),Schema.Boolean);
const record=Schema.Record({key:id,value:scalar});
export const LocalDemonstrationOwnerSchema=Schema.Struct({taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),moduleId:id,moduleVersion:Schema.Int.pipe(Schema.positive()),helperId:id});
export type LocalDemonstrationOwner=typeof LocalDemonstrationOwnerSchema.Type;
export const LocalDemonstrationStartSchema=Schema.Struct({name:note,intent:note,inputs:Schema.Array(StagedFieldSchema).pipe(Schema.minItems(1),Schema.maxItems(6)),input:record});
const actionReceipt=Schema.Struct({atRevision:revision,authority:Schema.Struct({kind:Schema.Literal('explicit-local-value-action'),expectedRevision:revision}),stage:DemonstratedStageSchema,before:record,after:record,result:Schema.Unknown});
export const LocalDemonstrationWorkspaceSchema=Schema.Struct({kind:Schema.Literal('owned-local-record-demonstration'),owner:LocalDemonstrationOwnerSchema,startedAtRevision:revision,name:note,intent:note,inputs:Schema.Array(StagedFieldSchema).pipe(Schema.minItems(1),Schema.maxItems(6)),input:record,actions:Schema.Array(actionReceipt).pipe(Schema.maxItems(6)),physicalGestureVerified:Schema.Literal(false),externalObservationVerified:Schema.Literal(false),effectAuthority:Schema.Literal('none')});
export type LocalDemonstrationWorkspace=Omit<typeof LocalDemonstrationWorkspaceSchema.Type,'actions'>&{readonly actions:readonly (Omit<typeof actionReceipt.Type,'result'>&{readonly result:Exclude<SemanticRunResult,{status:'invalid-input'}>})[]};
export const LocalDemonstrationOriginSchema=Schema.Struct({workspace:LocalDemonstrationWorkspaceSchema,finishedAtRevision:revision,outcome:Schema.Literal('cancelled','inactive-proposal'),definitionVersion:Schema.NullOr(Schema.Int.pipe(Schema.between(1,20)))});
export type LocalDemonstrationOrigin=Omit<typeof LocalDemonstrationOriginSchema.Type,'workspace'>&{readonly workspace:LocalDemonstrationWorkspace};
export const LocalDemonstrationActionSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('start-semantic-demonstration'),...LocalDemonstrationStartSchema.fields,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('perform-semantic-demonstration-step'),stage:DemonstratedStageSchema,expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('finish-semantic-demonstration'),confirmed:Schema.Literal('reviewed-inactive-local-procedure'),expectedRevision:revision}),
 Schema.Struct({kind:Schema.Literal('cancel-semantic-demonstration'),expectedRevision:revision}),
);
export type LocalDemonstrationAction=typeof LocalDemonstrationActionSchema.Type;
const decode=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
export function localDemonstrationDraft(workspace:LocalDemonstrationWorkspace):StagedProcedureDraft{
 return {format:'staged-record-v1',name:workspace.name,intent:workspace.intent,inputs:workspace.inputs.map(field=>({...field})),requirements:[],stages:workspace.actions.map(item=>structuredClone(item.stage)) as ProcedureStage[]};
}
export function localDemonstrationProcedure(workspace:LocalDemonstrationWorkspace){return stagedProcedure(localDemonstrationDraft(workspace),'demonstrated-local-helper');}
export function startLocalDemonstration(ownerValue:unknown,atRevision:number,value:unknown):LocalDemonstrationWorkspace{
 const owner=decode(LocalDemonstrationOwnerSchema,ownerValue),start=decode(LocalDemonstrationStartSchema,value);
 const validation=stagedProcedure({format:'staged-record-v1',name:start.name,intent:start.intent,inputs:start.inputs.map(field=>({...field})),requirements:[],stages:[{kind:'assign',label:'Validate supplied parameters.',field:{name:'checked',kind:'boolean'},value:{source:'literal',value:'true'}}]});
 const result=runSemanticProcedure(validation,start.input);if(result.status!=='completed')throw Error('Complete valid local parameters before starting the demonstration.');
 return {kind:'owned-local-record-demonstration',owner,startedAtRevision:atRevision,...start,actions:[],physicalGestureVerified:false,externalObservationVerified:false,effectAuthority:'none'};
}
/** Append the selected action; recompute prior pure steps to validate it. No external capability exists here. */
export function performLocalDemonstration(workspace:LocalDemonstrationWorkspace,expectedRevision:number,stageValue:unknown):LocalDemonstrationWorkspace{
 if(workspace.actions.length>=6)throw Error('This local workspace supports up to six demonstrated steps.');
 if(workspace.actions.at(-1)?.result.status==='abstained')throw Error('This demonstration stopped. Cancel it before starting another.');
 const stage=decode(DemonstratedStageSchema,stageValue),before=workspace.actions.at(-1)?.after??{};
 if(!workspace.actions.length&&stage.kind==='checkpoint')throw Error('Produce a result before demonstrating a checkpoint.');
 const provisional={...workspace,actions:[...workspace.actions,{atRevision:expectedRevision+1,authority:{kind:'explicit-local-value-action' as const,expectedRevision},stage,before,after:{},result:{} as never}]};
 const result=runSemanticProcedure(localDemonstrationProcedure(provisional),workspace.input);
 if(result.status==='invalid-input')throw Error('The selected step cannot run with these local parameters.');
 return {...workspace,actions:[...workspace.actions,{atRevision:expectedRevision+1,authority:{kind:'explicit-local-value-action',expectedRevision},stage,before,after:result.output,result}]};
}
/** Consistency checks do not authenticate imported JSON. Only the owned module action path creates receipts. */
export function parseLocalDemonstration(helperId:string,atRevision:number,value:unknown):LocalDemonstrationWorkspace{
 const workspace=decode(LocalDemonstrationWorkspaceSchema,value) as LocalDemonstrationWorkspace;
 if(workspace.owner.helperId!==helperId||workspace.startedAtRevision>atRevision)throw Error('This demonstration belongs to another owner or future revision.');
 let replay=startLocalDemonstration(workspace.owner,workspace.startedAtRevision,{name:workspace.name,intent:workspace.intent,inputs:workspace.inputs,input:workspace.input});
 let previous=workspace.startedAtRevision;
 for(const receipt of workspace.actions){
  if(receipt.authority.expectedRevision!==previous||receipt.atRevision!==previous+1||receipt.atRevision>atRevision)throw Error('Demonstrated steps must retain their exact revision order and authority.');
  replay=performLocalDemonstration(replay,previous,receipt.stage);
  if(!equal(replay.actions.at(-1),receipt))throw Error('A demonstrated action, input or result changed.');
  previous=receipt.atRevision;
 }
 return replay;
}
export function assertLocalDemonstrationOwner(workspace:LocalDemonstrationWorkspace,ownerValue:unknown){if(!equal(workspace.owner,decode(LocalDemonstrationOwnerSchema,ownerValue)))throw Error('The local demonstration source changed. Open its original current helper.');}
export function localDemonstrationOutput(workspace:LocalDemonstrationWorkspace):SemanticRecord{return workspace.actions.at(-1)?.after??{};}
