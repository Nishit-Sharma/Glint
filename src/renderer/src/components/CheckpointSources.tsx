import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {Checkpoint,Source,SourceRef,Task} from '../../../core/types';
import {sourceRoleLabel} from '../../../shared/public-messages';
import {sourceSnapshotDifference} from '../source-snapshot-difference';
import './source-snapshot-difference.css';

const same=(left:SourceRef,right:SourceRef)=>left.sourceId===right.sourceId&&left.version===right.version&&left.digest===right.digest;
type Comparison={reference:SourceRef;serial:number;owner:string};

function SavedReference({reference}:{reference:SourceRef}){
 return <details className="history-checkpoint-reference"><summary>Exact saved reference</summary><dl><dt>Source ID</dt><dd><code>{reference.sourceId}</code></dd><dt>Version</dt><dd>{reference.version}</dd><dt>Digest</dt><dd><code>{reference.digest}</code></dd></dl></details>;
}

function CheckpointComparison({source,before,after}:{source:Source;before:SourceRef;after:SourceRef}){
 const result=useMemo(()=>sourceSnapshotDifference(source,before,after),[source,before,after]);
 if(result.kind==='missing'||result.kind==='no-newer')return <p role="status">An exact selected snapshot is unavailable for this comparison. No replacement was selected.</p>;
 if(result.kind==='unsupported')return <p role="status">Only saved text snapshots can be compared here. Image and window contents are not loaded in History.</p>;
 return <>
  <p>Saved with this note: {result.before.label} · Version {result.before.version} · {sourceRoleLabel(result.before.role)}. Compared with: {result.after.label} · Version {result.after.version} · {sourceRoleLabel(result.after.role)}.</p>
  {result.kind==='large'?<p role="status">The text is too large or complex for an inline comparison. Read the complete saved snapshots below.</p>:result.unchanged?<p>Text is unchanged. The source name, role or saved version may have changed.</p>:<div className="source-snapshot-changes" aria-label="Text changes since this note">{result.parts.map((part,index)=><div key={index} className={part.added?'source-change-added':part.removed?'source-change-removed':'source-change-context'}><span className="source-change-label">{part.added?'Added':part.removed?'Removed':'Unchanged'}</span><pre>{part.value}</pre></div>)}</div>}
  <details><summary>Read compared snapshot · Version {result.after.version}</summary><pre className="source-snapshot-text" tabIndex={0}>{result.after.content}</pre></details>
 </>;
}

function CheckpointSource({task,checkpointId,reference}:{task:Task;checkpointId:string;reference:SourceRef}){
 const identity=JSON.stringify([task.id,checkpointId,reference]),scope=useRef(identity);scope.current=identity;
 const [comparison,setComparison]=useState<Comparison>(),serial=useRef(0),mounted=useRef(true),opener=useRef<HTMLButtonElement>(null),heading=useRef<HTMLHeadingElement>(null),sourceHeading=useRef<HTMLHeadingElement>(null);
 const opened=comparison?.owner===identity?comparison:undefined;
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{if(opened){heading.current?.scrollIntoView({block:'nearest'});heading.current?.focus({preventScroll:true});}},[opened?.serial]);
 const source=task.sources.find(item=>item.id===reference.sourceId),saved=source?.versions.find(version=>version.id===source.id&&version.version===reference.version&&version.digest===reference.digest),latest=source?.versions.find(version=>version.id===source.id&&version.version===source.currentVersion);
 const latestReference=source&&latest?{sourceId:source.id,version:latest.version,digest:latest.digest}:undefined,changed=latestReference&&!same(reference,latestReference);
 function compare(){
  if(!mounted.current||scope.current!==identity||!latestReference||!latest||latest.version<=reference.version)return;
  setComparison({reference:{...latestReference},serial:++serial.current,owner:identity});
 }
 function close(){
  if(!mounted.current||scope.current!==identity||!opened||opened.serial!==serial.current)return;
  const closingSerial=opened.serial;setComparison(undefined);
  requestAnimationFrame(()=>{
   if(!mounted.current||scope.current!==identity||serial.current!==closingSerial)return;
   const target=opener.current?.isConnected?opener.current:sourceHeading.current;
   if(target?.isConnected&&!target.closest('[hidden],[inert]'))target.focus({preventScroll:true});
  });
 }
 return <section className="history-checkpoint-source" aria-label={saved?`${saved.label} · Saved version ${reference.version}`:`Unavailable source ${reference.sourceId} · Version ${reference.version}`}>
  <h4 ref={sourceHeading} tabIndex={-1}>{saved?saved.label:`Unavailable source snapshot · Version ${reference.version}`}</h4>
  {!source||!saved?<><p>Source ID · <code>{reference.sourceId}</code></p><p role="status">This exact saved snapshot is unavailable. Its reference is kept; this does not mean its content was deleted.</p><SavedReference reference={reference}/></>:<>
  <p>Saved with this note · Version {reference.version} · {sourceRoleLabel(saved.role)}.</p>
  {!latest?<p role="status">The latest saved snapshot is unavailable. The note's exact saved evidence is kept below.</p>:changed?<p>Latest saved · Version {latest.version}{latest.label!==saved.label?' · '+latest.label:''}. This note still refers to version {reference.version}.</p>:<p>Matches the latest saved version.</p>}
  {source.freshness!=='fresh'&&<p className="warning">Refresh or review is required. This note keeps its original recorded versions; current live content is unknown.</p>}
  {saved.kind==='text'?<details><summary>Read source saved with this note · Version {reference.version}</summary><pre className="source-snapshot-text" tabIndex={0}>{saved.content}</pre></details>:<p>Image and window contents are not loaded in History. Only their saved references are shown.</p>}
  <SavedReference reference={reference}/>
  {changed&&latest&&latest.version>reference.version&&saved.kind==='text'&&latest.kind==='text'&&<button type="button" ref={opener} className="history-checkpoint-compare" onClick={compare}>Compare with saved version {latest.version}</button>}
  </>}
  {opened&&<section className="source-snapshot-difference" aria-label="Checkpoint source comparison"><h5 ref={heading} tabIndex={-1}>Changes since this note</h5><p>This compares saved snapshots only. Current live content is unknown. Reviewing them does not update this note, its sources or saved work.</p>{latestReference&&!same(latestReference,opened.reference)&&<p className="warning">The latest saved version is now {latestReference.version}. This comparison keeps version {opened.reference.version} until you choose another comparison.</p>}{source?<CheckpointComparison source={source} before={reference} after={opened.reference}/>:<p role="status">An exact selected snapshot is unavailable for this comparison. No replacement was selected.</p>}<button type="button" className="history-checkpoint-compare" onClick={close}>Close source comparison</button></section>}
 </section>;
}

export function CheckpointSources({task,checkpoint}:{task:Task;checkpoint:Checkpoint}){
 return <section className="history-checkpoint-sources" aria-label="Task sources recorded with this note"><h3>Sources at this point</h3><p>These versions were recorded for the task when this note was saved. Current live content is unknown.</p>{checkpoint.sourceRefs.length?checkpoint.sourceRefs.map(reference=><CheckpointSource key={JSON.stringify([task.id,checkpoint.id,reference])} task={task} checkpointId={checkpoint.id} reference={reference}/>):<p>No source snapshots were linked when this note was saved.</p>}</section>;
}
