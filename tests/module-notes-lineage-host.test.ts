import {expect,it} from 'vitest';
import {sourceIntakeHostFixture} from './source-intake-host.fixture';
import {moduleNotesFixture,marker} from './module-notes-lineage.fixture';
it('actual IPC derives exact generic note lineage, rejects forged body/origin metadata, and withdrawn skill refuses explicit revision before transport',async()=>{
 const h=await sourceIntakeHostFixture(),f=await moduleNotesFixture({core:h.core,taskId:h.task.id}),input=await f.input();
 for(const extra of [{content:'forged'},{sourceRefs:[]},{contextSkillRefs:[]},{local:true}])await expect(h.host.dispatch({type:'module.document',...input,...extra} as any)).rejects.toThrow();
 const saved=await h.host.dispatch({type:'module.document',...input}) as any,note=saved.task.artifacts.find((a:any)=>a.id===saved.artifactId).revisions[0];
 expect(note.content).toContain(marker);expect(note.contextSkillRefs).toEqual([f.skill.reference]);expect(note.sourceRefs).toEqual([f.ref]);expect(note.contextSourceRefs).toEqual([f.ref]);
 await h.core.setInstructionSkill(f.taskId,1,null);
 const command={type:'model.run' as const,taskId:f.taskId,requestId:'withdrawn-note-revision-host',kind:'revise' as const,prompt:'Revise explicit saved notes.',artifactId:saved.artifactId,sourceIds:[f.ref.sourceId],expectedSourceRefs:[f.ref]};
 // IPC sanitizes the skill error; the same production command seam retains its precise refusal.
 await expect(h.host.dispatch(command)).rejects.toThrow();await expect(h.host.command(command)).rejects.toThrow(/skill/i);
 expect(h.calls.transports).toBe(0);expect(h.calls.confirmations).toEqual([]);expect(h.calls.pixels).toBe(0);expect((await h.core.getTask(f.taskId)).actions).toEqual([]);
});
