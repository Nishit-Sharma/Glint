import {createHash} from 'node:crypto';
import type {Companion} from './companion';
import {blankCanvas,canvasSvg,canvasRevision,currentCanvas,DESIGN_CANVAS_MIME,DESIGN_SVG_MIME,readCanvasSave,readCanvasSvg,type CanvasSaved} from '../shared/design-canvas';

export async function saveDesignCanvas(core:Companion,value:unknown):Promise<CanvasSaved>{
 const input=readCanvasSave(value),before=await core.getTask(input.taskId),basis=input.artifact?before.artifacts.find(item=>item.id===input.artifact!.artifactId)?.revisions.find(item=>item.revision===input.artifact!.revision&&item.digest===input.artifact!.digest):undefined;if(input.artifact&&!basis)throw Error('The original canvas revision is unavailable.');if(basis)canvasRevision(basis);const refs=basis?.sourceRefs??[],scope=createHash('sha256').update(JSON.stringify(input.canvas)).digest('hex');
 const request=await core.runRequest({taskId:input.taskId,requestId:input.requestId,kind:'design-canvas-authoring',prompt:input.artifact?'Save the explicitly edited local canvas.':'Create a local editable canvas.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,executionScope:'design-canvas:v1:'+scope,...(input.artifact?{artifactId:input.artifact.artifactId,expectedRevision:input.artifact.revision,expectedArtifacts:[input.artifact]}:{})},async context=>{if(input.artifact)currentCanvas(context.task,input.artifact);return {title:input.canvas.title,content:JSON.stringify(input.canvas),mimeType:DESIGN_CANVAS_MIME};});
 if(request.status!=='completed'||!request.answer)throw Error(request.error??'The canvas save is unconfirmed. Check Files before another save.');
 return {task:await core.getTask(input.taskId),artifactId:request.answer.artifactId,revision:request.answer.revision};
}
export async function createDesignCanvas(core:Companion,input:{taskId:string;requestId:string}){return saveDesignCanvas(core,{...input,canvas:blankCanvas});}
export async function saveCanvasSvg(core:Companion,value:unknown):Promise<CanvasSaved>{
 const input=readCanvasSvg(value),task=await core.getTask(input.taskId),basis=task.artifacts.find(item=>item.id===input.artifact.artifactId)?.revisions.find(item=>item.revision===input.artifact.revision&&item.digest===input.artifact.digest);if(!basis)throw Error('The original canvas revision is unavailable.');const doc=canvasRevision(basis),refs=basis.sourceRefs;
 const request=await core.runRequest({taskId:input.taskId,requestId:input.requestId,kind:'design-canvas-svg',prompt:'Prepare a safe SVG copy of the reviewed saved canvas.',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs,expectedArtifacts:[input.artifact],executionScope:'design-svg:v1:'+JSON.stringify(input.artifact)},async context=>({title:doc.title+' SVG',content:canvasSvg(currentCanvas(context.task,input.artifact)),mimeType:DESIGN_SVG_MIME}));
 if(request.status!=='completed'||!request.answer)throw Error(request.error??'The SVG copy is unconfirmed. Check Files before trying again.');
 return {task:await core.getTask(input.taskId),artifactId:request.answer.artifactId,revision:request.answer.revision};
}
