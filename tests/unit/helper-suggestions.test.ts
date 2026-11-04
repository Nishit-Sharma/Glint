import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../../src/core/companion';
import {previewHelperSuggestions,readHelperSuggestionCommand,type HelperSuggestionPreview} from '../../src/shared/helper-suggestions';
import {checkedSuggestionHelper} from '../support/helper-suggestions.fixture';
let core:Companion,directory:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'selected-helper-suggestions-'));core=await createCompanion({dataDir:directory});});
afterEach(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
const preview=async(taskId:string)=>await core.helperSuggestions({type:'helper.suggestions.preview',taskId}) as HelperSuggestionPreview;
const opening=(review:HelperSuggestionPreview)=>({type:'helper.suggestions.open' as const,taskId:review.taskId,binding:review.binding,artifactId:review.candidates[0].helper.artifactId,moduleId:review.candidates[0].helper.moduleId});
it('finds same-task purpose matches with exact current evidence and opens inactive review without any mutation',async()=>{
 const task=await core.createTask({title:'Label cleanup',goal:'Trim labels for the stock list.'}),helper=await checkedSuggestionHelper(core,task.id),other=await core.createTask({title:'PRIVATE_OTHER_TASK_SENTINEL'});await checkedSuggestionHelper(core,other.id,'PRIVATE_OTHER_HELPER_SENTINEL');
 const before=await core.contentSnapshot(),review=await preview(task.id),candidate=review.candidates[0];
 expect(candidate.helper).toMatchObject({artifactId:helper.artifactId,activeVersion:null,version:1,stateRevision:helper.revision});expect(candidate.terms).toContain('trim');expect(candidate.evidence.some(item=>item.label==='Task goal'&&item.excerpt.includes('Trim labels'))).toBe(true);expect(JSON.stringify(review)).not.toContain('PRIVATE_OTHER');
 expect(await core.helperSuggestions(opening(review))).toMatchObject({task:{id:task.id},artifactId:helper.artifactId,artifactRevision:1});expect(await core.contentSnapshot()).toEqual(before);expect(await preview(task.id)).toEqual(review);
});
it('returns an honest no-match and excludes draft-only or unknown-origin helper metadata',async()=>{
 const task=await core.createTask({title:'Orbit calculation',goal:'Compare planets'});await checkedSuggestionHelper(core,task.id);
 expect((await preview(task.id)).candidates).toEqual([]);expect((await preview(task.id)).eligibleHelperCount).toBe(1);
 const raw=await core.getTask(task.id);raw.requests=[];raw.title='Trim labels';expect(previewHelperSuggestions(raw).eligibleHelperCount).toBe(0);
});
it('matches only included fresh current text and binds exact source versions',async()=>{
 const task=await core.createTask({title:'Stock',goal:''}),helper=await checkedSuggestionHelper(core,task.id);let current=await core.putSource(task.id,{kind:'text',label:'Inventory',content:'Please trim labels before printing.',role:'fact'});const source=current.sources[0],ref={sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest};
 const first=await preview(task.id);expect(first.candidates[0].evidence.some(item=>JSON.stringify(item.sourceRef)===JSON.stringify(ref)&&item.excerpt.includes('trim labels'))).toBe(true);
 await core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:0,sourceIds:[]});expect((await preview(task.id)).candidates).toEqual([]);await expect(core.helperSuggestions(opening(first))).rejects.toThrow(/changed/);
 await core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:1,sourceIds:[source.id]});current=await core.putSource(task.id,{kind:'text',id:source.id,label:'Inventory',content:'Calculate gross profit.',role:'fact'});expect((await preview(task.id)).candidates).toEqual([]);await expect(core.helperSuggestions(opening(first))).rejects.toThrow(/changed/);expect((await core.getTask(task.id)).session!.moduleStates[0].state.revision).toBe(helper.revision);
});
it('withholds helpers whose original context is excluded, revoked or advanced even when goal matches',async()=>{
 const task=await core.createTask({title:'Trim labels',goal:'Clean labels'}),withSource=await core.putSource(task.id,{kind:'text',label:'Private labels',content:'Trim labels',role:'fact'}),source=withSource.sources[0],ref={sourceId:source.id,version:source.currentVersion,digest:source.versions[0].digest};await checkedSuggestionHelper(core,task.id,'Trim labels',[ref]);const review=await preview(task.id);expect(review.candidates).toHaveLength(1);
 await core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:0,sourceIds:[]});expect((await preview(task.id)).eligibleHelperCount).toBe(0);await expect(core.helperSuggestions(opening(review))).rejects.toThrow(/changed/);
 await core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:1,sourceIds:[source.id]});await core.revokeSource(task.id,source.id);expect((await preview(task.id)).candidates).toEqual([]);
});
it('rejects exact helper-state drift, paused and archived owners, forged target and extra authority fields',async()=>{
 const task=await core.createTask({title:'Trim labels'}),helper=await checkedSuggestionHelper(core,task.id),review=await preview(task.id);
 expect(()=>readHelperSuggestionCommand({...opening(review),activate:true})).toThrow();expect(()=>readHelperSuggestionCommand({type:'helper.suggestions.preview',taskId:task.id,sourceIds:[]})).toThrow();await expect(core.helperSuggestions({...opening(review),moduleId:'other'})).rejects.toThrow(/changed/);
 await helper.act({kind:'activate-version',version:1});await expect(core.helperSuggestions(opening(review))).rejects.toThrow(/changed/);expect((await preview(task.id)).candidates[0].helper.activeVersion).toBe(1);
 await core.pause(task.id);await expect(preview(task.id)).rejects.toThrow(/resume/);await core.resume(task.id);const raw=await core.getTask(task.id);raw.archive={id:'synthetic-archive',archivedAt:'2026-11-03T00:00:00Z'};expect(()=>previewHelperSuggestions(raw)).toThrow(/resume/);expect(()=>previewHelperSuggestions({...raw,archive:undefined,provenance:'local-example'})).toThrow(/resume/);
});
it('recomputes after normal restart without creating suggestion artifacts or changing saved helpers',async()=>{
 const task=await core.createTask({title:'Trim labels'});await checkedSuggestionHelper(core,task.id);const before=await core.getTask(task.id),review=await preview(task.id);await core.close();core=await createCompanion({dataDir:directory});expect(await preview(task.id)).toEqual(review);const reopened=await core.getTask(task.id);expect(reopened.artifacts).toEqual(before.artifacts);expect(reopened.requests).toEqual(before.requests);expect(reopened.session?.moduleStates).toEqual(before.session?.moduleStates);expect(await core.helperSuggestions(opening(review))).toMatchObject({artifactId:review.candidates[0].helper.artifactId});
});
it('quotes original Unicode positions and exact tokens rather than earlier substring matches',async()=>{
 const task=await core.createTask({title:'Stock',goal:''});await checkedSuggestionHelper(core,task.id,'Normalize warehouse labels');await core.putSource(task.id,{kind:'text',label:'Packing notes',role:'fact',content:'İ'.repeat(300)+' unnormalized warehouses labelsmith '+'. '.repeat(200)+'normalize warehouse labels before packing.'});
 const review=await preview(task.id);expect(review.candidates).toHaveLength(1);expect(review.candidates[0].terms).toEqual(['labels','normalize','warehouse']);expect(review.candidates[0].evidence.every(item=>item.excerpt.includes('normalize warehouse labels before packing.'))).toBe(true);expect(review.candidates[0].evidence.every(item=>item.excerpt.length>10)).toBe(true);
});
