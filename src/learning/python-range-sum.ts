export const RANGE_SUM_FORMULA='initial + count * (count - 1) / 2';
export const RANGE_SUM_ASSUMPTION='This derived model assumes Python’s built-in range, ordinary integer addition, and exactly the reviewed three-line idiom. It does not execute Python or interpret omitted code.';
export const RANGE_SUM_LIMIT='Only range(count) with whole-number count from 0 to 32 and initial accumulator from -100 to 100 is modeled. The stop is excluded. Negative, fractional or larger counts, custom range bindings and other loop bodies are unsupported.';
export type RangeSumSource={accumulator:string;index:string;initial:number;count:number;quote:string;end:number};
const reserved=new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield range'.split(' '));
/** Complete three-line source only. This recognizes an idiom; it is not Python parsing or execution. */
export function recognizeRangeSum(text:string):RangeSumSource|null{
 if(typeof text!=='string'||text.length>2000||text.includes('\0'))return null;
 const lines=text.split(/\r\n|\r|\n/);if(lines.at(-1)==='')lines.pop();if(lines.length!==3)return null;
 const first=/^([A-Za-z][A-Za-z0-9_]{0,31})[ \t]*=[ \t]*(-?(?:0|[1-9][0-9]{0,2}))[ \t]*$/.exec(lines[0]);
 const second=/^for[ \t]+([A-Za-z][A-Za-z0-9_]{0,31})[ \t]+in[ \t]+range\([ \t]*(0|[1-9][0-9]{0,2})[ \t]*\)[ \t]*:[ \t]*$/.exec(lines[1]);
 if(!first||!second||first[1]===second[1]||reserved.has(first[1])||reserved.has(second[1]))return null;
 if(lines[2]!==`    ${first[1]} += ${second[1]}`)return null;
 const initial=Number(first[2]),count=Number(second[2]);if(initial < -100||initial>100||count>32)return null;
 const end=text.length-(text.endsWith('\r\n')?2:/[\r\n]$/.test(text)?1:0);
 return {accumulator:first[1],index:second[1],initial,count,quote:text.slice(0,end),end};
}
export function rangeSumInputs(initial:number,count:number){
 if(!Number.isSafeInteger(initial)||initial < -100||initial>100||!Number.isSafeInteger(count)||count<0||count>32)throw Error('Use whole-number initial values from -100 to 100 and counts from 0 to 32.');
 return {initial,count};
}
export function rangeSumIllustration(initial:number,count:number){
 rangeSumInputs(initial,count);let total=initial;
 const rows=Array.from({length:count},(_,index)=>{const before=total;total+=index;return {index,before,after:total};});
 return {initial,count,rows,result:total};
}
export function rangeSumVariables(source:RangeSumSource){return [{name:'initial',unit:'1',min:-100,max:100,value:source.initial,integer:true as const},{name:'count',unit:'1',min:0,max:32,value:source.count,integer:true as const}];}
