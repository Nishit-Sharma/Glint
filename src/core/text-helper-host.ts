import {randomUUID} from 'node:crypto';
import {Schema} from 'effect';
import type {Companion} from './companion';
import type {HelperData} from '../learning/reusable-helper';
import {MODULE_MIME} from '../shared/module-contract';

const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
const CreateTextHelper=Schema.Struct({taskId:id,requestId:id});
export type TextHelperCreate=typeof CreateTextHelper.Type;

export function readTextHelperCreate(value:unknown):TextHelperCreate{
 return Schema.decodeUnknownSync(CreateTextHelper,{onExcessProperty:'error'})(value);
}

export async function createTextHelper(core:Companion,value:unknown,assertCurrent?:()=>void){
 const input=readTextHelperCreate(value);
 assertCurrent?.();
 const request=await core.runRequest({...input,kind:'create',prompt:'Create a local text helper to teach, check and save.',executionScope:'local-text-helper:create:v1',sourceIds:[],expectedSourceRefs:[]},async()=>{
  const data={kind:'helper-studio',schemaVersion:1,id:randomUUID(),title:'Text helper',description:'Teach a sequence of the five text operations, with examples and exceptions.'} satisfies HelperData;
  return {title:data.title,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Local text helper. Teach only the listed text operations on text you paste here.',modules:[{id:randomUUID(),version:1,data,provenance:[]}]})};
 },assertCurrent);
 if(request.status!=='completed'||!request.artifactId||!request.answer)throw Error(request.status==='running'?'This text helper is still being saved. Reopen Files after it finishes.':request.error??'The text helper could not be created.');
 const task=await core.getTask(input.taskId),artifact=task.artifacts.find(item=>item.id===request.artifactId),revision=artifact?.revisions.at(-1);
 if(!artifact||!revision||request.answer.artifactId!==artifact.id||request.answer.revision!==revision.revision||request.answer.digest!==revision.digest||revision.mimeType!==MODULE_MIME)throw Error('The saved text helper changed. Open its current version from Files.');
 return {task,artifactId:artifact.id,revision:revision.revision};
}
