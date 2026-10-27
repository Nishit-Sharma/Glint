import {useEffect,useId,useLayoutEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,Calculator,Save} from 'lucide-react';
import {parseModelDraft,type ModelDraft,type ExperimentDraft} from '../../../core/model-drafts';
import type {Artifact,ArtifactRevision,ExperimentResult,ExperimentSpec,Expression,Task} from '../../../core/types';
import {Button,Field,type Run} from '../ui';
import {changedDependencies} from '../editor-state';
import {useNavigationDraft} from '../draft-navigation';
import {ExportReview} from './ExportReview';
import {ProcedureEditor} from './ProcedureEditor';
import {ReadyArtifact} from './ReadyArtifact';
import {DeveloperDetails} from './DeveloperDetails';
import {SourceLinks} from './SourceLinks';
import {TaskMenu} from './TaskMenu';
import './structured-tools.css';
import './model-draft-layout.css';

const latest=<T,>(items:T[])=>items[items.length-1];
const humanLabel=(name:string)=>name.replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const numberLabel=(value:number)=>value.toLocaleString(undefined,{maximumSignificantDigits:12});
export function readModelDraft(revision:ArtifactRevision):ModelDraft|undefined {
 if(revision.mimeType!=='application/json')return;
 try{return parseModelDraft(revision.content);}catch{return;}
}
export function expressionLabel(expression:Expression,variableLabel:(name:string)=>string=name=>name):string{
 switch(expression.op){
  case 'constant':return String(expression.value)+(expression.unit&&expression.unit!=='1'?' '+expression.unit:'');
  case 'variable':return variableLabel(expression.name);
  case 'power':return '('+expressionLabel(expression.base,variableLabel)+')^'+expression.exponent;
  default:return '('+expressionLabel(expression.left,variableLabel)+' '+({add:'+',subtract:'−',multiply:'×',divide:'÷'}[expression.op])+' '+expressionLabel(expression.right,variableLabel)+')';
 }
}
export function ModelDraftReview({task,artifact,busy,run,back}:{task:Task;artifact:Artifact;busy:boolean;run:Run;back:()=>void}){
 const [base,setBase]=useState(()=>latest(artifact.revisions));
 const [experimentDirty,setExperimentDirty]=useState(false);
 const [procedureDirty,setProcedureDirty]=useState(false);
 const [exportActionId,setExportActionId]=useState<string>(),[infoOpen,setInfoOpen]=useState(false),[fileSaved,setFileSaved]=useState(false);
 const review=useRef<HTMLDivElement>(null),exportScroll=useRef<{node:HTMLElement;top:number}[]|undefined>(undefined);
 const exportAction=task.actions.find(action=>action.proposal.id===exportActionId);
 useEffect(()=>{if(exportAction?.status==='verified'){setFileSaved(true);setExportActionId(undefined);}},[exportAction?.proposal.id,exportAction?.status]);
 useLayoutEffect(()=>{if(!exportActionId&&exportScroll.current){for(const position of exportScroll.current)position.node.scrollTop=position.top;exportScroll.current=undefined;}},[exportActionId]);
 const draft=readModelDraft(base);
 const latestRevision=latest(artifact.revisions);
 if(!draft)return <section className="structured-tools"><header className="structured-heading"><h2>{base.title}</h2></header><p className="warning">This draft cannot be opened as an interactive view. Its saved content is still available.</p><details><summary>View saved content</summary><pre className="source-content">{base.content}</pre></details></section>;
 const conflict=latestRevision.revision!==base.revision;
 const stale=changedDependencies(task,base.sourceRefs).length>0;
 const exportBlocked=experimentDirty||procedureDirty||conflict||stale;
 const exportTitle=exportAction?.status==='uncertain'?'Check this save':exportAction?.status==='failed'?'Could not save file':exportAction?.status==='retired'?'Approval expired':'Export '+draft.title;
 const artifactTools=<TaskMenu label="Artifact options"><Button onClick={()=>setInfoOpen(!infoOpen)}>Sources & versions</Button><Button disabled={busy||exportBlocked} onClick={async()=>{
  const positions=[review.current?.closest<HTMLElement>('.inspector-content'),review.current?.querySelector<HTMLElement>('.procedure-scroll')].filter((node):node is HTMLElement=>!!node).map(node=>({node,top:node.scrollTop}));
  const action=await run({type:'export.propose',taskId:task.id,artifactId:artifact.id,revision:base.revision});
  if(action){exportScroll.current=positions;setFileSaved(false);setExportActionId(action.proposal.id);}
 }}>Export draft</Button></TaskMenu>;
 const information=<>{fileSaved&&<p className="model-file-saved" role="status">File saved</p>}{conflict&&<section className="revision-conflict" role="status"><h3>A newer draft revision is available</h3><p>The review below uses revision {base.revision}. Your edits are preserved. Load the latest draft to replace them.</p><Button disabled={busy} onClick={()=>setBase(latestRevision)}>Load latest draft</Button></section>}{infoOpen&&<section className="document-information"><p className="tiny">Version {base.revision}</p><SourceLinks task={task} refs={base.sourceRefs}/></section>}</>;
 return <ReadyArtifact identity={[task.id,artifact.id,base.revision,base.digest].join(':')}><div ref={review} className="model-draft-review structured-tools" hidden={!!exportActionId}>
  {draft.kind==='experiment'?<GeneratedExperiment key={base.digest} task={task} artifact={artifact} base={base} draft={draft} busy={busy||conflict} run={run} back={back} onSaved={setBase} onDirty={setExperimentDirty} headerTools={artifactTools} information={information}/>:<>{information}<ProcedureEditor key={base.digest} task={task} seed={{...draft,sourceRefs:base.sourceRefs,originArtifact:{artifactId:artifact.id,revision:base.revision}}} onDirty={setProcedureDirty} busy={busy||conflict} run={run} back={back} headerTools={artifactTools}/></>}
 </div>{exportActionId&&<section className="model-draft-export structured-tools"><header className="structured-heading model-export-heading"><div><h2>{exportTitle}</h2></div></header><Button kind="back" onClick={()=>setExportActionId(undefined)}><ArrowLeft size={15}/>Back to result</Button>{exportAction&&<ExportReview taskId={task.id} action={exportAction} busy={busy} canApprove={!exportBlocked} showHeading={false} run={run}/>}</section>}</ReadyArtifact>;
}
function GeneratedExperiment({task,artifact,base,draft,busy,run,back,onSaved,onDirty,headerTools,information}:{task:Task;artifact:Artifact;base:ArtifactRevision;draft:ExperimentDraft;busy:boolean;run:Run;back:()=>void;onSaved:(revision:ArtifactRevision)=>void;onDirty:(dirty:boolean)=>void;headerTools:ReactNode;information:ReactNode}){
 const initialInputs=useRef(Object.fromEntries(Object.entries(draft.inputs).map(([name,value])=>[name,draft.unknownInputs?.includes(name)?NaN:value])));
 const [touched,setTouched]=useState<Record<string,boolean>>({});
 const [title,setTitle]=useState(draft.title),[inputs,setInputs]=useState({...initialInputs.current}),[assumptions,setAssumptions]=useState(draft.spec.assumptions.join('\n'));
 const [calculation,setCalculation]=useState<{result:ExperimentResult;inputs:Record<string,number>;spec:ExperimentSpec;title:string}>();
 const [localError,setLocalError]=useState(''),[methodEdited,setMethodEdited]=useState(false),[titleEdited,setTitleEdited]=useState(false),[pending,setPending]=useState(false);
 const version=useRef(0),operation=useRef(false),id=useId();
 const dirty=title!==draft.title||assumptions!==draft.spec.assumptions.join('\n')||JSON.stringify(inputs)!==JSON.stringify(initialInputs.current);
 const clearNavigationDraft=useNavigationDraft(dirty);
 useEffect(()=>{onDirty(dirty);},[dirty,onDirty]);
 const stale=changedDependencies(task,base.sourceRefs);
 const assumptionLines=assumptions.split('\n').map(line=>line.trim()).filter(Boolean);
 const assumptionError=assumptionLines.length<1?'Add at least one assumption.':assumptionLines.length>12?'Use 1–12 assumptions.':assumptionLines.some(line=>line.length>500)?'Use at most 500 characters each for your assumptions.':'';
 const spec={...draft.spec,title,assumptions:assumptionLines};
 const inputErrors=Object.fromEntries(draft.spec.variables.map(variable=>[variable.name,!Number.isFinite(inputs[variable.name])?'Enter a finite number.':inputs[variable.name]<variable.min||inputs[variable.name]>variable.max?`Enter a value from ${numberLabel(variable.min)} to ${numberLabel(variable.max)}.`:'']));
 const valid=Object.values(inputErrors).every(error=>!error);
 const locked=busy||pending;
 function changed(){version.current++;setCalculation(undefined);setLocalError('');}
 async function calculate(event:FormEvent){
  event.preventDefault();if(!valid||assumptionError||locked||operation.current)return;
  const atVersion=version.current,submitted={inputs:{...inputs},spec:structuredClone(spec),title};operation.current=true;setPending(true);setLocalError('');
  try{const result=await run<ExperimentResult>({type:'experiment.evaluate',spec:submitted.spec,inputs:submitted.inputs});if(result&&atVersion===version.current)setCalculation({...submitted,result});}
  finally{operation.current=false;setPending(false);}
 }
 async function saveDraft(){
  if(stale.length||locked||!valid||!title.trim()||operation.current)return;
  if(assumptionError){setMethodEdited(true);setLocalError('');return;}
  try{
   const submittedVersion=version.current,updated=parseModelDraft(JSON.stringify({...draft,title,spec,inputs,...(draft.unknownInputs?{unknownInputs:[]}:{})}),'experiment');setLocalError('');operation.current=true;setPending(true);
   const saved=await run<Task>({type:'artifact.save',taskId:task.id,artifact:{artifactId:artifact.id,expectedRevision:base.revision,title,content:JSON.stringify(updated,null,2),mimeType:'application/json',sourceRefs:base.sourceRefs}},'Experiment settings saved');
   if(saved&&version.current===submittedVersion){const item=saved.artifacts.find(item=>item.id===artifact.id);if(item){clearNavigationDraft();onSaved(latest(item.revisions));}}
  }catch{setLocalError('These experiment settings could not be saved. Review the title, input ranges and assumptions. Use 1–12 assumptions, with at most 500 characters each.');}
  finally{operation.current=false;setPending(false);}
 }
 async function saveResult(){
  if(!calculation||locked||stale.length||!title.trim()||operation.current)return;
  const snapshot=calculation,submittedVersion=version.current;operation.current=true;setPending(true);
  try{
   const saved=await run<Task>({type:'artifact.save',taskId:task.id,artifact:{title:snapshot.title+' — result',mimeType:'text/plain',sourceRefs:base.sourceRefs,content:`${snapshot.title}\n\nExperiment: ${draft.title}, version ${base.revision}\nFormula: ${expressionLabel(snapshot.spec.expression)}\nInputs:\n${snapshot.spec.variables.map(variable=>`${variable.name} = ${snapshot.inputs[variable.name]} ${variable.unit}`).join('\n')}\n\nResult: ${snapshot.result.value} ${snapshot.result.unit}\n\nAssumptions:\n${snapshot.result.assumptions.map(item=>'- '+item).join('\n')}`}},'Calculated result saved with its source links');if(saved&&version.current===submittedVersion){clearNavigationDraft();back();}
  }finally{operation.current=false;setPending(false);}
 }
 return <section className="experiment-tool" aria-label="Experiment review">
  <header className="structured-heading experiment-heading"><div><h2>{title.trim()||'Untitled experiment'}</h2></div><div className="model-object-actions">{headerTools}</div></header>
  {information}
  <p className="structured-intro">{draft.explanation}</p>
  <section className="experiment-workbench" aria-label="Inputs and result" aria-busy={pending}>
   <form onSubmit={calculate} noValidate>
    <div className="experiment-inputs">{draft.spec.variables.map((variable,index)=><div className="variable-input" key={variable.name}><Field label={`${humanLabel(variable.name)}${variable.unit==='1'?'':` (${variable.unit})`}`}><input disabled={locked} type="number" required step="any" min={variable.min} max={variable.max} value={Number.isFinite(inputs[variable.name])?inputs[variable.name]:''} placeholder={draft.unknownInputs?.includes(variable.name)?'Not confirmed':undefined} aria-invalid={!!inputErrors[variable.name]&&!!touched[variable.name]} aria-describedby={`${id}-input-${index}`} onChange={event=>{setTouched({...touched,[variable.name]:true});setInputs({...inputs,[variable.name]:event.target.valueAsNumber});changed();}}/></Field><p className="structured-field-error" id={`${id}-input-${index}`} role={inputErrors[variable.name]&&touched[variable.name]?'alert':undefined}>{touched[variable.name]?inputErrors[variable.name]:''}</p></div>)}</div>
    <div className="experiment-calculate"><Button type="submit" kind={calculation?'text':'primary'} disabled={locked||!valid||!!assumptionError}><Calculator size={15}/>Calculate</Button><p className="structured-help">{pending?'Calculating…':''}</p></div>
   </form>
   {calculation&&<section className="calculation generated-result" aria-label="Calculation result">{calculation.result.unit!=='1'&&<small>Calculated from your inputs</small>}<div className="experiment-equation">{calculation.result.unit==='1'&&<span>{expressionLabel(calculation.spec.expression,humanLabel).replace(/^\((.*)\)$/,'$1')} =</span>}<output>{numberLabel(calculation.result.value)}{calculation.result.unit!=='1'&&<span>{calculation.result.unit}</span>}</output></div><p className="structured-caveat">{calculation.result.assumptions[0]}</p><Button kind="primary" disabled={locked||stale.length>0||!title.trim()} onClick={()=>void saveResult()}><Save size={14}/>Save result to task</Button></section>}
  </section>
  <details className="experiment-method"><summary>Assumptions & method</summary><div className="model-formula"><span>Formula</span><code>{expressionLabel(draft.spec.expression)}</code></div>  <details className="structured-title-edit"><summary>Edit title</summary><Field label="Experiment title"><input disabled={locked} required maxLength={200} value={title} aria-invalid={titleEdited&&!title.trim()} aria-describedby={titleEdited&&!title.trim()?`${id}-title-error`:undefined} onChange={event=>{setTitle(event.target.value);setTitleEdited(true);changed();}}/></Field>{titleEdited&&!title.trim()&&<p className="structured-field-error" id={`${id}-title-error`} role="alert">Enter an experiment title.</p>}</details>
<p className="structured-help">This formula was suggested from your sources. Check these assumptions before relying on a result.</p><ul>{assumptionLines.map((item,index)=><li key={index}>{item}</li>)}</ul><details className="experiment-method-edit"><summary>Edit method</summary><Field label="Assumptions (one per line)"><textarea disabled={locked} rows={4} maxLength={16000} value={assumptions} aria-invalid={methodEdited&&!!assumptionError} aria-describedby={`${id}-method-help${methodEdited&&assumptionError?` ${id}-method-error`:''}`} onChange={event=>{setAssumptions(event.target.value);setMethodEdited(true);changed();}}/></Field><p className="structured-help" id={`${id}-method-help`}>Use 1–12 assumptions, with at most 500 characters each.</p></details>{dirty&&<div className="experiment-defaults"><p className="structured-help">Use these inputs and this method when reopening this experiment.</p><Button disabled={locked||stale.length>0||!valid||!title.trim()} onClick={()=>void saveDraft()}>Save as input defaults</Button></div>}<DeveloperDetails title="Expression diagnostics"><pre className="source-content">{JSON.stringify(draft.spec.expression,null,2)}</pre></DeveloperDetails></details>
  {methodEdited&&assumptionError&&<p className="structured-field-error" id={`${id}-method-error`} role="alert">{assumptionError}</p>}
  {stale.length>0&&<p className="structured-notice warning">Source links need review: {[...new Set(stale)].join(', ')}. You can explore these saved inputs, but refresh and generate a new draft before saving a result.</p>}
  {localError&&<p className="structured-field-error" role="alert">{localError}</p>}
 </section>;
}
