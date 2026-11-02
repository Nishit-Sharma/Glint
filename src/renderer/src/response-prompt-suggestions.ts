import type {Task} from '../../core/types';

export interface ResponsePromptSuggestions{readonly taskId:string;readonly key:string;readonly responseText:string;readonly prompts:readonly string[]}
/** Local text extraction only. It never requests or predicts a model response. */
export function responsePromptSuggestions(task:Task):ResponsePromptSuggestions|undefined{
 const request=task.requests.at(-1),answer=request?.answer;
 if(task.status!=='active'||!request||request.status!=='completed'||!['explain','create'].includes(request.kind)||request.targetArtifactId||!answer)return;
 const revision=task.artifacts.find(item=>item.id===answer.artifactId)?.revisions.find(item=>item.revision===answer.revision&&item.digest===answer.digest);
 if(!revision||!['text/plain','text/markdown'].includes(revision.mimeType)||revision.encoding==='base64'||!revision.content.trim()||revision.content.length>64_000||revision.content.includes('\0'))return;
 const text=revision.content.replace(/```[^]*?(?:```|$)|~~~[^]*?(?:~~~|$)/g,''),concepts:string[]=[];
 function add(value:string){const concept=value.replace(/[*_`#\[\]<>]/g,'').replace(/\s+/g,' ').replace(/[.:;!?]+$/,'').trim();if(concept.length>=3&&concept.length<=100&&/[\p{L}\p{N}]/u.test(concept)&&!concepts.some(item=>item.toLocaleLowerCase()===concept.toLocaleLowerCase()))concepts.push(concept);}
 for(const match of text.matchAll(/^#{1,6}\s+([^\n]+)|\*\*([^*\n]{3,100})\*\*|`([^`\n]{3,100})`/gm)){add(match[1]??match[2]??match[3]);if(concepts.length===3)break;}
 if(!concepts.length){const line=text.split(/\r?\n/).map(line=>line.replace(/^\s*(?:[-+*]|\d+[.)])\s+/, '').trim()).find(Boolean);if(line){const sentence=line.split(/[.!?](?:\s|$)/)[0];add(sentence.split(/\s+/).slice(0,12).join(' '));}}
 if(!concepts.length)return;
 const prompts=concepts.map(concept=>`Explain “${concept}” in more detail.`);
 return Object.freeze({taskId:task.id,key:JSON.stringify([task.id,request.id,request.digest,answer.artifactId,answer.revision,answer.digest]),responseText:revision.content,prompts:Object.freeze(prompts)});
}
export function responsePromptSuggestionsCurrent(task:Task|undefined,basis:ResponsePromptSuggestions){
 if(!task)return false;const current=responsePromptSuggestions(task);return !!current&&current.key===basis.key&&current.responseText===basis.responseText&&current.prompts.length===basis.prompts.length&&current.prompts.every((prompt,index)=>prompt===basis.prompts[index]);
}
/** Complete only an exact prefix at the end; unrelated text is never replaced. */
export function promptCompletion(prompt:string,value:string,start:number,end:number){return start===value.length&&end===start&&prompt.length>value.length&&prompt.startsWith(value)?prompt.slice(value.length):undefined;}
