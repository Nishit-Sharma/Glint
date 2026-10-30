import type {SavedHelperEntry} from '../../../shared/saved-helpers';
import {Button} from '../ui';
import './saved-helpers.css';

export function SavedHelpers({entries,pending,onOpen,onRefresh}:{entries:readonly SavedHelperEntry[];pending:boolean;onOpen:(entry:SavedHelperEntry)=>void;onRefresh:()=>void}){
 return <section className="saved-helpers"><p>Open a saved helper in its original task to use its active version.</p><p className="tiny">Text helpers transform pasted text. Record helpers compute local values. Picking helpers draft local manifests. Document recipes compose new documents from labelled notes. Table workflows filter, calculate and summarize selected local CSV sources.</p><Button disabled={pending} onClick={onRefresh}>Refresh helpers</Button>{entries.length===0?<p className="muted">No saved helpers yet. Choose Files → New file → Text helper to teach one, check it, and save a version.</p>:entries.map(entry=><article key={[entry.taskId,entry.artifactId,entry.moduleId].join(':')} aria-label={`${entry.name} in ${entry.taskTitle}`} className="saved-helper">
  <h3>{entry.name}</h3><p>{entry.description}</p><p className="tiny">Task: {entry.taskTitle} · {entry.activeVersion===null?`Inactive · Saved version ${entry.version}`:`Active version ${entry.activeVersion}`}</p><p>Discovery label: {entry.invocation}</p>
  {entry.example&&<details><summary>Saved example</summary><p className="tiny">Input</p><pre>{entry.example.input||'(empty)'}</pre><p className="tiny">Expected result</p><pre>{entry.example.expected.kind==='output'?entry.example.expected.text||'(empty)':'Leave for you to handle'}</pre></details>}
  {entry.recordExample&&<details><summary>{entry.scope==='table'?'Observed local manifest example':'Saved local record example'}</summary><p className="tiny">Input</p><pre>{JSON.stringify(entry.recordExample.input,null,2)}</pre><p className="tiny">{entry.scope==='table'?'Observed app-action result':'Computed result'}</p><pre>{JSON.stringify(entry.recordExample.output,null,2)}</pre></details>}
  <Button disabled={pending} onClick={()=>onOpen(entry)}>Open helper</Button>
 </article>)}</section>;
}
