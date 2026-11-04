import {useLayoutEffect,useRef,useState} from 'react';
import type {SourceRef,Task,SourceInput} from '../../../core/types';
import type {PdfPageOwner,PdfPageReview,PdfPagePreview,PdfPageAddResult} from '../../../shared/pdf-page-import';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field,type Run} from '../ui';
import {useNavigationDraft} from '../draft-navigation';
import './pdf-page-import.css';

export function PdfPageImport({task,busy,run,isCurrent,beforeAdd,onAdded,onCancel}:{task:Task;busy:boolean;run:Run;isCurrent:()=>boolean;beforeAdd:()=>void|Promise<void>;onAdded:(references:SourceRef[])=>void;onCancel:()=>void}){
 const [review,setReview]=useState<PdfPageReview>(),[preview,setPreview]=useState<PdfPagePreview>(),[page,setPage]=useState(1),[selected,setSelected]=useState<Array<{page:number;pngDigest:string}>>([]),[role,setRole]=useState<SourceInput['role']>('fact'),[working,setWorking]=useState(false),[message,setMessage]=useState('');
 const mounted=useRef(true),locked=useRef(false),owner=useRef<PdfPageOwner|undefined>(undefined),currentRef=useRef(isCurrent),generation=useRef(0);currentRef.current=isCurrent;
 const clearDraft=useNavigationDraft(!!review),current=()=>mounted.current&&currentRef.current();
 async function release(){const previous=owner.current;owner.current=undefined;generation.current++;if(previous)await window.companion.invoke({type:'source.pdf.cancel',...previous}).catch(()=>{});}
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;void release();};},[task.id]);
 async function choose(){
  if(locked.current||busy||!current())return;locked.current=true;setWorking(true);setMessage('');const chosen={taskId:task.id,attemptId:crypto.randomUUID()};owner.current=chosen;const epoch=++generation.current;
  try{const result=await run<PdfPageReview|{kind:'cancelled'}>({type:'source.pdf.choose',...chosen},undefined,{isCurrent:current});if(!current()||epoch!==generation.current)return;
   if(result?.kind==='review'){setReview(result);setSelected([]);setPage(1);const image=await run<PdfPagePreview>({type:'source.pdf.page',...chosen,page:1},undefined,{isCurrent:current});if(current()&&epoch===generation.current){setPreview(image);if(!image)setMessage('The page preview was not available. Choose a page and preview it again.');}}
   else{await release();if(current())setMessage(result?.kind==='cancelled'?'No PDF selected.':'The PDF could not be opened. Existing sources are unchanged.');}
  }catch(reason){if(current())setMessage(publicErrorMessage(reason));}finally{locked.current=false;if(current())setWorking(false);}
 }
 async function show(number:number){const chosen=owner.current;if(!chosen||locked.current||busy||!current())return;locked.current=true;setWorking(true);setPreview(undefined);setMessage('');const epoch=generation.current;
  try{const result=await run<PdfPagePreview>({type:'source.pdf.page',...chosen,page:number},undefined,{isCurrent:current});if(current()&&epoch===generation.current){setPreview(result);setPage(number);if(!result)setMessage('The page preview was not available. No context was added.');}}
  catch(reason){if(current())setMessage(publicErrorMessage(reason));}finally{locked.current=false;if(current())setWorking(false);}
 }
 async function add(){const chosen=owner.current;if(!chosen||!selected.length||locked.current||busy||!current())return;locked.current=true;setWorking(true);setMessage('');const epoch=generation.current;
  try{await beforeAdd();if(!current())return;const result=await run<PdfPageAddResult>({type:'source.pdf.add',...chosen,pages:selected,role},undefined,{isCurrent:current});if(!current()||epoch!==generation.current)return;if(result){clearDraft();await release();if(current())onAdded(result.references);}else setMessage('Adding the pages was not confirmed. Inspect Context before retrying; this review is kept.');}
  catch(reason){if(current())setMessage(publicErrorMessage(reason));}finally{locked.current=false;if(current())setWorking(false);}
 }
 const disabled=busy||working,shown=preview?.provenance;
 return <section className="pdf-page-import" aria-label="Import visual PDF pages"><h2>Visual PDF pages</h2>
  {!review?<><p>Choose a local PDF, inspect its page images, then explicitly add selected pages as context. This works without a PDF text layer.</p><p className="tiny">Up to 20 MiB and 200 PDF pages. Add up to four selected pages per review; each is a separate saved image source.</p><Button disabled={disabled} onClick={()=>void choose()}>Choose PDF…</Button></>:<>
   <h3>{review.fileName}</h3><p>{review.pageCount} {review.pageCount===1?'page':'pages'} · independent snapshot of the chosen file. The original file is not linked or monitored.</p>
   <div className="row"><Field label="Page"><select aria-label="PDF page" value={page} disabled={disabled} onChange={event=>setPage(Number(event.target.value))}>{Array.from({length:review.pageCount},(_,index)=><option key={index+1} value={index+1}>Page {index+1}</option>)}</select></Field><Button disabled={disabled} onClick={()=>void show(page)}>Preview page</Button></div>
   {preview&&shown&&<><figure><img src={preview.dataUrl} alt={`Rendered PDF page ${shown.page} of ${shown.pageCount}`}/><figcaption>Page {shown.page} of {shown.pageCount} · {shown.width} × {shown.height} pixels</figcaption></figure><label className="pdf-page-check"><input type="checkbox" aria-label={`Select PDF page ${shown.page}`} disabled={disabled||selected.length>=4&&!selected.some(item=>item.page===shown.page)} checked={selected.some(item=>item.page===shown.page&&item.pngDigest===shown.pngDigest)} onChange={event=>setSelected(event.target.checked?[...selected.filter(item=>item.page!==shown.page),{page:shown.page,pngDigest:shown.pngDigest}]:selected.filter(item=>item.page!==shown.page))}/>Select page {shown.page} as context</label></>}
   <p>{selected.length?`Selected pages: ${selected.map(item=>item.page).join(', ')}`:'No pages selected.'}</p><Field label="Use as"><select aria-label="PDF page role" value={role} disabled={disabled} onChange={event=>{const value=event.target.value;if(value==='fact'||value==='style'||value==='inspiration')setRole(value);}}><option value="fact">Source material</option><option value="style">Style reference</option><option value="inspiration">Inspiration</option></select></Field>
   <p className="tiny">Rendering preserves a cropped static page image. Inspect it before adding; interactive content may differ. No OCR or model understanding is claimed by this preview. Select the saved page sources explicitly for your next question.</p>
   <details><summary>File and page provenance</summary><p>PDF SHA-256: {review.fileDigest} · {review.byteLength} bytes.</p>{shown&&<p>Page PNG SHA-256: {shown.pngDigest} · {shown.method} · {shown.box}.</p>}</details>
   <Button disabled={disabled||!selected.length} onClick={()=>void add()}>Add {selected.length} {selected.length===1?'page':'pages'} as context</Button>
  </>}
  <Button kind="text" disabled={disabled} onClick={()=>{clearDraft();void release().then(()=>{if(current())onCancel();});}}>Cancel PDF review</Button>{message&&<p role="status">{message}</p>}
 </section>;
}
