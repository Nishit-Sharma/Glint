import {expect,test} from 'vitest';
import type {Task,Source,SourceVersion} from '../../src/core/types';
import {savedSourceSummary,taskSidebarPreview} from '../../src/renderer/src/components/task-preview';
const version=(version:number,label:string):SourceVersion=>({id:'owned-source',kind:'text',role:'fact',content:'Private body never belongs in a preview',label,version,digest:String(version).repeat(64),capturedAt:'2026-10-26T00:00:00.000Z'});
const source=(changes:Partial<Source>={}):Source=>({id:'owned-source',currentVersion:1,versions:[version(1,'Owned notes')],freshness:'fresh',...changes});
function task(sources:Source[]=[]):Task{return {id:'owned-task',title:'Owned task',goal:'',status:'active',createdAt:'2026-10-26T00:00:00.000Z',updatedAt:'2026-10-26T00:00:00.000Z',sources,artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};}

test('a saved source uses the exact current revision, label and digest rather than the last array element',()=>{
 const value=task([source({versions:[version(1,'Current chosen label'),version(2,'Different historical label')]})]);
 const summary=savedSourceSummary(value)!;
 expect(summary.reference).toEqual({sourceId:'owned-source',version:1,digest:'1'.repeat(64)});expect(summary.description).toBe('Current chosen label');expect(taskSidebarPreview(value)).toBe('Added: Current chosen label');
 expect(JSON.stringify(summary)).not.toContain('Private body');expect(JSON.stringify(summary)).not.toContain('Different historical label');expect(value.sources[0].currentVersion).toBe(1);
});
test('stale source remains an explicitly saved snapshot needing review, with its exact reference',()=>{
 const value=task([source({freshness:'refresh-required'})]);const summary=savedSourceSummary(value)!;
 expect(summary.heading).toBe('Earlier copy saved');expect(summary.description).toContain('It may have changed. Check it before using it again.');expect(summary.reference?.version).toBe(1);expect(taskSidebarPreview(value)).toBe('Earlier copy: Owned notes');
});
test('multiple saved sources open the source list without choosing an arbitrary single identity',()=>{
 const value=task([source(),source({id:'other-source',freshness:'refresh-required'})]);const summary=savedSourceSummary(value)!;
 expect(summary.reference).toBeUndefined();expect(summary.action).toBe('Review what you added');expect(summary.description).toBe('2 items added. 1 may have changed.');expect(taskSidebarPreview(value)).toBe('2 items added · Review needed');
});
test('missing current revisions cannot invent source copy or a review target',()=>{
 const value=task([source({currentVersion:3})]);expect(savedSourceSummary(value)).toBeUndefined();expect(taskSidebarPreview(value)).toBe('New task');expect(savedSourceSummary(task())).toBeUndefined();
});
test('an empty source label has a readable kind fallback without exposing content',()=>{
 const value=task([source({versions:[{...version(1,'  '),kind:'window'}]})]);expect(savedSourceSummary(value)?.description).toBe('Captured window');expect(taskSidebarPreview(value)).toBe('Added: Captured window');
});
test('existing document and goal preview precedence stays above saved-source fallback',()=>{
 const value=task([source()]);value.goal='Existing goal';expect(taskSidebarPreview(value)).toBe('Existing goal');
 value.artifacts=[{id:'document',revisions:[{revision:1,title:'Existing document',content:'hidden content',mimeType:'text/markdown',sourceRefs:[],digest:'d'.repeat(64),createdAt:value.createdAt}]}];expect(taskSidebarPreview(value)).toBe('Existing document');
});
test('existing chronology and screen-brief title take precedence over saved source copy',()=>{
 const value=task([source()]);value.requests=[{id:'request',kind:'explain',prompt:'Original request',digest:'r'.repeat(64),status:'completed',sourceRefs:[],startedAt:value.createdAt}];expect(taskSidebarPreview(value)).toBe('Original request');
 value.checkpoints=[{id:'checkpoint',note:'Later checkpoint',sourceRefs:[],artifacts:[],createdAt:'2026-10-26T01:00:00.000Z'}];expect(taskSidebarPreview(value)).toBe('Later checkpoint');
 value.checkpoints=[];value.requests[0].kind='brief';expect(taskSidebarPreview(value)).toBe('Screen insight');
});
