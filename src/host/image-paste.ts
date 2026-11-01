import {createHash} from 'node:crypto';
import type {Companion} from '../core/companion';
import {pendingFollowups} from '../shared/queued-followup';
import {readImagePasteCommand,IMAGE_PASTE_BYTES,IMAGE_PASTE_PIXELS,type ImagePasteResult} from '../shared/image-paste';
type PastedImage={isEmpty:()=>boolean;getSize:(scaleFactor?:number)=>{width:number;height:number};toPNG:()=>Buffer};
export async function pasteImageSource(value:unknown,core:Pick<Companion,'getTask'|'putSource'>,decode:(bytes:Buffer)=>PastedImage,assertCurrent:()=>void):Promise<ImagePasteResult>{
 const input=readImagePasteCommand(value),comma=input.content.indexOf(','),mime=input.content.slice(5,comma-7),base64=input.content.slice(comma+1),bytes=Buffer.from(base64,'base64');
 if(!bytes.length||bytes.length>IMAGE_PASTE_BYTES||bytes.toString('base64')!==base64)throw Error('Paste one PNG or JPEG image up to 8 MiB.');
 if(mime==='image/png'?!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw Error('The pasted image type does not match its bytes.');
 const image=decode(bytes),size=image.getSize(1);if(image.isEmpty()||!Number.isSafeInteger(size.width)||!Number.isSafeInteger(size.height)||size.width<1||size.height<1||size.width*size.height>IMAGE_PASTE_PIXELS)throw Error('The pasted image is empty or exceeds 40 megapixels.');
 const png=image.toPNG();if(!png.length||png.length>IMAGE_PASTE_BYTES)throw Error('The decoded pasted image exceeds the 8 MiB attachment limit.');const content='data:image/png;base64,'+png.toString('base64'),imageDigest=createHash('sha256').update(png).digest('hex');
 assertCurrent();let task=await core.getTask(input.taskId);assertCurrent();if(task.status!=='active'||task.archive||task.session?.browserContext||task.requests.some(request=>request.status==='running')||pendingFollowups(task.session?.queuedFollowups).length)throw Error('Open an active local task without a running response or queued follow-ups before adding this image.');
 const existing=task.sources.find(source=>source.id===input.sourceId);
 if(existing){const saved=existing.versions[0];if(existing.versions.length!==1||existing.currentVersion!==1||existing.freshness!=='fresh'||saved?.kind!=='image'||saved.label!=='Pasted image'||saved.role!=='fact'||saved.content!==content)throw Error('This pasted image identity already belongs to different saved content. Keep this review and inspect Context.');return {taskId:task.id,reference:{sourceId:existing.id,version:1,digest:saved.digest},...size,imageDigest};}
 task=await core.putSource(task.id,{id:input.sourceId,kind:'image',label:'Pasted image',content,role:'fact'},task,undefined,assertCurrent);const saved=task.sources.find(source=>source.id===input.sourceId)?.versions[0];if(!saved)throw Error('The pasted image save was not confirmed. Retry this unchanged review.');return {taskId:task.id,reference:{sourceId:input.sourceId,version:1,digest:saved.digest},...size,imageDigest};
}
