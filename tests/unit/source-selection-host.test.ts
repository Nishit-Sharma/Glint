import {expect,it} from 'vitest';
import {sourceIntakeHostFixture,hold} from '../support/source-intake-host.fixture';

it('production IPC validates task ownership and uses saved inclusion for omitted model source IDs',async()=>{
 const f=await sourceIntakeHostFixture();await f.core.putSource(f.task.id,{id:'private',kind:'text',role:'fact',label:'Private',content:'OMITTED_SOURCE_PRIVATE'});
 expect(()=>f.host.validate({type:'source-selection.set',taskId:f.task.id,expectedRevision:0,sourceIds:[],send:true})).toThrow();
 const other=await f.core.createTask({title:'Other selection owner'});await expect(f.host.dispatch({type:'source-selection.set',taskId:other.id,expectedRevision:0,sourceIds:[]})).rejects.toThrow('source owner task');
 await f.host.dispatch({type:'source-selection.set',taskId:f.task.id,expectedRevision:0,sourceIds:[]});
 await f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'selection-omitted',kind:'explain',prompt:'Synthetic current question'});
 expect(f.calls.transports).toBe(1);expect(f.state.payloads[0]).toMatchObject({sources:[]});expect(JSON.stringify(f.state.payloads)).not.toContain('OMITTED_SOURCE_PRIVATE');
 for(const kind of ['explain','create','experiment','procedure','brief'] as const)await expect(f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'selection-stale-'+kind,kind,prompt:'Synthetic stale selection',sourceIds:['private']})).rejects.toThrow('Source selection changed');expect(f.calls.transports).toBe(1);
});

it('selection change fences a provider waiting before its actual synthetic send boundary',async()=>{
 const f=await sourceIntakeHostFixture();await f.core.putSource(f.task.id,{id:'private',kind:'text',role:'fact',label:'Private',content:'PENDING_SOURCE_PRIVATE'});
 const gate=hold();f.state.providerGate=gate;const pending=f.host.dispatch({type:'model.run',taskId:f.task.id,requestId:'selection-delayed',kind:'explain',prompt:'Synthetic question',sourceIds:['private']}),rejected=expect(pending).rejects.toThrow();await gate.started;
 await f.host.dispatch({type:'source-selection.set',taskId:f.task.id,expectedRevision:0,sourceIds:[]});gate.release();await rejected;expect(f.calls.transports).toBe(0);expect((await f.core.getTask(f.task.id)).artifacts).toEqual([]);
});
