import {useEffect,useId,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {ChevronDown,Plus,X} from 'lucide-react';
import type {Procedure,ProcedureStep,SourceRef,Task} from '../../../core/types';
import {Button,Field,type Run} from '../ui';
import {changedDependencies,currentSourceRefs} from '../editor-state';
import {useNavigationDraft} from '../draft-navigation';
import {SourceLinks} from './SourceLinks';
import {TaskMenu} from './TaskMenu';
import './structured-tools.css';
import './procedure-layout.css';

const last=<T,>(items:T[])=>items[items.length-1];
const conditionLabel=(key:string)=>key.replace(/[_.-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,value=>value.toUpperCase());
const blankStep=():ProcedureStep=>({intent:'',target:'',preconditions:[],expectedResult:''});
export interface ProcedureSeed {originArtifact:{artifactId:string;revision:number};title:string;summary:string;steps:ProcedureStep[];limitations:string[];sourceRefs:SourceRef[]}

export function ProcedureEditor({task,procedure,seed,busy,run,back,onDirty,headerTools}:{task:Task;procedure?:Procedure;seed?:ProcedureSeed;busy:boolean;run:Run;back:()=>void;onDirty?:(dirty:boolean)=>void;headerTools?:ReactNode}){
 const current=procedure?last(procedure.revisions):undefined;
 const makeDraft=()=>({title:current?.title??seed?.title??'',steps:structuredClone(current?.steps??seed?.steps??[blankStep()]),sourceRefs:current?.sourceRefs??seed?.sourceRefs??currentSourceRefs(task),base:current?.revision});
 const [draft,setDraft]=useState(makeDraft),[check,setCheck]=useState<Record<string,string>>({}),[result,setResult]=useState<{ready:boolean;failures:string[];key:string}>();
 const [savedSnapshot,setSavedSnapshot]=useState(()=>JSON.stringify(makeDraft()));
 const [selectedStep,setSelectedStep]=useState<number|undefined>(current||seed?undefined:0),[view,setView]=useState<'read'|'edit'|'check'>(current||seed?'read':'edit');
 const [infoOpen,setInfoOpen]=useState(false);
 const [validationAttempt,setValidationAttempt]=useState(0),[removeStep,setRemoveStep]=useState<number>(),[pending,setPending]=useState(false);
 const form=useRef<HTMLFormElement>(null),stepButtons=useRef<(HTMLButtonElement|null)[]>([]),operation=useRef(false),focusAfterRender=useRef<'field'|'condition'|'condition-input'|'remove-confirm'|'step-options'|number|undefined>(undefined);
 const id=useId();
 const attempted=validationAttempt>0;
 const dirty=JSON.stringify(draft)!==savedSnapshot;
 const clearNavigationDraft=useNavigationDraft(dirty);
 const draftRef=useRef(draft);draftRef.current=draft;
 const locked=busy||pending;
 useEffect(()=>{onDirty?.(dirty);},[dirty,onDirty]);
 const conflict=!!current&&current.revision!==draft.base;
 const stale=changedDependencies(task,draft.sourceRefs);
 const observation=seed??current?.observation;
 const checkKey=JSON.stringify({revision:current?.revision,sources:task.sources.map(source=>({id:source.id,version:source.currentVersion,digest:last(source.versions).digest,freshness:source.freshness})),check,draft});
 const visibleResult=result?.key===checkKey?result:undefined;
 const canReviewSources=draft.sourceRefs.every(ref=>task.sources.some(source=>source.id===ref.sourceId&&source.freshness==='fresh'));
 const titleError=!draft.title.trim()?'Enter a procedure title.':'';
 const stepErrors=draft.steps.map(step=>({
  intent:!step.intent.trim()?'Describe what to do in this step.':'',
  target:!step.target.trim()?'Name where this step happens.':'',
  expectedResult:!step.expectedResult.trim()?'Describe the expected result.':'',
  conditions:step.preconditions.map((condition,index)=>({
   key:!condition.key.trim()?'Enter a condition name.':step.preconditions.some((other,i)=>i!==index&&other.key===condition.key)?'Use each condition name once per step.':'',
   equals:!condition.equals.trim()?'Enter the exact required value.':''
  }))
 }));
 const invalidStep=stepErrors.findIndex(error=>error.intent||error.target||error.expectedResult||error.conditions.some(condition=>condition.key||condition.equals));
 useEffect(()=>{
  if(current&&current.revision!==draft.base&&!dirty){const next=makeDraft();setDraft(next);setSavedSnapshot(JSON.stringify(next));setResult(undefined);setSelectedStep(undefined);}
 },[current?.revision]);
 useEffect(()=>{
  const target=focusAfterRender.current;if(target===undefined)return;focusAfterRender.current=undefined;
  if(typeof target==='number')stepButtons.current[target]?.focus();
  else {
   const selectors={field:'[aria-invalid="true"],.procedure-step-editor input',condition:'.procedure-conditions > button.text','condition-input':'.procedure-condition:last-of-type input','remove-confirm':'.procedure-remove-confirm button','step-options':'.procedure-step-options > summary'};
   form.current?.querySelector<HTMLElement>(selectors[target])?.focus();
  }
 },[selectedStep,validationAttempt,draft,view,removeStep]);
 function patch(index:number,change:Partial<ProcedureStep>){setDraft(previous=>({...previous,steps:previous.steps.map((step,i)=>i===index?{...step,...change}:step)}));setResult(undefined);}
 function selectStep(index:number){if(selectedStep!==index)focusAfterRender.current='field';setSelectedStep(selectedStep===index?undefined:index);setRemoveStep(undefined);}
 function remove(index:number){
  const nextIndex=Math.min(index,draft.steps.length-2);
  setDraft(previous=>({...previous,steps:previous.steps.filter((_,i)=>i!==index)}));setSelectedStep(nextIndex);setRemoveStep(undefined);setResult(undefined);focusAfterRender.current=nextIndex;
 }
 function loadLatest(){const next=makeDraft();setDraft(next);setSavedSnapshot(JSON.stringify(next));setResult(undefined);setValidationAttempt(0);setSelectedStep(undefined);setRemoveStep(undefined);}
 async function save(event:FormEvent){
  event.preventDefault();if(conflict||stale.length||locked||operation.current)return;
  setValidationAttempt(value=>value+1);
  if(titleError||invalidStep!==-1){setView('edit');if(invalidStep!==-1)setSelectedStep(invalidStep);focusAfterRender.current='field';return;}
  const submitted=draft;operation.current=true;setPending(true);
  try{
   const saved=await run<Task>({type:'procedure.save',taskId:task.id,procedure:{id:procedure?.id,expectedRevision:draft.base,title:draft.title,steps:draft.steps,sourceRefs:draft.sourceRefs,...(current?.scope.project?{project:current.scope.project}:{}),...(seed&&!procedure?{originArtifact:seed.originArtifact}:{})}},'Procedure saved for review');
   if(saved&&draftRef.current===submitted){clearNavigationDraft();back();}
  }finally{operation.current=false;setPending(false);}
 }
 async function checkSaved(){
  if(!procedure||locked||dirty||conflict||operation.current)return;
  const launchKey=checkKey;operation.current=true;setPending(true);
  try{const checked=await run<{ready:boolean;failures:string[]}>({type:'procedure.check',taskId:task.id,procedureId:procedure.id,context:{...check}});if(checked)setResult({...checked,key:launchKey});}
  finally{operation.current=false;setPending(false);}
 }
 const step=selectedStep===undefined?undefined:draft.steps[selectedStep];
 const errors=selectedStep===undefined?undefined:stepErrors[selectedStep];
 const readableFailure=(failure:string)=>current?.steps.flatMap(step=>step.preconditions).reduce((text,condition)=>text.replace(condition.key+' must equal '+condition.equals,conditionLabel(condition.key)+' should be '+(/^(yes|true)$/i.test(condition.equals)?'Yes':/^(no|false)$/i.test(condition.equals)?'No':condition.equals)),failure)??failure;
 const fieldError=(name:string,error:string)=>attempted&&error?<p className="structured-field-error" id={`${id}-${name}`}>{error}</p>:null;
 const errorProps=(name:string,error:string)=>({'aria-invalid':attempted&&!!error,'aria-describedby':attempted&&error?`${id}-${name}`:undefined});
 return <section className="structured-tools procedure-tool" aria-label="Procedure review">
  <header className="structured-heading"><div><h2>{draft.title.trim()||'New procedure'}</h2></div><div className="procedure-header-actions">{view==='read'&&<Button kind="text" onClick={()=>setView('edit')}>Edit procedure</Button>}{headerTools}<TaskMenu label="Procedure options"><Button onClick={()=>setInfoOpen(!infoOpen)}>Sources & history</Button></TaskMenu></div></header>
  <form className="procedure-form" ref={form} onSubmit={event=>{if(view==='check'){event.preventDefault();void checkSaved();}else void save(event);}} noValidate><div className="procedure-scroll">
  {(view==='check'||observation?.summary)&&<p className="structured-intro">{view==='check'?'These checks compare your answers with the saved conditions. They do not run the steps or independently verify the screen.':observation?.summary}</p>}
  {observation?.limitations[0]&&<p className="structured-caveat">{observation.limitations[0]}</p>}
  {conflict&&<section className="revision-conflict" role="status"><h3>A newer procedure revision is available</h3><p>Your edits use revision {draft.base}. Load the latest to continue; unsaved edits will be replaced.</p><Button disabled={locked} onClick={loadLatest}>Load latest procedure</Button></section>}
  {stale.length>0&&<section className="structured-notice warning"><p>Review the observations and steps against the changed sources: {[...new Set(stale)].join(', ')}. Refresh each source first; your edits will be kept.</p><Button kind="text" disabled={locked||!canReviewSources} onClick={()=>{setDraft(previous=>({...previous,sourceRefs:currentSourceRefs(task).filter(ref=>previous.sourceRefs.some(linked=>linked.sourceId===ref.sourceId))}));setResult(undefined);}}>I reviewed changed sources — use current versions</Button></section>}
   {view==='read'?<ol className="procedure-reading" aria-label="Procedure steps">{draft.steps.map((item,index)=><li key={index}><span className="procedure-number">{index+1}</span><div><h3>{item.intent}</h3><p>{item.expectedResult}</p><details><summary>Step details</summary><p>{item.target}</p>{item.preconditions.map((condition,i)=><p key={i}>{conditionLabel(condition.key)}: {condition.equals}</p>)}<Button kind="text" onClick={()=>{setView('edit');setSelectedStep(index);focusAfterRender.current='field';}}>Edit step {index+1}</Button></details></div></li>)}</ol>:view==='edit'?<>
    <details className="structured-title-edit" open={(!current&&!seed)||!!(attempted&&titleError)||undefined}><summary>Edit title</summary><Field label="Procedure title"><input disabled={locked} required maxLength={200} value={draft.title} {...errorProps('title',titleError)} onChange={event=>{setDraft({...draft,title:event.target.value});setResult(undefined);}}/></Field>{fieldError('title',titleError)}</details>
    <ol className="procedure-outline" aria-label="Procedure steps">{draft.steps.map((item,index)=>{
     const invalid=attempted&&!!(stepErrors[index].intent||stepErrors[index].target||stepErrors[index].expectedResult||stepErrors[index].conditions.some(condition=>condition.key||condition.equals));
     return <li key={index}><button type="button" className="procedure-summary" ref={element=>{stepButtons.current[index]=element;}} aria-label={`Edit step ${index+1}: ${item.intent.trim()||'Untitled step'}`} aria-expanded={selectedStep===index} aria-controls={`${id}-step-editor`} onClick={()=>selectStep(index)}><span className="procedure-number" aria-hidden="true">{index+1}</span><span className="procedure-summary-copy"><strong>{item.intent.trim()||'Describe this step'}</strong><span>{item.target.trim()||'No target yet'}</span><small>{invalid?'Needs details':`${item.preconditions.length} ${item.preconditions.length===1?'condition':'conditions'}`}</small></span><ChevronDown size={15} aria-hidden="true"/></button></li>;
    })}</ol>
    <Button kind="text" disabled={locked||draft.steps.length>=32} onClick={()=>{focusAfterRender.current='field';setSelectedStep(draft.steps.length);setDraft({...draft,steps:[...draft.steps,blankStep()]});setRemoveStep(undefined);setResult(undefined);}}><Plus size={14}/>Add step</Button>
    {step&&selectedStep!==undefined&&errors&&<section className="procedure-step-editor" id={`${id}-step-editor`} aria-label={`Edit step ${selectedStep+1}`}>
     <div className="structured-section-heading"><h3>Step {selectedStep+1}</h3><Button kind="text" onClick={()=>{focusAfterRender.current=selectedStep;setSelectedStep(undefined);setRemoveStep(undefined);}}>Close editor</Button></div>
     <Field label="What to do"><input disabled={locked} required maxLength={1000} value={step.intent} {...errorProps('intent',errors.intent)} onChange={event=>patch(selectedStep,{intent:event.target.value})}/></Field>{fieldError('intent',errors.intent)}
     <Field label="Where"><input disabled={locked} required maxLength={1000} value={step.target} {...errorProps('target',errors.target)} onChange={event=>patch(selectedStep,{target:event.target.value})}/></Field>{fieldError('target',errors.target)}
     <Field label="What should happen"><textarea disabled={locked} required rows={2} maxLength={2000} value={step.expectedResult} {...errorProps('expected',errors.expectedResult)} onChange={event=>patch(selectedStep,{expectedResult:event.target.value})}/></Field>{fieldError('expected',errors.expectedResult)}
     <div className="procedure-conditions"><h3>Conditions <span className="structured-meta">{step.preconditions.length}</span></h3>
      <p className="structured-help">Describe what you need to confirm before this step. Values are compared exactly, including capitals and spaces.</p>
      {step.preconditions.map((condition,conditionIndex)=><div className="procedure-condition" key={conditionIndex}><div className="structured-paired-fields"><div><Field label={`Condition ${conditionIndex+1} name`}><input disabled={locked} required maxLength={100} value={condition.key} {...errorProps(`condition-${conditionIndex}`,errors.conditions[conditionIndex].key)} onChange={event=>patch(selectedStep,{preconditions:step.preconditions.map((item,i)=>i===conditionIndex?{...item,key:event.target.value}:item)})}/></Field>{fieldError(`condition-${conditionIndex}`,errors.conditions[conditionIndex].key)}</div><div><Field label="Required value"><input disabled={locked} required maxLength={1000} value={condition.equals} {...errorProps(`value-${conditionIndex}`,errors.conditions[conditionIndex].equals)} onChange={event=>patch(selectedStep,{preconditions:step.preconditions.map((item,i)=>i===conditionIndex?{...item,equals:event.target.value}:item)})}/></Field>{fieldError(`value-${conditionIndex}`,errors.conditions[conditionIndex].equals)}</div></div><Button kind="icon" disabled={locked} title={`Remove condition ${conditionIndex+1} from step ${selectedStep+1}`} onClick={()=>{focusAfterRender.current='condition';patch(selectedStep,{preconditions:step.preconditions.filter((_,i)=>i!==conditionIndex)});}}><X size={15}/></Button></div>)}
      {!step.preconditions.length&&<p className="structured-help">No conditions are required for this step.</p>}
      <Button kind="text" disabled={locked||step.preconditions.length>=4} onClick={()=>{focusAfterRender.current='condition-input';patch(selectedStep,{preconditions:[...step.preconditions,{key:'',equals:''}]});}}><Plus size={14}/>Add condition</Button>
     </div>
     {draft.steps.length>1&&(removeStep===selectedStep?<div className="procedure-remove-confirm" role="group" aria-label={`Remove step ${selectedStep+1}`}><p>Remove this step? Your other steps will be kept.</p><div className="row"><Button kind="text danger" disabled={locked} onClick={()=>remove(selectedStep)}>Remove step {selectedStep+1}</Button><Button disabled={locked} onClick={()=>{focusAfterRender.current='step-options';setRemoveStep(undefined);}}>Keep step</Button></div></div>:<details className="procedure-step-options"><summary>Step options</summary><Button kind="text danger" disabled={locked} onClick={()=>{focusAfterRender.current='remove-confirm';setRemoveStep(selectedStep);}}>Remove step</Button></details>)}
    </section>}
   </>:current&&<section className="procedure-check" aria-label="Check conditions">
    {visibleResult&&<div className="check-result" role="status"><h3>{visibleResult.ready?'Ready for review':'Conditions need attention'}</h3><p>{visibleResult.ready?'Your answers match the saved conditions. Review the steps before proceeding.':'Some answers do not match the saved conditions.'}</p>{visibleResult.failures.filter(failure=>!/^Step \d+: /u.test(failure)).map((failure,index)=><p className="structured-caveat" key={index}>{readableFailure(failure)}</p>)}</div>}
    <ol className="procedure-check-steps">{current.steps.map((item,index)=>{
     const failures=visibleResult?.failures.filter(failure=>failure.startsWith(`Step ${index+1}: `))??[];
     return <li key={index} aria-label={`Step ${index+1}: ${item.intent}`}><div className="procedure-check-title"><span className="procedure-number" aria-hidden="true">{index+1}</span><strong>{item.intent}</strong><span className="structured-meta">{visibleResult?failures.length?'Needs attention':item.preconditions.length?'Matches your report':'No conditions':'Not checked'}</span></div><p>{item.target}</p><p className="structured-help">{item.expectedResult}</p>
      {item.preconditions.length>0&&<div className="procedure-step-questions" role="group" aria-label={`Your answers for step ${index+1}`}>{item.preconditions.map((condition,conditionIndex)=>{
       const boolean=/^(yes|no|true|false)$/i.test(condition.equals),label=conditionLabel(condition.key)+(boolean?'?':'');
       const positive=/^(yes|true)$/i.test(condition.equals),other=condition.equals===condition.equals.toUpperCase()?(/^(yes|no)$/i.test(condition.equals)?positive?'NO':'YES':positive?'FALSE':'TRUE'):/^(yes|no)$/i.test(condition.equals)?positive?'no':'yes':positive?'false':'true';
       return <div className="procedure-context-field" key={conditionIndex}><Field label={label}>{boolean?<select disabled={locked} value={check[condition.key]??''} onChange={event=>{setCheck({...check,[condition.key]:event.target.value});setResult(undefined);}}><option value="">Not confirmed</option><option value={positive?condition.equals:other}>Yes</option><option value={positive?other:condition.equals}>No</option></select>:<input disabled={locked} value={check[condition.key]??''} onChange={event=>{setCheck({...check,[condition.key]:event.target.value});setResult(undefined);}}/>}</Field></div>;
      })}</div>}
      {failures.length>0&&<ul>{failures.map((failure,i)=><li key={i}>{readableFailure(failure)}</li>)}</ul>}<Button kind="text" onClick={()=>{setView('edit');setSelectedStep(index);setRemoveStep(undefined);focusAfterRender.current='field';}}>Review step {index+1}</Button></li>;
    })}</ol>
   </section>}
   {infoOpen&&observation&&<details className="procedure-evidence"><summary>{seed?'Observed evidence':'Earlier observations'} · {observation.limitations.length} {observation.limitations.length===1?'limitation':'limitations'}</summary><p>{observation.summary}</p>{observation.limitations.length>1&&<><h3>Other limitations</h3><ul>{observation.limitations.slice(1).map((item,index)=><li key={index}>{item}</li>)}</ul></>}{current?.observation&&<p className="structured-help">From saved draft revision {current.observation.revision}. Corrections do not rewrite these original observations.</p>}</details>}
   {infoOpen&&<section className="procedure-information"><p className="tiny">{current?'Version '+current.revision:'Proposed procedure'}</p><SourceLinks task={task} refs={draft.sourceRefs}/></section>}
   {attempted&&(titleError||invalidStep!==-1)&&<p className="structured-field-error" role="alert">Complete the highlighted details before saving.</p>}
   </div><footer className="structured-action-rail procedure-footer">
    <span className="structured-save-state">{dirty?'Unsaved changes':''}{view==='check'&&dirty&&<span>Save edits before checking.</span>}</span>
    <div className="structured-rail-actions">{view==='check'?<><Button onClick={()=>setView('read')}>Back to procedure</Button><Button type="submit" kind="primary" disabled={locked||dirty||conflict}>Check my answers</Button></>:view==='read'?<>{procedure?<Button kind="primary" disabled={locked} onClick={()=>setView('check')}>Check conditions</Button>:<Button type="submit" kind="primary" disabled={locked||conflict||stale.length>0}>Save procedure</Button>}</>:<>{(current||seed)&&<Button onClick={()=>clearNavigationDraft.guard(()=>{loadLatest();setView('read');})}>Cancel</Button>}<Button type="submit" kind="primary" disabled={locked||conflict||stale.length>0||!!current&&!dirty}>Save procedure</Button></>}</div>
   </footer>
  </form>
 </section>;
}
