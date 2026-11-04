import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createCompanion,type Companion} from '../../src/core/companion';
import type {SourceRef,Task} from '../../src/core/types';
import {sourceDependencyRefs,inheritedSourceRefs} from '../../src/shared/source-dependencies';
import {sourceAffectedWork} from '../../src/renderer/src/source-affected-work';
import {revocationEffects} from '../../src/shared/source-intake';
import {projectRequestTask} from '../../src/core/request-context';
import {InheritedSourceWarning} from '../../src/renderer/src/components/InheritedSourceWarning';
import {SourceAffectedWork} from '../../src/renderer/src/components/SourceAffectedWork';
const a1={sourceId:'a',version:1,digest:'a1'},a2={sourceId:'a',version:2,digest:'a2'},b1={sourceId:'b',version:1,digest:'b1'};

test('dependency metadata preserves the exact union without parsing content, dropping old versions or mutating links',()=>{
 const value={sourceRefs:[a2,b1,a2],contextSourceRefs:[a1,b1,a2],content:'PRIVATE_BODY'};
 expect(sourceDependencyRefs(value)).toEqual([a2,b1,a1]);expect(inheritedSourceRefs(value)).toEqual([a1]);expect(value.sourceRefs).toEqual([a2,b1,a2]);expect(sourceDependencyRefs({sourceRefs:[a1]})).toEqual([a1]);expect(JSON.stringify(sourceDependencyRefs(value))).not.toContain('PRIVATE_BODY');
});
let core:Companion|undefined,directory:string|undefined;
afterEach(async()=>{await core?.close();if(directory)await rm(directory,{recursive:true,force:true});core=undefined;directory=undefined;});
const ref=(task:Task,id:string):SourceRef=>{const source=task.sources.find(source=>source.id===id)!,version=source.versions.at(-1)!;return {sourceId:id,version:version.version,digest:version.digest};};
async function fixture(){
 directory=await mkdtemp(join(tmpdir(),'source-impact-lineage-'));core=await createCompanion({dataDir:directory});let task=await core.createTask({title:'Owned source lineage'});
 for(const id of ['a','b','c'])task=await core.putSource(task.id,{id,kind:'text',role:'fact',label:'Source '+id,content:'PRIVATE_SOURCE_'+id});
 const request=await core.runRequest({taskId:task.id,requestId:'derived-a',kind:'explain',prompt:'Synthetic A interpretation',sourceIds:['a']},async()=>({title:'Authored B document',content:'Saved A-derived statement stays local.'}));
 await core.saveArtifact(task.id,{artifactId:request.artifactId,expectedRevision:1,title:'Authored B document',content:'User-authored retained statement.',sourceRefs:[ref(task,'b')]});
 const unrelated=await core.saveArtifact(task.id,{title:'Unrelated C',content:'Only C.',sourceRefs:[ref(task,'c')]});
 return {task:await core.getTask(task.id),artifactId:request.artifactId!,unrelatedId:unrelated.artifactId};
}
test.each(['refresh','revoke'] as const)('actual core lineage survives %s and reopen; impact metadata agrees with projection without changing saved content',async action=>{
 const f=await fixture(),original=f.task.artifacts.find(item=>item.id===f.artifactId)!,before=structuredClone(original),old=ref(f.task,'a');
 expect(sourceAffectedWork(f.task,'a')).toEqual([]);expect(revocationEffects(f.task,'a').artifactIds).toEqual([f.artifactId]);
 let task=action==='refresh'?await core!.putSource(f.task.id,{id:'a',kind:'text',role:'fact',label:'A current label',content:'CHANGED_PRIVATE_A'}):await core!.revokeSource(f.task.id,'a');
 const entries=sourceAffectedWork(task,'a');expect(entries).toHaveLength(1);expect(entries[0]).toMatchObject({kind:'artifact',refs:[],inheritedRefs:[old]});expect(entries[0].item.id).toBe(f.artifactId);expect(sourceAffectedWork(task,'b')).toEqual([]);expect(sourceAffectedWork(task,'c')).toEqual([]);
 const summary=await core!.resume(task.id);expect(summary.affectedArtifacts).toContainEqual({artifactId:f.artifactId,revisions:[1,2]});expect(summary.sourceContext.affectedArtifacts).toContainEqual({artifactId:f.artifactId,revisions:[1,2]});
 expect(projectRequestTask(task,task.sources.filter(source=>!source.revoked).map(source=>ref(task,source.id)),[task]).artifacts.some(item=>item.id===f.artifactId)).toBe(false);
 expect(task.artifacts.find(item=>item.id===f.artifactId)).toEqual(before);await core!.close();core=await createCompanion({dataDir:directory!});task=await core.getTask(task.id);
 expect(sourceAffectedWork(task,'a')[0]).toMatchObject({kind:'artifact',refs:[],inheritedRefs:[old]});expect(task.artifacts.find(item=>item.id===f.artifactId)).toEqual(before);expect(task.artifacts.find(item=>item.id===f.unrelatedId)).toEqual(f.task.artifacts.find(item=>item.id===f.unrelatedId));
});
test('inherited-only warning and affected-work row expose labels and exact versions without snapshot bodies or compare controls',async()=>{
 const f=await fixture(),task=await core!.putSource(f.task.id,{id:'a',kind:'text',role:'fact',label:'A current label',content:'CHANGED_PRIVATE_A'}),revision=task.artifacts.find(item=>item.id===f.artifactId)!.revisions.at(-1)!;
 const warning=renderToStaticMarkup(createElement(InheritedSourceWarning,{task,revision}));expect(warning).toContain('Inherited source context needs review: A current label');
 const html=renderToStaticMarkup(createElement(SourceAffectedWork,{task,source:task.sources[0],onArtifact:()=>{},onProcedure:()=>{},onVersion:()=>{throw Error('Inherited metadata cannot open snapshots');}}));
 expect(html).toContain('Inherited source context: Version 1');expect(html).toContain('Authored B document');for(const output of [warning,html])for(const forbidden of ['PRIVATE_SOURCE_a','CHANGED_PRIVATE_A','User-authored retained statement.','Compare source snapshots','Open referenced snapshot'])expect(output).not.toContain(forbidden);
 expect(renderToStaticMarkup(createElement(InheritedSourceWarning,{task,revision:{sourceRefs:[ref(task,'b')]}}))).toBe('');
});
test('metadata detects removed and same-version mismatched inherited refs without treating old artifact history as current impact',async()=>{
 const f=await fixture(),artifact=f.task.artifacts.find(item=>item.id===f.artifactId)!,latest=artifact.revisions.at(-1)!,withMismatch={...f.task,artifacts:[{...artifact,revisions:[...artifact.revisions.slice(0,-1),{...latest,contextSourceRefs:[{...ref(f.task,'a'),digest:'mismatch'}]}]}]};
 expect(sourceAffectedWork(withMismatch,'a')[0]).toMatchObject({inheritedRefs:[{...ref(f.task,'a'),digest:'mismatch'}]});
 const removed={...f.task,sources:f.task.sources.filter(source=>source.id!=='a')};expect(renderToStaticMarkup(createElement(InheritedSourceWarning,{task:removed,revision:latest}))).toContain('Removed source');
 const legacy={...f.task,artifacts:[{...artifact,revisions:[artifact.revisions[0],{...latest,contextSourceRefs:undefined}]}]};expect(sourceAffectedWork(legacy,'a')).toEqual([]);
});

test('source removal summaries count a running request using inherited context without exposing its prompt',()=>{
 const task={artifacts:[],procedures:[],requests:[{id:'running',status:'running',sourceRefs:[b1],contextSourceRefs:[a1],prompt:'PRIVATE_PROMPT'}],actions:[]} as unknown as Task;
 expect(revocationEffects(task,'a').runningRequestIds).toEqual(['running']);expect(JSON.stringify(revocationEffects(task,'a'))).not.toContain('PRIVATE_PROMPT');expect(revocationEffects(task,'foreign').runningRequestIds).toEqual([]);
});
