import {expect,it} from 'vitest';
import type {Task,RequestRecord} from '../../src/core/types';
import {emptyTaskSession} from '../../src/core/task-session';
import {deriveCharacterCue} from '../../src/renderer/src/character-cue';
const task=():Task=>({id:'owner',title:'Known task',goal:'',status:'active',createdAt:'now',updatedAt:'now',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:emptyTaskSession()});
const request=(status:RequestRecord['status']):RequestRecord=>({id:'request',kind:'explain',prompt:'uncertain failed waiting',digest:'digest',status,sourceRefs:[],startedAt:'now'});
it('scopes pending work and reads explicit latest request status without guessing from prose',()=>{
 const owner=task();owner.requests=[request('completed')];
 expect(deriveCharacterCue(undefined,undefined,{taskId:'owner'}).kind).toBe('ready');
 expect(deriveCharacterCue(owner,undefined,{taskId:'elsewhere'}).kind).toBe('ready');
 expect(deriveCharacterCue(owner,undefined,{taskId:'owner'}).kind).toBe('working');
 owner.requests=[request('failed')];expect(deriveCharacterCue(owner).kind).toBe('failed');
 owner.requests.push(request('completed'));expect(deriveCharacterCue(owner).kind).toBe('ready');
 owner.requests.push(request('interrupted'));expect(deriveCharacterCue(owner).kind).toBe('interrupted');
 owner.requests.push(request('running'));expect(deriveCharacterCue(owner).kind).toBe('working');
});
it('only warns about selected nonrevoked sources and gives active work priority',()=>{
 const owner=task();owner.sources=[{id:'stale',currentVersion:1,versions:[],freshness:'refresh-required'}];
 expect(deriveCharacterCue(owner).kind).toBe('stale');expect(deriveCharacterCue(owner,[]).kind).toBe('ready');
 expect(deriveCharacterCue(owner,['other']).kind).toBe('ready');expect(deriveCharacterCue(owner,['stale'],{taskId:owner.id}).kind).toBe('working');
 owner.sources[0].revoked={id:'revocation',at:'now',previousFreshness:'fresh'};expect(deriveCharacterCue(owner,['stale']).kind).toBe('ready');
 owner.status='paused';expect(deriveCharacterCue(owner).kind).toBe('paused');
});
it('uses held follow-ups and the latest browser operation with explicit reconciliation',()=>{
 const owner=task();
 owner.session={...owner.session!,queuedFollowups:[{id:'held',revision:1,prompt:'input',kind:'explain',createdAt:'now',sourceRefs:[],status:'held',basis:'basis',scope:'scope',precedingRequestIds:[]}]};
 expect(deriveCharacterCue(owner).kind).toBe('needs-input');owner.session={...owner.session!,queuedFollowups:[]};
 const observation={id:'observation',taskId:owner.id,browserId:'browser',documentId:'document',url:'https://example.test',title:'Fixture',text:'',digest:'digest',targets:[]};
 const operation={id:'operation',intent:{kind:'click' as const,snapshotId:'observation',targetId:'target'},status:'uncertain' as const,reason:'Known status'};
 owner.session={...owner.session!,runs:[{id:'run',endpointKey:'endpoint',origin:'https://example.test',browserId:'browser',initialObservation:observation,operations:[operation]}]};
 expect(deriveCharacterCue(owner).kind).toBe('uncertain');
 owner.session={...owner.session!,runs:[{...owner.session!.runs[0],operations:[{...operation,reconciliation:{id:'review',outcome:'completed',basis:'user-reviewed-observation',note:'Inspected',observation}}]}]};
 expect(deriveCharacterCue(owner).kind).toBe('ready');
 owner.session={...owner.session!,runs:[{...owner.session!.runs[0],operations:[...owner.session!.runs[0].operations,{...operation,id:'new',status:'proposed'}]}]};expect(deriveCharacterCue(owner).kind).toBe('needs-input');
 owner.session={...owner.session!,runs:[{...owner.session!.runs[0],operations:[...owner.session!.runs[0].operations,{...operation,id:'done',status:'observed'}]}]};expect(deriveCharacterCue(owner).kind).toBe('ready');
 const resolvedRun=owner.session!.runs[0];
 owner.session={...owner.session!,runs:[{...resolvedRun,operations:[operation,{...operation,id:'later',status:'observed'}]}]};
 expect(deriveCharacterCue(owner).kind).toBe('uncertain');
 owner.session={...owner.session!,runs:[...owner.session!.runs,{...resolvedRun,id:'later-run'}]};
 expect(deriveCharacterCue(owner).kind).toBe('uncertain');
 owner.session={...owner.session!,runs:[{...resolvedRun,operations:[{...operation,reconciliation:{id:'review',outcome:'not-completed',basis:'user-reviewed-observation',note:'Inspected',observation}}]},resolvedRun]};
 expect(deriveCharacterCue(owner).kind).toBe('ready');
 owner.actions=[{proposal:{id:'export',taskId:owner.id,artifactId:'artifact',revision:1,path:'/fixture',parentRealPath:'/',parentDevice:'1',parentInode:'1',artifactDigest:'digest',sourceRefs:[],byteLength:1,digest:'digest',createdAt:'now'},status:'uncertain'}];expect(deriveCharacterCue(owner).kind).toBe('uncertain');
 owner.actions[0].status='verified';expect(deriveCharacterCue(owner).kind).toBe('ready');
});

it('shows explicit live questions as waiting input and restores working after their decision, preserving safety and owner priorities',()=>{
 const owner=task(),running=request('running');running.questions=[{id:'question',digest:'question-digest',revision:1,definition:{question:'Choose a detail',mode:'single',options:[{id:'a',label:'First'},{id:'b',label:'Second'}]},status:'waiting',createdAt:'now'}];owner.requests=[running];
 expect(deriveCharacterCue(owner,undefined,{taskId:owner.id})).toMatchObject({kind:'needs-input',phase:'waiting',label:'Waiting for your answer'});
 owner.actions=[{status:'uncertain'} as Task['actions'][number]];expect(deriveCharacterCue(owner).kind).toBe('uncertain');owner.actions=[];
 owner.status='paused';expect(deriveCharacterCue(owner).kind).toBe('paused');owner.status='active';
 for(const status of ['answered','skipped','closed'] as const){running.questions[0].status=status;expect(deriveCharacterCue(owner,undefined,{taskId:owner.id}).kind).toBe('working');}
 running.questions[0].status='waiting';running.status='completed';expect(deriveCharacterCue(owner,undefined,{taskId:'elsewhere'}).kind).toBe('ready');
});
