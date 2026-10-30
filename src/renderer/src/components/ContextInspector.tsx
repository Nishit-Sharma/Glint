import {useEffect,useLayoutEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,FileText,Image as ImageIcon,AppWindow,Plus,RefreshCw} from 'lucide-react';
import type {Task,Source,SourceInput,SourceRef,Artifact,Procedure} from '../../../core/types';
import {SourceAffectedWork} from './SourceAffectedWork';
import {sourceAffectedWork} from '../source-affected-work';
import {SourceHistoryComparison} from './SourceHistoryComparison';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {Button,Field,type Run} from '../ui';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';
import {FrozenSourcePreview} from './SourceSnapshotReview';
import {DeveloperDetails} from './DeveloperDetails';
import {TaskMenu} from './TaskMenu';
import {SavedTextSourceEditor,type SavedTextSourceStart} from './SavedTextSourceEditor';
import type {SourceTextSaveInput,SourceTextSaveInspectionInput} from '../../../shared/source-text-save';
import type {createLearningDrafts} from '../learning-drafts';
import {SavedDocumentSource} from './SavedDocumentSource';
import {WindowSourceContinuity} from './WindowSourceContinuity';

const latest=<T,>(items:T[])=>items[items.length-1];
const time=(value:string)=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
type Mode='list'|'source'|'text'|'image'|'crop'|'saved-document';
interface Props{task:Task;tasks?:readonly Task[];beforeDocumentSource?:()=>void;busy:boolean;run:Run;cache:ReturnType<typeof createLearningDrafts>;saveSourceText?:(input:SourceTextSaveInput)=>Promise<unknown>;inspectSourceSave?:(input:SourceTextSaveInspectionInput)=>Promise<unknown>;isCurrent?:()=>boolean;reference?:SourceRef;intake?:'text'|'image';onWindow:()=>void;onArtifact:(item:Artifact)=>void;onProcedure:(item:Procedure)=>void;renderImageEditor:(source:Source)=>ReactNode}

export function ContextInspector({task,tasks,beforeDocumentSource,busy,run,cache,saveSourceText,inspectSourceSave,isCurrent,reference,intake,onWindow,onArtifact,onProcedure,renderImageEditor}:Props){
 const [selection,setSelection]=useState<SourceRef|undefined>(reference),[mode,setMode]=useState<Mode>(intake??(reference?'source':'list'));
 const [editId,setEditId]=useState<string>(),[label,setLabel]=useState(''),[content,setContent]=useState(''),[role,setRole]=useState<SourceInput['role']>('fact');
 const [baseline,setBaseline]=useState({label:'',content:'',role:'fact' as SourceInput['role']});
 const [savedTextStart,setSavedTextStart]=useState<SavedTextSourceStart>();
 const editEpoch=useRef(0),list=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),lastSource=useRef<string|undefined>(undefined),listScroll=useRef(0);
 useLayoutEffect(()=>{if(mode==='source'){heading.current?.scrollIntoView({block:'start'});heading.current?.focus({preventScroll:true});}if(mode==='list'&&list.current&&lastSource.current){const owner=list.current.closest<HTMLElement>('.inspector-content');if(owner)owner.scrollTop=listScroll.current;const button=[...list.current.querySelectorAll<HTMLButtonElement>('[data-source-id]')].find(b=>b.dataset.sourceId===lastSource.current);button?.focus({preventScroll:true});if(button&&owner){const b=button.getBoundingClientRect(),r=owner.getBoundingClientRect();if(b.top<r.top||b.bottom>r.bottom)button.scrollIntoView({block:'nearest'});}}},[mode,selection?.sourceId,selection?.version]);
 const routeKey=JSON.stringify([reference,intake]),liveEditor=useRef({taskId:task.id,mode,sourceId:savedTextStart?.reference.sourceId,routeKey});liveEditor.current={taskId:task.id,mode,sourceId:savedTextStart?.reference.sourceId,routeKey};
 useLayoutEffect(()=>()=>{editEpoch.current++;},[]);
 const dirty=label!==baseline.label||content!==baseline.content||role!==baseline.role;
 const clearDraft=useNavigationDraft(dirty),guard=useGuardedAction(),draftRef=useRef({label,content,role,editId});draftRef.current={label,content,role,editId};
 const source=task.sources.find(s=>s.id===selection?.sourceId),version=source?.versions.find(v=>v.version===selection?.version&&v.digest===selection?.digest),historical=source&&selection?.version!==source.currentVersion;
 function reset(){editEpoch.current++;setLabel('');setContent('');setRole('fact');setEditId(undefined);setSavedTextStart(undefined);setBaseline({label:'',content:'',role:'fact'});}
 function navigate(action:()=>void){guard(()=>{reset();action();});}
 function choose(source:Source){navigate(()=>{lastSource.current=source.id;listScroll.current=list.current?.closest<HTMLElement>('.inspector-content')?.scrollTop??0;const v=latest(source.versions);setSelection({sourceId:source.id,version:v.version,digest:v.digest});setMode('source');});}
 useEffect(()=>{reset();if(reference){setSelection(reference);setMode('source');}else if(intake)setMode(intake);},[reference?.sourceId,reference?.version,reference?.digest,intake]);
 async function saveText(event:FormEvent){
  event.preventDefault();const submitted=draftRef.current,epoch=editEpoch.current;if(!submitted.content.trim())return;
  const result=await run<Task>({type:'source.text',taskId:task.id,source:{kind:'text',...(submitted.editId?{id:submitted.editId}:{}),label:submitted.label.trim()||submitted.content.trim().split('\n')[0].slice(0,80),content:submitted.content,role:submitted.role}},submitted.editId?'Source refreshed':'Source added');
  if(!result||epoch!==editEpoch.current)return;const saved=submitted.editId?result.sources.find(s=>s.id===submitted.editId):latest(result.sources);if(!saved)return;
  const v=latest(saved.versions),exact=JSON.stringify(draftRef.current)===JSON.stringify(submitted);
  if(exact){clearDraft();reset();setSelection({sourceId:saved.id,version:v.version,digest:v.digest});setMode('source');}
  else if(draftRef.current.editId===submitted.editId){setBaseline({label:v.label,content:v.content,role:v.role});setEditId(saved.id);if(draftRef.current.label===submitted.label)setLabel(v.label);}
 }

 function edit(){if(!source||!version)return;editEpoch.current++;setSavedTextStart({reference:{sourceId:source.id,version:version.version,digest:version.digest},freshness:source.freshness,fields:{label:version.label,content:version.content,role:version.role}});setMode('text');}
 const roleField=<Field label="Use as"><select disabled={busy} value={role} onChange={event=>setRole(event.target.value as SourceInput['role'])}><option value="fact">Source material</option><option value="style">Style reference</option><option value="inspiration">Inspiration</option></select></Field>;
 if(mode==='saved-document')return <SavedDocumentSource task={task} tasks={tasks??[task]} busy={busy} run={run} beforeAdd={()=>beforeDocumentSource?.()} isCurrent={()=>liveEditor.current.mode==='saved-document'&&liveEditor.current.taskId===task.id&&(isCurrent?.()??true)} onAdded={reference=>{reset();setSelection(reference);setMode('source');}} onCancel={()=>navigate(()=>setMode('list'))}/>;
 if(mode==='text'&&savedTextStart){const epoch=editEpoch.current,sourceId=savedTextStart.reference.sourceId,ownerTaskId=task.id;return <SavedTextSourceEditor key={ownerTaskId+':'+sourceId+':'+epoch} task={task} start={savedTextStart} cache={cache} busy={busy} run={run} saveSourceText={saveSourceText} inspect={inspectSourceSave} isCurrent={()=>editEpoch.current===epoch&&liveEditor.current.taskId===ownerTaskId&&liveEditor.current.mode==='text'&&liveEditor.current.routeKey===routeKey&&liveEditor.current.sourceId===sourceId&&(isCurrent?.()??true)} onDone={reference=>{if(editEpoch.current!==epoch||!(isCurrent?.()??true))return;reset();setSelection(reference);setMode('source');}}/>;}
 if(mode==='text')return <section className="source-intake-editor"><h2>{editId?'Edit source':'Paste text'}</h2><form onSubmit={saveText}><Field label="Source text"><textarea autoFocus rows={9} required value={content} onChange={event=>setContent(event.target.value)} placeholder="Paste the text to use…"/></Field><div className="two-fields"><Field label="Source name (optional)"><input maxLength={200} value={label} onChange={event=>setLabel(event.target.value)} placeholder="Named from your text"/></Field>{roleField}</div><div className="row"><Button kind="primary" type="submit" disabled={busy||!content.trim()}>{editId?'Save new version':'Add text'}</Button><Button onClick={()=>navigate(()=>setMode(selection?'source':'list'))}>Cancel</Button></div></form></section>;
 if(mode==='image')return <section className="source-intake-editor"><h2>Add an image</h2>{roleField}<div className="row"><Button kind="primary" disabled={busy} onClick={async()=>{const result=await run<Task>({type:'source.image',taskId:task.id,role});if(result&&result.sources.length>task.sources.length){clearDraft();reset();const saved=latest(result.sources),v=latest(saved.versions);setSelection({sourceId:saved.id,version:v.version,digest:v.digest});setMode('source');}}}><ImageIcon size={16}/>Choose image…</Button><Button onClick={()=>navigate(()=>setMode('list'))}>Cancel</Button></div></section>;
 if(mode==='crop'&&source)return <section className="source-crop-editor"><header className="source-object-heading"><Button kind="icon" title="Back to source" onClick={()=>navigate(()=>setMode('source'))}><ArrowLeft size={16}/></Button><h2>{version?.label}</h2></header>{renderImageEditor(source)}</section>;
 if(mode==='source')return <section className="selected-context" aria-label="Source snapshot">{!source||!version?<p>This source version is no longer available.</p>:<>
  <div className="source-object-heading"><Button kind="icon" title="All context" onClick={()=>navigate(()=>{setSelection(undefined);setMode('list');})}><ArrowLeft size={16}/></Button><h2 ref={heading} tabIndex={-1}>{version.label}</h2><TaskMenu label="Source options">{version.kind==='text'&&!historical&&<Button onClick={edit}>Edit / refresh</Button>}{version.kind==='image'&&!historical&&<Button onClick={()=>setMode('crop')}>Crop & annotate</Button>}{version.kind==='image'&&!historical&&<Button disabled={busy} onClick={()=>void run({type:'source.image',taskId:task.id,sourceId:source.id,role:version.role},'Image source replaced')}>Replace image…</Button>}<Button disabled={busy} onClick={()=>void run({type:'source.invalidate',taskId:task.id,sourceId:source.id},'Source marked for refresh')}>Mark changed</Button></TaskMenu></div>
  {historical&&<p className="warning">Earlier snapshot · Version {version.version}</p>}
  {version.kind==='window'&&!historical&&<WindowSourceContinuity task={task} sourceId={source.id}/>}
  {version.kind==='text'?<pre className="source-content">{version.content}</pre>:version.kind==='image'?<img className="source-image" src={version.content} alt={'Source snapshot: '+version.label}/>:<FrozenSourcePreview taskId={task.id} source={source} reference={selection}/>}
  <div className="source-capture-row"><small>{time(version.capturedAt)}</small>{version.kind==='window'&&!historical&&<Button kind="text" disabled={busy} onClick={async()=>{const result=await run<Task>({type:'windows.capture',taskId:task.id,windowId:version.windowId!,sourceId:source.id},'New window snapshot saved');if(result){const saved=result.sources.find(s=>s.id===source.id)!,v=latest(saved.versions);setSelection({sourceId:source.id,version:v.version,digest:v.digest});}}}><RefreshCw size={14}/>Refresh capture</Button>}</div>
  {source.freshness!=='fresh'&&<p className="warning">{version.kind==='window'?'Capture this window again to use its latest content.':'Review this source before using it again.'}</p>}
  <div className="source-role-row"><span>Use as</span><span>{sourceRoleLabel(version.role)}</span></div>
  <SourceHistoryComparison key={`${task.id}:${source.id}:${version.version}:${version.digest}`} taskId={task.id} source={source} selectedReference={selection!}/>
  <SourceAffectedWork key={`${source.id}:${version.version}:${version.digest}`} task={task} source={source} onArtifact={onArtifact} onProcedure={onProcedure} onVersion={ref=>navigate(()=>setSelection(ref))}/>
  <details className="source-history"><summary>Source history</summary>{source.versions.map(v=><button type="button" className="source-version-link" key={v.version} onClick={()=>setSelection({sourceId:source.id,version:v.version,digest:v.digest})}>Version {v.version} · {time(v.capturedAt)}</button>)}</details><DeveloperDetails title="Source verification"><pre>{JSON.stringify(selection,null,2)}</pre></DeveloperDetails>
 </>}</section>;
 return <section className="context-list"><div className="context-list-actions"><TaskMenu label="Add source"><Button onClick={onWindow}><AppWindow size={15}/>Window</Button><Button onClick={()=>navigate(()=>setMode('image'))}><ImageIcon size={15}/>Image</Button><Button onClick={()=>navigate(()=>setMode('text'))}><FileText size={15}/>Paste text</Button><Button onClick={()=>navigate(()=>setMode('saved-document'))}><FileText size={15}/>Saved document</Button></TaskMenu></div>{task.sources.length?<div className="source-list" ref={list}>{task.sources.map(source=>{const v=latest(source.versions),affectedCount=sourceAffectedWork(task,source.id).length;return <button className="source-list-row" data-source-id={source.id} key={source.id} onClick={()=>choose(source)}>{v.kind==='text'?<FileText size={17}/>:v.kind==='window'?<AppWindow size={17}/>:<ImageIcon size={17}/>}<span><strong>{v.label}</strong><small>{source.freshness==='fresh'?sourceRoleLabel(v.role):'Refresh required'}</small>{affectedCount>0&&<small>{affectedCount} saved {affectedCount===1?'item':'items'} to review</small>}</span></button>})}</div>:<p className="muted">No context attached yet.</p>}</section>;
}
