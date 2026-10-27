import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {diffLines} from 'diff';
import {ArrowLeft} from 'lucide-react';
import type {ArtifactRevision,Task} from '../../../core/types';
import {Field} from '../ui';
import {ReadableText} from './ReadableText';
import {SourceLinks} from './SourceLinks';
import './revision-compare.css';

export function RevisionCompare({task,revisions,selected,onClose}:{task:Task;revisions:readonly ArtifactRevision[];selected:number;onClose:()=>void}){
 const [beforeId,setBefore]=useState([...revisions].reverse().find(r=>r.revision<selected)?.revision??revisions[0].revision),[afterId,setAfter]=useState(selected),[changes,setChanges]=useState(false),back=useRef<HTMLButtonElement>(null);
 useLayoutEffect(()=>{back.current?.focus({preventScroll:true});},[]);
 const before=revisions.find(r=>r.revision===beforeId)??revisions[0],after=revisions.find(r=>r.revision===afterId)??revisions.at(-1)!;
 const parts=useMemo(()=>changes&&before.content.length+after.content.length<=100_000?diffLines(before.content,after.content,{timeout:30,maxEditLength:1000}):undefined,[changes,before.content,after.content]);
 return <section className="revision-comparison" aria-label="Revision comparison">
  <button type="button" className="back" ref={back} onClick={onClose}><ArrowLeft size={14} aria-hidden="true"/>Back to document</button>
  <div className="compare-selectors">{([{label:'Before',value:beforeId,set:setBefore},{label:'After',value:afterId,set:setAfter}] as const).map(field=><Field label={field.label} key={field.label}><select value={field.value} onChange={event=>field.set(Number(event.target.value))}>{revisions.map(revision=><option key={revision.revision} value={revision.revision}>Revision {revision.revision} · {revision.title}</option>)}</select></Field>)}</div>
  <div className="compare-mode" role="group" aria-label="Comparison view"><button type="button" aria-pressed={!changes} onClick={()=>setChanges(false)}>Read versions</button><button type="button" aria-pressed={changes} onClick={()=>setChanges(true)}>Text changes</button></div>
  {changes?<><p className="tiny">Exact text, including Markdown formatting. Added and removed text is labelled.</p>{before.title!==after.title&&<p className="compare-title-change"><del>{before.title}</del><ins>{after.title}</ins></p>}{before.content===after.content?<p className="compare-unchanged">Text unchanged. Source links may differ.</p>:!parts?<p role="status">This change is too large for an inline comparison. Read both versions instead.</p>:<div className="compare-changes" aria-label="Text changes">{parts.map((part,index)=><div key={index} className={part.added?'compare-added':part.removed?'compare-removed':'compare-context'}><span className="sr-only">{part.added?'Added: ':part.removed?'Removed: ':'Unchanged: '}</span>{part.added?<ins>{part.value}</ins>:part.removed?<del>{part.value}</del>:<span>{part.value}</span>}</div>)}</div>}<div className="compare-source-links"><section aria-label="Before sources"><h3>Before sources</h3><SourceLinks task={task} refs={before.sourceRefs}/></section><section aria-label="After sources"><h3>After sources</h3><SourceLinks task={task} refs={after.sourceRefs}/></section></div></>:<div className="compare-readers">{([{label:'Before',revision:before},{label:'After',revision:after}] as const).map(({label,revision})=><section key={label} aria-label={label+' revision'}><h3>{revision.title} <span>· Revision {revision.revision}</span></h3><ReadableText text={revision.content} leadingTitle={revision.title}/><SourceLinks task={task} refs={revision.sourceRefs}/></section>)}</div>}
 </section>;
}
