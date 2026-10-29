import type {Command} from '../../shared/bridge';
import type {SourceTextSaveInput} from '../../shared/source-text-save';

type Effects={lock:{current:boolean};setBusy:(busy:boolean)=>void;start:()=>void;invoke:(command:Extract<Command,{type:'source.text'}>)=>Promise<unknown>;refresh:()=>Promise<void>};

/** Saved-source errors belong to the owning controller, including an unknown
 * postcommit refresh. Keep normal App admission and authoritative refresh,
 * without publishing a late source error over another selected editor. */
export async function requestSavedTextSource(input:SourceTextSaveInput,effects:Effects):Promise<unknown>{
 if(effects.lock.current)return;
 effects.lock.current=true;effects.setBusy(true);
 try{
  effects.start();
  const result=await effects.invoke({type:'source.text',taskId:input.taskId,source:input.source,expectedSource:input.expectedSource,edit:{intentId:input.intentId,binding:input.binding}});
  await effects.refresh();
  return result;
 }finally{effects.lock.current=false;effects.setBusy(false);}
}
