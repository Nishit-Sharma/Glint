import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {createCompanion} from '../../src/core/companion';
import {createTruthTable,inspectTruthTable} from '../../src/core/truth-table-host';
import {parseModuleAnswer} from '../../src/core/interactive-modules';
import {OnboardingFixture} from '../support/onboarding-fixture';
import type {Command} from '../../src/shared/bridge';

test('the public fixture dispatches actual module.edit after checked truth publication',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'truth-public-selection-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Owned public dispatch'}),text='y <= a nand b;\ny <= a and b;',quote='y <= a and b;',sourced=await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned source',content:text}),v=sourced.sources[0].versions[0],refs=[{sourceId:v.id,version:v.version,digest:v.digest}],doc=await core.saveArtifact(task.id,{title:'Boolean source',content:'Explore only an explicitly reviewed assignment.',sourceRefs:refs}),input={taskId:task.id,basis:{artifactId:doc.artifactId,revision:1,digest:doc.revision.digest},expectedSourceRefs:refs,sourceId:v.id,start:text.indexOf(quote),end:text.indexOf(quote)+quote.length,quote,confirmed:true as const},created=await createTruthTable(core,input);expect(await inspectTruthTable(core,input)).toMatchObject({kind:'completed',artifactId:created.artifactId});const snapshot=await core.getTask(task.id),artifact=snapshot.artifacts.find(a=>a.id===created.artifactId)!,module=parseModuleAnswer(JSON.parse(artifact.revisions[0].content)).modules[0],command:Command={type:'module.edit',taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:module.id,action:{kind:'select',rowId:'pair-11',expectedRevision:0}},calls:Command[]=[],events:unknown[]=[],fixture={core,commands:calls,emit:async(event:unknown)=>{events.push(event);}} as unknown as OnboardingFixture;
 const updated=await OnboardingFixture.prototype.invoke.call(fixture,command);expect(calls).toEqual([command]);expect(events).toEqual([{type:'changed'}]);expect(updated).toMatchObject({id:task.id,session:{moduleStates:[{artifactId:artifact.id,state:{kind:'comparison',revision:1,selectedRowId:'pair-11'}}]}});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
