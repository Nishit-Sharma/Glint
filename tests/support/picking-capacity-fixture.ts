import {expect} from 'vitest';
import {pickingPlan} from './picking-fixture';
import {pickingDefinition} from '../../src/learning/picking-helper';
import {copyTableData} from '../../src/learning/semantic-table-procedure';
const text=(n:number)=>'\u0001'.repeat(n);
function count(value:unknown):number{if(typeof value==='string')return value.length;if(!value||typeof value!=='object')return 0;return Reflect.ownKeys(value).reduce<number>((sum,key)=>sum+String(key).length+(key==='length'&&Array.isArray(value)?0:count((value as Record<string,unknown>)[key as string])),0);}
export function maxPickingDefinition(){
 const plan=structuredClone(pickingPlan()),slots:{object:Record<string,unknown>;key:string;minimum:number}[]=[];
 const fill=(object:Record<string,unknown>,key:string,n:number,minimum=1)=>{object[key]=text(n);slots.push({object,key,minimum});};
 let sequence=0;
 function tree(leaves:number):any{if(leaves===1){const node={kind:'abstain',id:'stop'+sequence++,intent:'',reason:''};fill(node,'intent',500);fill(node,'reason',500);return node;}const left=Math.floor(leaves/2),node={kind:'branch',id:'branch'+sequence++,intent:'',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'key'},right:{kind:'literal',value:text(160)}},then:tree(left),else:tree(leaves-left)};fill(node,'intent',500);return node;}
 let root=tree(30);
 for(const [index,field] of ['handling','quantity','label','itemKey'].entries()){const node={kind:'assign',id:'copy'+index,intent:'',field,value:field==='quantity'?{kind:'input',field:'quantity'}:{kind:'literal',value:text(160)},next:root};fill(node,'intent',500);root=node;}
 (plan.body as any).root=root;
 const conditions=(prefix:string,post:boolean)=>Array.from({length:8},(_,i)=>{const c={id:prefix+i,reason:'',predicate:post?{kind:'all',terms:Array.from({length:8},()=>({kind:'compare',operator:'eq',left:{kind:'input',field:'key'},right:{kind:'literal',value:text(160)}}))}:{kind:'compare',operator:'eq',left:{kind:'input',field:'key'},right:{kind:'literal',value:text(160)}}};fill(c,'reason',500);return c;});
 (plan.body as any).preconditions=conditions('pre',false);(plan.body as any).postconditions=conditions('post',true);fill(plan as unknown as Record<string,unknown>,'intent',500);fill(plan.body as unknown as Record<string,unknown>,'intent',500);
 let excess=count(plan)-64000;for(const slot of slots){if(excess<=0)break;const value=slot.object[slot.key] as string,remove=Math.min(value.length-slot.minimum,excess);slot.object[slot.key]=value.slice(remove);excess-=remove;}
 expect(excess).toBe(0);expect(count(plan)).toBe(64000);copyTableData(plan);pickingDefinition(plan);return plan;
}
export function maxPickingCase(i:number){const scalar=text(160),caseId='c'.repeat(77)+String(i).padStart(3,'0');return {id:caseId,role:'counterexample' as const,table:{id:'t'.repeat(80),rows:Array.from({length:12},(_,j)=>({id:'r'.repeat(77)+String(j).padStart(3,'0'),values:Array(4).fill(scalar)}))},request:{key:scalar,quantity:scalar,reviewed:scalar,delivery:scalar},expected:{status:'completed' as const,output:{itemKey:scalar,label:scalar,quantity:scalar,handling:scalar}}};}
