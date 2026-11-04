import {expect,test,vi} from 'vitest';
const failure=vi.hoisted(()=>({rename:false}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,rename:async(...args:Parameters<typeof fs.rename>)=>{if(failure.rename){failure.rename=false;throw Error('Owned synthetic preference write failure');}return fs.rename(...args);}};});
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {TaskViewPreferences} from '../../src/host/task-view-preferences';
import {favoriteFileViews,readFileFavoritesCommand,readFileFavoritesState} from '../../src/shared/task-view';
import {captureContentBackup,readContentBackup} from '../../src/host/content-backup';
import {parseCurrentState} from '../../src/core/store';

test('favorite saved files are durable navigation preferences, independent of task content and last-open-task selection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-file-favorites-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned favorite QA'}),saved=await core.saveArtifact(task.id,{title:'Owned saved note',content:'Synthetic favorite text.'});
  const current=await core.getTask(task.id),file=current.artifacts.find(item=>item.id===saved.artifactId)!,revision=saved.revision;
  const prefs=()=>new TaskViewPreferences(directory,async id=>(await core.listTasks()).some(task=>task.id===id),id=>core.getTask(id));
  const view=prefs();await view.select(task.id);const before=await readFile(join(directory,'tasks.json'),'utf8');
  expect(await view.readFileFavorites()).toEqual({kind:'available',revision:0,items:[]});
  const favorites=await view.changeFileFavorites({expectedRevision:0,change:{kind:'favorite',taskId:task.id,artifactId:file.id,revision:revision.revision,digest:revision.digest}});
  expect(favorites).toMatchObject({kind:'available',revision:1,items:[{taskId:task.id,artifactId:file.id,label:revision.title,reference:{revision:revision.revision,digest:revision.digest}}]});
  await view.select(null);expect(await prefs().readFileFavorites()).toEqual(favorites);expect(await prefs().read()).toEqual({kind:'available',taskId:null});
  expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
  const backup=await captureContentBackup(directory,parseCurrentState(JSON.parse(before)),'0.4.10');expect(readContentBackup(JSON.stringify(backup)).payload.files.find(file=>file.name==='task-view.json')?.content).toBe(await readFile(join(directory,'task-view.json'),'utf8'));
  const removed=await view.changeFileFavorites({expectedRevision:1,change:{kind:'unfavorite',taskId:task.id,artifactId:file.id,revision:revision.revision,digest:revision.digest}});expect(removed).toEqual({kind:'available',revision:2,items:[]});expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('exact current version and preference CAS reject stale changes; missing favorites are metadata-only clearable',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-file-favorites-guards-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned stable identity'}),saved=await core.saveArtifact(task.id,{title:'Original file label',content:'Original saved text.'}),view=new TaskViewPreferences(directory,async id=>(await core.listTasks()).some(task=>task.id===id),id=>core.getTask(id));
  const change={kind:'favorite' as const,taskId:task.id,artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest};
  await view.changeFileFavorites({expectedRevision:0,change});const favorite=readFileFavoritesState(await view.readFileFavorites());expect(favorite.kind).toBe('available');if(favorite.kind!=='available')throw Error('Fixture favorites unavailable');
  const next=await core.saveArtifact(task.id,{artifactId:saved.artifactId,expectedRevision:1,title:'Renamed current file',content:'A later saved revision.'});const bytes=await readFile(join(directory,'task-view.json'),'utf8');
  await expect(view.changeFileFavorites({expectedRevision:1,change:{...change,kind:'unfavorite'}})).rejects.toThrow(/changed/);
  await expect(view.changeFileFavorites({expectedRevision:0,change:{...change,revision:2,digest:next.revision.digest}})).rejects.toThrow(/Reload/);
  expect(await readFile(join(directory,'task-view.json'),'utf8')).toBe(bytes);
  const views=favoriteFileViews(await core.listTasks(),favorite.items);expect(views[0].favorite.label).toBe('Original file label');expect(views[0].match).toMatchObject({title:'Renamed current file',revision:2,digest:next.revision.digest});
  await expect(view.changeFileFavorites({expectedRevision:1,change:{kind:'clear-unavailable',taskId:task.id,artifactId:saved.artifactId}})).rejects.toThrow(/available again/);
  await core.deleteTask(task.id);expect(favoriteFileViews(await core.listTasks(),favorite.items)[0].unavailable).toContain('no longer available');
  expect(await view.changeFileFavorites({expectedRevision:1,change:{kind:'clear-unavailable',taskId:task.id,artifactId:saved.artifactId}})).toEqual({kind:'available',revision:2,items:[]});expect(await core.listTasks()).toEqual([]);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('strict unfamiliar documents and failed preference publication preserve bytes and existing selection',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-file-favorites-failure-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned failure QA'}),saved=await core.saveArtifact(task.id,{title:'Kept file',content:'Kept bytes.'}),view=new TaskViewPreferences(directory,async id=>id===task.id,id=>core.getTask(id)),change={expectedRevision:0,change:{kind:'favorite' as const,taskId:task.id,artifactId:saved.artifactId,revision:1,digest:saved.revision.digest}};
  await view.select(task.id);const bytes=await readFile(join(directory,'task-view.json'),'utf8');failure.rename=true;await expect(view.changeFileFavorites(change)).rejects.toThrow();expect(await readFile(join(directory,'task-view.json'),'utf8')).toBe(bytes);
  for(const raw of ['{broken',JSON.stringify({schemaVersion:1,taskId:task.id,futureAuthority:true})]){await writeFile(join(directory,'task-view.json'),raw);expect(await view.readFileFavorites()).toMatchObject({kind:'unavailable'});expect(await view.changeFileFavorites(change)).toMatchObject({kind:'unavailable'});expect(await view.select(null)).toMatchObject({kind:'unavailable'});expect(await readFile(join(directory,'task-view.json'),'utf8')).toBe(raw);}
  expect(()=>readFileFavoritesCommand({type:'file-favorites.get',extra:true})).toThrow();expect(()=>readFileFavoritesCommand({type:'file-favorites.change',...change,change:{...change.change,digest:'wrong'}})).toThrow();
 }
 finally{failure.rename=false;await core.close();await rm(directory,{recursive:true,force:true});}
});

test('the canonical 500-character Unicode file title remains an exact durable favorite label',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-file-favorites-title-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned title boundary'}),label='界'.repeat(500),saved=await core.saveArtifact(task.id,{title:label,content:'Synthetic title boundary content.'}),open=()=>new TaskViewPreferences(directory,async id=>id===task.id,id=>core.getTask(id)),view=open();
  const before=await readFile(join(directory,'tasks.json'),'utf8');
  const favorites=await view.changeFileFavorites({expectedRevision:0,change:{kind:'favorite',taskId:task.id,artifactId:saved.artifactId,revision:1,digest:saved.revision.digest}});
  expect(favorites).toMatchObject({kind:'available',revision:1,items:[{label}]});expect(await open().readFileFavorites()).toEqual(favorites);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
  await expect(core.saveArtifact(task.id,{title:label+'界',content:'Over the existing artifact limit.'})).rejects.toThrow();expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
 }
 finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
