import {expect} from 'vitest';
import type {Companion} from '../../src/core/companion';
import type {RequestOutput,SourceRef} from '../../src/core/types';
import {artifactContextUncertain} from '../../src/core/request-context';

// Use the normal completed-answer journal; editable metadata cannot establish an origin.
export async function currentAnswerOrigin(core:Companion,taskId:string,requestId:string,output:RequestOutput,sourceRefs:SourceRef[]){
 const record=await core.runRequest({taskId,requestId,kind:'create',prompt:'Create the disclosed synthetic original answer.',executionScope:'test-current-answer-origin:v1',sourceIds:sourceRefs.map(ref=>ref.sourceId),expectedSourceRefs:sourceRefs},async()=>output);
 expect(record.status,record.error).toBe('completed');
 const task=await core.getTask(taskId),records=task.requests.filter(request=>request.id===requestId),artifacts=task.artifacts.filter(artifact=>artifact.id===record.artifactId);
 expect(records).toEqual([record]);expect(artifacts).toHaveLength(1);expect(artifacts[0].revisions).toHaveLength(1);
 const revision=artifacts[0].revisions[0],artifactId=artifacts[0].id;
 expect(record.answer).toEqual({artifactId,revision:1,digest:revision.digest});
 expect(revision).toMatchObject({...output,revision:1,sourceRefs,contextSourceRefs:sourceRefs});
 expect(record.sourceRefs).toEqual(sourceRefs);expect(artifactContextUncertain(task,artifactId,revision)).toBe(false);
 expect((await core.getTask(taskId)).artifacts.find(artifact=>artifact.id===artifactId)!.revisions[0]).toEqual(revision);
 return {artifactId,revision,requestId};
}
