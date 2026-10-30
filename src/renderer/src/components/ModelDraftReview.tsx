import {RangeSumExplanation} from './RangeSumExplanation';
import {ExperimentTargetPractice} from './ExperimentTargetPractice';
import {SOURCE_FORMULA_MIME,readSourceFormulaPacket,reviewedSourceFormula,sourceFormulaCitationText,type SourceFormulaPacket} from '../../../learning/source-formula';
import {SourceFormulaCitation} from './SourceFormulaCitation';
import {compareExperimentSnapshots,experimentComparisonWorkedText,traceQuantity,sameExperimentMethod,sameExperimentOwner,type ExperimentSnapshot} from '../experiment-comparison';
import {useEffect,useId,useLayoutEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ArrowLeft,Calculator,Save} from 'lucide-react';
import {parseModelDraft,type ModelDraft,type ExperimentDraft} from '../../../core/model-drafts';
import type {Artifact,ArtifactRevision,ExperimentResult,ExperimentSpec,Expression,Task} from '../../../core/types';
import {Button,Field,type Run} from '../ui';
import {changedDependencies} from '../editor-state';
import {useGuardedAction,useNavigationDraft} from '../draft-navigation';
import {ExportReview} from './ExportReview';
import {ExperimentPractice} from './ExperimentPractice';
import {ExperimentChangeExplanation} from './ExperimentChangeExplanation';
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
 if(revision.mimeType===SOURCE_FORMULA_MIME)try{return readSourceFormulaPacket(revision.content).draft;}catch{return;}
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
 const guard=useGuardedAction();
 const [experimentDirty,setExperimentDirty]=useState(false);
 const [procedureDirty,setProcedureDirty]=useState(false);
 const [exportActionId,setExportActionId]=useState<string>(),[infoOpen,setInfoOpen]=useState(false),[fileSaved,setFileSaved]=useState(false);
 const review=useRef<HTMLDivElement>(null),exportScroll=useRef<{node:HTMLElement;top:number}[]|undefined>(undefined);
 const exportAction=task.actions.find(action=>action.proposal.id===exportActionId);
 useEffect(()=>{if(exportAction?.status==='verified'){setFileSaved(true);setExportActionId(undefined);}},[exportAction?.proposal.id,exportAction?.status]);
 useLayoutEffect(()=>{if(!exportActionId&&exportScroll.current){for(const position of exportScroll.current)position.node.scrollTop=position.top;exportScroll.current=undefined;}},[exportActionId]);
 const draft=readModelDraft(base);let sourcePacket:SourceFormulaPacket|undefined;if(base.mimeType===SOURCE_FORMULA_MIME)try{sourcePacket=reviewedSourceFormula(task,artifact.id,base);}catch{return <section className="structured-tools" role="alert"><h2>Source formula needs inspection</h2><p>The original local publication or exact quoted snapshot could not be verified. Its saved bytes remain available in history; no learning action runs from this view.</p></section>;}
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
 const information=<>{sourcePacket&&<SourceFormulaCitation task={task} packet={sourcePacket}/>}{fileSaved&&<p className="model-file-saved" role="status">File saved</p>}{conflict&&<section className="revision-conflict" role="status"><h3>A newer draft revision is available</h3><p>The review below uses revision {base.revision}. Your edits are preserved. Load the latest draft to replace them.</p><Button disabled={busy} onClick={()=>guard(()=>setBase(latestRevision))}>Load latest draft</Button></section>}{infoOpen&&<section className="document-information"><p className="tiny">Version {base.revision}</p><SourceLinks task={task} refs={base.sourceRefs}/></section>}</>;
 return <ReadyArtifact identity={[task.id,artifact.id,base.revision,base.digest].join(':')}><div ref={review} className="model-draft-review structured-tools" hidden={!!exportActionId}>
  {draft.kind==='experiment'?<GeneratedExperiment key={JSON.stringify([task.id,artifact.id,base.revision,base.digest,base.sourceRefs])} task={task} artifact={artifact} base={base} draft={draft} sourcePacket={sourcePacket} busy={busy||conflict} run={run} back={back} onSaved={setBase} onDirty={setExperimentDirty} headerTools={artifactTools} information={information}/>:<>{information}<ProcedureEditor key={base.digest} task={task} seed={{...draft,sourceRefs:base.sourceRefs,originArtifact:{artifactId:artifact.id,revision:base.revision}}} onDirty={setProcedureDirty} busy={busy||conflict} run={run} back={back} headerTools={artifactTools}/></>}
 </div>{exportActionId&&<section className="model-draft-export structured-tools"><header className="structured-heading model-export-heading"><div><h2>{exportTitle}</h2></div></header><Button kind="back" onClick={()=>setExportActionId(undefined)}><ArrowLeft size={15}/>Back to result</Button>{exportAction&&<ExportReview taskId={task.id} action={exportAction} busy={busy} canApprove={!exportBlocked} showHeading={false} run={run}/>}</section>}</ReadyArtifact>;
}
function GeneratedExperiment({task,artifact,base,draft,sourcePacket,busy,run,back,onSaved,onDirty,headerTools,information}:{task:Task;artifact:Artifact;base:ArtifactRevision;draft:ExperimentDraft;sourcePacket?:SourceFormulaPacket;busy:boolean;run:Run;back:()=>void;onSaved:(revision:ArtifactRevision)=>void;onDirty:(dirty:boolean)=>void;headerTools:ReactNode;information:ReactNode}){
 const initialInputs=useRef(Object.fromEntries(Object.entries(draft.inputs).map(([name,value])=>[name,draft.unknownInputs?.includes(name)?NaN:value])));
 const [touched,setTouched]=useState<Record<string,boolean>>({});
 const [title,setTitle]=useState(draft.title),[inputs,setInputs]=useState({...initialInputs.current}),[assumptions,setAssumptions]=useState(draft.spec.assumptions.join('\n'));
 const [calculation,setCalculation]=useState<ExperimentSnapshot>(),[baseline,setBaseline]=useState<ExperimentSnapshot>(),[practiceOpen,setPracticeOpen]=useState(false);
 const [localError,setLocalError]=useState(''),[methodEdited,setMethodEdited]=useState(false),[titleEdited,setTitleEdited]=useState(false),[pending,setPending]=useState(false);
 const version=useRef(0),operation=useRef(false),id=useId(),mounted=useRef(true);
 const identity=JSON.stringify([task.id,artifact.id,base.revision,base.digest,base.sourceRefs]),latestIdentity=useRef(identity),latestTask=useRef(task);latestIdentity.current=identity;latestTask.current=task;
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const dirty=title!==draft.title||assumptions!==draft.spec.assumptions.join('\n')||JSON.stringify(inputs)!==JSON.stringify(initialInputs.current);
 const clearNavigationDraft=useNavigationDraft(dirty||!!baseline,()=>{version.current++;setCalculation(undefined);setBaseline(undefined);setPracticeOpen(false);setInputs({...initialInputs.current});setAssumptions(draft.spec.assumptions.join('\n'));setTitle(draft.title);setTouched({});setLocalError('');setMethodEdited(false);setTitleEdited(false);});
 useEffect(()=>{onDirty(dirty||!!baseline);},[dirty,baseline,onDirty]);
 const stale=changedDependencies(task,base.sourceRefs);
 const assumptionLines=assumptions.split('\n').map(line=>sourcePacket?line:line.trim()).filter(line=>line.trim().length>0);
 const assumptionError=assumptionLines.length<1?'Add at least one assumption.':assumptionLines.length>12?'Use 1–12 assumptions.':assumptionLines.some(line=>line.length>500)?'Use at most 500 characters each for your assumptions.':'';
 const spec={...draft.spec,title,assumptions:assumptionLines};
 const inputErrors=Object.fromEntries(draft.spec.variables.map(variable=>[variable.name,!Number.isFinite(inputs[variable.name])?'Enter a finite number.':inputs[variable.name]<variable.min||inputs[variable.name]>variable.max?`Enter a value from ${numberLabel(variable.min)} to ${numberLabel(variable.max)}.`:variable.integer&&!Number.isSafeInteger(inputs[variable.name])?'Enter a whole-number value.':'']));
 const valid=Object.values(inputErrors).every(error=>!error);
 const locked=busy||pending;
 const owner={taskId:task.id,artifact:{artifactId:artifact.id,revision:base.revision,digest:base.digest},sourceRefs:base.sourceRefs};
 const calculationOwned=!calculation||sameExperimentOwner(calculation.owner,owner),baselineOwned=!baseline||sameExperimentOwner(baseline.owner,owner);
 const rangeModel=sourcePacket?.input.derivation==='python-range-sum-v1',quantity=(value:number,unit:string)=>rangeModel?traceQuantity({value,unit}):`${numberLabel(value)} ${unit}`;
 const comparison=baseline&&calculation?compareExperimentSnapshots(baseline,calculation):undefined,methodChanged=!!baseline&&!sameExperimentMethod(baseline.spec,spec);
 const practiceBlocked=locked||stale.length>0||!base.sourceRefs.length||!!draft.unknownInputs?.length||!calculationOwned||title!==draft.title||!sameExperimentMethod(draft.spec,spec)||comparison?.kind==='incompatible';
 const demonstratedInputs=[...(baseline?[baseline.inputs]:[]),...(calculation?[calculation.inputs]:[])].filter((example,index,all)=>!all.slice(0,index).some(other=>draft.spec.variables.every(v=>other[v.name]===example[v.name])));
 function changed(){version.current++;setCalculation(undefined);setLocalError('');}
 async function calculate(event:FormEvent){
  event.preventDefault();if(!valid||assumptionError||locked||operation.current)return;
  const atVersion=version.current,submitted={inputs:{...inputs},spec:structuredClone(spec),title,owner:{taskId:task.id,artifact:{artifactId:artifact.id,revision:base.revision,digest:base.digest},sourceRefs:structuredClone(base.sourceRefs)}};operation.current=true;setPending(true);setLocalError('');
  const isCurrent=()=>mounted.current&&latestIdentity.current===identity&&atVersion===version.current;
  try{const result=await run<ExperimentResult>({type:'experiment.evaluate',spec:submitted.spec,inputs:submitted.inputs},undefined,{isCurrent});if(result&&isCurrent())setCalculation({...submitted,result});}
  finally{operation.current=false;if(mounted.current)setPending(false);}
 }
 async function saveDraft(){
  if(sourcePacket||stale.length||locked||!valid||!title.trim()||operation.current||baseline)return;
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
  if(!sameExperimentOwner(calculation.owner,owner)||baseline&&!sameExperimentOwner(baseline.owner,owner)){setLocalError('The experiment revision or source links changed. Calculate again before saving.');return;}
  const snapshot=calculation,submittedVersion=version.current,comparison=baseline?compareExperimentSnapshots(baseline,snapshot):undefined;if(comparison?.kind==='incompatible'){setLocalError(comparison.reason);return;}const isCurrent=()=>mounted.current&&latestIdentity.current===identity&&version.current===submittedVersion;operation.current=true;setPending(true);
  try{
   const saved=await run<Task>({type:'artifact.save',taskId:task.id,artifact:{title:snapshot.title+' — result',mimeType:'text/plain',sourceRefs:base.sourceRefs,expectedArtifacts:[{artifactId:artifact.id,revision:base.revision,digest:base.digest}],content:`${snapshot.title}\n\nExperiment: ${draft.title}, revision ${base.revision}\nFormula: ${expressionLabel(snapshot.spec.expression)}\n${baseline&&comparison?.kind==='comparable'?`\nComparison baseline inputs:\n${baseline.spec.variables.map(variable=>`${variable.name} = ${baseline.inputs[variable.name]} ${variable.unit}`).join('\n')}\nBaseline result: ${baseline.result.value} ${baseline.result.unit}\n\n`:''}Inputs:\n${snapshot.spec.variables.map(variable=>`${variable.name} = ${snapshot.inputs[variable.name]} ${variable.unit}`).join('\n')}\n\nResult: ${snapshot.result.value} ${snapshot.result.unit}${baseline&&comparison?.kind==='comparable'?`\nCalculated difference: ${comparison.delta} ${comparison.unit}\nThis comparison uses the same formula and assumptions. It does not establish real-world causation.\n\n${experimentComparisonWorkedText(baseline,snapshot)}`:''}\n\nAssumptions:\n${snapshot.result.assumptions.map(item=>'- '+item).join('\n')}\n\nTechnical provenance:\nExperiment identity: ${artifact.id}; digest: ${base.digest}${sourcePacket?`\n\n${sourceFormulaCitationText(sourcePacket)}`:''}`}},'Calculated result saved with its source links',{isCurrent});if(saved&&isCurrent()){clearNavigationDraft();back();}
  }finally{operation.current=false;if(mounted.current)setPending(false);}
 }
 if(practiceOpen&&calculation){const isCurrent=()=>{const current=latestTask.current,revision=current.artifacts.find(item=>item.id===artifact.id)?.revisions.at(-1);return mounted.current&&latestIdentity.current===identity&&current.id===task.id&&!!revision&&revision.revision===base.revision&&revision.digest===base.digest&&JSON.stringify(revision.sourceRefs)===JSON.stringify(base.sourceRefs)&&changedDependencies(current,base.sourceRefs).length===0;};return <section className="experiment-tool" aria-label="Experiment review">{information}{!isCurrent()&&<p className="warning" role="alert">This experiment or a linked source changed. Return and review it before continuing.</p>}<ExperimentPractice basis={{taskId:task.id,basis:{artifactId:artifact.id,revision:base.revision,digest:base.digest},expectedSourceRefs:base.sourceRefs}} spec={draft.spec} defaults={draft.inputs} demonstratedInputs={demonstratedInputs} formula={expressionLabel(draft.spec.expression)} outputUnit={calculation.result.unit} busy={busy} run={run} isCurrent={isCurrent} onBack={()=>setPracticeOpen(false)}/></section>;}
 return <section className="experiment-tool" aria-label="Experiment review">
  <header className="structured-heading experiment-heading"><div><h2>{title.trim()||'Untitled experiment'}</h2></div><div className="model-object-actions">{headerTools}</div></header>
  {information}
  <p className="structured-intro">{draft.explanation}</p><p className="structured-help">This relationship was suggested from linked material; the links do not verify its accuracy. Review the formula and assumptions before relying on a result.</p>
  <section className="experiment-workbench" aria-label="Inputs and result" aria-busy={pending}>
   <form onSubmit={calculate} noValidate>
    <div className="experiment-inputs">{draft.spec.variables.map((variable,index)=><div className="variable-input" key={variable.name}><Field label={`${humanLabel(variable.name)}${variable.unit==='1'?'':` (${variable.unit})`}`}><input disabled={locked} type="number" required step={variable.integer?1:'any'} min={variable.min} max={variable.max} value={Number.isFinite(inputs[variable.name])?inputs[variable.name]:''} placeholder={draft.unknownInputs?.includes(variable.name)?'Not confirmed':undefined} aria-invalid={!!inputErrors[variable.name]&&!!touched[variable.name]} aria-describedby={`${id}-input-${index}`} onChange={event=>{setTouched({...touched,[variable.name]:true});setInputs({...inputs,[variable.name]:event.target.valueAsNumber});changed();}}/></Field><p className="structured-field-error" id={`${id}-input-${index}`} role={inputErrors[variable.name]&&touched[variable.name]?'alert':undefined}>{touched[variable.name]?inputErrors[variable.name]:''}</p></div>)}</div>
    <div className="experiment-calculate"><Button type="submit" kind={calculation?'text':'primary'} disabled={locked||!valid||!!assumptionError}><Calculator size={15}/>Calculate</Button><p className="structured-help">{pending?'Calculating…':''}</p></div>
   </form>
   {calculation&&<section className="calculation generated-result" aria-label="Calculation result">{calculation.result.unit!=='1'&&<small>Calculated from your inputs</small>}<div className="experiment-equation">{calculation.result.unit==='1'&&<span>{expressionLabel(calculation.spec.expression,humanLabel).replace(/^\((.*)\)$/,'$1')} =</span>}<output>{numberLabel(calculation.result.value)}{calculation.result.unit!=='1'&&<span>{calculation.result.unit}</span>}</output></div><p className="structured-caveat">{calculation.result.assumptions[0]}</p><Button type="button" disabled={locked} onClick={()=>setBaseline(structuredClone(calculation))}>{baseline?'Replace comparison baseline':'Use as comparison baseline'}</Button><Button type="button" disabled={practiceBlocked} onClick={()=>setPracticeOpen(true)}>Try separate practice</Button><Button kind="primary" disabled={locked||stale.length>0||!title.trim()||!calculationOwned||!baselineOwned||comparison?.kind==='incompatible'} onClick={()=>void saveResult()}><Save size={14}/>Save result to task</Button></section>}
  </section>
  {calculation&&(title!==draft.title||!sameExperimentMethod(draft.spec,spec)||!!draft.unknownInputs?.length||!base.sourceRefs.length)&&<p className="structured-help">To practice, use a source-linked experiment with saved, confirmed defaults and the same saved title, formula and assumptions. Hypothetical numeric changes do not need to replace those defaults.</p>}
  {baseline&&<section className="experiment-comparison" aria-label="Experiment comparison"><h3>Compare calculations</h3><p>Baseline: {quantity(baseline.result.value,baseline.result.unit)}. This comparison is temporary until you save a result; it is not restored on reopening the experiment.</p><Button type="button" disabled={locked} onClick={()=>setBaseline(undefined)}>Clear comparison baseline</Button>{methodChanged?<p role="alert">The formula, input definitions or assumptions changed. Calculate and choose a new baseline before comparing.</p>:!calculation?<p>Change an input and calculate again to compare it with this baseline.</p>:comparison?.kind==='incompatible'?<p role="alert">{comparison.reason}</p>:comparison?.kind==='comparable'?<><p>{comparison.changed.length?'Changed inputs:':'No input values changed.'}</p>{comparison.changed.length>0&&<ul>{comparison.changed.map(item=><li key={item.name}>{humanLabel(item.name)}: {numberLabel(item.before)} → {numberLabel(item.after)}{item.unit==='1'?'':` ${item.unit}`}</li>)}</ul>}<p>Calculated result: {numberLabel(baseline.result.value)} → {quantity(calculation.result.value,comparison.unit)}; difference {quantity(comparison.delta,comparison.unit)}.</p><ExperimentChangeExplanation baseline={baseline} current={calculation}/></>:null}</section>}
  {sourcePacket&&calculation&&<RangeSumExplanation packet={sourcePacket} inputs={calculation.inputs}/>}
  {sourcePacket&&<ExperimentTargetPractice task={task} artifactId={artifact.id} revision={base} packet={sourcePacket} demonstratedInputs={demonstratedInputs} busy={locked}/>}
  <details className="experiment-method"><summary>Assumptions & method</summary><div className="model-formula"><span>Formula</span><code>{expressionLabel(draft.spec.expression)}</code></div>  <details className="structured-title-edit"><summary>Edit title</summary><Field label="Experiment title"><input disabled={locked} required maxLength={200} value={title} aria-invalid={titleEdited&&!title.trim()} aria-describedby={titleEdited&&!title.trim()?`${id}-title-error`:undefined} onChange={event=>{setTitle(event.target.value);setTitleEdited(true);changed();}}/></Field>{titleEdited&&!title.trim()&&<p className="structured-field-error" id={`${id}-title-error`} role="alert">Enter an experiment title.</p>}</details>
<p className="structured-help">{sourcePacket?'This formula was transcribed and explicitly reviewed locally. Values and assumptions remain user declarations.':'This formula was suggested from your sources. Check these assumptions before relying on a result.'}</p><ul>{assumptionLines.map((item,index)=><li key={index}>{item}</li>)}</ul><details className="experiment-method-edit"><summary>Edit method</summary><Field label="Assumptions (one per line)"><textarea disabled={locked} rows={4} maxLength={16000} value={assumptions} aria-invalid={methodEdited&&!!assumptionError} aria-describedby={`${id}-method-help${methodEdited&&assumptionError?` ${id}-method-error`:''}`} onChange={event=>{setAssumptions(event.target.value);setMethodEdited(true);changed();}}/></Field><p className="structured-help" id={`${id}-method-help`}>Use 1–12 assumptions, with at most 500 characters each.</p></details>{dirty&&!sourcePacket&&<div className="experiment-defaults"><p className="structured-help">Use these inputs and this method when reopening this experiment.</p>{baseline&&<p className="structured-help">Clear the comparison baseline before saving new input defaults.</p>}<Button disabled={locked||stale.length>0||!valid||!title.trim()||!!baseline} onClick={()=>void saveDraft()}>Save as input defaults</Button></div>}{sourcePacket&&<p className="structured-help">This cited transcription is immutable. Input changes here are hypothetical. To correct the formula, units or bounds, open Files → New file → Experiment and explicitly review another transcription; the earlier publication stays saved.</p>}<DeveloperDetails title="Expression diagnostics"><pre className="source-content">{JSON.stringify(draft.spec.expression,null,2)}</pre></DeveloperDetails></details>
  {methodEdited&&assumptionError&&<p className="structured-field-error" id={`${id}-method-error`} role="alert">{assumptionError}</p>}
  {stale.length>0&&<p className="structured-notice warning">Source links need review: {[...new Set(stale)].join(', ')}. You can explore these saved inputs, but {sourcePacket?'review a current source and save a separately reviewed transcription before saving a result.':'refresh and generate a new draft before saving a result.'}</p>}
  {(!calculationOwned||!baselineOwned)&&<p className="structured-field-error" role="alert">The experiment revision or source links changed. Calculate again before saving.</p>}
  {localError&&<p className="structured-field-error" role="alert">{localError}</p>}
 </section>;
}
