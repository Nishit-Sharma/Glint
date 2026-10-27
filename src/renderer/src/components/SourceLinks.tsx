import {useRef,useState} from 'react';
import type {SourceRef,Task} from '../../../core/types';
import {DeveloperDetails} from './DeveloperDetails';
import {SourceSnapshotReview} from './SourceSnapshotReview';
export function SourceLinks({task,refs,title='Sources used'}:{task:Task;refs:SourceRef[];title?:string}){
 const [review,setReview]=useState<SourceRef>(),opener=useRef<HTMLButtonElement|null>(null);
 return <details className="provenance"><summary>{title} · {refs.length}</summary>{refs.length?refs.map(ref=>{
  const source=task.sources.find(source=>source.id===ref.sourceId),version=source?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest);
  return <button type="button" className="source-version-link" key={ref.sourceId} onClick={event=>{opener.current=event.currentTarget;setReview(ref);}}>{version?.label??'Source no longer available'} · Version {ref.version}</button>;
 }):<p className="tiny">No sources linked.</p>}{review&&<SourceSnapshotReview task={task} reference={review} onClose={()=>{setReview(undefined);opener.current?.focus();}}/>}<DeveloperDetails title="Source verification"><pre className="source-content">{JSON.stringify(refs,null,2)}</pre></DeveloperDetails></details>;
}
