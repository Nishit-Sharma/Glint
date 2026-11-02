import {readConversationMentions,validateConversationMentions,type MentionDirectory} from '../shared/conversation-mentions';
export function createConversationMentionValidation(load:{bots:()=>Promise<NonNullable<MentionDirectory['bots']>>;routines:()=>Promise<NonNullable<MentionDirectory['routines']>>;skills:()=>Promise<NonNullable<MentionDirectory['skills']>>}){
 async function check(prompt:string){const refs=readConversationMentions(prompt);if(!refs.length)return;const kinds=new Set(refs.map(ref=>ref.kind));const [bots,routines,skills]=await Promise.all([kinds.has('bot')?load.bots():undefined,kinds.has('routine')?load.routines():undefined,kinds.has('skill')?load.skills():undefined]);validateConversationMentions(refs,{bots,routines,skills});}
 return {check,async review<T>(prompt:string,operation:()=>Promise<T>):Promise<T>{await check(prompt);const result=await operation();await check(prompt);return result;}};
}
