import {readLocalTaskStart,type LocalTaskStartInput,type LocalTaskStartResult,type LocalTaskStartValue} from '../../shared/local-task-start';

export type LocalTaskIntentState={kind:'idle'}|{kind:'saving'|'uncertain'|'completed';input:Readonly<LocalTaskStartInput>}|{kind:'left'};
type Options={createId:()=>string;send:(input:Readonly<LocalTaskStartInput>)=>Promise<LocalTaskStartResult|undefined>;onCreated:(result:LocalTaskStartResult)=>void;onState?:(state:LocalTaskIntentState)=>void;isActive?:()=>boolean};
export function createLocalTaskIntent(options:Options){
 let state:LocalTaskIntentState={kind:'idle'};
 const active=()=>options.isActive?.()??true;
 function publish(next:LocalTaskIntentState){state=Object.freeze(next);if(active())options.onState?.(state);}
 async function save(input:Readonly<LocalTaskStartInput>){
  publish({kind:'saving',input});
  let result:LocalTaskStartResult|undefined;
  try{result=await options.send(input);}catch{if(state.kind!=='left')publish({kind:'uncertain',input});return;}
  if(state.kind==='left')return;
  if(result===undefined){publish({kind:'uncertain',input});return;}
  publish({kind:'completed',input});
  if(active())options.onCreated(result);
 }
 return {
  snapshot:()=>state,
  async submit(value:LocalTaskStartValue){
   if(state.kind!=='idle'||!active())return;
   const input=Object.freeze(readLocalTaskStart({...value,intentId:options.createId()}));
   await save(input);
  },
  async retry(){if(state.kind==='uncertain'&&active())await save(state.input);},
  leave(){publish({kind:'left'});},
 };
}
