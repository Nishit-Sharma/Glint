import {expect,test,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {composeOrdinaryRequest} from '../../src/host/ordinary-request-composition';
import {reconcileTaskResponseModes} from '../../src/shared/task-response-mode';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test.each(['raw','scoped'] as const)('preserves historical %s ordinary replay after reopen and a later Plan choice without rerunning or rewriting data',async format=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-plan-replay-'));let core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'Legacy ordinary'}),input={taskId:task.id,requestId:'legacy-saved',kind:'explain',prompt:'Original ordinary question'};await core.saveComposerDraft(task.id,0,{text:'Keep unsent question',kind:'create'});await core.runRequest(input,async()=>({title:'Original answer',content:'Saved original ordinary bytes'}));await core.close();
  const path=join(directory,'tasks.json'),state=JSON.parse(await readFile(path,'utf8')),record=state.tasks[0].requests[0];delete record.responseMode;record.digest=hash(format==='raw'?input:{...input,sourceRefs:[]});await writeFile(path,JSON.stringify(state));
  core=await createCompanion({dataDir:directory});await core.setTaskResponseMode(task.id,0,'plan');const before=await readFile(path,'utf8'),runner=vi.fn(async()=>({title:'Must not run',content:'Must not run'}));
  const saved=await core.runRequest(input,runner);expect(saved).toEqual(record);expect(runner).not.toHaveBeenCalled();expect(await readFile(path,'utf8')).toBe(before);expect((await core.getTask(task.id)).session?.responseMode?.mode).toBe('plan');
  await expect(core.runRequest({...input,responseMode:'plan'},runner)).rejects.toThrow(/different payload|source scope/);expect(runner).not.toHaveBeenCalled();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('replaying a newly recorded Plan response preserves its original mode after the task switches to Ordinary',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-plan-idempotent-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Pinned Plan'});await core.setTaskResponseMode(task.id,0,'plan');const input={taskId:task.id,requestId:'saved-plan',kind:'explain',prompt:'Plan this question',sourceIds:[]};const saved=await core.runRequest(input,async()=>({title:'Plan',content:'Saved'}));await core.setTaskResponseMode(task.id,1,'ordinary');const runner=vi.fn(async()=>({title:'Never',content:'Never'}));expect(await core.runRequest(input,runner)).toEqual(saved);expect(runner).not.toHaveBeenCalled();await expect(core.runRequest({...input,responseMode:'ordinary'},runner)).rejects.toThrow(/different payload/);}finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test.each(['ordinary','plan'] as const)('existing folder-only scope supports %s ordinary responses while preserving the user prompt and guidance',async mode=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-plan-folder-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Folder question'}),executionScope='folder-instructions:v1:'+'a'.repeat(64),folderGuidance={folderId:'folder',fileId:'file',selectionRevision:1,folderName:'Owned folder',relativePath:'instructions.md',reference:{artifactId:'instructions',revision:1,digest:'b'.repeat(64)},text:'Keep this exact folder guidance.'};const result=await core.runRequest({taskId:task.id,requestId:mode,kind:'explain',prompt:'Original question',sourceIds:[],responseMode:mode,executionScope},async context=>{expect(context.responseMode).toBe(mode);const composed=composeOrdinaryRequest({prompt:'Original question',sources:[],taskHistory:context.taskHistory,responseMode:context.responseMode,folderGuidance});expect(JSON.parse(composed.taskContext!).explicitFolderInstructions.text).toBe(folderGuidance.text);expect(composed.prompt.includes('Plan mode')).toBe(mode==='plan');return {title:'Synthetic response',content:'No external request'};});expect(result.responseMode).toBe(mode);expect(result.prompt).toBe('Original question');}finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('specialized and unrecognized execution scopes do not inherit Plan or accept a claimed ordinary mode',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-plan-scope-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Scope guard'});await core.setTaskResponseMode(task.id,0,'plan');for(const executionScope of ['recurring-response:v1:reviewed','unrecognized','folder-instructions:v1:unbound']){await expect(core.runRequest({taskId:task.id,requestId:executionScope,kind:'explain',prompt:'Retain original path',sourceIds:[],responseMode:'plan',executionScope},async()=>({title:'Never',content:'Never'}))).rejects.toThrow(/ordinary|mode/);}}finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('mode-only acknowledgement retains coherent old session contents and CAS revision until a canonical read',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-plan-cas-')),core=await createCompanion({dataDir:directory});try{const created=await core.createTask({title:'CAS task'}),before=await core.getTask(created.id),saved=await core.setTaskResponseMode(created.id,0,'plan'),merged=reconcileTaskResponseModes([before],[saved])[0];expect(merged.session?.revision).toBe(before.session?.revision??0);expect(merged.session?.responseMode).toEqual(saved.session?.responseMode);await expect(core.replaceSession(created.id,merged.session!.revision,merged.session!)).rejects.toThrow(/changed|conflict|revision/i);const canonical=await core.getTask(created.id);expect(canonical.session?.revision).toBe(saved.session?.revision);expect((await core.replaceSession(created.id,canonical.session!.revision,canonical.session!)).responseMode).toEqual(saved.session?.responseMode);}finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
