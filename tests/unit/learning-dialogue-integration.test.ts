import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion,type Companion} from '../../src/core/companion';
import {editModule} from '../../src/core/module-state';
import {projectTaskDialogue,readTaskArtifactText} from '../../src/core/task-dialogue';
import {taskContext} from '../../src/host/browser/coordinator';
import {exampleLesson} from '../../src/learning/example';
import type {JoinAction} from '../../src/learning/join-lab';
import {helperStudio} from '../../src/learning/reusable-helper';
import {MODULE_MIME} from '../../src/shared/module-contract';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'learning-dialogue-')),core=await createCompanion({dataDir:directory});cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});return core;}

async function lesson(core:Companion){
 const task=await core.createTask({title:'Join practice'}),data=structuredClone(exampleLesson);
 data.transfer.title='UNSEEN_TRANSFER_SENTINEL';
 const output=await core.runRequest({taskId:task.id,requestId:'lesson',kind:'create',prompt:'Let me practice a join.',sourceIds:[]},async()=>({title:data.title,mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'A local join example.',modules:[{id:'join',version:1,data,provenance:[]}]})}));
 return {taskId:task.id,artifactId:output.artifactId!};
}

it('ordinary history, revision projection and browser history hide future transfer data until its stage begins',async()=>{
 const core=await fixture(),{taskId,artifactId}=await lesson(core);
 const before=await core.getTask(taskId),readable=readTaskArtifactText(before,artifactId,1);
 expect(readable).toMatchObject({available:true,text:expect.stringContaining('Members and invitations')});
 for(const text of [JSON.stringify(readable),projectTaskDialogue(before,'next',[]),taskContext(before,'next')])expect(text).not.toContain('UNSEEN_TRANSFER_SENTINEL');
 const action=async(value:JoinAction)=>editModule(core,{taskId,artifactId,artifactRevision:1,moduleId:'join',action:value});
 await action({kind:'predict',count:2,reasoning:'One left key matches two right rows.',expectedRevision:0});
 await action({kind:'edit-row',side:'left',rowId:'practice-b',values:['x','blue'],expectedRevision:1});
 await action({kind:'predict',count:4,reasoning:'Two left rows each have two matches.',expectedRevision:2});
 await action({kind:'start-transfer',expectedRevision:3});
 const during=await core.getTask(taskId);
 for(const text of [JSON.stringify(readTaskArtifactText(during,artifactId,1)),projectTaskDialogue(during,'next',[]),taskContext(during,'next')]){
  expect(text).toContain('UNSEEN_TRANSFER_SENTINEL');
  expect(text).not.toContain('Paired row identities (6)');
  expect(text).not.toContain('"transfer":{');
 }
});

it('the helper readable observation includes the actual input, active version and deterministic outcome',()=>{
 const data={kind:'helper-studio',schemaVersion:1,id:'label',title:'Clean label',description:'Preserve protected labels.'};
 let state=helperStudio.initial(data);
 const send=(value:Record<string,unknown>)=>{state=helperStudio.update(data,state,{...value,expectedRevision:state.revision});};
 send({kind:'append-operation',operation:{kind:'trim'}});
 send({kind:'add-test',test:{id:'example',label:'Ordinary',role:'example',input:'  Dock  ',expected:{kind:'output',text:'Dock'}}});
 send({kind:'add-exception',exception:{id:'keep',contains:'KEEP:',behavior:'preserve',reason:'Keep protected spacing.'}});
 send({kind:'add-test',test:{id:'protected',label:'Protected',role:'counterexample',input:'KEEP:  Dock ',expected:{kind:'output',text:'KEEP:  Dock '}}});
 send({kind:'save-version',changeNote:'Tested trim with protected labels.'});
 send({kind:'activate-version',version:1});
 send({kind:'run-active',input:'KEEP:  New Dock '});
 const text=helperStudio.text(data,state);
 expect(text).toContain('Last run used version 1');
 expect(text).toContain('KEEP:  New Dock ');
 expect(text).toContain('Applied exception reason');
 expect(text).toContain('Keep protected spacing.');
 expect(text).not.toContain('exceptionId');
});
