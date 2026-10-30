import {Schema} from 'effect';
import {pickingDigest} from './picking-digest';
import type {DocumentRecipeState} from '../learning/document-recipe';
const text=(n:number)=>Schema.String.pipe(Schema.maxLength(n));
const forms={details:Schema.Struct({name:text(200),intent:text(200),template:text(8000)}),sample:Schema.Struct({name:text(200),intent:text(200),input:text(8000)}),insertion:Schema.Struct({text:text(2000),field:text(40)}),exception:Schema.Struct({contains:text(160),reason:text(200)}),check:Schema.Struct({input:text(8000),expected:text(20000),kind:Schema.Literal('output','stopped')})};
const parseForms={details:Schema.decodeUnknownSync(forms.details,{onExcessProperty:'error'}),sample:Schema.decodeUnknownSync(forms.sample,{onExcessProperty:'error'}),insertion:Schema.decodeUnknownSync(forms.insertion,{onExcessProperty:'error'}),exception:Schema.decodeUnknownSync(forms.exception,{onExcessProperty:'error'}),check:Schema.decodeUnknownSync(forms.check,{onExcessProperty:'error'})};
export type DocumentRecipeForm=keyof typeof forms;
export function documentRecipeForm(slot:string):DocumentRecipeForm|undefined{for(const family of ['details','sample','insertion','exception','check'] as const)if(slot===`document-recipe:${family}`)return family;return undefined;}
export function validateDocumentRecipeRaw(value:unknown,slot?:string){
 const family=slot?documentRecipeForm(slot):undefined;
 if(slot&&!family)throw Error('Unknown document recipe form.');
 return family?parseForms[family](value):Schema.decodeUnknownSync(Schema.Union(forms.details,forms.sample,forms.insertion,forms.exception,forms.check),{onExcessProperty:'error'})(value);
}
export function documentRecipeFormBasis(state:DocumentRecipeState,family:DocumentRecipeForm){
 return pickingDigest({family,...(family==='details'?{name:state.draft.name,intent:state.draft.intent,template:state.draft.template}:family==='sample'?{name:state.draft.name,intent:state.draft.intent}:family==='check'||family==='exception'?{template:state.draft.template,exceptions:state.draft.exceptions,observationInput:state.draft.observation?.input??null}:family==='insertion'?{recording:state.recording?.input??null}:{})});
}
export const DOCUMENT_RECIPE_DRAFT_BYTES=192*1024;
