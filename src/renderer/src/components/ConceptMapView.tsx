import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {Artifact,ArtifactRevision,SourceRef,Task} from '../../../core/types';
import {conceptCitationRange,readConceptMap,sameConceptRef,type ConceptCitation} from '../../../shared/concept-map';
import {SourceSnapshotReview} from './SourceSnapshotReview';
import './concept-map.css';

export function ConceptMapView({task,artifact,revision}:{task:Task;artifact:Artifact;revision:ArtifactRevision}){
 const id=useId(),[selection,setSelection]=useState<{kind:'node'|'relationship';id:string}>(),[activation,setActivation]=useState(0),[review,setReview]=useState<SourceRef>(),panel=useRef<HTMLElement>(null),heading=useRef<HTMLHeadingElement>(null),endpointFocus=useRef(false);
 const map=readConceptMap(revision.content,revision.sourceRefs);
 useLayoutEffect(()=>{if(!activation)return;const reveal=endpointFocus.current?heading.current:panel.current;if(endpointFocus.current){endpointFocus.current=false;heading.current?.focus({preventScroll:true});}const frame=requestAnimationFrame(()=>reveal?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}));return()=>cancelAnimationFrame(frame);},[activation]);
 const receipt=task.requests.some(request=>request.kind==='concept-map'&&request.status==='completed'&&request.answer?.artifactId===artifact.id&&request.answer.revision===revision.revision&&request.answer.digest===revision.digest);
 const sourceFor=(ref:SourceRef)=>task.sources.find(source=>source.id===ref.sourceId)?.versions.find(version=>version.version===ref.version&&version.digest===ref.digest);
 const invalidQuote=map&&[...map.nodes,...map.relationships].some(item=>item.citations.some(citation=>{const version=sourceFor(citation.sourceRef);return version&&(version.kind!=='text'||version.content.slice(citation.start,citation.start+citation.quote.length)!==citation.quote);}));
 if(!map||!receipt||invalidQuote)return <p className="warning" role="alert">This saved concept map needs review. Its original file is kept.</p>;
 const stale=revision.sourceRefs.some(ref=>{const source=task.sources.find(source=>source.id===ref.sourceId),current=source?.versions.at(-1);return !source||source.freshness!=='fresh'||!current||!sameConceptRef(ref,{sourceId:source.id,version:current.version,digest:current.digest});});
 const selectedNode=selection?.kind==='relationship'?undefined:map.nodes.find(node=>node.id===selection?.id)??map.nodes[0];
 const selectedRelation=selection?.kind==='relationship'?map.relationships.find(edge=>edge.id===selection.id):undefined;
 const selected=selectedRelation??selectedNode!;
 const title=selectedRelation?`${map.nodes.find(node=>node.id===selectedRelation.from)!.title} → ${selectedRelation.label} → ${map.nodes.find(node=>node.id===selectedRelation.to)!.title}`:selectedNode!.title;
 function select(kind:'node'|'relationship',itemId:string){setSelection({kind,id:itemId});setActivation(value=>value+1);}
 function selectEndpoint(nodeId:string){endpointFocus.current=true;select('node',nodeId);}
 function citationView(citation:ConceptCitation,index:number){const source=sourceFor(citation.sourceRef),range=source?.kind==='text'?conceptCitationRange(source.content,citation):undefined;return <div className="concept-map-citation" key={index}><blockquote>{citation.quote}</blockquote><button type="button" onClick={()=>setReview(citation.sourceRef)} aria-label={`Review ${source?.label??'unavailable source'}, version ${citation.sourceRef.version}`}>{source?.label??'Unavailable saved source'} · Version {citation.sourceRef.version}<span>{range?`Characters ${range.start}–${range.end}`:'Character range unavailable'}</span></button></div>;}
 return <section className="concept-map" aria-label="Concept map">
  <header><p className="concept-map-eyebrow">Suggested concept map</p><h2>{map.title}</h2><p>{map.summary}</p><p className="concept-map-notice">Inspect concepts and directed links below. Quotations reproduce source text; interpretations and unknowns remain proposals to check.</p></header>
  {stale&&<p className="concept-map-stale" role="status">Earlier source context. This map keeps its original excerpts and versions; current claims need review.</p>}
  <div className="concept-map-nodes" role="group" aria-label="Concepts">{map.nodes.map(node=><button type="button" key={node.id} aria-pressed={selectedNode?.id===node.id} aria-controls={`${id}-details`} onClick={()=>select('node',node.id)}>{node.title}<small>{node.basis==='quotation'?'Quoted passage':node.basis==='unknown'?'Unknown':'Interpretation'}</small></button>)}</div>
  <div className="concept-map-links" role="group" aria-label="Concept relationships">{map.relationships.map(edge=><button type="button" className="concept-map-edge" key={edge.id} aria-label={`Inspect relationship: ${map.nodes.find(node=>node.id===edge.from)!.title} ${edge.label} ${map.nodes.find(node=>node.id===edge.to)!.title}`} aria-pressed={selectedRelation?.id===edge.id} aria-controls={`${id}-details`} onClick={()=>select('relationship',edge.id)}><span>{map.nodes.find(node=>node.id===edge.from)!.title}</span><span className="concept-map-edge-label"><span aria-hidden="true">→</span>{edge.label}<small>{edge.basis==='unknown'?'Unknown relationship':'Interpretation'}</small><span aria-hidden="true">→</span></span><span>{map.nodes.find(node=>node.id===edge.to)!.title}</span></button>)}</div>
  <span className="sr-only" role="status">{activation?`Showing ${selectedRelation?'relationship':'concept'} details: ${title}`:''}</span>
  <section ref={panel} id={`${id}-details`} className="concept-map-details" aria-labelledby={`${id}-selected`}>
   <p className="concept-map-eyebrow">{selectedRelation?'Relationship':'Concept'} · {selected.basis==='quotation'?'Quoted passage':selected.basis==='unknown'?'Unknown':'Interpretation'}</p><h3 ref={heading} tabIndex={-1} id={`${id}-selected`}>{title}</h3><p>{selected.detail}</p>{selected.reason&&<p className="concept-map-reason"><strong>{selected.basis==='unknown'?'What is missing':'Why this interpretation'}</strong>{selected.reason}</p>}
   <div role="group" aria-label="Evidence for selected item">{selected.citations.map(citationView)}</div>
   {selectedRelation&&<div className="concept-map-endpoints"><button type="button" onClick={()=>selectEndpoint(selectedRelation.from)}>Inspect {map.nodes.find(node=>node.id===selectedRelation.from)!.title}</button><button type="button" onClick={()=>selectEndpoint(selectedRelation.to)}>Inspect {map.nodes.find(node=>node.id===selectedRelation.to)!.title}</button></div>}
  </section>
  {review&&<SourceSnapshotReview task={task} reference={review} onClose={()=>setReview(undefined)}/>}
 </section>;
}
