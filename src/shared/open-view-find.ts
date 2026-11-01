import {Schema} from 'effect';
const scope=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(2000));
const command=Schema.Struct({type:Schema.Literal('view.find'),scope,action:Schema.Literal('bind','query','next','previous','close'),query:Schema.optional(Schema.String.pipe(Schema.maxLength(500),Schema.filter(value=>!/[\u0000-\u001f\u007f]/.test(value))))}).pipe(Schema.filter(value=>value.action==='query'?value.query!==undefined:value.query===undefined));
export type OpenViewFindCommand=typeof command.Type;
export const readOpenViewFindCommand=Schema.decodeUnknownSync(command,{onExcessProperty:'error'});
export type OpenViewFindEvent={type:'view.find.open';scope:string}|{type:'view.find.result';scope:string;requestId:number;query:string;current:number;total:number;final:boolean};
