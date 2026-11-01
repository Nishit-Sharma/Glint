import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath,rename,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../src/core/companion';
import {CodeWorkspaces} from '../src/host/code-workspace';
import type {CodeFolders,CodeOpened,CodeReview} from '../src/shared/code-workspace';
import {composeOrdinaryRequest} from '../src/host/ordinary-request-composition';

it('uses only the explicitly chosen physical folder instruction file for its owning task',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'glint-folder-guidance-'))),folder=join(directory,'owned-folder');await mkdir(folder);await writeFile(join(folder,'instructions.md'),'FOLDER731 Preserve exact evidence.');const core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const owner=await core.createTask({title:'Folder owner'}),other=await core.createTask({title:'Unrelated QA owner'}),workspaces=new CodeWorkspaces({directory,core,choose:async()=>folder});await core.saveComposerDraft(owner.id,0,{text:'Keep this exact draft731\n',kind:'explain'});
  const chosen=await workspaces.command({type:'code.folder.choose',taskId:owner.id}) as CodeFolders,opened=await workspaces.command({type:'code.file.open',taskId:owner.id,folderId:chosen.folders[0].id,relativePath:'instructions.md'}) as CodeOpened;
  await workspaces.command({type:'code.instructions.use',taskId:owner.id,fileId:opened.file.id,expectedRevision:0,expected:{artifactId:opened.file.artifactId,revision:opened.revision.revision,digest:opened.revision.digest}});
  const before=await core.getTask(owner.id),invalidated=await core.markResponseContextChanged(owner.id);expect(invalidated.session?.contextRevision).toBe((before.session?.contextRevision??0)+1);expect(invalidated.session?.draft).toBe(before.session?.draft);expect(invalidated.sources).toEqual(before.sources);
  const lease=await workspaces.guidanceLease(owner.id),request=composeOrdinaryRequest({prompt:'Keep this exact question.',sources:[],folderGuidance:lease.current});
  expect(JSON.parse(request.taskContext!)).toMatchObject({explicitFolderInstructions:{text:'FOLDER731 Preserve exact evidence.',folderName:'owned-folder'}});expect(request.prompt).toBe('Keep this exact question.');expect((await workspaces.guidanceLease(other.id)).current).toBeUndefined();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('rechecks edited physical instructions, preserves a queued scope until reviewed, and disables without changing inherited guidance',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'glint-folder-update-'))),folder=join(directory,'owned-folder');await mkdir(folder);await writeFile(join(folder,'instructions.md'),'FOLDER731 First version.');let core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const task=await core.createTask({title:'Folder update owner'}),options={directory,core:{getTask:(id:string)=>core.getTask(id),saveArtifact:(...args:Parameters<typeof core.saveArtifact>)=>core.saveArtifact(...args)},choose:async()=>folder};let workspaces=new CodeWorkspaces(options);
  const chosen=await workspaces.command({type:'code.folder.choose',taskId:task.id}) as CodeFolders,folderId=chosen.folders[0].id,opened=await workspaces.command({type:'code.file.open',taskId:task.id,folderId,relativePath:'instructions.md'}) as CodeOpened,expected={artifactId:opened.file.artifactId,revision:opened.revision.revision,digest:opened.revision.digest};
  await workspaces.command({type:'code.instructions.use',taskId:task.id,fileId:opened.file.id,expectedRevision:0,expected});const queued=await workspaces.guidanceLease(task.id),frozenScope=queued.scope;
  const review=await workspaces.command({type:'code.file.review',taskId:task.id,fileId:opened.file.id,expected,content:'FOLDER731 Updated during the session.'}) as CodeReview;await workspaces.command({type:'code.file.save',taskId:task.id,fileId:opened.file.id,reviewId:review.id,confirmed:'write-reviewed-file'});
  expect(()=>queued.assertCurrent()).toThrow('instructions changed');await expect(queued.check()).rejects.toThrow();const updated=await workspaces.guidanceLease(task.id);expect(updated.scope).not.toBe(frozenScope);expect(updated.current?.text).toBe('FOLDER731 Updated during the session.');expect(queued.current?.text).toBe('FOLDER731 First version.');
  const inherited={revision:1,enabled:true,text:'GLOBAL731 Keep paragraphs short.'},input={prompt:'Exact question731',sources:[],preferences:inherited,projectInstructions:{projectId:'synthetic-project',name:'Synthetic project',revision:1,text:'PROJECT731 Preserve citations.'}};
  const included=composeOrdinaryRequest({...input,folderGuidance:updated.current});expect(JSON.parse(included.taskContext!)).toMatchObject({responsePreferences:{text:inherited.text},explicitFolderInstructions:{text:'FOLDER731 Updated during the session.'}});expect(included.projectInstructions).toEqual(input.projectInstructions);
  await core.close();core=await createCompanion({dataDir:join(directory,'store')});workspaces=new CodeWorkspaces(options);expect((await workspaces.guidanceLease(task.id)).current?.text).toBe('FOLDER731 Updated during the session.');
  await workspaces.command({type:'code.instructions.disable',taskId:task.id,folderId,expectedRevision:1});const disabled=await workspaces.guidanceLease(task.id),excluded=composeOrdinaryRequest({...input,folderGuidance:disabled.current});expect(disabled.current).toBeUndefined();expect(excluded.taskContext).not.toContain('FOLDER731');expect(JSON.parse(excluded.taskContext!)).toMatchObject({responsePreferences:{text:inherited.text}});expect(excluded.projectInstructions).toEqual(input.projectInstructions);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('rejects foreign-owner, stale file, symlink and replaced-folder instruction authority',async()=>{
 const directory=await realpath(await mkdtemp(join(tmpdir(),'glint-folder-guards-'))),folder=join(directory,'owned-folder');await mkdir(folder);const path=join(folder,'instructions.md');await writeFile(path,'Original instructions731.');const core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const owner=await core.createTask({title:'Guard owner'}),other=await core.createTask({title:'Foreign owner'}),workspaces=new CodeWorkspaces({directory,core,choose:async()=>folder}),chosen=await workspaces.command({type:'code.folder.choose',taskId:owner.id}) as CodeFolders,folderId=chosen.folders[0].id,opened=await workspaces.command({type:'code.file.open',taskId:owner.id,folderId,relativePath:'instructions.md'}) as CodeOpened,expected={artifactId:opened.file.artifactId,revision:opened.revision.revision,digest:opened.revision.digest};
  await expect(workspaces.command({type:'code.instructions.use',taskId:other.id,fileId:opened.file.id,expectedRevision:0,expected})).rejects.toThrow();await expect(workspaces.command({type:'code.instructions.use',taskId:owner.id,fileId:opened.file.id,expectedRevision:1,expected})).rejects.toThrow();await workspaces.command({type:'code.instructions.use',taskId:owner.id,fileId:opened.file.id,expectedRevision:0,expected});
  const lease=await workspaces.guidanceLease(owner.id);await writeFile(path,'External edit731.');await expect(lease.check()).rejects.toThrow();await expect(workspaces.guidanceLease(owner.id)).rejects.toThrow();await rm(path);await writeFile(join(directory,'outside.md'),'Outside must stay private.');await symlink(join(directory,'outside.md'),path);await expect(workspaces.guidanceLease(owner.id)).rejects.toThrow();await rename(folder,folder+'-old');await mkdir(folder);await writeFile(path,'Replacement root731.');await expect(workspaces.guidanceLease(owner.id)).rejects.toThrow();expect((await workspaces.guidanceLease(other.id)).current).toBeUndefined();
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
