import {expect,test,vi} from 'vitest';
import type {Task} from '../src/core/types';
import {searchSavedWork} from '../src/shared/saved-work-search';
import {requestSavedWorkNavigation,type SavedWorkNavigation} from '../src/renderer/src/saved-work-navigation';
const task:Task={id:'b',title:'Owner B',goal:'Orchard',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'file',revisions:[{revision:1,digest:'d',title:'Crate notes',content:'Mesa crates',mimeType:'text/plain',createdAt:'time',sourceRefs:[]}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
const match=searchSavedWork([task],'Mesa').matches[0];
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){
 let current=true,dirty=false,held:(()=>void)|undefined,loaded=structuredClone(task);const order:string[]=[];
 const owner:SavedWorkNavigation={listGeneration:()=>1,knownTask:()=>loaded,current:()=>current,guard:action=>{if(dirty){held=action;order.push('guard-held');return false;}action();return true;},dirty:()=>dirty,flush:vi.fn(async()=>{order.push('flush');}),load:vi.fn(async id=>{order.push('read:'+id);return loaded;}),started:vi.fn(),finished:vi.fn(),failed:vi.fn(),open:vi.fn(()=>{order.push('open');})};
 return {owner,order,setCurrent(value:boolean){current=value;},setDirty(value:boolean){dirty=value;},setTask(value:Task){loaded=value;},leave(){dirty=false;held?.();held=undefined;},keep(){held=undefined;}};
}
test('cross-task lookup flushes the old composer and resolves the exact owned revision before opening without mutation',async()=>{
 const f=fixture(),before=JSON.stringify(task);requestSavedWorkNavigation(match,f.owner);await tick();expect(f.order).toEqual(['flush','read:b','open']);expect(f.owner.open).toHaveBeenCalledWith(task,expect.objectContaining({kind:'file',revision:expect.objectContaining({revision:1,digest:'d'})}));expect(f.owner.failed).not.toHaveBeenCalled();expect(JSON.stringify(task)).toBe(before);
});
test('keep editing cancels a held selection without reads; leave performs a fresh read and rejects a changed result',async()=>{
 const f=fixture();f.setDirty(true);requestSavedWorkNavigation(match,f.owner);await tick();expect(f.owner.load).not.toHaveBeenCalled();f.keep();expect(f.owner.open).not.toHaveBeenCalled();requestSavedWorkNavigation(match,f.owner);f.setTask({...task,artifacts:[]});f.leave();await tick();expect(f.owner.load).toHaveBeenCalledOnce();expect(f.owner.open).not.toHaveBeenCalled();expect(f.owner.failed).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining('Search again')}));
});
test('new edits during a held read require another guard and re-read after discard, never the earlier snapshot',async()=>{
 const f=fixture();let release!:(task:Task)=>void;vi.mocked(f.owner.load).mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));requestSavedWorkNavigation(match,f.owner);await tick();f.setDirty(true);release(task);await tick();expect(f.owner.open).not.toHaveBeenCalled();expect(f.order).toContain('guard-held');f.setTask({...task,title:'Renamed while discard review was open'});f.leave();await tick();expect(f.owner.load).toHaveBeenCalledTimes(2);expect(f.owner.open).not.toHaveBeenCalled();expect(f.owner.failed).toHaveBeenCalledOnce();
});
test('a query, owner, route, activation or surface change invalidates a late response, with no opening or stale error',async()=>{
 for(const result of ['task','error']){const f=fixture();let release!:()=>void;vi.mocked(f.owner.load).mockImplementationOnce(()=>new Promise((resolve,reject)=>{release=()=>result==='task'?resolve(task):reject(Error('late failure'));}));requestSavedWorkNavigation(match,f.owner);await tick();f.setCurrent(false);release();await tick();expect(f.owner.open).not.toHaveBeenCalled();expect(f.owner.failed).not.toHaveBeenCalled();}
});
test('deleted or foreign owners and local read/flush failures remain explicit without changing the view',async()=>{
 for(const cause of ['deleted','foreign','flush']){const f=fixture();if(cause==='deleted')vi.mocked(f.owner.load).mockRejectedValue(Error('Task not found.'));if(cause==='foreign')f.setTask({...task,id:'foreign'});if(cause==='flush')vi.mocked(f.owner.flush).mockRejectedValue(Error('Message could not be saved.'));requestSavedWorkNavigation(match,f.owner);await tick();expect(f.owner.open).not.toHaveBeenCalled();expect(f.owner.failed).toHaveBeenCalledOnce();expect(f.owner.finished).toHaveBeenCalledOnce();}
});
