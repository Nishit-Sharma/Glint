import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion,type Companion} from '../src/core/companion';
import {defaultReadingPreferences,readReadingCommand} from '../src/shared/reading-view';
const directories:string[]=[],cores:Companion[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
it('saves reading preferences in the same owner state, rejects stale changes, and preserves task work through reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-reading-'));directories.push(directory);let core=await createCompanion({dataDir:directory});cores.push(core);
 const task=await core.createTask({title:'Reading owner',goal:'Synthetic'}),other=await core.createTask({title:'Other owner',goal:'Untouched'});
 await core.saveComposerDraft(task.id,0,{text:'Unsent reading owner draft731\n',kind:'explain'});await core.putSource(task.id,{kind:'text',label:'Saved notes',content:'Saved source731',role:'fact'});await core.saveArtifact(task.id,{title:'Saved reading',content:'Exact saved body731',mimeType:'text/markdown',sourceRefs:[]});
 const before=await core.getTask(task.id),otherBefore=await core.getTask(other.id),options={textSize:30 as const,lineSpacing:2.2 as const,theme:'contrast' as const,focus:'passage' as const};
 expect(await core.getReadingPreferences(task.id)).toEqual(defaultReadingPreferences());const results=await Promise.all([core.changeReadingPreferences({type:'reading.preferences.set',taskId:task.id,expectedRevision:0,preferences:options}),core.changeReadingPreferences({type:'reading.preferences.set',taskId:task.id,expectedRevision:0,preferences:{...options,textSize:18}})]);expect(results.map(result=>result.kind)).toEqual(['saved','conflict']);
 const after=await core.getTask(task.id);expect({...after,session:undefined}).toEqual({...before,session:undefined});expect({...after.session,readingPreferences:undefined,revision:before.session!.revision}).toEqual({...before.session,readingPreferences:undefined});expect(await core.getTask(other.id)).toEqual(otherBefore);
 await core.close();cores.pop();core=await createCompanion({dataDir:directory});cores.push(core);expect(await core.getReadingPreferences(task.id)).toEqual({...options,revision:1});expect((await core.getTask(task.id)).session?.draft).toBe('Unsent reading owner draft731\n');
 let checks=0;await expect(core.changeReadingPreferences({type:'reading.preferences.set',taskId:task.id,expectedRevision:1,preferences:options},()=>{checks++;throw Error('Owner changed');})).rejects.toThrow('Owner changed');expect(checks).toBe(1);expect((await core.getReadingPreferences(task.id)).revision).toBe(1);
});
it('accepts only bounded presentation preferences and rejects text, provider or other injected fields',()=>{
 for(const value of [{type:'reading.preferences.set',taskId:'owner',expectedRevision:0,preferences:{textSize:200,lineSpacing:1.8,theme:'paper',focus:'all'}},{type:'reading.preferences.set',taskId:'owner',expectedRevision:0,preferences:{...defaultReadingPreferences(),text:'Injected body'}},{type:'reading.preferences.get',taskId:'owner',provider:'codex'}])expect(()=>readReadingCommand(value)).toThrow();
});
