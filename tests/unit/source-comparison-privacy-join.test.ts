import {readFile} from 'node:fs/promises';
import {expect,it,vi} from 'vitest';
import {comparisonDraftFixture} from '../support/source-comparison-drafts.fixture';
import {sourceComparisonBinding} from '../../src/shared/source-comparison';
import {findSourceComparisonReceipt} from '../../src/core/source-comparison-receipt';
import {artifactContextUncertain} from '../../src/core/request-context';
import type {RequestContext} from '../../src/core/types';

it('a real comparison publication keeps its exact receipt and privacy restrictions through restart and revision',async()=>{
 const f=await comparisonDraftFixture();
 try{
  const notes={question:f.raw.question,comparison:f.raw.comparison,uncertainty:f.raw.uncertainty};
  const input={taskId:f.task.id,intentId:crypto.randomUUID(),refs:f.refs,notes,binding:sourceComparisonBinding(f.task.id,f.refs,notes)};
  const saved=await f.core.saveSourceComparison(input),origin=saved.revision.contextOrigin;
  expect(origin?.kind).toBe('source-comparison-v1');
  if(origin?.kind!=='source-comparison-v1')throw Error('The actual publisher did not issue its origin record.');
  const state=JSON.parse(await readFile(f.directory+'/tasks.json','utf8'));
  expect(findSourceComparisonReceipt(state.usedRequestIds,origin.claimHash)).toMatchObject({binding:origin.binding,taskId:f.task.id,artifactId:saved.artifact.id,revision:1,digest:origin.contentDigest});
  await f.recreate(true);
  const reopened=await f.core.getTask(f.task.id),revision=reopened.artifacts.find(item=>item.id===saved.artifact.id)!.revisions.at(-1)!;
  expect(artifactContextUncertain(reopened,saved.artifact.id,revision)).toBe(false);
  const allowed=vi.fn(async(context:RequestContext)=>{
   expect(context.task.artifacts.some(item=>item.id===saved.artifact.id)).toBe(true);
   return {title:'Reviewed comparison',content:revision.content+'\n\nReviewed against the selected snapshots.'};
  });
  expect((await f.core.runRequest({taskId:f.task.id,requestId:'joined-comparison-positive',kind:'revise',prompt:'Clarify my comparison against these exact sources.',artifactId:saved.artifact.id,expectedRevision:1,sourceIds:f.refs.map(ref=>ref.sourceId),expectedSourceRefs:f.refs},allowed)).status).toBe('completed');
  expect(allowed).toHaveBeenCalledOnce();
  expect((await f.core.saveSourceComparison(input)).revision).toEqual(saved.revision);
  const current=await f.core.getTask(f.task.id);
  expect(current.artifacts).toHaveLength(1);
  expect(artifactContextUncertain(current,saved.artifact.id,current.artifacts[0].revisions.at(-1)!)).toBe(false);
  await f.core.setSourceSelection({type:'source-selection.set',taskId:f.task.id,expectedRevision:0,sourceIds:[]});
  const blocked=vi.fn(async()=>({title:'Unexpected',content:'This must not run.'}));
  await expect(f.core.runRequest({taskId:f.task.id,requestId:'joined-comparison-excluded',kind:'revise',prompt:'Do not reuse excluded context.',artifactId:saved.artifact.id,expectedRevision:2,sourceIds:[],expectedSourceRefs:[]},blocked)).rejects.toThrow();
  expect(blocked).not.toHaveBeenCalled();
 }finally{await f.close();}
});
