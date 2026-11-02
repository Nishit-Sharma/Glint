import {afterEach,expect,test,vi} from 'vitest';
const fault=vi.hoisted(()=>({rename:false}));
vi.mock('node:fs/promises',async original=>{const fs=await original<typeof import('node:fs/promises')>();return {...fs,rename:async(...args:Parameters<typeof fs.rename>)=>{if(fault.rename){fault.rename=false;throw Error('Owned section publication failure');}return fs.rename(...args);}};});
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {TaskViewPreferences} from '../src/host/task-view-preferences';
import {captureContentBackup,readContentBackup} from '../src/host/content-backup';
import {parseCurrentState} from '../src/core/store';
import {readTaskSectionChange,readTaskSectionsCommand,readTaskSectionsSaved,type TaskSectionChange} from '../src/shared/task-sections';
const directories:string[]=[];
afterEach(async()=>{fault.rename=false;for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function directory(){const value=await mkdtemp(join(tmpdir(),'glint-sidebar-sections-'));directories.push(value);return value;}

test('real task section operations persist independently of tasks, projects, content, pins, favorites and backup data',async()=>{
 const dir=await directory(),core=await createCompanion({dataDir:dir});
 try{
  const a=await core.createTask({title:'Owned section task A',goal:'Keep the original goal'}),b=await core.createTask({title:'Owned section task B'}),file=await core.saveArtifact(a.id,{title:'Kept original file',content:'Exact original file text'});
  const open=()=>new TaskViewPreferences(dir,async id=>(await core.listTasks()).some(task=>task.id===id),id=>core.getTask(id),async()=>(await core.listTasks()).map(task=>task.id)),view=open();
  await view.select(a.id);await view.setPinned(a.id,true);await view.changeFileFavorites({expectedRevision:0,change:{kind:'favorite',taskId:a.id,artifactId:file.artifactId,revision:1,digest:file.revision.digest}});await view.changeLibraryPins({expectedRevision:0,change:{kind:'pin',taskId:a.id,artifactId:file.artifactId,revision:1,digest:file.revision.digest}});
  const beforeCore=await readFile(join(dir,'tasks.json'),'utf8'),pins=await readFile(join(dir,'task-pins.json'),'utf8'),originalView=JSON.parse(await readFile(join(dir,'task-view.json'),'utf8'));
  expect(await view.readTaskSections()).toEqual({kind:'available',revision:0,sections:[],unavailableTaskIds:[]});
  let revision=0;const change=async(value:TaskSectionChange['change'])=>{const result=await view.changeTaskSections({expectedRevision:revision,change:value});expect(result.kind).toBe('available');if(result.kind!=='available')throw Error('Owned section fixture unavailable');revision=result.revision;return result;};
  await change({kind:'create',sectionId:'research',name:'Research Ω',taskId:a.id});await change({kind:'create',sectionId:'client',name:'Client work'});await change({kind:'move',taskId:b.id,sectionId:'research'});await change({kind:'rename',sectionId:'research',name:'Review Ω'});await change({kind:'move',taskId:a.id,sectionId:'client'});
  const arranged=await open().readTaskSections();expect(arranged).toEqual({kind:'available',revision:5,sections:[{id:'research',name:'Review Ω',taskIds:[b.id]},{id:'client',name:'Client work',taskIds:[a.id]}],unavailableTaskIds:[]});
  await view.select(b.id);expect(await open().readTaskSections()).toEqual(arranged);
  await change({kind:'move',taskId:b.id,sectionId:null});await change({kind:'move',taskId:b.id,sectionId:'client'});await change({kind:'remove',sectionId:'client'});
  expect(await open().readTaskSections()).toEqual({kind:'available',revision:8,sections:[{id:'research',name:'Review Ω',taskIds:[]}],unavailableTaskIds:[]});
  const saved=JSON.parse(await readFile(join(dir,'task-view.json'),'utf8'));expect({...saved,taskId:originalView.taskId,sidebarSections:undefined}).toEqual({...originalView,sidebarSections:undefined});expect(saved.taskId).toBe(b.id);expect((await stat(join(dir,'task-view.json'))).mode&0o777).toBe(0o600);
  expect(await readFile(join(dir,'task-pins.json'),'utf8')).toBe(pins);expect(await readFile(join(dir,'tasks.json'),'utf8')).toBe(beforeCore);
  const backup=readContentBackup(JSON.stringify(await captureContentBackup(dir,parseCurrentState(JSON.parse(beforeCore)),'0.4.10')));expect(backup.payload.files.find(item=>item.name==='task-view.json')?.content).toBe(await readFile(join(dir,'task-view.json'),'utf8'));
 }finally{await core.close();}
});

test('CAS and one shared view writer preserve concurrent task selection and all arbitrary task IDs',async()=>{
 const dir=await directory(),ids=new Set(Array.from({length:75},(_,index)=>'task-'+index)),view=new TaskViewPreferences(dir,async id=>ids.has(id),undefined,async()=>[...ids]);
 await Promise.all([view.changeTaskSections({expectedRevision:0,change:{kind:'create',sectionId:'all',name:'Whole corpus',taskId:'task-74'}}),view.select('task-0')]);
 expect(await view.read()).toEqual({kind:'available',taskId:'task-0'});expect(await view.readTaskSections()).toMatchObject({revision:1,sections:[{taskIds:['task-74']}]});
 const before=await readFile(join(dir,'task-view.json'),'utf8');await expect(view.changeTaskSections({expectedRevision:0,change:{kind:'rename',sectionId:'all',name:'Stale'}})).rejects.toThrow('Reload');expect(await readFile(join(dir,'task-view.json'),'utf8')).toBe(before);
 await expect(view.changeTaskSections({expectedRevision:1,change:{kind:'move',taskId:'not-owned',sectionId:'all'}})).rejects.toThrow('no longer available');
 ids.delete('task-74');expect(await view.readTaskSections()).toMatchObject({revision:1,unavailableTaskIds:['task-74'],sections:[{taskIds:['task-74']}]});expect(await readFile(join(dir,'task-view.json'),'utf8')).toBe(before);
 await view.changeTaskSections({expectedRevision:1,change:{kind:'remove',sectionId:'all'}});expect(await view.readTaskSections()).toMatchObject({revision:2,sections:[]});expect(ids.size).toBe(74);
});

test('failed publication and retired lifecycle preserve exact prior bytes; an acknowledged no-op does not advance revision',async()=>{
 const dir=await directory(),view=new TaskViewPreferences(dir,async()=>true);await view.select('owned');const before=await readFile(join(dir,'task-view.json'),'utf8'),change={expectedRevision:0,change:{kind:'create' as const,sectionId:'one',name:'One'}};
 fault.rename=true;await expect(view.changeTaskSections(change)).rejects.toThrow('publication');expect(await readFile(join(dir,'task-view.json'),'utf8')).toBe(before);
 let checks=0;await expect(view.changeTaskSections(change,()=>{if(++checks===3)throw Error('Retired lifecycle');})).rejects.toThrow('Retired');expect(await readFile(join(dir,'task-view.json'),'utf8')).toBe(before);
 await view.changeTaskSections(change);const saved=await readFile(join(dir,'task-view.json'),'utf8');await view.changeTaskSections({expectedRevision:1,change:{kind:'rename',sectionId:'one',name:'One'}});expect(await readFile(join(dir,'task-view.json'),'utf8')).toBe(saved);
});

test('strict closed commands and unfamiliar or corrupt namespaces fail without overwriting saved bytes',async()=>{
 const dir=await directory(),view=new TaskViewPreferences(dir,async()=>true);
 for(const raw of ['{broken',JSON.stringify({schemaVersion:1,taskId:'owned',futureAuthority:true}),JSON.stringify({schemaVersion:1,taskId:'owned',sidebarSections:{revision:1,sections:[{id:'one',name:'One',taskIds:['a','a']}]}})]){
  await writeFile(join(dir,'task-view.json'),raw);expect(await view.readTaskSections()).toMatchObject({kind:'unavailable'});expect(await view.changeTaskSections({expectedRevision:0,change:{kind:'create',sectionId:'new',name:'New'}})).toMatchObject({kind:'unavailable'});expect(await view.select(null)).toMatchObject({kind:'unavailable'});expect(await readFile(join(dir,'task-view.json'),'utf8')).toBe(raw);
 }
 expect(readTaskSectionsCommand({type:'task-sections.get'})).toEqual({type:'task-sections.get'});
 for(const value of [{type:'task-sections.get',taskId:'foreign'},{type:'task-sections.remove'},{type:'task-sections.change',expectedRevision:0,change:{kind:'create',sectionId:'one',name:' One '}},{type:'task-sections.change',expectedRevision:0,change:{kind:'remove',sectionId:'one',deleteTasks:true}}])expect(()=>readTaskSectionsCommand(value)).toThrow();
 expect(()=>readTaskSectionChange({expectedRevision:-1,change:{kind:'remove',sectionId:'one'}})).toThrow();expect(()=>readTaskSectionsSaved({revision:1,sections:[{id:'one',name:'One',taskIds:['a']},{id:'two',name:'Two',taskIds:['a']}]})).toThrow();
});
