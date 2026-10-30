import type {SemanticRecord} from '../../../learning/semantic-procedure';
import type {LocalDemonstrationWorkspace as Workspace} from '../../../learning/local-demonstration';
import {localActionDescription} from '../local-demonstration-display';
import './local-demonstration-readable.css';
export function LocalDemonstrationValues({value,label,empty='No values yet.'}:{value:SemanticRecord;label:string;empty?:string}){
 return Object.keys(value).length?<dl className="local-demonstration-values" aria-label={label}>{Object.entries(value).map(([name,item])=><div key={name}><dt>{name}</dt><dd className="semantic-exact-value">{item===''?<span aria-label="Empty text">Empty text</span>:String(item)}</dd></div>)}</dl>:<p>{empty}</p>;
}
export function LocalDemonstrationAction({receipt,index}:{receipt:Workspace['actions'][number];index:number}){
 const {stage,result,before,after}=receipt,produced=stage.kind==='assign'&&Object.hasOwn(after,stage.field.name)?{[stage.field.name]:after[stage.field.name]}:{};
 return <article className="local-demonstration-step" aria-label={`Recorded step ${index+1}`}><h5>Step {index+1}</h5><p className="local-demonstration-description">{localActionDescription(stage)}</p>{stage.kind==='checkpoint'?<p>{result.status==='completed'?'Checkpoint passed. The current values were kept.':`Stopped: ${result.reason}`}</p>:<LocalDemonstrationValues value={produced} label={`Result of step ${index+1}`} empty={result.status==='abstained'?`No new value. Stopped: ${result.reason}`:'This action produced no new value.'}/>}<details><summary>Saved note</summary><p className="semantic-exact-value">{stage.label}</p></details><details><summary>Before and after values</summary><h6>Before this step</h6><LocalDemonstrationValues value={before} label={`Before step ${index+1}`}/><h6>After this step</h6><LocalDemonstrationValues value={after} label={`After step ${index+1}`}/></details><details><summary>Local approval and revision</summary><p>Approved for this exact local value action at helper revision {receipt.authority.expectedRevision}. Recorded at revision {receipt.atRevision}. No browser, file, OS or model action is authorized.</p></details></article>;
}
