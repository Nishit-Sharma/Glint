import {Schema} from 'effect';
import type {Task} from '../core/types';
const reference=Schema.Struct({id:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80)),version:Schema.Int.pipe(Schema.positive()),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>value.trim().length>0&&!value.includes('\0')));
const input=Schema.Struct({originTaskId:Schema.NullOr(id),starter:reference});
export type TaskStarterReference=typeof reference.Type;
export type SuggestedTaskInput=typeof input.Type;
export type SuggestedTaskResult={task:Task;created:boolean};
export type TaskStarter={reference:TaskStarterReference;title:string;description:string;goal:string;prompt:string;kind:'explain'};
/** Original Glint-authored, inert prompts. No account, source or provider data. */
const originals:readonly TaskStarter[]=[
 {
  "reference": {
   "id": "small-project",
   "version": 1,
   "digest": "fdc6465c3c117d0accba575871287389a836bb4d69097bdad362c2ea1f3a331a"
  },
  "title": "Plan a small project",
  "description": "Clarify a goal, constraints and a manageable next step.",
  "goal": "Turn a small project into a practical sequence of next steps.",
  "prompt": "Help me plan a small project.\n\nMy goal:\nConstraints:\nWhat I have tried:\n\nAsk me about missing details before proposing a plan.",
  "kind": "explain"
 },
 {
  "reference": {
   "id": "understand-topic",
   "version": 1,
   "digest": "1503b603ca027193ff5e2fe661784a07ce73b128b753e08acf0cdad6f936cfaf"
  },
  "title": "Understand a topic",
  "description": "Build an explanation around what you know and where you are stuck.",
  "goal": "Build understanding of a topic through explanations and worked examples.",
  "prompt": "Help me understand a topic.\n\nTopic:\nWhat I already know:\nWhere I am stuck:\n\nBegin with a short explanation, then use an example and check my understanding.",
  "kind": "explain"
 },
 {
  "reference": {
   "id": "review-writing",
   "version": 1,
   "digest": "9f59cfb52a6f0aa3008a7cc2998f3db96a0b11259845667537b52f09943813e7"
  },
  "title": "Review a piece of writing",
  "description": "Check clarity and structure while keeping your intended meaning.",
  "goal": "Review a piece of writing for clarity and specific improvements.",
  "prompt": "Help me review a piece of writing.\n\nAudience:\nWhat I want the writing to do:\nDraft:\n\nExplain specific changes and preserve my intended meaning.",
  "kind": "explain"
 }
];
for(const starter of originals){Object.freeze(starter.reference);Object.freeze(starter);}Object.freeze(originals);
export function getTaskStarters():TaskStarter[]{return originals.map(starter=>({...starter,reference:{...starter.reference}}));}
export function taskStarterPayload(starter:TaskStarter){return {id:starter.reference.id,version:starter.reference.version,title:starter.title,description:starter.description,goal:starter.goal,prompt:starter.prompt,kind:starter.kind};}
export function resolveTaskStarter(value:unknown):TaskStarter{
 try{const ref=Schema.decodeUnknownSync(reference,{onExcessProperty:'error'})(value),starter=originals.find(starter=>starter.reference.id===ref.id&&starter.reference.version===ref.version&&starter.reference.digest===ref.digest);if(starter)return {...starter,reference:{...starter.reference}};}catch{}
 throw Error('This Glint starter changed or is unavailable. Choose it again.');
}
export function readSuggestedTaskInput(value:unknown):SuggestedTaskInput{
 try{const parsed=Schema.decodeUnknownSync(input,{onExcessProperty:'error'})(value);resolveTaskStarter(parsed.starter);return {originTaskId:parsed.originTaskId,starter:{...parsed.starter}};}catch{throw Error('This Glint starter changed or is unavailable. Choose it again.');}
}
