import {randomUUID} from 'node:crypto';
import type {Companion} from '../../src/core/companion';
import type {SourceRef} from '../../src/core/types';
import {editModule} from '../../src/core/module-state';
import {MODULE_MIME} from '../../src/shared/module-contract';
export async function checkedSuggestionHelper(core:Companion,taskId:string,name='Trim labels',refs:SourceRef[]=[]){
 const data={kind:'helper-studio',schemaVersion:1,id:randomUUID(),title:name,description:'Trim pasted labels.'},moduleId=randomUUID();
 const request=await core.runRequest({taskId,requestId:randomUUID(),kind:'create',prompt:'Synthetic checked helper',sourceIds:refs.map(ref=>ref.sourceId),expectedSourceRefs:refs},async()=>({title:name,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Synthetic local helper.',modules:[{id:moduleId,version:1,data,provenance:[]}]})}));
 if(request.status!=='completed'||!request.answer)throw Error(request.error??'Fixture helper failed.');
 const owner={taskId,artifactId:request.answer.artifactId,artifactRevision:request.answer.revision,moduleId};let revision=0;
 const act=async(action:Record<string,unknown>)=>{const saved=await editModule(core,{...owner,action:{...action,expectedRevision:revision} as import('../../src/core/interactive-modules').ModuleAction});revision=(saved.moduleStates.find(item=>item.artifactId===owner.artifactId&&item.moduleId===moduleId)!.state as {revision:number}).revision;};
 await act({kind:'set-details',name,description:'Trim pasted labels.',invocation:'Clean label whitespace'});
 await act({kind:'append-operation',operation:{kind:'trim'}});
 await act({kind:'add-test',test:{id:'example',label:'Trim edges',role:'example',input:' Dock ',expected:{kind:'output',text:'Dock'}}});
 await act({kind:'add-test',test:{id:'empty',label:'Keep empty',role:'counterexample',input:'',expected:{kind:'output',text:''}}});
 await act({kind:'save-version',changeNote:'Checked fixture'});
 return {...owner,act,get revision(){return revision;}};
}
