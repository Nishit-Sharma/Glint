import {lexer,type Token} from 'marked';
const supportedTokens=new Set(['space','code','heading','hr','blockquote','list','list_item','paragraph','text','strong','em','del','codespan','br','escape','checkbox']);
function supportsTokens(tokens:readonly Token[]):boolean{
 return tokens.every(token=>supportedTokens.has(token.type)&&(token.type!=='code'||/^```(?!`)[^\n]*\n/.test(token.raw)&&!token.text.includes('```'))&&(!('tokens' in token)||!token.tokens||supportsTokens(token.tokens))&&(token.type!=='list'||token.items.every((item:Token)=>supportsTokens([item]))));
}
export function canEditRichText(content:string,mime='text/markdown'){
 if(mime!=='text/markdown')return false;
 try{return supportsTokens(lexer(content,{gfm:true}));}catch{return false;}
}
export function editableDocumentBody(content:string,title:string){
 const match=/^(\s*#\s+)([^\n]+)(?:\n\n?|$)/.exec(content);
 return match&&match[2].trim()===title.trim()?{prefix:match[1]+title+'\n\n',body:content.slice(match[0].length)}:{prefix:'',body:content};
}
export function renameDocumentTitle(content:string,previous:string,next:string){
 const {prefix,body}=editableDocumentBody(content,previous);
 return prefix?'# '+next+'\n\n'+body:content;
}
