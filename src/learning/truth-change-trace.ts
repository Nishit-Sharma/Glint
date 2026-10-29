import {parseBinaryAssignment} from './truth-table';

type Bit=0|1;
/** Computes only the two binary values of one reviewed, supported assignment. */
export function truthChangeTrace(quote:string,selected:string|undefined){
 const rule=parseBinaryAssignment(quote);if(!rule)throw Error('This source line is not a supported binary assignment.');
 if(selected===undefined)return null;
 const match=/^pair-([01])([01])$/.exec(selected);if(!match)throw Error('This saved input pair needs review.');
 const left=Number(match[1]) as Bit,right=Number(match[2]) as Bit;
 const output=(rule.operator==='and'?left===1&&right===1:rule.operator==='or'?left===1||right===1:left!==right)?1:0;
 const explanation=rule.operator==='and'?`AND returns ${output} because ${left===1&&right===1?'both inputs are 1':'at least one input is 0'}.`:rule.operator==='or'?`OR returns ${output} because ${left===1||right===1?'at least one input is 1':'neither input is 1'}.`:`XOR returns ${output} because the inputs ${left!==right?'differ':'are the same'}.`;
 return {quote:rule.quote,operator:rule.operator,outputName:rule.output,before:{left:0 as Bit,right:0 as Bit,output:0 as Bit},after:{left,right,output:output as Bit},inputs:[{name:rule.left,before:0 as Bit,after:left},{name:rule.right,before:0 as Bit,after:right}],outputChanged:output!==0,explanation};
}
