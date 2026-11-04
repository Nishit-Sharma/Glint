import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {emptySourceComparisonDraft,SOURCE_COMPARISON_BASIS as basis,SOURCE_COMPARISON_SLOT as slot,sourceComparisonOwner} from '../src/shared/source-comparison-draft';
export {basis,slot};
export async function comparisonDraftFixture(){
 const directory=await mkdtemp(join(tmpdir(),'comparison-drafts-'));let core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Compare exact snapshots'});
 for(const label of ['Invitation','Guide','Unselected'])task=await core.putSource(task.id,{kind:'text',role:'fact',label,content:label+' PRIVATE BODY SENTINEL'});
 const original=structuredClone(task),owner=sourceComparisonOwner(task.id),refs=task.sources.slice(0,2).map(source=>({sourceId:source.id,version:1,digest:source.versions[0].digest})),raw={refs:[refs[0],refs[1]] as [typeof refs[number],typeof refs[number]],question:'  Why do the times differ?\n',comparison:'  My unsent interpretation\n',uncertainty:'Ask the organizer; unconfirmed.'};
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)});let failWrites=false,writes=0;
 const makeCache=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>{writes++;return failWrites?Promise.reject(Error('Owned draft write failure.')):store.save(...args);}});
 let cache=makeCache();await cache.load();
 return {directory,store,owner,refs,raw,original,get task(){return task;},get core(){return core;},get cache(){return cache;},get writes(){return writes;},makeCache,edit(){return cache.tryEdit(owner,slot,emptySourceComparisonDraft,basis,()=>structuredClone(raw));},failWrites(value=true){failWrites=value;},async refresh(){task=await core.putSource(original.id,{id:refs[0].sourceId,kind:'text',role:'fact',label:'Revised invitation',content:'UPDATED PRIVATE BODY'});},async revoke(){task=await core.revokeSource(original.id,refs[1].sourceId);},async second(){task=await core.createTask({title:'Another task'});},async restore(){task=await core.getTask(original.id);},async recreate(restart=false){await cache.flush();if(restart){await core.close();core=await createCompanion({dataDir:directory});}task=await core.getTask(task.id);cache=makeCache();await cache.load();},async close(){await core.close();await rm(directory,{recursive:true,force:true});}};
}
