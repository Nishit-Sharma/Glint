import {publicErrorMessage,RESPONSE_BRANCH_IMAGE_LIMIT} from '../src/shared/public-messages';
import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {responseBranchSnapshot} from '../src/core/response-branch';

test('creates an independent reviewed text-context branch once without changing the original unsent draft',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'response-branch-')),core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'Original work'});await core.runRequest({taskId:task.id,requestId:'first',kind:'explain',prompt:'Explain the first approach.',sourceIds:[]},async()=>({title:'First response',content:'Keep this exact saved answer.',mimeType:'text/markdown'}));await core.saveComposerDraft(task.id,0,{text:'Unsent original follow-up',kind:'explain'});const before=await core.getTask(task.id),selection={taskId:task.id,requestId:'first',answer:before.requests[0].answer!},snapshot=responseBranchSnapshot(before,selection),input={...selection,title:'Alternative approach',expectedSnapshot:snapshot.content};
  const branch=await core.branchFromResponse(input,'owned-bot');expect(branch.kind).toBe('text');expect(branch.task.id).not.toBe(task.id);expect(branch.task.sources[0].versions[0].content).toBe(snapshot.content);expect(branch.task.requests).toEqual([]);expect(branch.task.actions).toEqual([]);expect(branch.task.session?.browserContext).toBeUndefined();expect(await core.getTask(task.id)).toEqual(before);expect((await core.branchFromResponse(input,'other-default')).task.id).toBe(branch.task.id);expect(await core.listTasks()).toHaveLength(2);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

async function withOriginal(check:(core:Awaited<ReturnType<typeof createCompanion>>,directory:string,input:ReturnType<typeof branchInput>)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'response-branch-contract-'));let core=await createCompanion({dataDir:directory});
 try{const task=await core.createTask({title:'Original task'});await core.runRequest({taskId:task.id,requestId:'answer-1',kind:'explain',prompt:'First question',sourceIds:[]},async()=>({title:'Original answer',content:'Exact first response',mimeType:'text/markdown'}));await check(core,directory,branchInput(await core.getTask(task.id)));}finally{await core.close();await rm(directory,{recursive:true,force:true});}
}
function branchInput(task:import('../src/core/types').Task){const selection={taskId:task.id,requestId:'answer-1',answer:task.requests.find(request=>request.id==='answer-1')!.answer!};return {...selection,title:'A different approach',expectedSnapshot:responseBranchSnapshot(task,selection).content};}

test('concurrent choices and reordered closed input reopen one receipt while a different name creates another',()=>withOriginal(async(core,_directory,input)=>{
 const reordered={expectedSnapshot:input.expectedSnapshot,title:input.title,answer:{digest:input.answer.digest,revision:input.answer.revision,artifactId:input.answer.artifactId},requestId:input.requestId,taskId:input.taskId};
 const [a,b]=await Promise.all([core.branchFromResponse(input,'first-bot'),core.branchFromResponse(reordered,'second-bot')]);expect(a.task.id).toBe(b.task.id);expect(b.task.assignedBotId).toBe('first-bot');
 expect((await core.branchFromResponse({...input,title:' Another name '},'first-bot')).task.id).not.toBe(a.task.id);expect(await core.listTasks()).toHaveLength(3);
}));
test('the selected exact response is copied after a later artifact edit and excludes later messages and source bodies',()=>withOriginal(async(core,_directory,input)=>{
 await core.putSource(input.taskId,{kind:'text',label:'Private linked body',role:'fact',content:'SOURCE BODY MUST NOT COPY'});
 await core.saveArtifact(input.taskId,{artifactId:input.answer.artifactId,expectedRevision:input.answer.revision,title:'Edited answer',content:'LATER EDIT MUST NOT COPY'});
 await core.runRequest({taskId:input.taskId,requestId:'later',kind:'explain',prompt:'LATER QUESTION MUST NOT COPY',sourceIds:[]},async()=>({title:'Later',content:'LATER ANSWER MUST NOT COPY'}));
 const snapshot=responseBranchSnapshot(await core.getTask(input.taskId),input);expect(snapshot.content).toBe(input.expectedSnapshot);expect(snapshot.content).toContain('Exact first response');expect(snapshot.content).not.toMatch(/MUST NOT COPY/);
 const branch=await core.branchFromResponse(input,'bot');expect(branch.task.sources[0].versions[0].content).toBe(input.expectedSnapshot);
}));
test('changed source title, forged revision, unknown fields and copied text fail before any creation or ledger write',()=>withOriginal(async(core,directory,input)=>{
 const {readFile}=await import('node:fs/promises'),path=join(directory,'tasks.json');
 for(const invalid of [{...input,answer:{...input.answer,revision:2}},{...input,expectedSnapshot:input.expectedSnapshot+'forged'}, {...input,permissions:['capture']}]){const before=await readFile(path);await expect(core.branchFromResponse(invalid,'bot')).rejects.toThrow();expect(await readFile(path)).toEqual(before);}
 await core.updateTask(input.taskId,{title:'Renamed after review'});const before=await readFile(path);await expect(core.branchFromResponse(input,'bot')).rejects.toThrow('changed');expect(await readFile(path)).toEqual(before);
}));
test('source deletion queued before creation is checked in the atomic commit; existing branch survives source deletion',()=>withOriginal(async(core,_directory,input)=>{
 const branch=await core.branchFromResponse(input,'bot');const deletion=core.deleteTask(input.taskId),fresh=core.branchFromResponse({...input,title:'Must not create'},'bot');await deletion;await expect(fresh).rejects.toThrow();expect((await core.branchFromResponse(input,'new-default')).task.id).toBe(branch.task.id);expect(await core.listTasks()).toHaveLength(1);
}));
test('reopen preserves the receipt, current branch edits and independent deletion without resurrection',()=>withOriginal(async(core,directory,input)=>{
 const branch=await core.branchFromResponse(input,'bot');if(branch.kind!=='text')throw Error('Expected text');await core.putSource(branch.task.id,{id:branch.sourceId,kind:'text',role:'fact',label:'Edited context',content:'User changed this independent task'});await core.close();
 const reopened=await createCompanion({dataDir:directory});try{const same=await reopened.branchFromResponse(input,'new-default');expect(same.task.id).toBe(branch.task.id);expect(same.task.sources[0].versions.at(-1)?.content).toBe('User changed this independent task');await reopened.deleteTask(branch.task.id);await expect(reopened.branchFromResponse(input,'bot')).rejects.toThrow('already used');expect((await reopened.getTask(input.taskId)).id).toBe(input.taskId);}finally{await reopened.close();}
}));
test('lifecycle scope is checked on replay as well as new creation',()=>withOriginal(async(core,_directory,input)=>{
 await core.branchFromResponse(input,'bot');await expect(core.branchFromResponse(input,'bot',()=>{throw Error('Owner left');})).rejects.toThrow('Owner left');await expect(core.branchFromResponse({...input,title:'Other'},'bot',()=>{throw Error('Owner left');})).rejects.toThrow('Owner left');expect(await core.listTasks()).toHaveLength(2);
}));
test('unsupported selected answers and oversized snapshots refuse while earlier omitted replies are explicit',()=>withOriginal(async(core,_directory,input)=>{
 const task=await core.getTask(input.taskId),unsupported=structuredClone(task);unsupported.artifacts[0].revisions[0].mimeType='application/json';expect(()=>responseBranchSnapshot(unsupported,input)).toThrow('saved text');
 const oversized=structuredClone(task);oversized.requests[0].prompt='q'.repeat(100_000);expect(()=>responseBranchSnapshot(oversized,input)).toThrow('exceeds');
 const mixed=structuredClone(task);mixed.requests.unshift({...mixed.requests[0],id:'earlier-failure',status:'failed',prompt:'Earlier failed question',answer:undefined});const snapshot=responseBranchSnapshot(mixed,input);expect(snapshot.omissions).toContain('Turn 1: the request did not complete; its response is omitted.');expect(snapshot.content).toContain('[No completed readable text response copied.]');expect(snapshot.turns).toBe(2);
}));

// A raw data-image marker is refused before any historical answer projection can partially replace it.
for(const [form,image] of [['standard','data:image/png;base64,aGVsbG8='],['percent-encoded','data:image/png;base64,aGVs%62G8='],['line-wrapped','data:image/png;base64,aGVs\nbG8='],['extra-parameter','data:image/png;charset=utf-8;base64,aGVsbG8=']] as const){
 for(const location of ['title','prompt','answer'] as const){
  test(`raw ${form} image data in ${location} refuses preview and creation with original/store bytes intact`,()=>withOriginal(async(core,directory,input)=>{
   const secret='PRIVATE_IMAGE_SUFFIX',value='Before '+image+' after '+secret;if(location==='title')await core.updateTask(input.taskId,{title:value});
   await core.runRequest({taskId:input.taskId,requestId:'image-input',kind:'explain',prompt:location==='prompt'?value:'Readable saved question',sourceIds:[]},async()=>({title:'Readable answer',content:location==='answer'?value:'Readable saved answer',mimeType:'text/markdown'}));
   const original=await core.getTask(input.taskId),selection={taskId:original.id,requestId:'image-input',answer:original.requests.at(-1)!.answer!};let error:unknown;try{responseBranchSnapshot(original,selection);}catch(caught){error=caught;}expect(error).toBeInstanceOf(Error);expect(String(error)).toContain('embedded image data');expect(String(error)).not.toContain(secret);expect(publicErrorMessage(error)).toBe(RESPONSE_BRANCH_IMAGE_LIMIT);
   const {readFile}=await import('node:fs/promises'),before=await readFile(join(directory,'tasks.json'));await expect(core.branchFromResponse({...selection,title:'Must not create',expectedSnapshot:'Must be refused'},'bot')).rejects.toThrow('embedded image data');expect(await readFile(join(directory,'tasks.json'))).toEqual(before);expect(await core.getTask(original.id)).toEqual(original);expect(await core.listTasks()).toHaveLength(1);
  }));
 }
}

test('an earlier image-bearing turn blocks a later clean response while the explicit earlier-response recovery still creates exact reviewed text',()=>withOriginal(async(core,directory,input)=>{
 await core.runRequest({taskId:input.taskId,requestId:'image-earlier',kind:'explain',prompt:'Earlier data:image/png;base64,aGVs\nbG8= private suffix',sourceIds:[]},async()=>({title:'Earlier reply',content:'Earlier data:image/png;base64,aGVs%62G8= private suffix',mimeType:'text/markdown'}));await core.runRequest({taskId:input.taskId,requestId:'clean-later',kind:'explain',prompt:'Later clean question',sourceIds:[]},async()=>({title:'Clean reply',content:'Later clean answer',mimeType:'text/markdown'}));
 const original=await core.getTask(input.taskId),selection={taskId:original.id,requestId:'clean-later',answer:original.requests.at(-1)!.answer!},{readFile}=await import('node:fs/promises'),before=await readFile(join(directory,'tasks.json'));expect(()=>responseBranchSnapshot(original,selection)).toThrow(RESPONSE_BRANCH_IMAGE_LIMIT);await expect(core.branchFromResponse({...selection,title:'Must not create',expectedSnapshot:'Must be refused'},'bot')).rejects.toThrow(RESPONSE_BRANCH_IMAGE_LIMIT);expect(await readFile(join(directory,'tasks.json'))).toEqual(before);expect(publicErrorMessage(new Error(RESPONSE_BRANCH_IMAGE_LIMIT+' private suffix'))).not.toContain('private suffix');
 const snapshot=responseBranchSnapshot(original,input);expect(snapshot.content).toBe(input.expectedSnapshot);const saved=await core.branchFromResponse(input,'bot');expect(saved.task.sources[0].versions[0].content).toBe(snapshot.content);expect(await core.getTask(input.taskId)).toEqual(original);
}));
