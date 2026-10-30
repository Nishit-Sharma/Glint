import {Schema} from 'effect';

export const HelperOperationSchema=Schema.Union(
 Schema.Struct({kind:Schema.Literal('trim','collapse-spaces','lowercase','uppercase')}),
 Schema.Struct({kind:Schema.Literal('replace-literal'),find:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(80)),replacement:Schema.String.pipe(Schema.maxLength(80))}),
);
export type HelperOperation=typeof HelperOperationSchema.Type;

export function applyHelperOperation(value:string,op:HelperOperation):string {
 let result:string;
 switch(op.kind){
  case 'trim':result=value.trim();break;
  case 'collapse-spaces':result=value.replace(/[ \t]+/g,' ');break;
  case 'lowercase':result=value.toLowerCase();break;
  case 'uppercase':result=value.toUpperCase();break;
  case 'replace-literal':result=value.split(op.find).join(op.replacement);break;
 }
 if(result.length>16_000)throw Error('The output exceeds the local text limit.');
 return result;
}
