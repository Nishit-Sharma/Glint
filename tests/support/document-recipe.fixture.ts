import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {createDocumentRecipe} from '../../src/core/document-recipe-host';
import {initialModuleState,parseModuleAnswer} from '../../src/core/interactive-modules';
import {editModule} from '../../src/core/module-state';
import {documentRecipe,DocumentRecipeActionSchema} from '../../src/learning/document-recipe';
import {Schema} from 'effect';
import type {DocumentRecipeRequest} from '../../src/shared/document-recipe';
export async function documentRecipeFixture(){
 const directory=await mkdtemp(join(tmpdir(),'document-recipe-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Owned document workflow'}),created=await createDocumentRecipe(core,{taskId:task.id,requestId:'create-document-recipe'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
 if(module.data.kind!=='document-recipe')throw Error('Expected document recipe');const data=module.data,owner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
 const read=async()=>documentRecipe.parseState((await core.getTask(task.id)).session?.moduleStates.find(item=>item.artifactId===artifact.id&&item.moduleId===module.id)?.state??initialModuleState(data));
 const act=async(value:Record<string,unknown>)=>{const action=Schema.decodeUnknownSync(DocumentRecipeActionSchema)({...value,expectedRevision:(await read()).revision});await editModule(core,{...owner,action});return read();};
 const teach=async()=>{
  await act({kind:'document-recipe-start',name:'Handoff note',intent:'Create a handoff from local notes.',input:'Owner: Mira\nNext: Ship samples'});
  for(const step of [{kind:'text',text:'Owner: '},{kind:'field',name:'Owner'},{kind:'text',text:'\nNext: '},{kind:'field',name:'Next'}])await act({kind:'document-recipe-add',step});
  await act({kind:'document-recipe-finish'});await act({kind:'document-recipe-exception',contains:'PRIVATE',reason:'Keep private notes for review.'});
  await act({kind:'document-recipe-check',input:'Owner: Jules\nNext: Confirm delivery',expected:{kind:'output',text:'Owner: Jules\nNext: Confirm delivery'}});
  await act({kind:'document-recipe-check',input:'PRIVATE\nOwner: Jules\nNext: Confirm delivery',expected:{kind:'stopped'}});await act({kind:'document-recipe-save-version'});return act({kind:'document-recipe-activate',version:1});
 };
 const source=async(content='Owner: Rowan\nNext: Inspect stock')=>{const updated=await core.putSource(task.id,{id:'handoff-source',kind:'text',role:'fact',label:'Fresh local notes',content}),source=updated.sources.find(item=>item.id==='handoff-source')!,version=source.versions.at(-1)!,state=await read();if(state.activeVersion===null)throw Error('Activate first');const request:DocumentRecipeRequest={...owner,stateRevision:state.revision,activeVersion:state.activeVersion,sourceRef:{sourceId:source.id,version:version.version,digest:version.digest}};return request;};
 return {directory,core,owner,artifact,data,read,act,teach,source,close:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
