import {expect,it} from 'vitest';
import {sourceIntakeHostFixture} from './source-intake-host.fixture';
import {moduleNotesFixture} from './module-notes-lineage.fixture';
import {savedDocumentDraftBasis} from '../src/shared/saved-document-draft';
import {artifactContextUncertain} from '../src/core/request-context';
import {UNCERTAIN_ARTIFACT_CONTEXT} from '../src/shared/artifact-context-origin';

it('SOURCE09 actual strict host withholds a newly authored source-free generic document, while closed canonical notes remain reusable',async()=>{
 const h=await sourceIntakeHostFixture();
 const raw={title:'My newly authored plan',content:'I will compare two workshop layouts.\nThe small layout seats twelve people.',mimeType:'text/markdown',sourceRefs:[]};
 const task=await h.host.dispatch({type:'artifact.save',taskId:h.task.id,artifact:raw}) as typeof h.task;
 const artifact=task.artifacts.at(-1)!,revision=artifact.revisions[0];
 expect(revision.content).toBe(raw.content);expect(revision.sourceRefs).toEqual([]);expect(artifactContextUncertain(task,artifact.id,revision)).toBe(true);
 const command={type:'model.run' as const,taskId:task.id,requestId:'new-human-explanation',kind:'revise' as const,prompt:'Explain the tradeoff in my plan.',artifactId:artifact.id,sourceIds:[],expectedSourceRefs:[]};
 await expect(h.host.dispatch(command)).rejects.toThrow(UNCERTAIN_ARTIFACT_CONTEXT);
 await expect(h.host.dispatch({...command,requestId:'new-human-evidence-edits',suggestEdits:true,revisionBasis:savedDocumentDraftBasis(task,artifact.id,revision)})).rejects.toThrow(UNCERTAIN_ARTIFACT_CONTEXT);
 expect(h.calls.transports).toBe(0);expect((await h.core.getTask(task.id)).artifacts[0].revisions[0]).toEqual(revision);
 const f=await moduleNotesFixture({core:h.core,taskId:task.id}),saved=await h.host.dispatch({type:'module.document',...await f.input()}) as {task:typeof task;artifactId:string};
 const note=saved.task.artifacts.find(a=>a.id===saved.artifactId)!.revisions[0];
 expect(note.contextOrigin?.kind).toBe('module-notes-v1');
 await h.host.dispatch({type:'model.run',taskId:task.id,requestId:'canonical-positive',kind:'revise',prompt:'Explain these current notes.',artifactId:saved.artifactId,sourceIds:[f.ref.sourceId],expectedSourceRefs:[f.ref]});
 expect(h.calls.transports).toBe(1);expect(h.state.payloads[0].sources).toEqual(expect.arrayContaining([expect.objectContaining({content:note.content})]));
});
