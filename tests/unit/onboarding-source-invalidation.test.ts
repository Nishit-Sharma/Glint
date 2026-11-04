import {expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {OnboardingFixture} from '../support/onboarding-fixture';

test('the existing public fixture invalidates the exact source through real core and emits one changed event',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'fixture-invalidation-')),core=await createCompanion({dataDir:directory}),events:unknown[]=[];try{let task=await core.createTask({title:'Two sources'});task=await core.putSource(task.id,{kind:'text',label:'A',content:'A1',role:'fact'});task=await core.putSource(task.id,{kind:'text',label:'B',content:'B1',role:'fact'});const original=structuredClone(task),page={evaluate:vi.fn(async(_callback:unknown,event:unknown)=>{events.push(event);})},fixture=Reflect.construct(OnboardingFixture,[page,directory,core,{}]) as OnboardingFixture,command={type:'source.invalidate' as const,taskId:task.id,sourceId:task.sources[0].id};
  const result=await fixture.invoke(command) as typeof task;expect(result.sources[0].freshness).toBe('refresh-required');expect(result.sources[0].staleReason).toBe('Explicitly marked changed. Refresh or replace this source.');expect(result.sources[1]).toEqual(original.sources[1]);expect(result.sources[0].versions).toEqual(original.sources[0].versions);expect(events).toEqual([{type:'changed',taskId:task.id}]);expect(fixture.commands).toEqual([command]);expect((await core.getTask(task.id)).sources).toEqual(result.sources);
  events.length=0;await expect(fixture.invoke({...command,sourceId:'missing'})).rejects.toThrow();expect(events).toEqual([]);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
