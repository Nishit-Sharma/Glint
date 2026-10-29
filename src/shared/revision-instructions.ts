import {Schema} from 'effect';
import {invalidLearningDraft} from './learning-draft-validation';
import type {ArtifactRef,SourceRef,Task} from '../core/types';
import {ordinaryTextDocument,parseSavedDocumentDraftBasis,savedDocumentDraftBasis,sameDocumentRefs} from './saved-document-draft';
export const REVISION_INSTRUCTIONS_SLOT='saved-document:revision-instructions';
const raw=Schema.Struct({present:Schema.Boolean,text:Schema.String.pipe(Schema.maxLength(32*1024))});
export type RevisionInstructions=typeof raw.Type;
export const emptyRevisionInstructions:RevisionInstructions=Object.freeze({present:false,text:''});
export function parseRevisionInstructions(value:unknown):RevisionInstructions{
 try{const parsed=Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(value);if(!parsed.present&&parsed.text!=='')throw Error();return parsed;}
 catch{throw invalidLearningDraft('Revision instructions exceed their supported fields or text limits.');}
}
export type RevisionInstructionSubmission={requestId:string;basis:string;sourceRefs:SourceRef[]};
const changed=()=>Error('The document or linked sources changed. Review your revision instructions before sending.');
export function assertRevisionInstructionRequest(task:Task,artifactId:string,basisText:string,sourceIds:readonly string[]|undefined,sourceRefs:readonly SourceRef[]|undefined){
 const basis=parseSavedDocumentDraftBasis(basisText),revision=task.artifacts.find(item=>item.id===artifactId)?.revisions.at(-1);
 if(basis.taskId!==task.id||basis.artifactId!==artifactId||!revision||!ordinaryTextDocument(revision)||savedDocumentDraftBasis(task,artifactId,revision)!==basisText||basis.sources.some((source,index)=>source.kind!=='available'||source.freshness!=='fresh'||source.version!==basis.sourceRefs[index].version||source.digest!==basis.sourceRefs[index].digest)||!sourceRefs||!sameDocumentRefs(sourceRefs,basis.sourceRefs)||!sourceIds||new Set(sourceIds).size!==sourceIds.length||sourceIds.length!==basis.sourceRefs.length||sourceIds.some(id=>!basis.sourceRefs.some(ref=>ref.sourceId===id)))throw changed();
 return revision;
}
export function confirmedRevisionInstructionResult(task:Task,submission:RevisionInstructionSubmission,prompt:string):ArtifactRef|undefined{
 const basis=parseSavedDocumentDraftBasis(submission.basis),requests=task.requests.filter(request=>request.id===submission.requestId),request=requests.length===1?requests[0]:undefined,answer=request?.answer;
 const artifact=task.artifacts.find(item=>item.id===basis.artifactId),original=artifact?.revisions.find(revision=>revision.revision===basis.revision&&revision.digest===basis.digest),latest=artifact?.revisions.at(-1);
 if(task.id!==basis.taskId||!original||savedDocumentDraftBasis(task,basis.artifactId,original)!==submission.basis||!request||request.status!=='completed'||request.kind!=='revise'||request.prompt!==prompt||request.targetArtifactId!==basis.artifactId||request.expectedRevision!==basis.revision||request.artifactId!==basis.artifactId||!sameDocumentRefs(request.sourceRefs,basis.sourceRefs)||!answer||answer.artifactId!==basis.artifactId||answer.revision!==basis.revision+1||!latest||latest.revision!==answer.revision||latest.digest!==answer.digest||!sameDocumentRefs(latest.sourceRefs,basis.sourceRefs))return;
 return answer;
}
