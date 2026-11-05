import {useLayoutEffect,useRef,useState} from 'react';
import type {ArtifactRef,SourceInput,SourceRef,Task} from '../../../core/types';
import {savedDocumentSourcePreview,type SavedDocumentSourceResult} from '../../../shared/saved-document-source';
import {Button,Field,type Run} from '../ui';
import './saved-work-search.css';

type Selection={ownerTaskId:string;artifact:ArtifactRef;preview:ReturnType<typeof savedDocumentSourcePreview>};
export function SavedDocumentSource({task,tasks,busy,run,isCurrent,beforeAdd,onAdded,onCancel}:{task:Task;tasks:readonly Task[];busy:boolean;run:Run;isCurrent:()=>boolean;beforeAdd:()=>void|Promise<void>;onAdded:(reference:SourceRef)=>void;onCancel:()=>void}){
 const [query,setQuery]=useState(''),[role,setRole]=useState<SourceInput['role']>('fact'),[selected,setSelected]=useState<Selection>(),[working,setWorking]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(true),locked=useRef(false),epoch=useRef(0);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 const choices=tasks.flatMap(owner=>owner.artifacts.flatMap(artifact=>{const revision=artifact.revisions.at(-1);if(!revision)return [];const ref={artifactId:artifact.id,revision:revision.revision,digest:revision.digest};try{return [{ownerTaskId:owner.id,artifact:ref,preview:savedDocumentSourcePreview(owner,ref,role)}];}catch{return [];}})).filter(item=>(item.preview.ownerTitle+'\n'+item.preview.revision.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 function selectionCurrent(selection:Selection){const owners=tasks.filter(owner=>owner.id===selection.ownerTaskId);try{return owners.length===1&&savedDocumentSourcePreview(owners[0],selection.artifact,role).snapshot===selection.preview.snapshot;}catch{return false;}}
 const unchanged=selected?selectionCurrent(selected):false;
 function choose(selection:Selection){if(working||busy||!isCurrent())return;epoch.current++;setMessage('');setSelected(selection);}
 async function add(selection:Selection){
  if(locked.current||busy||task.status!=='active'||!isCurrent())return;
  if(!selectionCurrent(selection)){setMessage('This saved document changed. Choose it again.');return;}
  const token=++epoch.current,current=()=>mounted.current&&epoch.current===token&&isCurrent();locked.current=true;setWorking(true);setMessage('');setSelected(selection);
  try{
   await beforeAdd();if(!current())return;
   const result=await run<SavedDocumentSourceResult>({type:'source.document',taskId:task.id,ownerTaskId:selection.ownerTaskId,artifact:selection.artifact,role,expectedSnapshot:selection.preview.snapshot},undefined,{isCurrent:current});
   if(!current())return;
   if(result)onAdded(result.reference);else setMessage('The copy was not confirmed. Review Context before trying the same selection again.');
  }catch{if(current())setMessage('The copy was not confirmed. Your saved documents and edits are kept.');
  }finally{locked.current=false;if(current())setWorking(false);}
 }
 return <section className="saved-work-search saved-document-source" aria-label="Saved document source">
  <h2>Use a saved document</h2><p>Add a saved plain-text or Markdown document from any task to “{task.title}”. You can view the exact copy first. Unsent edits stay in their original editor.</p>
  <Field label="Use copied source as"><select value={role} disabled={working||busy} onChange={event=>{epoch.current++;setRole(event.target.value as SourceInput['role']);setSelected(undefined);setMessage('');}}><option value="fact">Source material</option><option value="style">Style reference</option><option value="inspiration">Inspiration</option></select></Field>
  <Field label="Find saved document"><input type="search" maxLength={200} value={query} disabled={working||busy} onChange={event=>setQuery(event.target.value)}/></Field>
  <p className="tiny">This adds an independent local snapshot. Nothing is sent to an AI service. Changes to the original do not update the copy.</p>
  <ul aria-label="Documents available to copy">{choices.map(item=><li className="saved-document-choice" key={item.ownerTaskId+':'+item.artifact.artifactId}><div><strong>{item.preview.revision.title}</strong><p className="tiny">{item.preview.ownerTitle} · revision {item.artifact.revision}</p></div><div className="saved-document-choice-actions"><Button disabled={working||busy||task.status!=='active'} onClick={()=>void add(item)}>Add {item.preview.revision.title}</Button><Button kind="text" disabled={working||busy} onClick={()=>choose(item)}>View exact copy of {item.preview.revision.title}</Button></div></li>)}</ul>
  {!choices.length&&<p role="status">No supported saved documents match. Images, interactive files and documents containing embedded image bytes are excluded.</p>}
  {selected&&<section aria-label="Review document source copy"><p>Original task: {selected.preview.ownerTitle} · Document: {selected.preview.revision.title} · Saved revision {selected.artifact.revision}</p><Field label="Text to copy"><textarea readOnly rows={12} value={selected.preview.content}/></Field><p className="tiny">Linked source bodies, unsent drafts, approvals and live access are excluded. Your existing selection for the next request stays unchanged; select the copied source when you want to use it.</p>{!unchanged&&<p role="alert">The document or its linked source freshness changed. Choose it again to review the current copy.</p>}<Button kind="primary" disabled={busy||working||!unchanged||task.status!=='active'} onClick={()=>void add(selected)}>{working?'Adding snapshot…':'Add local source snapshot'}</Button></section>}
  {message&&<p role="status">{message}</p>}<Button disabled={working||busy} onClick={onCancel}>Back to Attachments</Button>
 </section>;
}
