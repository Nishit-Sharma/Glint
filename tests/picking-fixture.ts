import type {SemanticProcedure,SemanticStep} from '../src/learning/semantic-procedure';
const input=(field:string)=>({kind:'input' as const,field});
const literal=(value:string|number|boolean)=>({kind:'literal' as const,value});
const eq=(field:string,value:string|number|boolean)=>({kind:'compare' as const,operator:'eq' as const,left:input(field),right:literal(value)});
function projection(id:string,handling:string):SemanticStep{
 let next:SemanticStep={kind:'return',id:id+'Done',intent:'Check the projected manifest.'};
 for(const [field,value] of [['handling',literal(handling)],['quantity',input('quantity')],['label',input('matchedLabel')],['itemKey',input('matchedKey')]] as const)next={kind:'assign',id:id+field,intent:'Project '+field,field,value,next};
 return next;
}
export function pickingPlan(){
 const body:SemanticProcedure={schemaVersion:1,id:'manifestBody',version:1,intent:'Prepare an owned local manifest value.',target:'local-export-manifest',
 input:{name:'boundRequest',fields:[{name:'key',kind:'string',minLength:1,maxLength:160},{name:'quantity',kind:'number',minimum:1,maximum:10000},{name:'reviewed',kind:'boolean'},{name:'delivery',kind:'string',minLength:1,maxLength:160},{name:'matchedKey',kind:'string',minLength:1,maxLength:160},{name:'matchedLabel',kind:'string',minLength:1,maxLength:160},{name:'available',kind:'number',minimum:0,maximum:10000},{name:'protected',kind:'boolean'}]},
 output:{name:'manifest',fields:[{name:'itemKey',kind:'string',minLength:1,maxLength:160},{name:'label',kind:'string',minLength:1,maxLength:160},{name:'quantity',kind:'number',minimum:1,maximum:10000},{name:'handling',kind:'string',minLength:1,maxLength:160}]},
 preconditions:[{id:'reviewed',reason:'Review the request first.',predicate:eq('reviewed',true)}],
 postconditions:[{id:'sameKey',reason:'Preserve requested key.',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'itemKey'},right:input('key')}},{id:'sameQuantity',reason:'Preserve quantity.',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'quantity'},right:input('quantity')}},{id:'sameLabel',reason:'Preserve selected label.',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'label'},right:input('matchedLabel')}}],
 root:{kind:'branch',id:'protection',intent:'Check protection.',predicate:eq('protected',true),then:{kind:'abstain',id:'protectedStop',intent:'Stop on protected items.',reason:'Protected item requires manual handling.'},else:{kind:'branch',id:'stock',intent:'Check available quantity.',predicate:{kind:'compare',operator:'gt',left:input('quantity'),right:input('available')},then:{kind:'abstain',id:'stockStop',intent:'Stop on insufficient stock.',reason:'Requested quantity exceeds availability.'},else:{kind:'branch',id:'pickup',intent:'Choose pickup handling.',predicate:eq('delivery','pickup'),then:projection('pickup','Collect locally'),else:{kind:'branch',id:'courier',intent:'Choose courier handling.',predicate:eq('delivery','courier'),then:projection('courier','Prepare for courier'),else:{kind:'abstain',id:'deliveryStop',intent:'Stop on unsupported delivery.',reason:'Choose pickup or courier.'}}}}},
 };
 return {schemaVersion:2 as const,id:'picking',version:1,intent:'Look up and project a local manifest.',requestFields:['key','quantity','reviewed','delivery'],integerRequestFields:['quantity'],table:{binding:'inventory',columns:[{id:'sku',kind:'string'},{id:'name',kind:'string'},{id:'stock',kind:'integer'},{id:'private',kind:'boolean'}]},lookup:{id:'findItem',column:'sku',keyInput:'key',bindings:[{column:'sku',input:'matchedKey'},{column:'name',input:'matchedLabel'},{column:'stock',input:'available'},{column:'private',input:'protected'}]},body};
}
export function inventory(){return {id:'inventoryOne',rows:[{id:'distractor',values:['K-18','Old label',1,false]},{id:'chosen',values:['K-17','River clamp',9,false]}]};}
export const pickingRequest={key:'K-17',quantity:2,reviewed:true,delivery:'pickup'};
