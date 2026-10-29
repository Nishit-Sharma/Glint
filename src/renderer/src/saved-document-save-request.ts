import type {ArtifactInput,Task} from '../../core/types';
import type {Command} from '../../shared/bridge';
type Effects={lock:{current:boolean};setBusy:(value:boolean)=>void;invoke:(command:Extract<Command,{type:'artifact.save'}>)=>Promise<Task>;refresh:()=>Promise<Task>};
export async function requestSavedDocument(taskId:string,artifact:ArtifactInput,effects:Effects):Promise<Task|undefined>{
 if(effects.lock.current)return;
 effects.lock.current=true;effects.setBusy(true);
 try{const result=await effects.invoke({type:'artifact.save',taskId,artifact});const current=await effects.refresh();if(result.id!==taskId||current.id!==taskId)throw Error('The saved document task changed.');return current;}
 finally{effects.lock.current=false;effects.setBusy(false);}
}
