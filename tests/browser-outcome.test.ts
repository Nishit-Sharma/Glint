import {expect,it} from 'vitest';
import type {Task} from '../src/core/types';
import {browserRequestOutcome,requestArtifact} from '../src/renderer/src/browser-outcome';
import {emptyTaskSession} from '../src/core/task-session';

function sample():Task{
 const observation={id:'observation',taskId:'task',browserId:'browser',documentId:'document',url:'https://owned.example',title:'Owned page',text:'Receipt 1',digest:'digest',targets:[]};
 return {id:'task',title:'Mesa draft',goal:'',status:'active',createdAt:'2026-10-25',updatedAt:'2026-10-25',sources:[],artifacts:[],procedures:[],actions:[],checkpoints:[],memory:{enabled:false},requests:[{id:'submit',kind:'browser',prompt:'Save once',status:'failed',digest:'request-digest',sourceRefs:[],startedAt:'2026-10-25'}],session:{...emptyTaskSession(),runs:[{id:'submit',endpointKey:'fixture',origin:'https://owned.example',browserId:'browser',initialObservation:observation,operations:[{id:'write',intent:{kind:'click',snapshotId:'observation',targetId:'save'},reason:'Save the draft',status:'observed',reconciliation:{id:'inspection',outcome:'completed',basis:'user-reviewed-observation',note:'User reviewed the receipt.',observation}}]}]}};
}

it('a reviewed action cannot settle another unknown action in the same request',()=>{
 const task=sample(),run=task.session!.runs[0];task.session={...task.session!,runs:[{...run,operations:[...run.operations,{id:'other-write',intent:{kind:'click',snapshotId:'observation',targetId:'other'},reason:'Another action',status:'uncertain'}]}]};
 expect(browserRequestOutcome(task,task.requests[0])).toMatchObject({label:'Outcome needs review',needsReview:true,reviewed:true});
});

it('mixed completed and not-completed reviews do not claim whole-request completion',()=>{
 const task=sample(),run=task.session!.runs[0],operation=run.operations[0];task.session={...task.session!,runs:[{...run,operations:[operation,{...operation,id:'other',status:'failed',reconciliation:{...operation.reconciliation!,id:'second-inspection',outcome:'not-completed'}}]}]};
 expect(browserRequestOutcome(task,task.requests[0])).toMatchObject({label:'Actions partly reviewed',needsReview:false});
});

it('a later unexecuted step remains incomplete after an earlier action review',()=>{
 const task=sample(),run=task.session!.runs[0];task.session={...task.session!,runs:[{...run,operations:[...run.operations,{id:'not-run',intent:{kind:'click',snapshotId:'observation',targetId:'other'},reason:'Later step',status:'retired'}]}]};
 expect(browserRequestOutcome(task,task.requests[0])?.label).toBe('Actions partly reviewed');
});

it('reviewing an earlier action does not finish an active request',()=>{
 const task=sample();task.requests[0].status='running';expect(browserRequestOutcome(task,task.requests[0])?.label).toBe('Working');
});

it('response content and citations stay on the original associated artifact revision',()=>{
 const task=sample(),first={revision:1,title:'Original answer',content:'Mesa is $40.',mimeType:'text/markdown',sourceRefs:[{sourceId:'source-a',version:1,digest:'original-source'}],digest:'original-answer',createdAt:'2026-10-25T08:00:00Z'};
 task.requests[0]={...task.requests[0],status:'completed',artifactId:'answer'};task.artifacts=[{id:'answer',revisions:[first,{...first,revision:2,content:'A later manual edit.',digest:'later-edit',createdAt:'2026-10-25T09:00:00Z'}]},{id:'unrelated',revisions:[{...first,title:'Unrelated file',sourceRefs:[],content:'Another task item.',createdAt:'2026-10-25T10:00:00Z'}]}];
 expect(requestArtifact(task,task.requests[0])).toEqual({artifact:{id:'answer',revisions:[first]},revision:first});
});
