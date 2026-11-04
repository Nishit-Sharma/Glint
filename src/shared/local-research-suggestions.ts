import {Schema} from 'effect';
import type {Task,RequestRecord} from '../core/types';
import {projectRequestTask,requestSkillRefs,artifactSkillRefs} from '../core/request-context';
import {skillAvailability} from './instruction-skill';
import {requestableSourceRefs} from './source-intake';
import {pickingTextDigest} from './picking-digest';
import {ProjectMemoryDeadlineSchema,type TaskMemorySelection} from './project-memory';
import {MEMORY_REQUEST_FACTS} from './user-memory';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0'))),revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER)),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/));
export const LocalResearchPreferencesSchema=Schema.Struct({revision,enabled:Schema.Boolean,memory:Schema.Boolean,notices:Schema.Boolean});
export type LocalResearchPreferences=typeof LocalResearchPreferencesSchema.Type;
export const defaultLocalResearchPreferences=():LocalResearchPreferences=>({revision:0,enabled:false,memory:false,notices:false});
export const LocalResearchPreferenceStateSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('available'),current:LocalResearchPreferencesSchema}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String}));
export type LocalResearchPreferenceState=typeof LocalResearchPreferenceStateSchema.Type;
export const readLocalResearchPreferenceState=Schema.decodeUnknownSync(LocalResearchPreferenceStateSchema,{onExcessProperty:'error'});
const update=Schema.Struct({type:Schema.Literal('research.settings'),expectedRevision:revision,enabled:Schema.Boolean,memory:Schema.Boolean,notices:Schema.Boolean});
const question=Schema.Literal('sources','assumptions','alternatives','guidance');
const command=Schema.Union(Schema.Struct({type:Schema.Literal('research.settings.get')}),update,Schema.Struct({type:Schema.Literal('research.preview'),taskId:id,preferenceRevision:revision,expectedBinding:Schema.optional(digest)}),Schema.Struct({type:Schema.Literal('research.choose'),taskId:id,preferenceRevision:revision,binding:digest,question}));
export type LocalResearchCommand=typeof command.Type;
export type LocalResearchUpdate=typeof update.Type;
export const readLocalResearchCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
const fact=Schema.Struct({id,revision});
const memoryReceipt=Schema.Struct({revision,status:Schema.Literal('off','included','no-match'),facts:Schema.Array(fact).pipe(Schema.maxItems(MEMORY_REQUEST_FACTS)),project:Schema.optional(Schema.Struct({projectId:id,revision,status:Schema.Literal('off','included','no-match'),facts:Schema.Array(fact).pipe(Schema.maxItems(MEMORY_REQUEST_FACTS))}))}).pipe(Schema.filter(value=>value.facts.length+(value.project?.facts.length??0)<=MEMORY_REQUEST_FACTS));
export const localResearchQuestions={sources:'Which reliable sources should I consult to investigate the latest completed question in this task?',assumptions:'Which assumptions in the latest completed question in this task should I verify?',alternatives:'What alternative approaches should I compare when researching the latest completed question in this task?',guidance:'Which parts of my saved guidance should I review before researching the latest completed question in this task?'} as const;
const reason=Schema.Literal('completed-question','question-asks-why','question-compares','matching-saved-guidance');
const preview=Schema.Struct({taskId:id,binding:digest,preferenceRevision:revision,request:Schema.optional(Schema.Struct({id,digest})),rule:Schema.Literal('default','why','comparison','no-eligible-question'),memory:Schema.optional(memoryReceipt),expiresAt:Schema.optional(ProjectMemoryDeadlineSchema),candidates:Schema.Array(Schema.Struct({question,prompt:Schema.String,reason})).pipe(Schema.maxItems(3))});
export type LocalResearchPreview=typeof preview.Type;
export type LocalResearchCandidate=LocalResearchPreview['candidates'][number];
export const readLocalResearchPreview=Schema.decodeUnknownSync(preview.pipe(Schema.filter(value=>value.candidates.every(candidate=>candidate.prompt===localResearchQuestions[candidate.question])&&new Set(value.candidates.map(candidate=>candidate.question)).size===value.candidates.length)),{onExcessProperty:'error'});
export const readLocalResearchChoice=Schema.decodeUnknownSync(Schema.Struct({taskId:id,binding:digest,question,prompt:Schema.String}).pipe(Schema.filter(value=>value.prompt===localResearchQuestions[value.question])),{onExcessProperty:'error'});
export const LOCAL_RESEARCH_CHANGED='The local research suggestion changed. Recompute it before choosing.';

function researchSkills(task:Task,owners:readonly Task[],request=task.requests.at(-1)){
 const answer=request?.answer,revision=answer&&task.artifacts.find(artifact=>artifact.id===answer.artifactId)?.revisions.find(revision=>revision.revision===answer.revision&&revision.digest===answer.digest);
 const references=[...(request?requestSkillRefs(task,request):[]),...(answer&&revision?artifactSkillRefs(task,answer.artifactId,revision):[])];
 return references.filter((reference,index)=>references.findIndex(other=>JSON.stringify(other)===JSON.stringify(reference))===index).map(reference=>{const artifact=owners.find(owner=>owner.id===reference.ownerTaskId)?.artifacts.find(artifact=>artifact.id===reference.artifactId);return {reference,availability:artifact?skillAvailability(artifact.skillAvailability):undefined};});
}

/** Eligibility precedes reading the query. The original task retains its memory policy. */
export function localResearchRequest(task:Task,owners:readonly Task[]=[task]):RequestRecord|undefined{
 if(task.status!=='active'||task.archive||task.provenance==='local-example'||task.session?.browserContext||task.requests.some(request=>request.status==='running'))return;
 const latest=task.requests.at(-1),selected=requestableSourceRefs(task);if(!latest||selected.length>64||researchSkills(task,owners,latest).some(skill=>!skill.availability?.enabled))return;
 const projected=projectRequestTask(task,selected,owners),request=projected.requests.at(-1),answer=request?.answer,revision=answer&&projected.artifacts.find(artifact=>artifact.id===answer.artifactId)?.revisions.find(revision=>revision.revision===answer.revision&&revision.digest===answer.digest);
 return request&&request.id===latest.id&&request.digest===latest.digest&&request.status==='completed'&&revision&&revision.encoding!=='base64'&&['text/plain','text/markdown'].includes(revision.mimeType)&&['explain','create'].includes(request.kind)&&!request.targetArtifactId?request:undefined;
}
/** Only opaque identities and finite public strings cross this boundary; no query/fact/topic text. */
export function previewLocalResearch(task:Task,preferences:LocalResearchPreferences,owners:readonly Task[]=[task],selection?:TaskMemorySelection):LocalResearchPreview{
 if(!preferences.enabled)throw Error('Local research suggestions are off.');
 const request=localResearchRequest(task,owners),rule=!request?'no-eligible-question':/\b(compare|versus|alternative|difference)\b/i.test(request.prompt)?'comparison':/\bwhy\b/i.test(request.prompt)?'why':'default';
 const chosen=preferences.memory&&request?selection:undefined,receipt=chosen?.receipt,memory=receipt?{revision:receipt.revision,status:receipt.status,facts:receipt.facts,...(receipt.project?{project:{projectId:receipt.project.projectId,revision:receipt.project.revision,status:receipt.project.status,facts:receipt.project.facts}}:{})}:undefined;
 const deadlines=chosen?chosen.projectFacts.flatMap(fact=>fact.expiresAt?[fact.expiresAt]:[]).sort():[],expiresAt=deadlines[0];
 const matched=!!memory&&(memory.facts.length+(memory.project?.facts.length??0)>0),order:LocalResearchCandidate['question'][]=rule==='comparison'?['alternatives','sources','assumptions']:rule==='why'?['assumptions','sources','alternatives']:['sources','assumptions','alternatives'];
 if(matched)order.splice(0,1,'guidance');
 const candidates:LocalResearchCandidate[]=request?order.map(question=>({question,prompt:localResearchQuestions[question],reason:question==='guidance'?'matching-saved-guidance':rule==='why'&&question==='assumptions'?'question-asks-why':rule==='comparison'&&question==='alternatives'?'question-compares':'completed-question'})):[];
 const sourceRefs=requestableSourceRefs(task),binding=pickingTextDigest(JSON.stringify({kind:'local-research-v1',taskId:task.id,status:task.status,archive:!!task.archive,projectId:task.projectId,request:request?{id:request.id,digest:request.digest,promptDigest:pickingTextDigest(request.prompt),answer:request.answer}:null,sourceRefs,sources:task.sources.map(source=>[source.id,source.currentVersion,source.versions.at(-1)?.digest,source.freshness,source.revoked,source.projectOrigin]),selection:task.session?.sourceSelection,skill:task.session?.instructionSkill,skillAvailability:researchSkills(task,owners),taskPolicy:task.session?.memoryPolicy,preferences,memory:chosen?{receipt:chosen.receipt,facts:chosen.facts.map(fact=>[fact.id,fact.revision]),projectFacts:chosen.projectFacts.map(fact=>[fact.id,fact.revision,fact.expiresAt])}:null,candidates}));
 return {taskId:task.id,binding,preferenceRevision:preferences.revision,...(request?{request:{id:request.id,digest:request.digest}}:{}),rule,...(memory?{memory}:{}),...(expiresAt?{expiresAt}:{}),candidates};
}
export function chooseLocalResearch(current:LocalResearchPreview,input:Extract<LocalResearchCommand,{type:'research.choose'}>){
 const candidate=current.candidates.find(candidate=>candidate.question===input.question);
 if(current.taskId!==input.taskId||current.preferenceRevision!==input.preferenceRevision||current.binding!==input.binding||!candidate)throw Error(LOCAL_RESEARCH_CHANGED);
 return {taskId:current.taskId,binding:current.binding,question:candidate.question,prompt:candidate.prompt};
}
