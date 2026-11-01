import {useState} from 'react';
import {DOCUMENT_IMPORT_TEXT_LIMIT} from '../../../shared/document-import';
import {Button,Field} from '../ui';
import {ReadableText} from './ReadableText';

/** Presentation only: the picker-owned review text remains the controlled value. */
export function MarkdownFileReview({content,disabled,onChange}:{content:string;disabled:boolean;onChange:(value:string)=>void}){
 const [editing,setEditing]=useState(false);
 return <section aria-label="Markdown file review">
  <div className="row"><Button disabled={disabled} onClick={()=>setEditing(!editing)}>{editing?'Show rendered Markdown':'Edit Markdown source'}</Button></div>
  {editing?<Field label="Review and correct Markdown source"><textarea autoFocus required rows={12} maxLength={DOCUMENT_IMPORT_TEXT_LIMIT} disabled={disabled} value={content} onChange={event=>onChange(event.target.value)}/></Field>:<section aria-label="Rendered Markdown file" tabIndex={0}><ReadableText text={content}/></section>}
  <p className="tiny">Links and image references stay as text. HTML and scripts are not run; remote images are not loaded.</p>
 </section>;
}
