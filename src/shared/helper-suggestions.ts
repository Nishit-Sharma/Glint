import {Schema} from 'effect';
import type {SourceRef,Task} from '../core/types';
import {projectRequestTask} from '../core/request-context';
import {requestableSourceRefs} from './source-intake';
import {savedHelpers,resolveSavedHelper,type SavedHelperEntry} from './saved-helpers';
import {pickingTextDigest} from './picking-digest';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const command=Schema.Union(
 Schema.Struct({type:Schema.Literal('helper.suggestions.preview'),taskId:id}),
 Schema.Struct({type:Schema.Literal('helper.suggestions.open'),taskId:id,binding:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),artifactId:id,moduleId:id}),
);
export type HelperSuggestionCommand=typeof command.Type;
export const readHelperSuggestionCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export const HELPER_SUGGESTION_LIMITS='Local exact-word matches only: this task’s name and goal, included source labels, and the first 20,000 characters of each included text source. Up to three matching saved helpers from this task. Matching words suggest a possible fit; they do not verify a helper’s suitability. No AI, background observation or automatic action.';
export type HelperSuggestionEvidence={label:string;excerpt:string;terms:string[];sourceRef?:SourceRef};
export type HelperSuggestion={helper:SavedHelperEntry;terms:string[];evidence:HelperSuggestionEvidence[]};
export type HelperSuggestionPreview={taskId:string;binding:string;candidates:HelperSuggestion[];eligibleHelperCount:number;limits:typeof HELPER_SUGGESTION_LIMITS};
export type HelperSuggestionOpened={task:Task;artifactId:string;artifactRevision:number};
const ignored=new Set('a an and are as at be been but by can do for from has have help helper helpers how i in into is it its local me my new of on or our saved task tasks that the their this to use using version we what when which with work you your'.split(' '));
const words=(value:string)=>[...new Set((value.match(/[\p{L}\p{N}]{3,}/gu)??[]).map(word=>word.toLocaleLowerCase('en-US')).filter(word=>!ignored.has(word)))];
function excerpt(value:string,term:string){
 const match=[...value.matchAll(/[\p{L}\p{N}]{3,}/gu)].find(match=>match[0].toLocaleLowerCase('en-US')===term)!;
 const start=Math.max(0,match.index!-60),end=Math.min(value.length,match.index!+match[0].length+100);
 return (start?'…':'')+value.slice(start,end)+(end<value.length?'…':'');
}
/** UI retirement key; authoritative eligibility and exact binding are recomputed in the core. */
export function helperSuggestionContextKey(task:Task):string{
 return pickingTextDigest(JSON.stringify({id:task.id,title:task.title,goal:task.goal,status:task.status,archive:task.archive??null,sources:task.sources.map(source=>({id:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest,freshness:source.freshness,revoked:source.revoked??null,origin:source.projectOrigin??null})),selection:task.session?.sourceSelection??null,skill:task.session?.instructionSkill??null,artifacts:task.artifacts.map(artifact=>({id:artifact.id,revision:artifact.revisions.at(-1)!.revision,digest:artifact.revisions.at(-1)!.digest})),states:(task.session?.moduleStates??[]).map(saved=>({artifactId:saved.artifactId,artifactRevision:saved.artifactRevision,moduleId:saved.moduleId??null,revision:saved.state.revision??null}))}));
}
/** Explicit read-only discovery. Eligibility is applied before any helper metadata or evidence is matched. */
export function previewHelperSuggestions(task:Task,owners:readonly Task[]=[task]):HelperSuggestionPreview{
 if(task.status!=='active'||task.archive||task.provenance==='local-example')throw Error('Open and resume this task before finding helper suggestions.');
 const selected=requestableSourceRefs(task);
 if(selected.length>64)throw Error('Choose at most 64 included sources before finding helper suggestions.');
 const eligible=projectRequestTask(task,selected,owners),helpers=savedHelpers([eligible]);
 const evidence:Array<{label:string;text:string;sourceRef?:SourceRef}>=[{label:'Task name',text:task.title},{label:'Task goal',text:task.goal},...eligible.sources.flatMap(source=>{const current=source.versions.at(-1)!;return [{label:current.label+' · source version '+current.version,text:current.label+(current.kind==='text'?'\n'+current.content.slice(0,20_000):''),sourceRef:{sourceId:source.id,version:current.version,digest:current.digest}}];})];
 const inputs=evidence.map(item=>({...item,words:new Set(words(item.text))}));
 const candidates=helpers.flatMap(helper=>{
  const terms=words(helper.name+' '+helper.description+' '+helper.invocation).filter(term=>inputs.some(item=>item.words.has(term))).sort().slice(0,4);
  if(!terms.length)return [];
  const evidence:HelperSuggestionEvidence[]=[];
  for(const term of terms){const item=inputs.find(item=>item.words.has(term))!,quote=excerpt(item.text,term),same=evidence.find(saved=>saved.label===item.label&&saved.excerpt===quote);if(same)same.terms.push(term);else evidence.push({label:item.label,excerpt:quote,terms:[term],...(item.sourceRef?{sourceRef:item.sourceRef}:{})});}
  return [{helper,terms,evidence}];
 }).sort((a,b)=>b.terms.length-a.terms.length||a.helper.artifactId.localeCompare(b.helper.artifactId)||a.helper.moduleId.localeCompare(b.helper.moduleId)).slice(0,3);
 const binding=pickingTextDigest(JSON.stringify({kind:'selected-task-helper-suggestions-v1',context:helperSuggestionContextKey(task),eligibleHelpers:helpers,eligibleSources:eligible.sources.map(source=>({id:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest})),candidates}));
 return {taskId:task.id,binding,candidates,eligibleHelperCount:helpers.length,limits:HELPER_SUGGESTION_LIMITS};
}
export function openHelperSuggestion(task:Task,input:Extract<HelperSuggestionCommand,{type:'helper.suggestions.open'}>,owners:readonly Task[]=[task]):HelperSuggestionOpened{
 const current=previewHelperSuggestions(task,owners),candidate=current.candidates.find(item=>item.helper.artifactId===input.artifactId&&item.helper.moduleId===input.moduleId);
 if(task.id!==input.taskId||current.binding!==input.binding||!candidate)throw Error('The task, sources or helper changed. Find suggestions again before opening a helper.');
 const artifact=resolveSavedHelper(task,candidate.helper);
 return {task,artifactId:artifact.id,artifactRevision:artifact.revisions.at(-1)!.revision};
}
