import {parseModuleAnswer} from '../../core/interactive-modules';
import type {ArtifactRef,Task} from '../../core/types';
import {WINDOW_WORKFLOW_MIME,readWindowWorkflowCandidate} from '../../shared/window-workflow-artifact';
const sameArtifact=(a:ArtifactRef,b:ArtifactRef)=>a.artifactId===b.artifactId&&a.revision===b.revision&&a.digest===b.digest;
export const windowRequestResultRef=(task:Task,requestId:string,mime:string,expected:ArtifactRef)=>{
 const request=task.requests.find(r=>r.id===requestId),answer=request?.status==='completed'?request.answer:undefined,revision=answer&&task.artifacts.find(a=>a.id===answer.artifactId)?.revisions.at(-1);
 if(!answer||!revision||revision.revision!==answer.revision||revision.digest!==answer.digest||revision.mimeType!==mime)return undefined;
 if(mime===WINDOW_WORKFLOW_MIME){const candidate=readWindowWorkflowCandidate(revision.content,revision.sourceRefs);return candidate&&candidate.provenance.taskId===task.id&&sameArtifact(candidate.provenance.basis,expected)?answer:undefined;}
 try{const module=parseModuleAnswer(JSON.parse(revision.content)).modules.find(module=>module.data.kind==='workflow-lab'&&module.data.basis.kind==='reviewed-window'&&sameArtifact(module.data.basis.candidate,expected));return module?answer:undefined;}catch{return undefined;}
};

type Publication={candidate:ArtifactRef;prepareIntent:()=>Promise<string>;readTask:()=>Promise<Task>;publish:(requestId:string)=>Promise<unknown>;isMounted:()=>boolean;isCurrent:()=>boolean;onOpen:(task:Task,ref:ArtifactRef)=>void};
/** Continuation of an explicitly submitted review; capture and admission remain host-owned. */
export async function publishWindowWorkflowReview(input:Publication):Promise<boolean>{
 const assertCurrent=()=>{if(!input.isMounted()||!input.isCurrent())throw Error('The review changed while saving. Confirm its current content again.');};
 assertCurrent();const requestId=await input.prepareIntent();assertCurrent();
 const lookup=async()=>{assertCurrent();const current=await input.readTask();assertCurrent();const ref=windowRequestResultRef(current,requestId,'application/vnd.window-companion.modules+json',input.candidate);if(ref)input.onOpen(current,ref);return !!ref;};
 if(await lookup())return true;
 assertCurrent();
 try{await input.publish(requestId);}catch{/* Inspect the exact durable receipt before any retry. */}
 assertCurrent();if(await lookup())return true;
 throw Error('Publication was not confirmed. Your raw review is kept. Check its saved outcome before another attempt.');
}
