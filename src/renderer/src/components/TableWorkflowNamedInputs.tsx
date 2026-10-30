import {Schema} from 'effect';
import {TableInputValuesSchema,type TableInputValues} from '../../../learning/table-workflow-inputs';

export function readNamedTableInputs(text:string):TableInputValues{
 return Schema.decodeUnknownSync(TableInputValuesSchema,{onExcessProperty:'error'})(JSON.parse(text));
}
export function TableWorkflowNamedInputs({prefix,contract,value,onChange}:{prefix:string;contract:readonly {name:string;kind:'text'|'number'}[];value:string;onChange:(value:string)=>void}){
 let values:TableInputValues;
 try{values=readNamedTableInputs(value);}catch{return <p role="alert">Earlier named-input fields are unsupported. Their exact local draft is kept in Unfinished practice; they cannot run.</p>;}
 const update=(index:number,name:string,value:string)=>onChange(JSON.stringify(index<0?[...values,{name,value}]:values.map((old,i)=>i===index?{...old,value}:old)));
 return <fieldset className="table-workflow-input-values"><legend>{prefix} values</legend><p>Every declared input is required. Text is exact; numeric values must be finite decimals. Blank values never use the original literal automatically.</p>{contract.map(input=>{const index=values.findIndex(item=>item.name===input.name);return <label key={input.name}>{input.name} · {input.kind}<input aria-label={`${prefix} ${input.name}`} inputMode={input.kind==='number'?'decimal':undefined} maxLength={160} value={index<0?'':values[index].value} onChange={event=>update(index,input.name,event.target.value)}/></label>;})}{values.map((input,index)=>!contract.some(item=>item.name===input.name)||values.findIndex(item=>item.name===input.name)!==index?<div key={index}><p className="table-workflow-exact">Retained unsupported or duplicate input “{input.name}”: {input.value}</p><button type="button" onClick={()=>onChange(JSON.stringify(values.filter((_,i)=>i!==index)))}>Remove earlier named input {index+1}</button></div>:null)}</fieldset>;
}
