import {Schema} from 'effect';
const id=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200));
export const FormulaComparisonOwnerSchema=Schema.Struct({kind:Schema.Literal('formula-comparison'),taskId:id,artifactId:id,artifactRevision:Schema.Int.pipe(Schema.positive()),artifactDigest:id});
export type FormulaComparisonOwner=typeof FormulaComparisonOwnerSchema.Type;
export const FORMULA_COMPARISON_SLOT='formula-comparison:review',FORMULA_COMPARISON_INTENT_SLOT='formula-comparison:save';
export const emptyFormulaComparison={formula:'',variable:'',minimum:'',maximum:'',prediction:'',reasoning:'',freshPrediction:''},emptyFormulaComparisonIntent={pendingText:''};
const text=(max:number)=>Schema.String.pipe(Schema.maxLength(max));
const raw=Schema.Struct({formula:text(2000),variable:text(32),minimum:text(80),maximum:text(80),prediction:text(20),reasoning:text(1000),freshPrediction:text(80)}),intent=Schema.Struct({pendingText:text(32000)});
export function readFormulaComparisonDraft(slot:string,value:unknown){if(slot===FORMULA_COMPARISON_SLOT)return Schema.decodeUnknownSync(raw,{onExcessProperty:'error'})(value);if(slot===FORMULA_COMPARISON_INTENT_SLOT)return Schema.decodeUnknownSync(intent,{onExcessProperty:'error'})(value);throw Error('Unsupported comparison raw slot.');}
export const formulaComparisonDraftIdentity=(owner:FormulaComparisonOwner,slot:string)=>JSON.stringify(['formula-comparison-raw-v1',owner,slot]);
export const formulaComparisonDraftBasis=(owner:FormulaComparisonOwner,slot:string)=>JSON.stringify({basis:formulaComparisonDraftIdentity(owner,slot),variableArrays:[]});
