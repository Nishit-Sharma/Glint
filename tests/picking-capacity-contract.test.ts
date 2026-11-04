import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {pickingPlan} from './picking-fixture';
import {pickingDefinition,parsePickingCase} from '../src/learning/picking-helper';
import {copyTableData} from '../src/learning/semantic-table-procedure';
import {pickingDigest} from '../src/shared/picking-digest';
const text=(n:number)=>'\u0001'.repeat(n),bytes=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
function count(value:unknown):number{if(typeof value==='string')return value.length;if(!value||typeof value!=='object')return 0;return Reflect.ownKeys(value).reduce<number>((sum,key)=>sum+String(key).length+(key==='length'&&Array.isArray(value)?0:count((value as Record<string,unknown>)[key as string])),0);}
function saturatedDefinition(){
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
function maxCase(i:number){const scalar=text(160),caseId='c'.repeat(77)+String(i).padStart(3,'0');return {id:caseId,role:'counterexample' as const,table:{id:'t'.repeat(80),rows:Array.from({length:12},(_,j)=>({id:'r'.repeat(77)+String(j).padStart(3,'0'),values:Array(4).fill(scalar)}))},request:{key:scalar,quantity:scalar,reviewed:scalar,delivery:scalar},expected:{status:'completed' as const,output:{itemKey:scalar,label:scalar,quantity:scalar,handling:scalar}}};}
test('complete closed V2 payloads and outer one-owner file fit unchanged 8 MiB with conservative headroom',()=>{
 const definition=saturatedDefinition(),allCases=Array.from({length:20},(_,i)=>maxCase(i));allCases.forEach(parsePickingCase);
 const payloads={candidate:{definitionText:JSON.stringify(definition),changeReason:text(500)},context:{rows:Array.from({length:12},()=>({values:Array(4).fill(text(160))})),key:text(160),quantity:text(160),reviewed:false,delivery:text(160)},recording:{rowId:'r'.repeat(80),source:'request',field:'f'.repeat(80),output:'quantity',literal:text(160)},cases:{cases:allCases},correction:{reason:text(500)},run:{runId:'r'.repeat(80),note:text(500)}};
 const owner={taskId:text(200),artifactId:text(200),artifactRevision:Number.MAX_SAFE_INTEGER,artifactDigest:text(200),moduleId:'m'.repeat(80),moduleVersion:Number.MAX_SAFE_INTEGER};
 const records=Object.entries(payloads).map(([family,payload])=>({owner,slot:'helper:table:'+family,revision:Number.MAX_SAFE_INTEGER,value:{initial:JSON.stringify(payload),value:JSON.stringify(payload),basis:text(16384)}}));
 const perSlot=Object.fromEntries(Object.entries(payloads).map(([family,payload],i)=>[family,{payloadBytes:bytes(payload),outerRecordBytes:bytes(records[i]),payloadDigest:createHash('sha256').update(JSON.stringify(payload)).digest('hex')}]));
 const file={schemaVersion:2,epoch:'11111111-1111-4111-8111-111111111111',records},result={classification:'inert prospective payload/serialization proof, no DOM input or execution-success claim',candidateCharacterBudget:count(definition),candidateSteps:63,cases:20,rowsPerCase:12,cellsPerRow:4,ownerMetadata:'200-char escaped task/artifact/digest,80ASCII module,maxsafe revisions',basisCharacters:16384,basisWorstEscape:'U+0001',initialAndValue:'both maximal witness',perSlot,completeOneOwnerFileBytes:bytes(file),unchangedFileLimit:8*1024*1024,headroom:8*1024*1024-bytes(file)};
 expect(bytes(file)).toBeLessThan(8*1024*1024);expect(perSlot.candidate.payloadBytes).toBeLessThan(1024*1024);expect(perSlot.cases.payloadBytes).toBeLessThan(1536*1024);for(const family of ['context','recording','correction','run'] as const)expect(perSlot[family].payloadBytes).toBeLessThan(128*1024);
 mkdirSync('evidence',{recursive:true});writeFileSync('evidence/RAW-CAPACITY-WITNESS.json',JSON.stringify(result,null,2)+'\n');
});
