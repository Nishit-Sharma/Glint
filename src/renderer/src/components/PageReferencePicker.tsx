import {useEffect,useRef,useState} from 'react';
import type {Artifact,Task} from '../../../core/types';
import {eligibleReferencePage,resolvePageReference,type PageReferencePreview,type PageReferenceSource} from '../../../shared/page-reference';
import {savePageReference} from '../page-reference-save';
import type {PageReadCommand} from '../page-reference-navigation';
import type {createSavedDocumentDraftController} from '../saved-document-draft-controller';
import {Button,Field} from '../ui';
import './page-reference.css';

export function PageReferencePicker({task,artifact,controller,disabled,isCurrent,onSaved,invoke=<T,>(command:PageReadCommand)=>window.companion.invoke<T>(command)}:{task:Task;artifact?:Artifact;controller?:ReturnType<typeof createSavedDocumentDraftController>;disabled:boolean;isCurrent:()=>boolean;onSaved:()=>void;invoke?:<T>(command:PageReadCommand)=>Promise<T>}){
 const [opened,setOpened]=useState(false),[catalog,setCatalog]=useState<Task[]>([]),[preview,setPreview]=useState<PageReferencePreview>(),[selected,setSelected]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[staged,setStaged]=useState(false),[message,setMessage]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null),intent=useRef(0),alive=useRef(true),lock=useRef(false),entry=useRef<PageReferenceSource|undefined>(undefined);
 const renderIntent=intent.current,renderSource=entry.current;
 const current=()=>alive.current&&isCurrent();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;intent.current++;};},[]);
 useEffect(()=>{if(opened)dialog.current?.showModal();return()=>{dialog.current?.close();};},[opened]);
 if(!artifact||!controller||!eligibleReferencePage(artifact)||task.archive||task.provenance==='local-example')return null;
 function close(){if(lock.current||intent.current!==renderIntent)return;intent.current++;setOpened(false);setMessage('');trigger.current?.focus();}
 async function start(){
  if(disabled||lock.current||!current()||intent.current!==renderIntent)return;const view=controller!.snapshot();
  if(view.raw.present||view.held||view.operation){setMessage('Finish or save your existing document edits before linking a page. Your draft is kept.');return;}
  const revision=artifact!.revisions.at(-1)!;entry.current={taskId:task.id,artifact:{artifactId:artifact!.id,revision:revision.revision,digest:revision.digest}};
  const ticket=++intent.current;setOpened(true);setCatalog([]);setPreview(undefined);setSelected('');setStaged(false);setLoading(true);setMessage('Loading saved pages…');
  try{const tasks=await invoke<Task[]>({type:'tasks.list'});if(ticket!==intent.current||!current())return;setCatalog(tasks.filter(owner=>!owner.archive&&owner.provenance!=='local-example'));setMessage('Choose a page to inspect its saved content.');}
  catch{if(ticket===intent.current&&current())setMessage('Saved pages could not be loaded. Your document is unchanged.');}
  finally{if(ticket===intent.current&&current())setLoading(false);}
 }
 async function choose(value:string){
  if(intent.current!==renderIntent||!opened||!current())return;
  const choice=catalog.flatMap(owner=>owner.artifacts.filter(eligibleReferencePage).map(item=>({taskId:owner.id,artifactId:item.id}))).find(item=>JSON.stringify(item)===value);
  if(!choice||lock.current)return;const ticket=++intent.current;setSelected(value);setPreview(undefined);setLoading(true);setMessage('Opening saved page preview…');
  try{const owner=await invoke<Task>({type:'tasks.get',taskId:choice.taskId});if(ticket!==intent.current||!current())return;setPreview(resolvePageReference(owner,choice));setMessage('Inspect this saved page, then save its link at the start of your document.');}
  catch(error){if(ticket===intent.current&&current())setMessage(error instanceof Error?error.message:'This page is unavailable.');}
  finally{if(ticket===intent.current&&current())setLoading(false);}
 }
 async function save(){
  if(!preview||!renderSource||disabled||lock.current||!current()||intent.current!==renderIntent||!opened)return;const ticket=renderIntent,selected=preview,source=renderSource;lock.current=true;setSaving(true);setMessage('Saving page link…');
  try{const saved=await savePageReference(controller!,source,selected,{current:()=>ticket===intent.current&&current(),load:taskId=>invoke<Task>({type:'tasks.get',taskId}),staged:()=>setStaged(true)});if(ticket!==intent.current||!current())return;if(saved){setOpened(false);setMessage('Page link saved.');onSaved();trigger.current?.focus();}else setMessage('The save was not confirmed. The staged document draft is kept; check its storage before saving again.');}
  catch(error){if(ticket===intent.current&&current())setMessage(error instanceof Error?error.message:'The page link could not be saved.');}
  finally{lock.current=false;if(ticket===intent.current&&current())setSaving(false);}
 }
 return <section className="page-reference-picker" aria-label="Link an existing page">
  <button ref={trigger} type="button" disabled={disabled||saving} onClick={()=>void start()}>Link existing page</button><p role="status">{!opened&&message}</p>
  {opened&&<dialog ref={dialog} className="page-reference-dialog" aria-labelledby="page-reference-heading" onCancel={event=>{event.preventDefault();close();}}>
   <h3 id="page-reference-heading">Link an existing page</h3><p>From {artifact.revisions.at(-1)!.title}</p>
   <Field label="Existing saved page"><select autoFocus name="existing-page" value={selected} disabled={loading||saving||staged} onChange={event=>void choose(event.target.value)}><option value="">Choose a page</option>{catalog.flatMap(owner=>owner.artifacts.filter(eligibleReferencePage).map(item=><option key={owner.id+':'+item.id} value={JSON.stringify({taskId:owner.id,artifactId:item.id})}>{owner.title} · {item.revisions.at(-1)!.title}</option>))}</select></Field>
   {preview&&<section aria-label="Selected saved page"><h4>{preview.title}</h4><p>{preview.taskTitle} · saved revision {preview.artifact.revision}</p><Field label="Saved page content"><textarea readOnly rows={8} value={preview.content}/></Field></section>}
   <p role="status">{message}</p><div className="row"><Button disabled={saving} onClick={close}>{staged?'Keep draft and close':'Cancel'}</Button>{!staged&&<Button kind="primary" disabled={!preview||loading||saving||disabled} onClick={()=>void save()}>{saving?'Saving…':'Save page link'}</Button>}</div>
  </dialog>}
 </section>;
}
