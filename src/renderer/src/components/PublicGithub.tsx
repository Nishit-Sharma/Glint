import {useLayoutEffect,useRef,useState} from 'react';
import type {SourceRef,SourceVersion,Task} from '../../../core/types';
import {parsePublicGithubRepository,publicGithubSourceRef,type PublicGithubResult} from '../../../shared/public-github';
import {Button,Field,type Run} from '../ui';
import './public-github.css';

export function PublicGithubSnapshotDetails({version}:{version:SourceVersion}){
 const snapshot=version.publicGithub;if(!snapshot)return null;
 return <dl className="public-github-details"><dt>Repository</dt><dd>{snapshot.repository} · Public</dd><dt>Default branch</dt><dd>{snapshot.defaultBranch}</dd><dt>README</dt><dd>{snapshot.path}</dd><dt>Snapshot</dt><dd>{new Date(snapshot.snapshotAt).toLocaleString()} · Source version {version.version}</dd><dt>README blob</dt><dd><code>{snapshot.blobSha}</code></dd></dl>;
}

export function PublicGithub({task,busy,run,isCurrent,beforeAdd,onCaptured,onOpen,onBack}:{task:Task;busy:boolean;run:Run;isCurrent:()=>boolean;beforeAdd:()=>void|Promise<void>;onCaptured:(reference:SourceRef)=>void|Promise<void>;onOpen:(reference:SourceRef)=>void;onBack:()=>void}){
 const [input,setInput]=useState(task.publicGithub?.repository??''),[working,setWorking]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const mounted=useRef(true),locked=useRef(false),attempt=useRef<string|undefined>(undefined),currentRef=useRef(isCurrent);currentRef.current=isCurrent;
 const current=()=>mounted.current&&currentRef.current();
 const release=()=>{const operationId=attempt.current;attempt.current=undefined;if(operationId)void window.companion.invoke({type:'github.cancel',taskId:task.id,operationId}).catch(()=>{});};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;release();};},[task.id]);
 const connection=task.publicGithub,reference=publicGithubSourceRef(task),source=task.sources.find(source=>source.id===reference?.sourceId),version=source?.versions.at(-1);
 let repository:string|undefined;try{repository=parsePublicGithubRepository(connection?.repository??input);}catch{/* Validation is shown when the form is submitted. */}
 async function capture(){
  if(locked.current||busy||!current())return;
  let selected:string;try{selected=parsePublicGithubRepository(connection?.repository??input);}catch(error){setError(error instanceof Error?error.message:'Enter a public GitHub repository.');return;}
  locked.current=true;setWorking(true);setMessage('');setError('');const operationId=crypto.randomUUID();attempt.current=operationId;
  let added=false;try{await beforeAdd();if(!current())return;const result=await run<PublicGithubResult>({type:'github.capture',taskId:task.id,operationId,repository:selected,expectedConnection:connection??null,...(reference?{expectedSource:reference}:{})},undefined,{isCurrent:current});
   if(!current()||attempt.current!==operationId)return;
   if(result){added=true;await onCaptured(result.reference);if(!current()||attempt.current!==operationId)return;setInput(selected);setMessage(result.unchanged?'README text is unchanged. The saved source version was retained.':'README saved as a text source.');}else setError('GitHub capture was not confirmed. The previous saved snapshot is retained. Review the error above before trying again.');
  }catch{if(current()&&attempt.current===operationId)setError(added?'The README is saved, but its source selection was not confirmed. Review Context before using it.':'The source selection or README capture was not confirmed. Review Context before retrying.');}
  finally{if(attempt.current===operationId)attempt.current=undefined;locked.current=false;if(current())setWorking(false);}
 }
 async function disconnect(){
  if(!connection||locked.current||busy||!current())return;locked.current=true;setError('');
  try{const result=await run<Task>({type:'github.disconnect',taskId:task.id,expectedConnection:connection},undefined,{isCurrent:current});if(result&&current())setMessage('GitHub disconnected. Saved README sources and their history remain in Context.');}finally{locked.current=false;}
 }
 return <section className="source-intake-editor public-github" aria-label="Public GitHub repository">
  <h2>Public GitHub repository</h2><p className="muted">Read a public repository card and its README into “{task.title}”. Public-only mode uses no GitHub account or credentials.</p>
  <form onSubmit={event=>{event.preventDefault();void capture();}}>
   <Field label="GitHub owner/repository or repository link"><input autoFocus disabled={busy||working||!!connection} value={connection?.repository??input} maxLength={250} placeholder="octocat/Hello-World" onChange={event=>{setInput(event.target.value);setError('');}}/></Field>
   <details className="public-github-scope" open><summary>Exact read scope</summary><p className="tiny">Only these two HTTPS GET requests run when you choose {connection?'Refresh README':'Add README to task'}. No background reads or automatic AI requests.</p><code>{repository?`https://api.github.com/repos/${repository}`:'https://api.github.com/repos/{owner}/{repository}'}</code><code>{repository?`https://api.github.com/repos/${repository}/readme`:'https://api.github.com/repos/{owner}/{repository}/readme'}</code><p className="tiny">README text up to 256 KiB is saved literally. Private repositories, account access and repository writes are unsupported.</p></details>
   <div className="row"><Button kind="primary" type="submit" disabled={busy||working||!input.trim()||task.status!=='active'}>{working?'Reading GitHub…':connection?'Refresh README':'Add README to task'}</Button>{working&&<Button onClick={()=>{release();setMessage('Read cancellation requested. Context retains any snapshot that already finished saving.');}}>Cancel read</Button>}<Button disabled={working} onClick={onBack}>Back to Context</Button></div>
  </form>
  {error&&<p role="alert" className="warning">{error}</p>}{message&&<p role="status">{message}</p>}
  {connection&&version?.publicGithub&&<article className="public-github-result" aria-label="GitHub repository result"><h3>{connection.repository}</h3>{version.publicGithub.description&&<p>{version.publicGithub.description}</p>}<p className="tiny">{version.publicGithub.stars.toLocaleString()} stars at snapshot time</p><PublicGithubSnapshotDetails version={version}/><p className="tiny">Last checked: {new Date(connection.checkedAt).toLocaleString()} · Returned README blob: <code>{connection.readmeSha}</code></p><div className="row"><Button disabled={working} onClick={()=>{if(reference)onOpen(reference);}}>Open saved README</Button><Button disabled={busy||working} onClick={()=>void disconnect()}>Disconnect GitHub</Button></div><p className="tiny">Disconnect removes this task’s repository configuration. Saved sources and source versions remain available in Context.</p></article>}
 </section>;
}
