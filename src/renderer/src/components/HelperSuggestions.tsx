import {useEffect,useRef,useState} from 'react';
import type {Task} from '../../../core/types';
import {helperSuggestionContextKey,type HelperSuggestionCommand,type HelperSuggestionOpened,type HelperSuggestionPreview} from '../../../shared/helper-suggestions';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button} from '../ui';
import './saved-helpers.css';

export function HelperSuggestions({task,scope,disabled,isCurrent,invoke,onOpen,onCatalogue,onCreate}:{task:Task;scope:string;disabled:boolean;isCurrent:()=>boolean;invoke:(command:HelperSuggestionCommand)=>Promise<unknown>;onOpen:(opened:HelperSuggestionOpened)=>void;onCatalogue:()=>void;onCreate:()=>void}){
 const [preview,setPreview]=useState<HelperSuggestionPreview>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),generation=useRef(0),working=useRef(false),context=helperSuggestionContextKey(task),latest=useRef({scope,context,disabled,isCurrent});latest.current={scope,context,disabled,isCurrent};
 useEffect(()=>{generation.current++;working.current=false;setBusy(false);setPreview(undefined);setError('');return ()=>{generation.current++;};},[scope,context]);
 async function perform(command:HelperSuggestionCommand){
  if(working.current||disabled||!isCurrent())return;
  const turn=++generation.current,current=()=>generation.current===turn&&latest.current.scope===scope&&latest.current.context===context&&!latest.current.disabled&&isCurrent()&&latest.current.isCurrent();
  working.current=true;setBusy(true);setError('');if(command.type==='helper.suggestions.preview')setPreview(undefined);
  try{const result=await invoke(command);if(!current())return;if(command.type==='helper.suggestions.preview')setPreview(result as HelperSuggestionPreview);else onOpen(result as HelperSuggestionOpened);}
  catch(error){if(current()){setPreview(undefined);setError(publicErrorMessage(error));}}
  finally{if(generation.current===turn){working.current=false;setBusy(false);}}
 }
 return <section className="saved-helpers" aria-label="Suggestions for this task">
  <p>Find helpers you’ve already saved in this task that fit its goal and attachments. Look a helper over before you use it.</p>
  <p className="tiny">This search matches exact words on this Mac. It doesn’t use AI or watch in the background. Results clear after a restart or when attachments change.</p>
  <Button disabled={disabled||busy} onClick={()=>void perform({type:'helper.suggestions.preview',taskId:task.id})}>{busy?'Checking…':preview?'Find suggestions again':'Find helper suggestions'}</Button>
  {busy&&<p role="status">Checking this task, its attachments and helpers…</p>}{error&&<p role="alert">{error}</p>}
  {preview&&<><p className="tiny">{preview.limits}</p>{preview.candidates.length===0?<p role="status">{preview.eligibleHelperCount===0?'No saved helpers fit this task yet. Save and check a helper here first. Helpers with hidden or out-of-date attachments aren’t shown.':'No exact-word matches within this search’s limits. Try a more specific task goal or review your helpers directly.'}</p>:preview.candidates.map(candidate=><article className="saved-helper" key={candidate.helper.artifactId+':'+candidate.helper.moduleId} aria-label={'Suggested helper: '+candidate.helper.name}>
   <h3>{candidate.helper.name}</h3><p>{candidate.helper.description}</p><p className="tiny">{candidate.helper.activeVersion===null?'Inactive · saved version '+candidate.helper.version:'Active version '+candidate.helper.activeVersion} · helper state revision {candidate.helper.stateRevision}</p>
   <p>Possible fit: the helper’s name, purpose or discovery label shares {candidate.terms.map(term=>'“'+term+'”').join(', ')} with this task’s context.</p>
   {candidate.evidence.map((item,index)=><blockquote key={index}><p>{item.excerpt}</p><footer>{item.label} · matching {item.terms.join(', ')}</footer></blockquote>)}
   <details><summary>Inspect exact versions</summary><p>Helper artifact {candidate.helper.artifactId} · revision {candidate.helper.artifactRevision} · digest {candidate.helper.artifactDigest}</p><p>Module {candidate.helper.moduleId} · helper {candidate.helper.helperId} · saved version {candidate.helper.version}</p>{candidate.evidence.filter(item=>item.sourceRef).map((item,index)=><p key={index}>{item.label} · source {item.sourceRef!.sourceId} · version {item.sourceRef!.version} · digest {item.sourceRef!.digest}</p>)}</details>
   <p className="tiny">Opening only shows the current helper for review. It does not activate or run it.</p><Button disabled={disabled||busy} onClick={()=>void perform({type:'helper.suggestions.open',taskId:task.id,binding:preview.binding,artifactId:candidate.helper.artifactId,moduleId:candidate.helper.moduleId})}>Open helper for preview</Button>
  </article>)}</>}
  <div className="local-task-actions"><Button disabled={disabled||busy} onClick={onCreate}>Create a helper in this task</Button><Button disabled={busy} onClick={onCatalogue}>Browse saved helpers</Button></div>
 </section>;
}
