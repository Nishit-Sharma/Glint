import {useEffect,useRef,useState,type ClipboardEvent,type ReactNode} from 'react';
import type {Task} from '../../../core/types';
import {IMAGE_PASTE_BYTES,readImagePasteResult,type ImagePasteCommand,type ImagePasteResult} from '../../../shared/image-paste';
import {pendingFollowups} from '../../../shared/queued-followup';
import {useNavigationDraft} from '../draft-navigation';
import {Button} from '../ui';

type Review={input:ImagePasteCommand;bytes:number;mime:string};
export function ClipboardImageAttachment({task,inputId,active,disabled,isCurrent,onAttach,children}:{task:Task;inputId:string;active:boolean;disabled:boolean;isCurrent:()=>boolean;onAttach:(input:ImagePasteCommand)=>Promise<ImagePasteResult>;children:(attachmentPending:boolean)=>ReactNode}){
 const [review,setReview]=useState<Review>(),[reading,setReading]=useState(false),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState(''),[added,setAdded]=useState<{review:Review;result:ImagePasteResult}>();const alive=useRef(true),locked=useRef(false),attempt=useRef(0),scope=useRef({active,isCurrent});scope.current={active,isCurrent};const clearDraft=useNavigationDraft(!!review||reading);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const current=()=>alive.current&&scope.current.active&&scope.current.isCurrent(),unavailable=disabled||!!task.session?.browserContext||task.status!=='active'||!!task.archive||task.requests.some(request=>request.status==='running')||pendingFollowups(task.session?.queuedFollowups).length>0;
 async function paste(event:ClipboardEvent<HTMLDivElement>){
  if((event.target as HTMLElement).tagName!=='TEXTAREA'||(event.target as HTMLElement).id!==inputId)return;const items=Array.from(event.clipboardData.items),images=items.filter(item=>item.kind==='file'&&item.type.startsWith('image/'));if(!images.length)return;event.preventDefault();
  if(!current())return;if(unavailable){setError('Image paste is available in an active local task without a running response or queued follow-ups. Your text is unchanged.');return;}if(locked.current||review){setError('Finish or cancel this image review before pasting another image.');return;}
  if(images.length!==1||!['image/png','image/jpeg'].includes(images[0].type)){setError('Paste one PNG or JPEG image. No image was added and your text is unchanged.');return;}const file=images[0].getAsFile();if(!file||!file.size||file.size>IMAGE_PASTE_BYTES){setError('Paste one PNG or JPEG image up to 8 MiB.');return;}
  locked.current=true;const token=++attempt.current;setReading(true);setError('');setAdded(undefined);
  try{const bytes=new Uint8Array(await file.arrayBuffer());if(!current()||attempt.current!==token)return;if(bytes.length!==file.size||bytes.length>IMAGE_PASTE_BYTES)throw Error();let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));const submitted:Review={input:{type:'source.image.paste',taskId:task.id,sourceId:crypto.randomUUID(),content:`data:${file.type};base64,${btoa(binary)}`},bytes:bytes.length,mime:file.type};setReview(submitted);setUncertain(false);setReading(false);locked.current=false;await attach(submitted);}
  catch{if(current())setError('The pasted image could not be read. No image was added; your text is unchanged.');}
  finally{if(attempt.current===token){locked.current=false;if(alive.current)setReading(false);}}
 }
 async function attach(submitted=review){if(!submitted||locked.current||unavailable||!current())return;locked.current=true;setSaving(true);setError('');
  try{const result=readImagePasteResult(await onAttach(submitted.input));if(!current())return;if(result.taskId!==submitted.input.taskId||result.reference.sourceId!==submitted.input.sourceId)throw Error();setAdded({review:submitted,result});setReview(undefined);setUncertain(false);clearDraft();}
  catch{if(current()){setUncertain(true);setError('Image save was not confirmed; it may already be in Context. Retry this unchanged image to reconcile before discarding the review. Your message is unchanged.');}}
  finally{locked.current=false;if(alive.current)setSaving(false);}
 }
 return <div onPasteCapture={paste} aria-label="Composer image paste">{children(!!review||reading||saving)}
  {reading&&<div><p role="status">Reading pasted image…</p><Button onClick={()=>{attempt.current++;locked.current=false;setReading(false);setError('Image reading cancelled. No image was added.');clearDraft();}}>Cancel image reading</Button></div>}
  {review&&<section aria-label="Pasted image attachment"><img src={review.input.content} alt="Pasted image being attached" style={{maxWidth:160,maxHeight:120,objectFit:'contain'}}/><p>{saving?'Adding pasted image locally…':'Pasted image save needs reconciliation.'} Your message is unchanged. Any clipboard text alongside the image was not inserted.</p><details><summary>Image details</summary><p>{review.mime} · {review.bytes.toLocaleString()} bytes. PNG/JPEG up to 8 MiB and 40 megapixels. Saved as PNG after host validation. Paste attaches locally; nothing is sent until a separate Ask action.</p></details>{uncertain&&<Button disabled={saving||unavailable} onClick={()=>void attach()}>Retry same image</Button>}</section>}
  {added&&<p role="status"><img src={added.review.input.content} alt="Image added to task context" style={{maxWidth:80,maxHeight:60,objectFit:'contain'}}/> Image added to selected context · {added.result.width} × {added.result.height}. Your message is unchanged.</p>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
