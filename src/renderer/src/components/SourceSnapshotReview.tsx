import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {Source,SourceRef,Task} from '../../../core/types';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button} from '../ui';

const date=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
const same=(a:SourceRef,b:SourceRef)=>a.sourceId===b.sourceId&&a.version===b.version&&a.digest===b.digest;

/** Pixels are requested for this exact immutable reference, never for a later
 * capture that happens to belong to the same OS window or source record. */
export function FrozenSourcePreview({taskId,source,reference}:{taskId:string;source:Source;reference?:SourceRef}){
 const version=source.versions.find(v=>v.version===(reference?.version??source.currentVersion));
 const ref:SourceRef=reference??{sourceId:source.id,version:version!.version,digest:version!.digest};
 const [preview,setPreview]=useState<{dataUrl:string;capturedAt:string;reference:SourceRef;taskId:string}|null>(),[error,setError]=useState('');
 useEffect(()=>{let current=true;setPreview(undefined);setError('');
  const unsubscribe=window.companion.subscribe(event=>{if(event.type==='capture.retired'){current=false;setPreview(null);setError('');}});
  if(!version||version.digest!==ref.digest||source.currentVersion!==ref.version){setPreview(null);return unsubscribe;}
  window.companion.invoke<{dataUrl:string;capturedAt:string;reference:SourceRef}|null>({type:'source.preview',taskId,sourceId:source.id,reference:ref}).then(result=>{if(current)setPreview(result&&result.reference&&same(result.reference,ref)?{...result,taskId}:null);}).catch(e=>{if(current)setError(publicErrorMessage(e));});
  return()=>{current=false;unsubscribe();};
 },[taskId,source.id,source.currentVersion,source.freshness,ref.version,ref.digest]);
 const exact=preview&&preview.taskId===taskId&&same(preview.reference,ref)&&source.currentVersion===ref.version&&source.freshness==='fresh';
 return <div>{exact?<><img className="source-image" src={preview.dataUrl} alt={'Window snapshot: '+version?.label}/><p className="tiny">Captured {date(preview.capturedAt)}. Capture again before a new question.</p></>:<p className="tiny">{error||(preview===undefined?'Loading snapshot…':'These window pixels are no longer available. The source and capture time are kept with this version.')}</p>}</div>;
}

export function SourceSnapshotReview({task,reference,onClose}:{task:Task;reference:SourceRef;onClose:()=>void}){
 const source=task.sources.find(s=>s.id===reference.sourceId),version=source?.versions.find(v=>v.version===reference.version&&v.digest===reference.digest),heading=useRef<HTMLHeadingElement>(null),panel=useRef<HTMLElement>(null),opener=useRef<HTMLElement|null>(null);
 useLayoutEffect(()=>{if(document.activeElement instanceof HTMLElement&&!panel.current?.contains(document.activeElement))opener.current=document.activeElement;panel.current?.scrollIntoView({block:'start'});heading.current?.focus({preventScroll:true});},[reference.sourceId,reference.version,reference.digest]);
 const close=()=>{const target=opener.current;onClose();requestAnimationFrame(()=>{if(target?.isConnected){target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}});};
 return <section ref={panel} className="snapshot-review" aria-label="Source snapshot"><div className="row"><h2 ref={heading} tabIndex={-1}>{version?.label||'Earlier source'}</h2><Button title="Close snapshot review" kind="icon" onClick={close}><X size={16}/></Button></div><p className="tiny">Version {reference.version}{version?' · '+date(version.capturedAt):''}</p>{!version?<p>This source version is no longer available.</p>:version.kind==='text'?<pre className="source-content">{version.content}</pre>:version.kind==='image'?<img className="source-image" src={version.content} alt={version.label}/>:<FrozenSourcePreview taskId={task.id} source={source!} reference={reference}/>}</section>;
}
