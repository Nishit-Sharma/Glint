import {expect,test} from 'vitest';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {sourceComparisonArtifact} from '../src/renderer/src/source-comparison';

const notes={question:'Why do the arrival times differ?',comparison:'The invitation says 09:30. The guide says 10:00; it may refer to doors opening.',uncertainty:'Arrival versus opening is unconfirmed. Ask the organizer.'};
test('human comparison saves only selected exact evidence, edits and reopens; changed snapshots refuse publication',async()=>{
 const runtime=resolve('work/continuation/runtime');await mkdir(runtime,{recursive:true});const dataDir=await mkdtemp(join(runtime,'comparison-'));let core=await createCompanion({dataDir});
 try{
  let task=await core.createTask({title:'Compare visit guidance'});
  for(const [label,content] of [['Invitation','Arrival 09:30'],['Guide','Doors open 10:00'],['Private unselected source','PRIVATE SOURCE SENTINEL']])task=await core.putSource(task.id,{kind:'text',role:'fact',label,content});
  const refs=task.sources.slice(0,2).map(source=>({sourceId:source.id,version:1,digest:source.versions[0].digest})),artifact=sourceComparisonArtifact(task,refs,notes);
  expect(JSON.stringify(artifact)).not.toContain('PRIVATE');expect(artifact.content).not.toContain('Arrival 09:30');expect(artifact.sourceRefs).toEqual(refs);expect(artifact.content).toContain('not an automatic fact check');expect(artifact.content).toContain(notes.uncertainty);
  const saved=await core.saveArtifact(task.id,artifact);await core.saveArtifact(task.id,{...artifact,artifactId:saved.artifactId,expectedRevision:1,content:artifact.content+'\n\nOrganizer confirmed arrival is earlier.'});
  await core.close();core=await createCompanion({dataDir});task=await core.getTask(task.id);expect(task.artifacts[0].revisions).toHaveLength(2);expect(task.artifacts[0].revisions[0]).toEqual(saved.revision);expect(task.artifacts[0].revisions[1].sourceRefs).toEqual(refs);expect(task.requests).toEqual([]);
  const original=structuredClone(task);
  expect(()=>sourceComparisonArtifact(task,[],notes)).toThrow('two different');expect(()=>sourceComparisonArtifact(task,[refs[0],refs[0]],notes)).toThrow('two different');expect(()=>sourceComparisonArtifact(task,[{...refs[0],digest:'wrong'},refs[1]],notes)).toThrow('changed');
  for(const field of ['question','comparison','uncertainty'] as const){expect(()=>sourceComparisonArtifact(task,refs,{...notes,[field]:''})).toThrow('Enter');expect(()=>sourceComparisonArtifact(task,refs,{...notes,[field]:'a'.repeat(field==='question'?201:6001)})).toThrow('limits');}
  expect(()=>sourceComparisonArtifact({...task,status:'paused'},refs,notes)).toThrow('Resume');
  expect(()=>sourceComparisonArtifact({...task,sources:task.sources.map(source=>Object.assign({...source},{revoked:{id:'synthetic',at:'time'}}))},refs,notes)).toThrow('needs refresh');
  task=await core.putSource(task.id,{id:refs[0].sourceId,kind:'text',role:'fact',label:'Invitation revised',content:'Arrival 09:45'});
  expect(()=>sourceComparisonArtifact(task,refs,notes)).toThrow('explicitly choose');await expect(core.saveArtifact(task.id,artifact)).rejects.toThrow('Source changed');expect((await core.getTask(task.id)).artifacts).toEqual(original.artifacts);
  const newest={...refs[0],version:2,digest:task.sources[0].versions[1].digest};task=await core.invalidateSource(task.id,refs[1].sourceId,'Needs review');expect(()=>sourceComparisonArtifact(task,[newest,refs[1]],notes)).toThrow('needs refresh');await expect(core.saveArtifact(task.id,{...artifact,sourceRefs:[newest,refs[1]]})).rejects.toThrow('Source changed');
 }finally{await core.close();}
});
