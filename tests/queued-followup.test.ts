import {afterEach,beforeEach,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import type {QueuedFollowup} from '../src/shared/queued-followup';
let core:Companion,dataDir:string;
beforeEach(async()=>{dataDir=await mkdtemp(join(tmpdir(),'glint-queue-'));core=await createCompanion({dataDir});});
afterEach(async()=>{await core.close();await rm(dataDir,{recursive:true,force:true});});
it('atomically keeps queue intent, consumes only its matching draft and holds it after restart',async()=>{
 const task=await core.createTask({title:'Queue owner'}),draft=await core.saveComposerDraft(task.id,0,{text:'Exact queued follow-up',kind:'explain'});
 const basis=await core.queuedFollowupBasis(task.id,[],[]),item:QueuedFollowup={id:'queue-1',revision:1,prompt:draft.text,kind:'explain',createdAt:'2026-10-31T00:00:00Z',sourceRefs:[],status:'queued',basis,scope:'a'.repeat(64),precedingRequestIds:[]};
 await core.saveQueuedFollowup(task.id,item,0,draft);expect((await core.getTask(task.id)).session?.draft).toBe('');
 await core.saveComposerDraft(task.id,1,{text:'Newer unsent draft',kind:'create'});await core.close();core=await createCompanion({dataDir});
 const recovered=await core.getTask(task.id);expect(recovered.session?.queuedFollowups?.[0]).toMatchObject({prompt:'Exact queued follow-up',status:'held'});expect(recovered.session?.draft).toBe('Newer unsent draft');expect(recovered.requests).toEqual([]);
});
