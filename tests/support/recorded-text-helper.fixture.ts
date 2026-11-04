import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {createTextHelper} from '../../src/core/text-helper-host';
import {editModule} from '../../src/core/module-state';
import {initialModuleState,parseModuleAnswer} from '../../src/core/interactive-modules';
import {helperStudio,type HelperOperation} from '../../src/learning/reusable-helper';
export async function recordedTextFixture(){
 const directory=await mkdtemp(join(tmpdir(),'recorded-text-helper-'));let core=await createCompanion({dataDir:directory});
 const task=await core.createTask({title:'Owned text recording fixture'}),created=await createTextHelper(core,{taskId:task.id,requestId:'text-fixture'}),artifact=created.task.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];
 if(module.data.kind!=='helper-studio')throw Error('Helper expected');const data=module.data;
 const owner={taskId:task.id,artifactId:artifact.id,artifactRevision:revision.revision,artifactDigest:revision.digest,moduleId:module.id,moduleVersion:module.version};
 const read=async()=>{const state=(await core.getTask(task.id)).session?.moduleStates.find(item=>item.artifactId===artifact.id)?.state??initialModuleState(data);return helperStudio.parseState(data,state);};
 const act=async(action:Record<string,unknown>)=>{await editModule(core,{...owner,action:{...action,expectedRevision:(await read()).revision} as never});return read();};
 return {directory,owner,data,get core(){return core;},read,act,async record(input='  RIVER\t  Dock  ',operations:HelperOperation[]=[{kind:'trim'},{kind:'collapse-spaces'},{kind:'lowercase'}]){await act({kind:'start-demonstration',input});for(const operation of operations)await act({kind:'demonstrate-step',operation});return act({kind:'finish-demonstration'});},async request(){const state=await read();return {...owner,stateRevision:state.revision,observationId:state.observations?.at(-1)?.id??'missing'};},async reopen(){await core.close();core=await createCompanion({dataDir:directory});},async close(){await core.close();await rm(directory,{recursive:true,force:true});}};
}
