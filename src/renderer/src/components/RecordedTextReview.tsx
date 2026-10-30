import {useEffect,useRef,useState} from 'react';
import {LOCAL_HELPER_CONTEXT_NOTICE} from '../../../core/interactive-modules';
import type {HelperData,HelperState} from '../../../learning/reusable-helper';
import type {RecordedTextOrigin} from '../../../learning/recorded-text-procedure';
import type {inspectRecordedTextHelper} from '../../../core/recorded-text-helper-host';
import type {LearningDraftOwner} from '../../../shared/learning-drafts';
import {useGuardedAction} from '../draft-navigation';
type Preview=Awaited<ReturnType<typeof inspectRecordedTextHelper>>;
export function RecordedTextOriginView({origin}:{origin:RecordedTextOrigin}){
 return <details className="learning-section"><summary>Original recorded text actions</summary><p>These actions were recorded in this app’s local text controls. Physical gestures and other apps were not observed. The original helper is separate; this frozen receipt remains attached when you edit this draft.</p><p>Original helper revision {origin.source.stateRevision}; demonstration {origin.observation.id}.</p><pre>{JSON.stringify({source:origin.source,input:origin.observation.input,steps:origin.observation.steps},null,2)}</pre></details>;
}
export function RecordedTextReview({data,state,pending,owner}:{data:HelperData;state:HelperState;pending:boolean;owner?:LearningDraftOwner}){
 const [preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const lock=useRef(false),alive=useRef(true),scope=JSON.stringify([owner,state.revision]),current=useRef(scope);current.current=scope;
 const guard=useGuardedAction();useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setPreview(null);setMessage('');},[scope]);
 if(!owner||'kind' in owner||data.recordedText)return null;
 const observation=state.observations?.at(-1),input=observation?{taskId:owner.taskId,artifactId:owner.artifactId,artifactRevision:owner.artifactRevision,artifactDigest:owner.artifactDigest,moduleId:owner.moduleId,moduleVersion:owner.moduleVersion,stateRevision:state.revision,observationId:observation.id}:null;
 async function act(create:boolean){
  if(!alive.current||current.current!==scope||pending||busy||lock.current||!input||create&&!preview)return;const at=scope;lock.current=true;setBusy(true);setMessage('');
  try{
   if(create){const result=await window.companion.invoke<{artifactId:string;revision:number;binding:string}>({type:'helper.recorded.create',...input,binding:preview!.binding,confirmed:'create-separate-inactive-draft'});if(alive.current&&current.current===at){setPreview(null);setMessage(`Separate inactive procedure saved in Files as “Recorded text procedure”, revision ${result.revision}. Open it to edit stages, declare checks and activate a checked version.`);}}
   else {const result=await window.companion.invoke<Preview>({type:'helper.recorded.inspect',...input});if(alive.current&&current.current===at)setPreview(result);}
  }catch(cause){if(alive.current&&current.current===at){setPreview(null);setMessage(cause instanceof Error?cause.message:'The recorded proposal could not be confirmed. Review the current original helper before retrying.');}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <section className="learning-section" aria-label="Separate procedure from recorded actions"><h4>Review recorded actions as typed stages</h4><p>{LOCAL_HELPER_CONTEXT_NOTICE}</p><p>Finish a new local text demonstration to propose a separate staged helper. Up to six operations and 160 characters per input or result are supported. Existing text exceptions are not transferred automatically. Checks, saving a version and activation remain separate.</p><button type="button" disabled={pending||busy||!input||!!state.recording} onClick={()=>void guard(()=>act(false))}>Review recorded text proposal</button>{preview&&<><RecordedTextOriginView origin={preview.origin}/><ol aria-label="Proposed recorded stages">{preview.origin.observation.steps.map((step,index)=><li key={index}>Stage {index+1}: {step.operation.kind}, using {index===0?'the text input':`result text${index}`} to produce text{index+1}.</li>)}</ol><p>No conditions or exceptions are inferred from this one demonstration. Different input does not establish independent generalization.</p><button type="button" disabled={pending||busy} onClick={()=>void guard(()=>act(true))}>Create separate inactive procedure</button><button type="button" disabled={busy} onClick={()=>setPreview(null)}>Cancel proposal review</button></>}{message&&<p role="status">{message}</p>}</section>;
}
