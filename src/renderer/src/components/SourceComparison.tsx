import {useLayoutEffect,useRef,useState,type FormEvent} from 'react';
import type {Artifact,SourceRef,Task} from '../../../core/types';
import {sourceComparisonArtifact,SourceComparisonError,type SourceComparisonNotes} from '../source-comparison';
import {publicErrorMessage} from '../../../shared/public-messages';
import {useNavigationDraft} from '../draft-navigation';
import {Button,Field,type Run} from '../ui';
import {ReadableText} from './ReadableText';
import {sourceComparisonBinding,type SourceComparisonInput,type SourceComparisonSaved,type SourceComparisonInspection} from '../../../shared/source-comparison';
import {SourceLinks} from './SourceLinks';
import {LearningDraftScope,useLearningDraft} from '../learning-draft-context';
import {emptySourceComparisonDraft,SOURCE_COMPARISON_BASIS,SOURCE_COMPARISON_SLOT,sourceComparisonOwner,type SourceComparisonDraft} from '../../../shared/source-comparison-draft';
import {learningDraftKey,serializeLearningDraftJson} from '../../../shared/learning-drafts';

const key=(ref:SourceRef)=>JSON.stringify([ref.sourceId,ref.version,ref.digest]);
type Props={task:Task;busy:boolean;run:Run;isCurrent:()=>boolean;onSaved:(artifact:Artifact)=>void;onBack:()=>void};
export function SourceComparison(props:Props){
 return <LearningDraftScope owner={sourceComparisonOwner(props.task.id)}><SourceComparisonForm key={props.task.id} {...props}/></LearningDraftScope>;
}
function SourceComparisonForm({task,busy,run,isCurrent,onSaved,onBack}:Props){
 const saved=useLearningDraft(emptySourceComparisonDraft,SOURCE_COMPARISON_SLOT,SOURCE_COMPARISON_BASIS),[local,setLocal]=useState(emptySourceComparisonDraft),[saving,setSaving]=useState(false),[error,setError]=useState(''),[legacyChoice,setLegacyChoice]=useState(''),[recovered,setRecovered]=useState<SourceComparisonSaved>();
 const raw=saved?.form.value??local,refs=raw.refs.map(ref=>ref??undefined),notes:SourceComparisonNotes={question:raw.question,comparison:raw.comparison,uncertainty:raw.uncertainty};
 const recoveredGuard=useRef<(()=>boolean)|undefined>(undefined),legacy=useRef<boolean|undefined>(undefined),mounted=useRef(true),pending=useRef(false),latest=useRef({task,raw,busy,isCurrent,cache:saved?.cache});latest.current={task,raw,busy,isCurrent,cache:saved?.cache};
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const clear=useNavigationDraft(saving||(!saved&&Object.values(notes).some(value=>!!value)),()=>setLocal(emptySourceComparisonDraft));
 const held=!!saved&&(saved.form.status!=='ready'||!!saved.form.error||saved.frozen||saved.maintenance),disabled=busy||saving||held||task.status!=='active'||!!task.archive;
 const choices=task.sources.flatMap(source=>{const version=source.versions.find(version=>version.id===source.id&&version.version===source.currentVersion);return !('revoked' in source&&source.revoked)&&source.freshness==='fresh'&&version?.kind==='text'?[{ref:{sourceId:source.id,version:version.version,digest:version.digest},label:version.label}]:[];});
 let problem='';try{sourceComparisonArtifact(task,refs,notes);}catch(error){problem=error instanceof SourceComparisonError?error.message:publicErrorMessage(error);}
 const binding=sourceComparisonBinding(task.id,refs,notes),knownIntent=raw.saveIntent?.binding===binding?raw.saveIntent:undefined;
 if(legacy.current===undefined&&(!saved||saved.cache.getSnapshot().ready&&saved.form.status==='ready'))legacy.current=!!saved&&!raw.saveIntent&&Object.values(notes).some(value=>!!value);
 function currentRaw(){return saved?saved.cache.readForm(saved.owner,saved.slot,emptySourceComparisonDraft,SOURCE_COMPARISON_BASIS).value:latest.current.raw;}
 function available(readOnly=false){
  if(!mounted.current||!latest.current.isCurrent()||latest.current.busy||!readOnly&&(latest.current.task.status!=='active'||!!latest.current.task.archive))return false;
  if(!saved)return true;
  const state=saved.cache.getSnapshot(),form=saved.cache.readForm(saved.owner,saved.slot,emptySourceComparisonDraft,SOURCE_COMPARISON_BASIS);
  return state.ready&&!state.error&&!state.frozen&&!state.maintenance&&form.status==='ready'&&!form.error;
 }
 function edit(transform:(current:SourceComparisonDraft)=>SourceComparisonDraft){
  if(pending.current||!available())return;
  if(saved)saved.cache.tryEdit(saved.owner,saved.slot,emptySourceComparisonDraft,SOURCE_COMPARISON_BASIS,transform);
  else setLocal(transform);
  setError('');setLegacyChoice('');
 }
 function choose(index:number,value:string){const selected=choices.find(choice=>key(choice.ref)===value);edit(current=>{const next:[SourceRef|null,SourceRef|null]=[...current.refs];next[index]=selected?.ref??null;return {...current,refs:next};});}
 async function submit(inspectOnly=false,forceNew=false){
  if(pending.current||!available(inspectOnly)||saved?.cache.getEditRejection(saved.owner,saved.slot))return;
  const submitted=latest.current,snapshot=structuredClone(currentRaw()),snapshotNotes={question:snapshot.question,comparison:snapshot.comparison,uncertainty:snapshot.uncertainty},binding=sourceComparisonBinding(submitted.task.id,snapshot.refs,snapshotNotes);
  if(forceNew&&legacyChoice!==binding)return;
  const previous=snapshot.saveIntent?.binding===binding?snapshot.saveIntent:undefined;
  if(inspectOnly&&!previous)return;
  if(!inspectOnly){
   let artifact;try{artifact=sourceComparisonArtifact(submitted.task,snapshot.refs.map(ref=>ref??undefined),snapshotNotes);}catch(error){setError(error instanceof SourceComparisonError?error.message:publicErrorMessage(error));return;}
   const ambiguous=legacy.current&&!previous&&submitted.task.artifacts.some(item=>item.revisions.some(revision=>revision.mimeType===artifact.mimeType&&revision.title===artifact.title&&revision.content===artifact.content&&JSON.stringify(revision.sourceRefs.map(key))===JSON.stringify(artifact.sourceRefs!.map(key))));
   if(ambiguous&&!forceNew){setLegacyChoice(binding);setError('These recovered notes match saved work, but their original save identity is unavailable. Inspect Files, or explicitly save a new comparison. Your notes are kept.');return;}
  }
  const intent=previous??{id:crypto.randomUUID(),binding},submittedRaw={...snapshot,saveIntent:intent};
  if(saved){
   if(!previous){const accepted=saved.cache.tryEdit(saved.owner,saved.slot,emptySourceComparisonDraft,SOURCE_COMPARISON_BASIS,()=>submittedRaw);if(accepted.kind!=='accepted')return;}
  }else{setLocal(submittedRaw);latest.current={...latest.current,raw:submittedRaw};}
  const token=saved?.cache.capture(saved.owner,saved.slot),signature=serializeLearningDraftJson(submittedRaw);
  if(saved&&!token)return;
  const exact=()=>mounted.current&&latest.current.task.id===submitted.task.id&&submitted.isCurrent()&&latest.current.isCurrent()&&latest.current.cache===saved?.cache&&serializeLearningDraftJson(currentRaw())===signature&&(!saved||saved.cache.getSnapshot().entries[learningDraftKey(saved.owner,saved.slot)]?.generation===token?.generation);
  pending.current=true;setSaving(true);setError('');
  const work=async()=>{
   try{
    if(saved)await saved.cache.flushForm(saved.owner,saved.slot);
    if(!exact()||!available(inspectOnly))return;
    const input={taskId:submitted.task.id,intentId:intent.id,binding,refs:snapshot.refs,notes:snapshotNotes} as SourceComparisonInput;
    const result=await run<SourceComparisonInspection>({type:inspectOnly?'comparison.inspect':'comparison.save',...input},undefined,{isCurrent:exact});
    if(!exact())return;
    if(!result){setError('The save was not confirmed. Your notes and original save identity are kept. Check Files or check the original comparison save before trying again.');return;}
    if(result.kind==='not-saved'){setError('No original saved receipt was found. Your notes are kept. Review the current sources before choosing Save comparison.');return;}
    const revision=result.revision,record=result.artifact?.revisions.find(item=>item.revision===revision?.revision&&item.digest===revision?.digest);
    if(result.kind!=='saved'||result.taskId!==input.taskId||result.intentId!==input.intentId||result.binding!==binding||!record||record.title!==snapshotNotes.question.trim()||record.mimeType!=='text/markdown'||record.encoding==='base64'||record.content!==revision.content||JSON.stringify(record.sourceRefs.map(key))!==JSON.stringify(snapshot.refs.map(ref=>ref?key(ref):null))){setError('The save returned without its exact comparison receipt. Your notes are kept. Check Files before another save.');return;}
    if(!saved||saved.cache.acknowledge(token!)){
     clear();setLocal(emptySourceComparisonDraft);latest.current={...latest.current,raw:emptySourceComparisonDraft};setLegacyChoice('');recoveredGuard.current=undefined;
     const current=result.artifact.revisions.at(-1)!;
     if(current.revision===revision.revision&&current.digest===revision.digest)onSaved(result.artifact);else{
      const generation=saved?.cache.getSnapshot().entries[learningDraftKey(saved.owner,saved.slot)]?.generation,acknowledged=serializeLearningDraftJson(currentRaw());
      recoveredGuard.current=()=>available(true)&&latest.current.task.id===submitted.task.id&&submitted.isCurrent()&&latest.current.cache===saved?.cache&&serializeLearningDraftJson(currentRaw())===acknowledged&&(!saved||saved.cache.getSnapshot().entries[learningDraftKey(saved.owner,saved.slot)]?.generation===generation);
      setRecovered({...result,revision:record});
     }
    }
   }catch(error){if(mounted.current&&submitted.isCurrent())setError(error instanceof SourceComparisonError?error.message:publicErrorMessage(error));}
   finally{pending.current=false;if(mounted.current)setSaving(false);}
  };
  if(saved)await saved.cache.runSubmission(work);else await work();
 }
 if(recovered){
  const viewGuard=recoveredGuard.current;
  return <section className="source-intake-editor" aria-label="Original saved comparison"><h2>Original saved comparison</h2><p>Confirmed revision {recovered.revision.revision}. The document has later edits; this is the original saved result.</p><h3>{recovered.revision.title}</h3><SourceLinks task={task} refs={recovered.revision.sourceRefs}/><ReadableText text={recovered.revision.content} leadingTitle={recovered.revision.title}/><div className="row"><Button disabled={!viewGuard?.()||!task.artifacts.some(item=>item.id===recovered.artifact.id)} onClick={()=>{const current=latest.current.task.artifacts.find(item=>item.id===recovered.artifact.id);if(current&&viewGuard&&recoveredGuard.current===viewGuard&&viewGuard())onSaved(current);}}>Open current document</Button><Button onClick={()=>{if(recoveredGuard.current===viewGuard){recoveredGuard.current=undefined;setRecovered(undefined);}}}>Start another comparison</Button></div></section>;
 }
 return <section className="source-intake-editor" aria-label="Compare attachments"><h2>Compare attachments</h2>
  <p>Choose two saved text snapshots, read their evidence, then write where they agree or differ. Glint does not decide which is correct.</p>
  <form onSubmit={(event:FormEvent)=>{event.preventDefault();return submit();}}><fieldset className="learning-draft-fields" disabled={disabled}>
   {[0,1].map(index=>{const selected=refs[index];return <Field key={index} label={`Source ${index+1}`}><select aria-label={`Source ${index+1}`} disabled={disabled} value={selected?key(selected):''} onChange={event=>choose(index,event.target.value)}>
    <option value="">Choose a text source…</option>{selected&&!choices.some(choice=>key(choice.ref)===key(selected))&&<option value={key(selected)}>Selected snapshot changed — review and choose again</option>}
    {choices.map(choice=><option key={key(choice.ref)} value={key(choice.ref)} disabled={refs[1-index]?.sourceId===choice.ref.sourceId}>{choice.label} · Version {choice.ref.version}</option>)}
   </select></Field>;})}
   {refs.some(Boolean)&&<SourceLinks task={task} refs={refs.filter((ref):ref is SourceRef=>!!ref)} title="Read selected evidence"/>}
   <Field label="Question being compared (200 characters)"><input maxLength={200} required disabled={disabled} value={notes.question} onChange={event=>edit(current=>({...current,question:event.target.value}))}/></Field>
   <Field label="My comparison (6000 characters)"><textarea rows={6} maxLength={6000} required disabled={disabled} value={notes.comparison} placeholder="Identify each source's claim, the relevant passage, and whether their conditions or definitions differ." onChange={event=>edit(current=>({...current,comparison:event.target.value}))}/></Field>
   <Field label="What remains uncertain, and what would help check it? (6000 characters)"><textarea rows={3} maxLength={6000} required disabled={disabled} value={notes.uncertainty} onChange={event=>edit(current=>({...current,uncertainty:event.target.value}))}/></Field>
   </fieldset>
   {raw.saveIntent&&!knownIntent&&<p role="status">These notes differ from the last save attempt. Saving creates a new comparison; check Files for an earlier saved copy.</p>}
   {saved&&<p className="tiny">Unfinished notes are kept privately on this device. Saving the comparison creates a document in Files.</p>}
   {saved?.feedback}
   <p className="tiny">Saves your notes with these exact source links. Source bodies are not copied. You can edit the saved document in Files.</p>
   {error?<p role="alert">{error}</p>:problem&&<p role="status">{problem}</p>}
   <div className="row"><Button type="submit" kind="primary" disabled={disabled||!!saved?.rejection||!!problem}>{saving?'Saving…':'Save comparison'}</Button>{knownIntent&&<Button disabled={busy||saving||held} onClick={()=>void submit(true)}>Check original comparison save</Button>}{legacyChoice===binding&&<Button disabled={disabled||!!problem} onClick={()=>void submit(false,true)}>Save as a new comparison</Button>}<Button disabled={saving} onClick={()=>clear.guard(onBack)}>Back to sources</Button></div>
  </form>
 </section>;
}
