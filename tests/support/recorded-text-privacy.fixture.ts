import type {Companion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {editModule} from '../../src/core/module-state';
import {createRecordedTextHelper,inspectRecordedTextHelper} from '../../src/core/recorded-text-helper-host';
import {helperModule,initialModuleState,parseModuleAnswer} from '../../src/core/interactive-modules';
import {MODULE_MIME} from '../../src/shared/module-contract';
export const privateText={input:'PRIVATE_RECORDED_INPUT',replacement:'PRIVATE_RECORDED_OUTPUT',name:'PRIVATE_HELPER_NAME',description:'PRIVATE_HELPER_DESCRIPTION',reason:'PRIVATE_HELPER_REASON',markdown:'PRIVATE_HELPER_MARKDOWN',literal:'PRIVATE_OPERATION_LITERAL'};
export async function privateRecordedHelpers(core:Companion){
 const task=await core.createTask({title:'Public task title'}),created=await createTextHelper(core,{taskId:task.id,requestId:'create-original'}),artifact=created.task.artifacts[0],revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='helper-studio')throw Error();const data=module.data,owner={taskId:task.id,artifactId:artifact.id,artifactRevision:1,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
 const read=async()=>{const saved=(await core.getTask(task.id)).session?.moduleStates.find(item=>item.artifactId===artifact.id);return helperModule.parseState(saved?.state??initialModuleState(data));};
 const act=async(action:Record<string,unknown>)=>editModule(core,{...owner,action:{...action,expectedRevision:(await read()).revision} as never});
 await act({kind:'start-demonstration',input:privateText.input});await act({kind:'demonstrate-step',operation:{kind:'replace-literal',find:privateText.input,replacement:privateText.replacement}});await act({kind:'finish-demonstration'});
 await act({kind:'set-details',name:privateText.name,description:privateText.description,invocation:privateText.literal});
 const state=await read();if('format' in state)throw Error();const request={...owner,stateRevision:state.revision,observationId:state.observations![0].id},preview=await inspectRecordedTextHelper(core,request),derived=await createRecordedTextHelper(core,{...request,binding:preview.binding,confirmed:'create-separate-inactive-draft'}),derivedArtifact=derived.task.artifacts.find(item=>item.id===derived.artifactId)!,derivedModule=parseModuleAnswer(JSON.parse(derivedArtifact.revisions[0].content)).modules[0];if(derivedModule.data.kind!=='helper-studio')throw Error();
 await act({kind:'add-exception',exception:{id:'private-reason',contains:privateText.literal,behavior:'abstain',reason:privateText.reason}});
 const finalOriginal=await read();if('format' in finalOriginal)throw Error();
 // An answer's surrounding Markdown is also user-editable/free text.
 const mixed=await core.runRequest({taskId:task.id,requestId:'mixed-answer',kind:'create',prompt:'A public helper request',sourceIds:[]},async()=>({title:privateText.name,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:privateText.markdown,modules:[{id:'mixed-helper',version:1,data:{...data,title:privateText.name,description:privateText.description},provenance:[]},{id:'plan',version:1,data:{kind:'plan',schemaVersion:1,title:'PUBLIC_PLAN_TITLE',purpose:'PUBLIC_PLAN_PURPOSE',items:[{id:'item',title:'PUBLIC_PLAN_ITEM',detail:'PUBLIC_PLAN_DETAIL'}]},provenance:[]}]})}));
 await core.runRequest({taskId:task.id,requestId:'ordinary',kind:'create',prompt:'PUBLIC_QUESTION',sourceIds:[]},async()=>({title:'PUBLIC_DOCUMENT_TITLE',content:'PUBLIC_DOCUMENT_BODY'}));
 return {taskId:task.id,owner,data,originalState:finalOriginal,derived,derivedData:derivedModule.data,derivedModuleId:derivedModule.id,mixedArtifactId:mixed.artifactId!,act,read};
}
