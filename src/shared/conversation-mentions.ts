import type {BotState} from './bot-catalog';
import {characterLabel} from './character-catalog';
import type {RecurringWork} from './recurring-work';
import {skillAvailability,type InstructionSkillEntry} from './instruction-skill';
export type ConversationMention={kind:'bot'|'routine';id:string;revision:number;name:string}|{kind:'skill';ownerTaskId:string;artifactId:string;revision:number;digest:string;name:string};
export interface MentionDirectory{bots?:BotState;routines?:readonly RecurringWork[];skills?:readonly InstructionSkillEntry[]}
const marker='glint-mention:',failure=()=>Error('A named reference changed or is unavailable. Remove it and type @ to choose the current saved entity.');
const clean=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\p{Cc}]/u.test(value);
function reference(value:unknown):ConversationMention{
 if(!value||typeof value!=='object'||Array.isArray(value))throw failure();const v=value as Record<string,unknown>;
 if(!clean(v.name,200)||!Number.isSafeInteger(v.revision)||(v.revision as number)<0)throw failure();
 if(v.kind==='bot'||v.kind==='routine'){if(Object.keys(v).sort().join(',')!=='id,kind,name,revision'||!clean(v.id,200))throw failure();return {kind:v.kind,id:v.id,revision:v.revision as number,name:v.name};}
 if(v.kind==='skill'){if(Object.keys(v).sort().join(',')!=='artifactId,digest,kind,name,ownerTaskId,revision'||!clean(v.ownerTaskId,200)||!clean(v.artifactId,200)||!clean(v.digest,200)||(v.revision as number)<1)throw failure();return {kind:'skill',ownerTaskId:v.ownerTaskId,artifactId:v.artifactId,revision:v.revision as number,digest:v.digest,name:v.name};}
 throw failure();
}
export function conversationMentionToken(value:ConversationMention){const ref=reference(value),label=ref.name.replace(/[\\[\]]/g,'\\$&'),payload=encodeURIComponent(JSON.stringify(ref)).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());return `@[${label}](${marker}${payload})`;}
/** Reserved local reference syntax is inert data; labels never resolve identities. */
export function readConversationMentions(prompt:string):ConversationMention[]{
 if(prompt.length>100_000)throw failure();const found:ConversationMention[]=[],pattern=/@\[((?:\\[\\\[\]]|[^\]\\\r\n]){1,400})\]\(glint-mention:([A-Za-z0-9%_.~-]{1,3000})\)/g;let remaining=prompt;
 for(const match of prompt.matchAll(pattern)){let ref:ConversationMention;try{ref=reference(JSON.parse(decodeURIComponent(match[2])));}catch{throw failure();}if(conversationMentionToken(ref)!==match[0]||found.length===20)throw failure();found.push(ref);remaining=remaining.replace(match[0],'');}
 if(remaining.includes(marker))throw failure();return found;
}
export function availableConversationMentions(directory:MentionDirectory):ConversationMention[]{
 const entries:ConversationMention[]=[];const add=(ref:ConversationMention)=>{try{entries.push(reference(ref));}catch{/* Invalid or unnamed saved entries are unavailable, never invented. */}};
 if(directory.bots?.kind==='available'&&directory.bots.current.kind==='ready')for(const bot of directory.bots.current.bots)if(!bot.hidden)add({kind:'bot',id:bot.id,revision:bot.revision,name:bot.title||characterLabel(bot.profile)});
 for(const routine of directory.routines??[])if(routine.enabled)add({kind:'routine',id:routine.id,revision:routine.revision,name:routine.title});
 for(const skill of directory.skills??[])if(skill.current&&skillAvailability(skill.availability).enabled)add({kind:'skill',...skill.reference,name:skill.name});
 return entries;
}
export function validateConversationMentions(refs:readonly ConversationMention[],directory:MentionDirectory){const available=new Set(availableConversationMentions(directory).map(conversationMentionToken));for(const ref of refs)if(!available.has(conversationMentionToken(ref)))throw failure();}
export interface MentionRange{start:number;end:number;caret:number;query:string}
function rawOffset(text:string,offset:number){let raw=0,dom=0;while(raw<text.length&&dom<offset){if(text[raw]==='\r'&&text[raw+1]==='\n')raw++;raw++;dom++;}return raw;}
export function conversationMentionRange(text:string,start:number,end:number):MentionRange|undefined{
 const dom=text.replace(/\r\n|\r/g,'\n');if(start!==end||!Number.isInteger(start)||start<0||start>dom.length)return;const match=/(?:^|\s)@([\p{L}\p{N}_-]{0,60})$/u.exec(dom.slice(0,start));if(!match)return;return {start:rawOffset(text,start-match[1].length-1),end:rawOffset(text,end),caret:start,query:match[1]};
}
export function insertConversationMention(text:string,range:MentionRange,ref:ConversationMention){const current=conversationMentionRange(text,range.caret,range.caret);if(!current||JSON.stringify(current)!==JSON.stringify(range))throw failure();const token=conversationMentionToken(ref),next=text.slice(0,range.start)+token+' '+text.slice(range.end),caret=next.slice(0,range.start+token.length+1).replace(/\r\n|\r/g,'\n').length;return {text:next,start:caret,end:caret};}
