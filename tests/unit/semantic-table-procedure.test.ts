import {expect,test} from 'vitest';
import {pickingPlan as plan,inventory as table,pickingRequest as request} from '../support/picking-fixture';
// Keep absent-feature red in the actual test bodies, not collection.
const path='../../src/learning/semantic-table-procedure';const api=()=>import(path);
test('unique typed lookup projects reordered rows and executes both configured branches',async()=>{
 const {runTableProcedure}=await api();
 expect(runTableProcedure(plan(),table(),request)).toMatchObject({status:'completed',output:{itemKey:'K-17',label:'River clamp',quantity:2,handling:'Collect locally'},effectAuthority:'none',lookup:{rowId:'chosen'}});
 expect(runTableProcedure(plan(),{...table(),rows:[...table().rows].reverse()},{...request,delivery:'courier'})).toMatchObject({status:'completed',output:{handling:'Prepare for courier'},lookup:{rowId:'chosen'}});
});
test('missing and duplicate keys stop precisely instead of choosing a demonstration position',async()=>{
 const {runTableProcedure}=await api();
 expect(runTableProcedure(plan(),table(),{...request,key:'missing'})).toMatchObject({status:'abstained',code:'lookup-missing',output:{}});
 expect(runTableProcedure(plan(),{...table(),rows:[...table().rows,{id:'duplicate',values:['K-17','Different label',8,false]}]},request)).toMatchObject({status:'abstained',code:'lookup-ambiguous',output:{}});
});
test('precondition, protection, stock and delivery stops produce no derived manifest',async()=>{
 const {runTableProcedure}=await api();
 for(const [data,input,haltedStepId] of [[table(),{...request,reviewed:false},'reviewed'],[{...table(),rows:[{id:'private',values:['K-17','Private',9,true]}]},request,'protectedStop'],[table(),{...request,quantity:10},'stockStop'],[table(),{...request,delivery:'airdrop'},'deliveryStop']] as const)expect(runTableProcedure(plan(),data,input)).toMatchObject({status:'abstained',haltedStepId,output:{}});
});
test('different reviewed column roles and a fresh table use the same interpreter',async()=>{
 const {runTableProcedure}=await api(),configured=plan();
 configured.table.columns=configured.table.columns.map((column,index)=>({...column,id:['code','caption','remaining','restricted'][index]}));
 configured.lookup.column='code';configured.lookup.bindings=configured.lookup.bindings.map((binding,index)=>({...binding,column:['code','caption','remaining','restricted'][index]}));
 expect(runTableProcedure(configured,{id:'freshInventory',rows:[{id:'new',values:['P-42','East tool',7,false]},{id:'oldName',values:['K-17','River clamp',4,false]}]},{...request,key:'P-42',quantity:6})).toMatchObject({status:'completed',output:{itemKey:'P-42',label:'East tool',quantity:6}});
});
test('inert boundaries refuse coercion, NULL, duplicate identities and authority expansion',async()=>{
 const {runTableProcedure,parseTableProcedure}=await api();let reads=0;const getter={...request};Object.defineProperty(getter,'key',{enumerable:true,get(){reads++;return 'K-17';}});
 for(const value of [{...request,quantity:1.5},{...request,quantity:'2'},{...request,extra:true},getter])expect(runTableProcedure(plan(),table(),value)).toMatchObject({status:'invalid-input'});
 for(const rows of [[{id:'null',values:['K-17',null,9,false]}],[{id:'wrong',values:['K-17','Label','9',false]}],Array.from({length:13},(_,i)=>({id:'r'+i,values:['K'+i,'Label',1,false]})),[{id:'same',values:['K-17','One',1,false]},{id:'same',values:['K-18','Two',1,false]}]])expect(runTableProcedure(plan(),{id:'table',rows},request)).toMatchObject({status:'invalid-input'});
 expect(reads).toBe(0);
 for(const value of [{...plan(),capability:'browser'},{...plan(),lookup:{...plan().lookup,column:'missing'}},{...plan(),lookup:{...plan().lookup,bindings:[{column:'stock',input:'matchedLabel'}]}},{...plan(),table:{...plan().table,columns:[...plan().table.columns,plan().table.columns[0]]}}])expect(()=>parseTableProcedure(value)).toThrow();
});
test('every run validates current definition and returns a detached value without effects',async()=>{
 const {runTableProcedure}=await api(),definition=plan(),data=table(),before=JSON.stringify({definition,data,request});const result=runTableProcedure(definition,data,request);expect(result.status).toBe('completed');result.output.label='Changed return only';
 expect(runTableProcedure(definition,data,request)).toMatchObject({output:{label:'River clamp'},effectAuthority:'none'});
 expect(runTableProcedure({...definition,body:{...definition.body,target:'browser'}},data,request)).toMatchObject({status:'invalid-input',stage:'definition'});expect(JSON.stringify({definition,data,request})).toBe(before);
});

test('request-only preconditions stop before lookup and disclose no selected row',async()=>{
 const {runTableProcedure}=await api();expect(runTableProcedure(plan(),table(),{...request,key:'missing',reviewed:false})).toMatchObject({status:'abstained',code:'precondition',haltedStepId:'reviewed',output:{}});expect(runTableProcedure(plan(),table(),{...request,key:'missing',reviewed:false})).not.toHaveProperty('lookup');
});
