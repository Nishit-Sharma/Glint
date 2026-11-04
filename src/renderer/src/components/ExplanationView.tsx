import {ExplanationTeachback,type TeachbackActions} from './ExplanationTeachback';
import {useId,useState} from 'react';
import type {Artifact,ArtifactRevision,SourceRef,Task} from '../../../core/types';
import {EXPLAIN_DEPTHS,citationDisplay,citationStateText,explainDepthLabel,explanationSourcesValid,readExplanation,type ExplainDepth} from '../../../shared/explanation-modes';
import {diagramText,layoutDiagram,type DiagramSpec} from '../../../shared/explanation-diagram';
import {ReadableText} from './ReadableText';
import {SourceSnapshotReview} from './SourceSnapshotReview';
import './explanation.css';

export function ExplanationDiagram({spec}:{spec:DiagramSpec}){
 const marker=useId(),layout=layoutDiagram(spec);
 return <figure className="explanation-diagram"><figcaption>{spec.title??'Concept diagram'} · Suggested relationships</figcaption><div className="explanation-diagram-scroll" tabIndex={0} role="region" aria-label="Scrollable concept diagram"><svg role="img" aria-label={spec.title??'Concept diagram'} viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height}>
  <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker></defs>
  {layout.groups.map(group=><g key={group.id} className="explanation-diagram-group"><rect x={group.x} y={group.y} width={group.width} height={group.height} rx="8"/><text x={group.x+8} y={group.y+14}>{group.label}</text></g>)}
  {layout.edges.map(edge=><g key={edge.from+':'+edge.to}><path d={edge.path} fill="none" stroke="currentColor" markerEnd={`url(#${marker})`}/>{edge.label&&<text className="explanation-edge-label" x={edge.labelX} y={edge.labelY-5} textAnchor="middle">{edge.label}</text>}</g>)}
  {layout.nodes.map(node=><g key={node.id}><title>{spec.nodes.find(item=>item.id===node.id)!.label}</title><rect className="explanation-node" x={node.x} y={node.y} width={node.width} height={node.height} rx="8"/><text x={node.x+node.width/2} y={node.y+node.height/2-(node.lines.length-1)*8} textAnchor="middle">{node.lines.map((line,index)=><tspan key={index} x={node.x+node.width/2} dy={index?16:0}>{line}</tspan>)}</text></g>)}
 </svg></div><details><summary>Read diagram as text</summary><pre>{diagramText(spec)}</pre></details></figure>;
}

export function ExplanationView({task,artifact,revision,disabled,onDepth,teachbackActions}:{task:Task;artifact:Artifact;revision:ArtifactRevision;disabled?:boolean;onDepth?:(depth:ExplainDepth)=>void;teachbackActions?:TeachbackActions}){
 const [review,setReview]=useState<SourceRef>(),explanation=readExplanation(revision.content);
 const sources=revision.sourceRefs.flatMap(ref=>task.sources.find(source=>source.id===ref.sourceId)?.versions.filter(version=>version.version===ref.version&&version.digest===ref.digest)??[]);
 const receipt=task.requests.some(request=>request.status==='completed'&&request.explainDepth===explanation?.depth&&request.answer?.artifactId===artifact.id&&request.answer.revision===revision.revision&&request.answer.digest===revision.digest);
 if(!explanation||!receipt||!explanationSourcesValid(explanation,revision.sourceRefs,sources))return <p role="alert">This saved explanation needs review. Its original file is kept.</p>;
 const current=task.artifacts.find(item=>item.id===artifact.id)?.revisions.at(-1),deep=explanation.deep;
 return <section className="explanation-view" aria-label={`${explainDepthLabel[explanation.depth]} explanation`}><header><p className="tiny">{explainDepthLabel[explanation.depth]} explanation · Version {revision.revision}</p><h2>{explanation.title}</h2></header><ReadableText text={explanation.answer}/>
  {deep&&<><h3>Core idea</h3><ReadableText text={deep.coreIdea}/><h3>Parts</h3>{deep.parts.map((part,index)=><section key={index}><h4>{part.title}</h4><ReadableText text={part.detail}/></section>)}<h3>Worked example</h3><ReadableText text={deep.workedExample}/><h3>Common misconceptions</h3>{deep.misconceptions.map((item,index)=><section key={index}><p><strong>{item.misconception}</strong></p><ReadableText text={item.correction}/></section>)}<h3>Check your understanding</h3><ReadableText text={deep.check.question}/><details><summary>Show answer</summary><ReadableText text={deep.check.answer}/></details>{teachbackActions&&<ExplanationTeachback task={task} basis={{artifactId:artifact.id,revision:revision.revision,digest:revision.digest}} question={deep.check.question} disabled={!!disabled||current?.digest!==revision.digest} actions={teachbackActions}/>}</>}
  {explanation.diagram?.status==='valid'&&<ExplanationDiagram spec={explanation.diagram.spec}/>}
  {!!explanation.citations.length&&<section aria-label="Explanation sources"><h3>Sources</h3><p className="tiny">Quotes are checked against this saved source version. This does not confirm current source availability or the explanation’s interpretation.</p>{explanation.citations.map((citation,index)=>{const display=citationDisplay(task,citation);return <div key={index} className="explanation-citation"><p>[{index+1}] {display.label} · Version {citation.version}</p><p className="tiny">{citationStateText[display.state]}</p><blockquote>{citation.quote}</blockquote><button type="button" onClick={()=>setReview({sourceId:citation.sourceId,version:citation.version,digest:citation.digest!})}>Review {display.label}, version {citation.version}</button></div>;})}</section>}
  {current?.digest===revision.digest&&onDepth&&<div role="group" aria-label="Change explanation depth">{EXPLAIN_DEPTHS.map(depth=><button type="button" key={depth} disabled={disabled||depth===explanation.depth} onClick={()=>onDepth(depth)}>{explainDepthLabel[depth]}</button>)}</div>}
  {review&&<SourceSnapshotReview task={task} reference={review} onClose={()=>setReview(undefined)}/>}
 </section>;
}
