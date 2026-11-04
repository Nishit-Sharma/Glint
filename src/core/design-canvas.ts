import {createHash} from 'node:crypto';
import type {Companion} from './companion';
import type {ArtifactInput,RequestInput,SourceRef,Task} from './types';
import type {ProjectInstructions} from '../shared/projects';
import {blankCanvas,canvasSvg,canvasRevision,currentCanvas,DESIGN_CANVAS_MIME,DESIGN_SVG_MIME,type CanvasSave,type CanvasSvg,type CanvasSaved} from '../shared/design-canvas';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const refsKey=(refs:readonly SourceRef[])=>JSON.stringify(refs.map(ref=>[ref.sourceId,ref.version,ref.digest]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
function originalCanvasPublication(task:Task,request:RequestInput,artifact:ArtifactInput,legacyGuidance?:ProjectInstructions):CanvasSaved|undefined{
 const matches=task.requests.filter(item=>item.id===request.requestId);if(!matches.length)return;
 const saved=matches[0],answer=saved.answer,owner=task.artifacts.find(item=>item.id===answer?.artifactId),revision=owner?.revisions.find(item=>item.revision===answer?.revision&&item.digest===answer.digest),refs=request.expectedSourceRefs!;
 // Legacy inference-backed saves also hashed project guidance; never guess an unreconstructable original basis.
 const bound={...request,sourceIds:saved.sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:saved.sourceRefs},localDigest=digest({...bound,sourceRefs:saved.sourceRefs}),legacyDigest=digest({...bound,sourceRefs:saved.sourceRefs,...(legacyGuidance?{projectInstructions:legacyGuidance}:{})});
 if(matches.length!==1||saved.kind!==request.kind||saved.prompt!==request.prompt||saved.status!=='completed'||!answer||!revision||saved.artifactId!==answer.artifactId||saved.targetArtifactId!==request.artifactId||saved.expectedRevision!==request.expectedRevision||request.artifactId!==undefined&&answer.artifactId!==request.artifactId||answer.revision!==(request.expectedRevision??0)+1||![localDigest,legacyDigest].includes(saved.digest)||refsKey(saved.sourceRefs)!==refsKey(refs)||refsKey(revision.sourceRefs)!==refsKey(refs)||revision.title!==artifact.title||revision.mimeType!==artifact.mimeType||revision.encoding==='base64'||revision.content!==artifact.content||revision.digest!==createHash('sha256').update(revision.content).digest('hex')||refsKey(saved.contextSourceRefs??[])!==refsKey(revision.contextSourceRefs??[])||JSON.stringify(saved.contextSkillRefs??[])!==JSON.stringify(revision.contextSkillRefs??[]))throw Error('The original canvas publication cannot be verified. Inspect its saved revision in Files before another save.');
 return {task,artifactId:answer.artifactId,revision:answer.revision};
}
export function designCanvasPublication(task:Task,input:CanvasSave,legacyGuidance?:ProjectInstructions){
 const basis=input.artifact?task.artifacts.find(item=>item.id===input.artifact!.artifactId)?.revisions.find(item=>item.revision===input.artifact!.revision&&item.digest===input.artifact!.digest):undefined;if(input.artifact&&!basis)throw Error('The original canvas revision is unavailable.');if(basis)canvasRevision(basis);const refs=basis?.sourceRefs??[];
 const request:RequestInput={taskId:input.taskId,requestId:input.requestId,kind:'design-canvas-authoring',prompt:input.artifact?'Save the explicitly edited local canvas.':'Create a local editable canvas.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,executionScope:'design-canvas:v1:'+digest(input.canvas),...(input.artifact?{artifactId:input.artifact.artifactId,expectedRevision:input.artifact.revision,expectedArtifacts:[input.artifact]}:{})},artifact:ArtifactInput={title:input.canvas.title,content:JSON.stringify(input.canvas),mimeType:DESIGN_CANVAS_MIME,...(input.artifact?{artifactId:input.artifact.artifactId,expectedRevision:input.artifact.revision}:{})};
 const existing=originalCanvasPublication(task,request,artifact,legacyGuidance);if(existing)return {kind:'existing' as const,result:existing};if(input.artifact)currentCanvas(task,input.artifact);return {kind:'new' as const,request,artifact};
}
export function canvasSvgPublication(task:Task,input:CanvasSvg,legacyGuidance?:ProjectInstructions){
 const basis=task.artifacts.find(item=>item.id===input.artifact.artifactId)?.revisions.find(item=>item.revision===input.artifact.revision&&item.digest===input.artifact.digest);if(!basis)throw Error('The original canvas revision is unavailable.');const doc=canvasRevision(basis),refs=basis.sourceRefs;
 const request:RequestInput={taskId:input.taskId,requestId:input.requestId,kind:'design-canvas-svg',prompt:'Prepare a safe SVG copy of the reviewed saved canvas.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,expectedArtifacts:[input.artifact],executionScope:'design-svg:v1:'+JSON.stringify(input.artifact)},artifact:ArtifactInput={title:doc.title+' SVG',content:canvasSvg(doc),mimeType:DESIGN_SVG_MIME};
 const existing=originalCanvasPublication(task,request,artifact,legacyGuidance);if(existing)return {kind:'existing' as const,result:existing};currentCanvas(task,input.artifact);return {kind:'new' as const,request,artifact};
}
export function saveDesignCanvas(core:Companion,value:unknown,assertCurrent:()=>void=()=>{}):Promise<CanvasSaved>{return core.saveDesignCanvas(value,assertCurrent);}
export function createDesignCanvas(core:Companion,input:{taskId:string;requestId:string}){return saveDesignCanvas(core,{...input,canvas:blankCanvas});}
export function saveCanvasSvg(core:Companion,value:unknown,assertCurrent:()=>void=()=>{}):Promise<CanvasSaved>{return core.saveCanvasSvg(value,assertCurrent);}
