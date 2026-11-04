import {expectPinnedReaderRefusal} from '../support/pinned-reader-refusal.fixture';
import {expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Effect} from 'effect';
import {createCompanion} from '../../src/core/companion';
import {createExperimentPractice,inspectExperimentPractice} from '../../src/core/experiment-practice-host';
import {readState as oldRead} from '../fixtures/a91/src/core/store';

const model={schemaVersion:1,kind:'experiment',title:'Cost',explanation:'Suggested rate × time plus fee.',spec:{title:'Cost',expression:{op:'add',left:{op:'multiply',left:{op:'variable',name:'rate'},right:{op:'variable',name:'time'}},right:{op:'variable',name:'fee'}},variables:[{name:'rate',unit:'USD/s',min:0,max:100},{name:'time',unit:'s',min:0,max:100},{name:'fee',unit:'USD',min:0,max:100}],assumptions:['Constant rate; one fee.']},inputs:{rate:3,time:4,fee:2}};

it('refuses comparison examples, accepts a different vector, and keeps one first answer across comparison contexts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'experiment-demonstrations-'));let core=await createCompanion({dataDir:dir});try{
  const task=await core.createTask({title:'Cost'}),source=await core.putSource(task.id,{kind:'text',role:'fact',label:'Reviewed note',content:'Cost = rate × time + fee.'}),v=source.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],saved=await core.saveArtifact(task.id,{title:model.title,content:JSON.stringify(model),mimeType:'application/json',sourceRefs:refs});
  const demonstratedInputs=[{rate:4,time:4,fee:2},{rate:4,time:3,fee:2}],base={taskId:task.id,basis:{artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},expectedSourceRefs:refs,demonstratedInputs};
  for(const inputs of demonstratedInputs){await expect(inspectExperimentPractice(core,{...base,inputs})).rejects.toThrow(/different.*demonstrated/i);await expect(createExperimentPractice(core,{...base,inputs,prediction:12,reasoning:'Already shown.'})).rejects.toThrow(/different.*demonstrated/i);}
  const inputs={rate:5,time:3,fee:2};expect(await inspectExperimentPractice(core,{...base,inputs})).toEqual({kind:'not-started'});
  const answer=await createExperimentPractice(core,{...base,inputs,prediction:15,reasoning:'I forgot the fee.'});
  const repeated=await createExperimentPractice(core,{...base,demonstratedInputs:[demonstratedInputs[1]],inputs,prediction:17,reasoning:'Replace'});expect(repeated).toEqual(answer);
  const taskAfter=await core.getTask(task.id),content=taskAfter.artifacts.find(a=>a.id===answer.artifactId)!.revisions[0].content;expect(taskAfter.requests).toHaveLength(1);expect(content).toContain('Your first prediction: 15 USD');expect(content).toContain('I forgot the fee.');expect(content).toContain('Calculated result: 17 USD');expect(content).toContain('Current comparison examples reported at submission:');expect(content).toContain('rate = 4 USD/s, time = 3 s, fee = 2 USD');
  const firstRecord=taskAfter.artifacts.find(a=>a.id===answer.artifactId)!;await core.close();await expectPinnedReaderRefusal(dir,()=>Effect.runPromise(oldRead(dir)));core=await createCompanion({dataDir:dir});expect(await inspectExperimentPractice(core,{...base,inputs})).toMatchObject({kind:'completed',...answer});expect((await core.getTask(task.id)).artifacts.find(a=>a.id===answer.artifactId)).toEqual(firstRecord);
  const {demonstratedInputs:omit,...legacy}=base;expect(await inspectExperimentPractice(core,{...legacy,inputs})).toMatchObject({kind:'completed',...answer});
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});

it('validates comparison input names, bounds, cardinality and model/source identity before creating anything',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'experiment-demonstration-refusal-')),core=await createCompanion({dataDir:dir});try{
  const task=await core.createTask({title:'Cost'}),source=await core.putSource(task.id,{kind:'text',role:'fact',label:'Note',content:'Cost.'}),v=source.sources[0].versions[0],refs=[{sourceId:v.id,version:1,digest:v.digest}],saved=await core.saveArtifact(task.id,{title:model.title,content:JSON.stringify(model),mimeType:'application/json',sourceRefs:refs}),base={taskId:task.id,basis:{artifactId:saved.artifactId,revision:1,digest:saved.revision.digest},expectedSourceRefs:refs,inputs:{rate:5,time:4,fee:2}};
  for(const demonstratedInputs of [[{rate:3,time:4}],[{...model.inputs,other:1}],[{...model.inputs,rate:101}],[{...model.inputs,rate:Infinity}],Array.from({length:15},()=>model.inputs)])await expect(inspectExperimentPractice(core,{...base,demonstratedInputs})).rejects.toThrow();
  expect((await core.getTask(task.id)).requests).toHaveLength(0);
  await core.putSource(task.id,{id:v.id,kind:'text',role:'fact',label:'Note',content:'Changed.'});await expect(inspectExperimentPractice(core,{...base,demonstratedInputs:[model.inputs]})).rejects.toThrow(/source changed/i);expect((await core.getTask(task.id)).requests).toHaveLength(0);
 }finally{await core.close();await rm(dir,{recursive:true,force:true});}
});
