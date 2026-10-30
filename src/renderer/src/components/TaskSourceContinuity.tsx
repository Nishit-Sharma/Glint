import {useMemo} from 'react';
import type {Task} from '../../../core/types';
import {sourceResumeContext} from '../../../core/source-resume';
import './task-source-continuity.css';

const quantity=(count:number,label:string)=>`${count} ${label}${count===1?'':'s'}`;

/** Local metadata from the selected authoritative task; no retained resume reply or action authority. */
export function TaskSourceContinuity({task}:{task:Task}){
 const context=useMemo(()=>sourceResumeContext(task),[task]),procedures=context.affectedProcedures,omitted=context.omissions;
 const total=procedures.length+omitted.affectedProcedures;
 if(!total)return null;
 const current=procedures.filter(procedure=>procedure.revisions.some(revision=>revision.revision===procedure.currentRevision)).length;
 return <section className="task-source-continuity" aria-label="Saved procedure source continuity">
  <details>
   <summary>Saved procedure source context <span>{quantity(total,'procedure')}</span></summary>
   <p>Among the included summaries, {quantity(current,'current revision')} {current===1?'needs':'need'} source review. Older revisions keep their recorded references.</p>
   <p className="muted">These are saved references. Current live content is unknown. This local view grants no capture, sharing or execution permission.</p>
   <ul className="continuity-procedures">{procedures.map(record=>{
    const procedure=task.procedures.find(procedure=>procedure.id===record.procedureId),latest=procedure?.revisions.find(revision=>revision.revision===record.currentRevision);
    return <li key={record.procedureId}>
     <h3>{latest?.title??'Unavailable saved procedure'}</h3><p className="tiny">Current saved revision {record.currentRevision}</p>
     <ul>{record.revisions.map(revision=><li key={revision.revision}>
      <h4>Revision {revision.revision} · {revision.revision===record.currentRevision?'Current saved revision':'Historical saved revision'}</h4>
      <ul>{revision.sourceRefs.map((reference,index)=>{
       const source=task.sources.find(source=>source.id===reference.sourceId),saved=source?.versions.find(version=>version.id===source.id&&version.version===reference.version&&version.digest===reference.digest);
       return <li key={reference.sourceId+':'+reference.version+':'+index}>
        <p><strong>{saved?.label??'Unavailable source snapshot'}</strong> · Version {reference.version}</p>
        <p>{reference.availability==='unavailable'?'The exact saved snapshot is unavailable; its reference is kept.':reference.versionRelation==='superseded'?'An earlier saved source version.':reference.versionRelation==='current'?'Matches the latest saved version.':'The latest saved version cannot be verified.'}</p>
        <p className="muted">{reference.freshness==='refresh-required'?'Refresh or review is required. Current live content is unknown.':reference.freshness==='unknown'?'Source freshness is unknown.':'The source is marked fresh; live content remains unknown.'}</p>
        <details className="continuity-reference"><summary>Exact saved reference</summary><dl><dt>Procedure ID</dt><dd><code>{record.procedureId}</code></dd><dt>Procedure revision</dt><dd>{revision.revision}</dd><dt>Source ID</dt><dd><code>{reference.sourceId}</code></dd><dt>Source version</dt><dd>{reference.version}</dd><dt>Source digest</dt><dd><code>{reference.digest}</code></dd></dl></details>
       </li>;
      })}</ul>
      {!!revision.omittedSourceRefs&&<p className="muted">{quantity(revision.omittedSourceRefs,'affected source reference')} omitted from this revision.</p>}
     </li>)}</ul>
     {!!record.omittedRevisions&&<p className="muted">{quantity(record.omittedRevisions,'affected revision')} omitted from this procedure.</p>}
    </li>;
   })}</ul>
  </details>
  {!!(omitted.affectedProcedures||omitted.procedureRevisions||omitted.procedureSourceRefs)&&<p className="continuity-omissions" role="status">Omitted dependency metadata: {quantity(omitted.affectedProcedures,'entire procedure')}, {quantity(omitted.procedureRevisions,'revision')} and {quantity(omitted.procedureSourceRefs,'source reference')}. Omitted dependencies remain unknown.</p>}
 </section>;
}
