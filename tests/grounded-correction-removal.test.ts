import {currentAnswerOrigin} from './current-answer-origin.fixture';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {createCompanion} from '../src/core/companion';
import {admitJoinExtraction,createGroundedJoinArtifact,localGroundedJoin} from '../src/core/grounded-join-host';
import {editModule} from '../src/core/module-state';
import {groundedJoin,type GroundedJoinAction} from '../src/learning/grounded-join';
import {GroundedJoin} from '../src/renderer/src/components/GroundedJoin';
import {extractionFixture} from './grounded-join-fixture';
import {exampleLesson} from '../src/learning/example';

const removeCell={kind:'remove-cell-correction',side:'left',rowId:'practice-b',columnId:'p-key'} as const;
const removeType={kind:'remove-type-correction',side:'left',columnId:'p-key'} as const;
const removeKeys={kind:'remove-key-correction'} as const;

test('restore original corrections through module persistence, then reapply and compute without changing source evidence',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'grounded-correction-removal-'));let core=await createCompanion({dataDir:directory});
 try{
  const f=extractionFixture(true),task=await core.createTask({title:'Synthetic correction retraction'});
  await core.putSource(task.id,{kind:'text',role:'fact',label:'Synthetic tables',content:f.content});
  const basis=await currentAnswerOrigin(core,task.id,'correction-removal-origin',{title:'Source explanation',content:'Review the synthetic table transcription.'},(await core.getTask(task.id)).sources.map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest})));
  const proposal={...f.proposal,extraction:{...f.proposal.extraction,left:{...f.proposal.extraction.left,columns:f.proposal.extraction.left.columns.map((c,i)=>i===0?{...c,type:'unknown' as const,typeCitationId:null}:c)},join:{kind:'ambiguous' as const,reason:'Choose a reviewed join condition.'}}};
  const input={id:'correction-retraction',title:'Restore original extraction',version:1,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},proposal,transfer:f.transfer};
  const data=admitJoinExtraction(await core.getTask(task.id),input),request=await createGroundedJoinArtifact(core,{...input,taskId:task.id,requestId:'synthetic-correction-review'}),target={taskId:task.id,artifactId:request.artifactId!,artifactRevision:1,moduleId:data.id};
  const original=await core.getTask(task.id);let state=groundedJoin.initial(data);
  const apply=async(action:unknown)=>{await editModule(core,{...target,action:action as GroundedJoinAction});state=groundedJoin.parseState(data,(await core.getTask(task.id)).session!.moduleStates[0].state);};
  const corrections=[{kind:'correct-cell',side:'left',rowId:'practice-b',columnId:'p-key',value:'x',reason:'User reads x.'},{kind:'correct-type',side:'left',columnId:'p-key',type:'string',reason:'User confirms text.'},{kind:'correct-keys',keys:{mode:'INNER',leftColumnId:'p-key',rightColumnId:'p-rkey'},reason:'User confirms equality.'}] as const;
  for(const action of corrections)await apply({...action,expectedRevision:state.revision});
  expect(groundedJoin.observe(data,state).ready).toBe(true);
  const html=renderToStaticMarkup(createElement(GroundedJoin,{data,state,status:{kind:'current'},onAction:()=>{}}));
  for(const label of ['Restore original value','Restore original type','Restore original join condition'])expect(html).toContain(label);
  const staleRevision=state.revision;
  for(const action of [removeCell,removeType,removeKeys]){
   await apply({...action,expectedRevision:state.revision});
   expect(groundedJoin.observe(data,state).ready).toBe(false);
   await expect(apply({kind:'accept-extraction',expectedRevision:state.revision})).rejects.toThrow(/Resolve/);
   await expect(apply({...action,expectedRevision:state.revision})).rejects.toThrow(/no saved/);
  }
  expect(groundedJoin.observe(data,state).missing).toHaveLength(3);
  expect(state).toMatchObject({cellCorrections:[],typeCorrections:[],keyCorrection:null,lab:null});
  await expect(apply({...removeCell,expectedRevision:staleRevision})).rejects.toThrow(/module changed/);
  const saved=structuredClone(state);await core.close();core=await createCompanion({dataDir:directory});
  expect((await core.getTask(task.id)).session!.moduleStates[0].state).toEqual(saved);
  for(const action of corrections)await apply({...action,expectedRevision:state.revision});
  for(const action of [{...removeCell,rowId:'nonexistent'},{...removeType,columnId:'nonexistent'}])await expect(apply({...action,expectedRevision:state.revision})).rejects.toThrow(/no saved/);
  await expect(apply({...removeKeys,unexpected:'not allowed',expectedRevision:state.revision})).rejects.toThrow();
  await apply({kind:'accept-extraction',expectedRevision:state.revision});
  for(const action of [removeCell,removeType,removeKeys])await expect(apply({...action,expectedRevision:state.revision})).rejects.toThrow(/reviewed extraction is fixed/);
  await apply({kind:'lab',action:{kind:'predict',count:4,reasoning:'Two duplicate matches for each corrected member.',expectedRevision:0},expectedRevision:state.revision});
  expect(groundedJoin.observe(data,state).lab?.assessment).toMatchObject({actualCount:4,correct:true});
  const acceptedHtml=renderToStaticMarkup(createElement(GroundedJoin,{data,state,status:{kind:'current'},onAction:()=>{}}));
  expect(acceptedHtml).not.toContain('Restore original value');
  const after=await core.getTask(task.id);expect(after.sources).toEqual(original.sources);expect(after.artifacts).toEqual(original.artifacts);
  const second=await createGroundedJoinArtifact(core,{...input,taskId:task.id,requestId:'synthetic-unaccepted-review'}),other={...target,artifactId:second.artifactId!};
  for(const [expectedRevision,action] of corrections.entries())await editModule(core,{...other,action:{...action,expectedRevision}});
  await core.invalidateSource(task.id,after.sources[0].id,'Synthetic freshness change.');
  const staleTask=await core.getTask(task.id);
  for(const action of [removeCell,removeType,removeKeys])await expect(editModule(core,{...other,action:{...action,expectedRevision:3}})).rejects.toThrow(/source changed|fresh capture/i);
  expect(await core.getTask(task.id)).toEqual(staleTask);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('removing a supplied-cell correction restores its exact value and stale or pending controls stay disabled',()=>{
 const data=localGroundedJoin(exampleLesson);
 const target={side:'left' as const,rowId:data.extraction.left.rows[0].id,columnId:data.extraction.left.columns[0].id};
 const state=groundedJoin.update(data,groundedJoin.initial(data),{kind:'correct-cell',...target,value:null,reason:'Temporary NULL declaration.',expectedRevision:0});
 const removed=groundedJoin.update(data,state,{kind:'remove-cell-correction',...target,expectedRevision:1});
 expect(groundedJoin.observe(data,removed)).toMatchObject({origin:'local-demo',ready:true});expect(removed.cellCorrections).toEqual([]);expect(removed.lab).toBeNull();
 for(const props of [{status:{kind:'historical' as const,reason:'Source changed.'}},{status:{kind:'current' as const},pending:true}]){
  const html=renderToStaticMarkup(createElement(GroundedJoin,{data,state,onAction:()=>{},...props}));
  expect(html).toMatch(/<button type="button" disabled="" aria-label="Restore original value/);
 }
});
