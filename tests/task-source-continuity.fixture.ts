import type {Companion} from '../src/core/companion';

/** Synthetic saved data only; UI actions are exercised separately. */
export async function continuityTask(core:Companion,title:string,changed=true){
 let task=await core.createTask({title});
 task=await core.putSource(task.id,{kind:'text',role:'fact',label:title+' notes',content:'PRIVATE_SOURCE_BODY',});
 const source=task.sources[0],ref={sourceId:source.id,version:1,digest:source.versions[0].digest};
 task=await core.saveProcedure(task.id,{title:title+' procedure',steps:[{intent:'PRIVATE_PROCEDURE_STEP',target:'PRIVATE_TARGET',preconditions:[],expectedResult:'PRIVATE_RESULT'}],sourceRefs:[ref]});
 if(changed)task=await core.putSource(task.id,{id:source.id,kind:'text',role:'fact',label:title+' revised notes',content:'PRIVATE_NEW_BODY'});
 return {task,ref,procedureId:task.procedures[0].id};
}
