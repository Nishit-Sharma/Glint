import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TaskViewPreferences} from '../../src/host/task-view-preferences';
import {restoreTaskView} from '../../src/shared/task-view';

const directories:string[]=[];
afterEach(async()=>{for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'task-view-'));directories.push(directory);const tasks=new Set(['a','b']);return {directory,tasks,open:()=>new TaskViewPreferences(directory,async id=>tasks.has(id))};}
it('first open reads no task and restarting restores only the selected pointer',async()=>{
 const f=await fixture(),prefs=f.open();expect(await prefs.read()).toEqual({kind:'available',taskId:null});await expect(readFile(join(f.directory,'task-view.json'))).rejects.toMatchObject({code:'ENOENT'});
 await prefs.select('b');expect(await f.open().read()).toEqual({kind:'available',taskId:'b'});expect(JSON.parse(await readFile(join(f.directory,'task-view.json'),'utf8'))).toEqual({schemaVersion:1,taskId:'b'});expect(restoreTaskView([{id:'a'},{id:'b'}],await f.open().read())).toEqual({id:'b'});
});
it('deleted tasks recover honestly and cannot be persisted as an arbitrary missing owner',async()=>{
 const f=await fixture(),prefs=f.open();await prefs.select('b');f.tasks.delete('b');expect(await f.open().read()).toMatchObject({kind:'missing',taskId:null});expect(restoreTaskView([{id:'a'}],await prefs.read())).toBeUndefined();await expect(prefs.select('nonexistent')).rejects.toThrow('no longer available');expect(JSON.parse(await readFile(join(f.directory,'task-view.json'),'utf8')).taskId).toBe('b');await prefs.select('a');expect(await prefs.read()).toEqual({kind:'available',taskId:'a'});
});
it.each(['{broken',JSON.stringify({schemaVersion:2,taskId:'b'}),JSON.stringify({schemaVersion:1,taskId:'b',futureImportant:'preserve'}),JSON.stringify({schemaVersion:1,taskId:17})])('preserves corrupt or unfamiliar preferences without overwriting their bytes',async raw=>{
 const f=await fixture();await writeFile(join(f.directory,'task-view.json'),raw);const prefs=f.open();expect(await prefs.read()).toMatchObject({kind:'unavailable',taskId:null});expect(await prefs.select('a')).toMatchObject({kind:'unavailable'});expect(await readFile(join(f.directory,'task-view.json'),'utf8')).toBe(raw);
});
it('serializes rapid selection saves even when the first owner check is slow',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(resolve=>entered=resolve),held=new Promise<void>(resolve=>release=resolve);let calls=0;
 const prefs=new TaskViewPreferences(f.directory,async id=>{if(++calls===1){entered();await held;}return f.tasks.has(id);});const a=prefs.select('a');await ready;const b=prefs.select('b');release();await Promise.all([a,b]);expect(await f.open().read()).toEqual({kind:'available',taskId:'b'});
});
