import {useLayoutEffect,useRef,useState} from 'react';
import type {SourceInput,SourceRef,Task} from '../../../core/types';
import {DOCUMENT_IMPORT_TEXT_LIMIT,readDocumentCsv,type DocumentImportChoice,type DocumentImportPreview,type DocumentImportResult} from '../../../shared/document-import';
import './document-import.css';
import {Button,Field,type Run} from '../ui';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';

export function CsvImportPreview({content}:{content:string}){
 let rows:string[][];try{rows=readDocumentCsv(content);}catch{return <p role="alert">This CSV cannot be added. Check its quotes or the displayed import limits. The complete text is kept below for correction.</p>;}
 const headers=rows[0],records=rows.slice(1),maximum=rows.reduce((width,row)=>Math.max(width,row.length),0),minimum=rows.reduce((width,row)=>Math.min(width,row.length),maximum),columns=Array.from({length:Math.min(maximum,12)},(_,index)=>index),short=(value:string)=>value.length>200?value.slice(0,200)+'…':value;
 return <section aria-label="CSV table preview"><p className="tiny">{records.length.toLocaleString()} data {records.length===1?'row':'rows'} · {maximum} {maximum===1?'column':'columns'}{minimum!==maximum?' maximum':''}. Preview shows the first 20 data rows and 12 columns, up to 200 characters per cell. All CSV text is retained.</p>{minimum!==maximum&&<p className="tiny">Record widths vary from {minimum} to {maximum} cells. Missing cells are marked in this preview; retained CSV is unchanged.</p>}<div className="csv-import-scroll" tabIndex={0} role="region" aria-label="CSV rows"><table><caption>First CSV row shown as column headings</caption><thead><tr>{columns.map(index=><th scope="col" key={index}>{headers[index]===undefined?<span className="muted">Column {index+1} (no heading)</span>:short(headers[index])||<span className="muted">Empty heading</span>}</th>)}</tr></thead><tbody>{records.slice(0,20).map((row,index)=><tr key={index}>{columns.map(column=><td key={column}>{row[column]===undefined?<span className="muted">Missing cell</span>:short(row[column])}</td>)}</tr>)}</tbody></table></div></section>;
}

export function DocumentImport({task,busy,run,isCurrent,beforeAdd,onAdded,onCancel}:{task:Task;busy:boolean;run:Run;isCurrent:()=>boolean;beforeAdd:()=>void;onAdded:(reference:SourceRef)=>void;onCancel:()=>void}){
 const [preview,setPreview]=useState<DocumentImportPreview>(),[content,setContent]=useState(''),[label,setLabel]=useState(''),[role,setRole]=useState<SourceInput['role']>('fact'),[working,setWorking]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(true),locked=useRef(false),attempt=useRef<string|undefined>(undefined),currentRef=useRef(isCurrent);currentRef.current=isCurrent;
 const clearDraft=useNavigationDraft(!!preview),guard=useGuardedAction();
 const release=async()=>{const attemptId=attempt.current;attempt.current=undefined;if(attemptId)await window.companion.invoke({type:'source.import.cancel',taskId:task.id,attemptId}).catch(()=>{});};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void release();};},[task.id]);
 const current=()=>mounted.current&&currentRef.current();
 async function choose(){
  if(locked.current||busy||!current())return;locked.current=true;setWorking(true);setMessage('');const attemptId=crypto.randomUUID();attempt.current=attemptId;
  try{const result=await run<DocumentImportChoice>({type:'source.import.choose',taskId:task.id,attemptId},undefined,{isCurrent:current});
   if(!current()||attempt.current!==attemptId)return;
   if(result?.kind==='review'){setPreview(result);setContent(result.text);setLabel(result.fileName);}else{await release();if(result?.kind==='cancelled')setMessage('No file selected.');}
  }finally{locked.current=false;if(current())setWorking(false);}
 }
 async function add(){
  if(locked.current||busy||!preview||!content.trim()||!label.trim()||!current())return;locked.current=true;setWorking(true);setMessage('');
  try{beforeAdd();if(!current())return;const result=await run<DocumentImportResult>({type:'source.import.add',taskId:task.id,attemptId:preview.attemptId,label:label.trim(),content,role},undefined,{isCurrent:current});
   if(!current())return;if(result){clearDraft();await release();if(current())onAdded(result.reference);}else setMessage('Adding the source was not confirmed. Review Context before trying again; your review is kept here.');
  }finally{locked.current=false;if(current())setWorking(false);}
 }
 const disabled=busy||working;let csvIssue=false;if(preview?.format==='csv')try{readDocumentCsv(content);}catch{csvIssue=true;}
 return <section className="source-intake-editor" aria-label="Import document">
  <h2>{preview?(preview.format==='csv'?'Review CSV context':'Review document text'):'Import a document'}</h2>
  {!preview?<><p className="muted">Choose a local PDF, Word (.docx or .doc), plain-text, Markdown or CSV file, up to 20 MiB. Review and correct its readable text before adding it to “{task.title}”.</p><p className="tiny">PDF and Word extraction runs on this Mac. Scanned pages and images need OCR elsewhere. Importing does not send anything to an AI service.</p><p className="tiny">CSV: UTF-8, up to 100,000 characters, 10,000 data rows, 100 columns and 10,000 characters per cell. The first row supplies preview headings; duplicate and empty headings are allowed. Formulas and scripts stay as text.</p><div className="row"><Button kind="primary" disabled={disabled||task.status!=='active'} onClick={()=>void choose()}>{working?'Reading document…':'Choose document…'}</Button><Button disabled={disabled} onClick={onCancel}>Back to Context</Button></div></>:<>
   <p className="muted">{preview.fileName} · {preview.format.toUpperCase()}{preview.pageCount===undefined?'':` · ${preview.pageCount} pages`}</p>
   <div role="note">{preview.warnings.map(warning=><p className="tiny" key={warning}>{warning}</p>)}</div>
   <form onSubmit={event=>{event.preventDefault();void add();}}>
    {preview.format==='csv'&&<CsvImportPreview content={content}/>}
    <Field label={preview.format==='csv'?'Review and correct CSV text':'Review and correct extracted text'}><textarea autoFocus required rows={12} maxLength={DOCUMENT_IMPORT_TEXT_LIMIT} disabled={disabled} value={content} onChange={event=>setContent(event.target.value)}/></Field>
    <p className="tiny">{content.length.toLocaleString()} / 100,000 characters</p>
    <Field label="Source name"><input required maxLength={200} disabled={disabled} value={label} onChange={event=>setLabel(event.target.value)}/></Field>
    <Field label="Use as"><select disabled={disabled} value={role} onChange={event=>{const value=event.target.value;if(value==='fact'||value==='style'||value==='inspiration')setRole(value);}}><option value="fact">Source material</option><option value="style">Style reference</option><option value="inspiration">Inspiration</option></select></Field>
    <p className="tiny">Adds an independent text snapshot with the file name, fingerprint and extraction details. The original file is unchanged. Select the new source when you want to include it in a request.</p>
    <div className="row"><Button kind="primary" type="submit" disabled={disabled||csvIssue||!content.trim()||!label.trim()||task.status!=='active'}>{working?'Adding source…':preview.format==='csv'?'Add CSV as context':'Add document source'}</Button><Button disabled={disabled} onClick={()=>guard(()=>{clearDraft();void release();setPreview(undefined);setContent('');setLabel('');setMessage('');})}>Choose another file</Button><Button disabled={disabled} onClick={()=>guard(()=>{clearDraft();void release();onCancel();})}>Cancel</Button></div>
   </form>
   <details><summary>Import details</summary><p className="tiny">{preview.method} · {preview.byteLength.toLocaleString()} bytes · {new Date(preview.extractedAt).toLocaleString()}</p><p className="tiny break">File SHA-256: {preview.fileDigest}</p><p className="tiny">This review can no longer be added after 15 minutes. Leaving or quitting discards it.</p></details>
  </>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
