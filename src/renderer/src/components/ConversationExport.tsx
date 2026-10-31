import {useEffect,useRef,useState} from 'react';
import type {ConversationExportFormat,ConversationExportPreview,ConversationExportSaved} from '../../../shared/conversation-export';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field} from '../ui';
import './conversation-export.css';

export function ConversationExport({taskId,onPreview,onSave,isCurrent}:{taskId:string;onPreview:(format:ConversationExportFormat,includeSourceText:boolean)=>Promise<ConversationExportPreview>;onSave:(snapshotId:string)=>Promise<ConversationExportSaved>;isCurrent:()=>boolean}){
 const [format,setFormat]=useState<ConversationExportFormat>('markdown'),[includeSourceText,setIncludeSourceText]=useState(false),[preview,setPreview]=useState<ConversationExportPreview>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<ConversationExportSaved>();
 const epoch=useRef(0),mounted=useRef(true),lock=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 const current=(generation:number)=>mounted.current&&generation===epoch.current&&isCurrent();
 async function prepare(){if(lock.current)return;lock.current=true;const generation=++epoch.current;setBusy(true);setError('');setResult(undefined);setPreview(undefined);try{const value=await onPreview(format,includeSourceText);if(current(generation)&&value.taskId===taskId&&value.format===format&&value.includeSourceText===includeSourceText)setPreview(value);}catch(error){if(current(generation))setError(publicErrorMessage(error));}finally{lock.current=false;if(current(generation))setBusy(false);}}
 async function save(){if(lock.current||!preview||!isCurrent())return;lock.current=true;const generation=epoch.current;setBusy(true);setError('');setResult(undefined);try{const value=await onSave(preview.snapshotId);if(current(generation)&&value.taskId===taskId&&value.snapshotId===preview.snapshotId)setResult(value);}catch(error){if(current(generation))setError(publicErrorMessage(error));}finally{lock.current=false;if(current(generation))setBusy(false);}}
 function changed(){epoch.current++;setPreview(undefined);setResult(undefined);setError('');}
 return <section className="conversation-export" aria-label="Conversation export review">
  <p>Save a copy of this task’s conversation. Review one saved snapshot before choosing a local file.</p>
  <Field label="File format"><select disabled={busy} value={format} onChange={event=>{changed();setFormat(event.target.value==='json'?'json':'markdown');}}><option value="markdown">Markdown (.md)</option><option value="json">Structured JSON (.json)</option></select></Field>
  <label className="conversation-export-source"><input type="checkbox" checked={includeSourceText} disabled={busy} onChange={event=>{changed();setIncludeSourceText(event.target.checked);}}/>Also include this task’s text source bodies and historical text versions</label>
  <p className="tiny">Includes recorded questions, outcomes, every saved answer and artifact revision, citations, Activity notes, procedures, local follow-up records and the saved unsent draft. Queued and held follow-ups are labeled unsent; canceled follow-ups were not dispatched. Image and binary bodies, browser observations, provider and account records, credentials, permissions, grants, project instructions and other tasks are excluded. Text sources are excluded unless selected above.</p>
  <p className="tiny">A running request is marked in progress. Streamed text that has not been saved is excluded. Later changes require a new snapshot.</p>
  <Button disabled={busy} onClick={()=>void prepare()}>{busy&&!preview?'Preparing snapshot…':preview?'Refresh snapshot':'Review snapshot'}</Button>
  {preview&&<>
   <dl><dt>Task</dt><dd>{preview.title}</dd><dt>Snapshot</dt><dd>{preview.capturedAt}</dd><dt>Contents</dt><dd>{preview.requestCount} recorded {preview.requestCount===1?'request':'requests'} · {preview.revisionCount} saved {preview.revisionCount===1?'revision':'revisions'} · {preview.byteLength.toLocaleString()} bytes</dd></dl>
   {preview.incompleteCount>0&&<p role="status">{preview.incompleteCount} request{preview.incompleteCount===1?' is':'s are'} incomplete, canceled, interrupted or failed. Their recorded status is included.</p>}
   <details><summary>Inspect complete file contents</summary><pre className="conversation-export-body" tabIndex={0}>{preview.body}</pre></details>
   <p className="tiny">Creates one new local file. Existing files will not be replaced.</p>
   <Button kind="primary" disabled={busy} onClick={()=>void save()}>{busy?'Saving…':'Choose file location'}</Button>
  </>}
  {result?.kind==='cancelled'&&<p role="status">Save canceled. No file was written. This snapshot is still available.</p>}
  {result?.kind==='saved'&&<p role="status" className="conversation-export-receipt">Conversation saved · {result.byteLength.toLocaleString()} bytes<br/><span>{result.path}</span></p>}
  {error&&<p role="alert" className="warning">{error}</p>}
 </section>;
}
