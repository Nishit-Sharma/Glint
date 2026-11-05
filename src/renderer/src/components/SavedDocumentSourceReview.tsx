import {useMemo,useRef,useState,type ReactNode} from 'react';
import type {createSavedDocumentDraftController} from '../saved-document-draft-controller';
import type {SavedDocumentSourceChange} from '../saved-document-source-changes';
import {sourceSnapshotDifference} from '../source-snapshot-difference';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {Button} from '../ui';
import './source-snapshot-difference.css';
import './saved-document-source-review.css';

function SnapshotComparison({change}:{change:Extract<SavedDocumentSourceChange,{kind:'ready'}>}){
 const result=useMemo(()=>sourceSnapshotDifference(change.source,change.reference,change.current),[change.source,change.before,change.after]);
 return <div className="source-snapshot-difference">
  <p>Referenced: {change.before.label} · Version {change.before.version} · {sourceRoleLabel(change.before.role)}. Latest saved: {change.after.label} · Version {change.after.version} · {sourceRoleLabel(change.after.role)}.</p>
  {result.kind==='unsupported'?<p>Text comparison is unavailable for image and window snapshots. Inspect their exact saved versions in Attachments before choosing a version here.</p>:result.kind==='missing'||result.kind==='no-newer'?<p role="status">The exact saved snapshots could not be compared. Review this source in Attachments.</p>:<>
   {result.kind==='large'?<p role="status">The text is too large or complex for an inline comparison. Read the complete saved snapshots below.</p>:result.unchanged?<p>Text is unchanged. The source name, role or saved version may have changed.</p>:<div className="source-snapshot-changes" aria-label={`Saved text changes · ${change.label}`}>{result.parts.map((part,index)=><div key={index} className={part.added?'source-change-added':part.removed?'source-change-removed':'source-change-context'}><span className="source-change-label">{part.added?'Added':part.removed?'Removed':'Unchanged'}</span><pre>{part.value}</pre></div>)}</div>}
   <details><summary>Read referenced snapshot · Version {change.before.version}</summary><pre className="source-snapshot-text" tabIndex={0}>{change.before.content}</pre></details>
   <details><summary>Read latest saved snapshot · Version {change.after.version}</summary><pre className="source-snapshot-text" tabIndex={0}>{change.after.content}</pre></details>
  </>}
 </div>;
}
function SourceChange({change,children}:{change:SavedDocumentSourceChange;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <section className="document-source-change" aria-label={change.label} data-source-review-id={change.reference.sourceId}>
  <h4>{change.label}</h4><p>Linked version {change.reference.version}{change.kind!=='unavailable'?` → latest saved version ${change.current.version}`:''}.</p>
  {change.kind==='unavailable'?<p role="status">An exact linked or latest saved snapshot is unavailable. This link is kept and cannot be updated here.</p>:change.kind==='refresh-required'?<p role="status">This source requires refresh or review in Attachments. Its current live content is unknown, and this link is kept.</p>:<details aria-label={`Compare ${change.label}`} onToggle={event=>setOpen(event.currentTarget.open)}><summary>Compare saved snapshots</summary>{open&&<SnapshotComparison change={change}/>}</details>}
  {children}
 </section>;
}
export function SavedDocumentSourceReview({controller}:{controller:ReturnType<typeof createSavedDocumentDraftController>}){
 const {sourceReview:review,sourceChanges}=controller.snapshot(),root=useRef<HTMLElement>(null);
 return <section className="saved-document-source-review" aria-label="Review changed source links" ref={root}>
  <h3>Review source changes</h3><p>Choose each source version you reviewed. Only that link changes in your draft; your text and other links stay as they are. Correct the document before saving its next revision.</p><p className="tiny">These are saved snapshots. Current live content is unknown. Updating a link does not verify the document.</p>
  {sourceChanges.length>0&&<p role="status" aria-live="polite">{sourceChanges.length} source {sourceChanges.length===1?'link still needs':'links still need'} review or refresh before saving.</p>}
  {sourceChanges.map(change=><SourceChange key={JSON.stringify([change.reference,change.kind,change.kind==='unavailable'?null:change.current])} change={change}>
   <Button kind="text" disabled={!review||change.kind!=='ready'} onClick={()=>{
    const current=root.current,picker=current?.closest<HTMLElement>('.dependency-picker');if(!review||!controller.reviewSources(review,change.reference.sourceId))return;
    const next=[...(current?.querySelectorAll<HTMLElement>('[data-source-review-id]')??[])].filter(row=>row.dataset.sourceReviewId!==change.reference.sourceId).map(row=>row.querySelector<HTMLButtonElement>('button:not(:disabled)')).find(button=>button?.isConnected);
    if(next)next.focus();else if(picker?.isConnected){picker.tabIndex=-1;picker.focus();}
   }}>{change.kind==='ready'?`Use reviewed version ${change.current.version} · ${change.label}`:`Keep linked version ${change.reference.version} · ${change.label}`}</Button>
  </SourceChange>)}
 </section>;
}
