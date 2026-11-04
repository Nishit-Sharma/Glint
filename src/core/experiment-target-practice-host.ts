import {OPEN_REVIEW_EXAMPLES} from '../shared/experiment-examples';
import {createHash} from 'node:crypto';
import type {Companion} from './companion';
import type {Task,RequestInput,ArtifactRevision} from './types';
import {reviewedSourceFormula,sourceFormulaCitationText} from '../learning/source-formula';
import {makeTargetProblem,checkTargetAnswer,targetPracticeLimits,readTargetPracticeInput,readTargetPracticeSubmission,targetPracticeIdentity,targetSubmissionIdentity,type TargetPracticeInput,type TargetPracticeSubmission} from '../learning/experiment-target-practice';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function original(task:Task,value:TargetPracticeInput){
 const artifact=task.artifacts.find(item=>item.id===value.basis.artifactId),revision=artifact?.revisions.find(item=>item.revision===value.basis.revision&&item.digest===value.basis.digest);
 if(!revision||JSON.stringify(revision.sourceRefs)!==JSON.stringify(value.expectedSourceRefs))throw Error('The original reviewed formula or source links are unavailable.');
 const packet=reviewedSourceFormula(task,artifact!.id,revision),problem=makeTargetProblem(packet.draft,value.variable,value.demonstratedInputs);
 const binding={taskId:task.id,basis:value.basis,sourceRefs:value.expectedSourceRefs,challenge:problem.challenge};
 return {packet,problem,binding,revision};
}
function requireCurrent(task:Task,value:TargetPracticeInput,revision:ArtifactRevision){
 const current=task.artifacts.find(item=>item.id===value.basis.artifactId)?.revisions.at(-1);
 if(current?.revision!==revision.revision||current.digest!==revision.digest)throw Error('The reviewed formula changed. Inspect the original answer or review the current formula.');
 for(const ref of value.expectedSourceRefs){const source=task.sources.find(item=>item.id===ref.sourceId),latest=source?.versions.at(-1);if(!source||source.freshness!=='fresh'||source.currentVersion!==ref.version||latest?.digest!==ref.digest)throw Error('A cited source changed. Inspect the original answer; new target practice is held.');}
}
const requestId=(binding:unknown,index:number)=>'experiment-target-v1-'+hash(binding)+(index?'_'+index:'');
const attempt=(binding:unknown,id:string)=>{for(let index=0;index<targetPracticeLimits.attempts;index++)if(requestId(binding,index)===id)return index;return -1;};
function requestInput(value:TargetPracticeInput,binding:unknown,index:number):RequestInput{return {taskId:value.taskId,requestId:requestId(binding,index),kind:'experiment',prompt:'Save the first answer to a bounded source-formula target challenge.',executionScope:'experiment-target-v1:'+hash(binding),sourceIds:value.expectedSourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:[...value.expectedSourceRefs],expectedArtifacts:[value.basis]};}
function verifyRequest(value:TargetPracticeInput,binding:unknown,index:number,request:Task['requests'][number]){
 const expected=requestInput(value,binding,index),digest=hash({...expected,sourceIds:expected.sourceIds,sourceRefs:value.expectedSourceRefs});
 if(request.id!==expected.requestId||request.kind!=='experiment'||request.digest!==digest||JSON.stringify(request.sourceRefs)!==JSON.stringify(value.expectedSourceRefs))throw Error('The original target-practice request needs inspection.');
}
function savedAnswer(task:Task,value:TargetPracticeInput,binding:unknown,index:number,request:Task['requests'][number]){
 verifyRequest(value,binding,index,request);const answer=request.answer,saved=answer&&task.artifacts.find(item=>item.id===answer.artifactId)?.revisions.find(item=>item.revision===answer.revision&&item.digest===answer.digest);
 if(request.status!=='completed'||!answer||request.artifactId!==answer.artifactId||!saved||saved.mimeType!=='text/plain'||saved.encoding==='base64'||createHash('sha256').update(saved.content).digest('hex')!==saved.digest||JSON.stringify(saved.sourceRefs)!==JSON.stringify(value.expectedSourceRefs))throw Error('The original target-practice answer is unavailable. No replacement was made.');
 return {taskId:task.id,binding:targetPracticeIdentity(value,original(task,value).problem.challenge),artifactId:answer.artifactId,revision:answer.revision,digest:answer.digest,content:saved.content};
}
function prior(task:Task,value:TargetPracticeInput,binding:unknown){
 let latest:Task['requests'][number]|undefined,index=0;
 for(;index<targetPracticeLimits.attempts;index++){const request=task.requests.find(item=>item.id===requestId(binding,index));if(!request)break;verifyRequest(value,binding,index,request);latest=request;}
 return {latest,index:index-1};
}
export async function inspectTargetPractice(core:Companion,raw:unknown){
 const value=readTargetPracticeInput(raw),task=await core.getTask(value.taskId),{packet,problem,binding,revision}=original(task,value),{latest,index}=prior(task,value,binding);
 if(latest?.status==='completed')return {kind:'completed' as const,...savedAnswer(task,value,binding,index,latest)};
 if(latest?.status==='running')return {taskId:task.id,binding:targetPracticeIdentity(value,problem.challenge),kind:'running' as const,requestId:latest.id};
 if(latest){if(latest.artifactId!==undefined)throw Error('The earlier target-practice outcome needs review.');let canRetry=index<targetPracticeLimits.attempts-1;try{requireCurrent(task,value,revision);}catch{canRetry=false;}return {taskId:task.id,binding:targetPracticeIdentity(value,problem.challenge),kind:'terminal' as const,requestId:latest.id,canRetry};}
 requireCurrent(task,value,revision);return {taskId:task.id,binding:targetPracticeIdentity(value,problem.challenge),kind:'not-started' as const,challenge:problem.challenge,title:packet.draft.title};
}
function feedback(value:TargetPracticeSubmission,record:ReturnType<typeof original>){
 const {packet,problem}=record,checked=checkTargetAnswer(packet.draft,problem,value.answer),c=problem.challenge,fence='`'.repeat(Math.max(3,...(value.reasoning.match(/`+/g)??[]).map(run=>run.length+1)));
 return `Target-outcome practice: ${packet.draft.title}\n\nHypothetical target calculated from the exact reviewed formula. Earlier exposure is unknown. The twelve-sample generator is not an inverse solver or a proof of unique answers. This is not a simulator or a measure of mastery.\n\nFind an input for ${c.variable} (${c.inputUnit}) between ${c.minimum} and ${c.maximum}${c.integer?'; whole numbers only':''}.\nFixed known inputs:\n${Object.entries(c.knownInputs).map(([name,number])=>`${name} = ${number} ${packet.draft.spec.variables.find(item=>item.name===name)!.unit}`).join('\n')||'(No other inputs.)'}\nTarget output: ${c.target} ${c.outputUnit}\n\nYour first answer: ${value.answer} ${c.inputUnit}\nYour first reasoning (retained, not graded):\n${fence}text\n${value.reasoning}\n${fence}\n\nCalculated output from your answer: ${checked.result.value} ${checked.result.unit}\nYour answer ${checked.matches?'meets':'does not meet'} the target within approximately ${Number(c.tolerance.toPrecision(8))} ${c.outputUnit}. Tolerance is the larger of 0.000000001 output units and one-billionth of the target magnitude; floating-point arithmetic is used.\n\nOne sampled input that meets the target: ${problem.witness} ${c.inputUnit}. Other valid inputs may also meet the target. ${value.exampleContext===OPEN_REVIEW_EXAMPLES?`The saved defaults and ${value.demonstratedInputs.length} recorded calculation/trial outputs from this open review were excluded by this generator. Prior-review exposure is not tracked.`:value.demonstratedInputs.length<=2?'Only the saved defaults and up to two current comparison outputs were excluded by this generator.':`The saved defaults and ${value.demonstratedInputs.length} recorded comparison/trial outputs were excluded by this generator.`} Other earlier exposure remains unknown.\n\nUser-supplied assumptions:\n${packet.draft.spec.assumptions.map(item=>'- '+item).join('\n')}\n\nTechnical provenance:\nExperiment identity: ${value.basis.artifactId}; revision ${value.basis.revision}; digest ${value.basis.digest}\nSubmission receipt ${value.exampleContext===OPEN_REVIEW_EXAMPLES?'v2':'v1'}: ${targetSubmissionIdentity(value)}\n\n${sourceFormulaCitationText(packet)}`;
}
/** Exact-payload reconciliation never upgrades a challenge-level answer into
 * proof that a different pending answer or reasoning was saved. */
export async function inspectOriginalTargetPractice(core:Companion,raw:unknown){
 const value=readTargetPracticeSubmission(raw),{answer,reasoning,shareWithTask,retryOf,...input}=value,result=await inspectTargetPractice(core,input);if(result.kind!=='completed')return result;
 let matches=false;try{matches=result.content===feedback(value,original(await core.getTask(value.taskId),value));}catch{/* An unsupported/older receipt cannot confirm this pending payload. */}
 return matches?{...result,submissionDigest:targetSubmissionIdentity(value)}:{...result,kind:'receipt-mismatch' as const};
}
function exactAnswer(task:Task,value:TargetPracticeSubmission,binding:unknown,index:number,request:Task['requests'][number]){
 const saved=savedAnswer(task,value,binding,index,request);if(saved.content!==feedback(value,original(task,value)))throw Error('An earlier first answer does not confirm this exact answer and reasoning. The pending original stays held; no second first answer was created.');return {...saved,submissionDigest:targetSubmissionIdentity(value)};
}
export function targetPracticePublication(task:Task,value:TargetPracticeSubmission){
 if(!value.reasoning.trim()||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.reasoning))throw Error('Enter reasoning without control characters.');
 const record=original(task,value),{latest,index:previous}=prior(task,value,record.binding);if(latest?.status==='completed')return {kind:'existing' as const,result:exactAnswer(task,value,record.binding,previous,latest)};
 requireCurrent(task,value,record.revision);checkTargetAnswer(record.packet.draft,record.problem,value.answer);
 let index=0;if(value.retryOf!==undefined){const old=attempt(record.binding,value.retryOf);if(!latest||latest.id!==value.retryOf||old<0||old>=targetPracticeLimits.attempts-1||!['failed','cancelled','interrupted'].includes(latest.status)||latest.artifactId!==undefined)throw Error('Inspect the original attempt before explicitly retrying.');index=old+1;}else if(latest)throw Error('Inspect the original target practice before trying again.');
 return {kind:'new' as const,index,binding:record.binding,request:requestInput(value,record.binding,index),artifact:{title:`Target practice: ${record.packet.draft.title}`.slice(0,500),mimeType:'text/plain',content:feedback(value,record)}};
}
export {exactAnswer as targetPracticeResult};
export function submitTargetPractice(core:Companion,raw:unknown,assertCurrent:()=>void=()=>{}){return core.saveTargetPractice(raw,assertCurrent);}
