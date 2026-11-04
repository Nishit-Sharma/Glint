import {expect,it} from 'vitest';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import type {Task} from '../../src/core/types';
import {emptyTaskSession} from '../../src/core/task-session';
import {taskResumeSuggestions,createTaskResumePreference} from '../../src/renderer/src/task-resume-suggestions';

function task(id='other',status:Task['requests'][number]['status']='interrupted'):Task{return {id,title:'Review orbital periods',goal:'Compare recorded periods',status:'active',createdAt:'2026-11-03T00:00:00.000Z',updatedAt:'2026-11-03T00:00:00.000Z',sources:[],artifacts:[],requests:[{id:'request-'+id,digest:'a'.repeat(64),kind:'explain',prompt:'PRIVATE QUESTION',status,sourceRefs:[],contextSourceRefs:[],startedAt:'2026-11-03T00:00:00.000Z'}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};}
function withSource(owner:Task){const source:Task['sources'][number]={id:'source',currentVersion:1,freshness:'fresh' as const,versions:[{id:'version',version:1,digest:'b'.repeat(64),capturedAt:'2026-11-03T00:00:00.000Z',kind:'text' as const,label:'PRIVATE LABEL',content:'PRIVATE SOURCE',role:'fact' as const}]};owner.sources=[source];owner.requests[0].sourceRefs=[{sourceId:'source',version:1,digest:'b'.repeat(64)}];owner.requests[0].contextSourceRefs=[...owner.requests[0].sourceRefs];return source;}
function storage(){const data=new Map<string,string>();return {data,access:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}}};}

it('derives accurate status reasons without question/source/answer copying or input mutation',()=>{
 const interrupted=task(),failed=task('failed','failed'),stopped=task('stopped','cancelled'),waiting=task('waiting','running');waiting.requests[0].questions=[{id:'question',digest:'f'.repeat(64),revision:1,status:'waiting',createdAt:waiting.updatedAt,definition:{question:'PRIVATE QUESTION TEXT',mode:'single',options:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]}}];
 const source=withSource(interrupted),owners=[interrupted,failed,stopped,waiting],before=structuredClone(owners),results=taskResumeSuggestions(owners,'current');
 expect(results.map(item=>item.taskId)).toEqual(['other','failed','stopped']);expect(results.find(item=>item.taskId==='other')?.reason).toContain('outcome may need review');expect(JSON.stringify(results)).not.toMatch(/PRIVATE/);expect(owners).toEqual(before);
 source.versions[0].content='DIFFERENT PRIVATE TEXT';interrupted.requests[0].prompt='OTHER PRIVATE PROMPT';expect(taskResumeSuggestions(owners,'current')).toEqual(results);
});
it('omits current/archive/example tasks, automatic work and requests whose current privacy projection is withheld',()=>{
 const current=task('current'),archived=task('archived'),example=task('example'),running=task('running','running'),browser=task('browser');archived.archive={id:'archive',archivedAt:'2026-11-03T00:00:00.000Z'};example.provenance='local-example';browser.requests[0].kind='browser';
 expect(taskResumeSuggestions([current,archived,example,running,browser],'current')).toEqual([]);expect(taskResumeSuggestions([task()],'current',['other'])).toEqual([]);
 for(const mutation of [(owner:Task)=>{owner.sources[0].revoked={id:'revocation',at:'2026-11-03T00:00:00.000Z',previousFreshness:'fresh'};},(owner:Task)=>{owner.sources[0].freshness='refresh-required';},(owner:Task)=>{owner.session={...emptyTaskSession(),sourceSelection:{revision:1,sourceIds:[]}};},(owner:Task)=>{owner.sources[0].currentVersion=2;owner.sources[0].versions.push({...owner.sources[0].versions[0],version:2,digest:'c'.repeat(64)});},(owner:Task)=>{owner.requests[0].instructionSkill={ownerTaskId:'missing',artifactId:'missing',revision:1,digest:'c'.repeat(64)};}]){const owner=task();withSource(owner);mutation(owner);expect(taskResumeSuggestions([owner])).toEqual([]);}
 const older=task();older.requests.push({...older.requests[0],id:'latest',sourceRefs:[{sourceId:'missing',version:1,digest:'d'.repeat(64)}]});expect(taskResumeSuggestions([older])).toEqual([]);
});
it('rechecks inherited source ownership, binds status/privacy/metadata identity and never treats a completed request as unfinished',()=>{
 const parent=task('parent'),original=withSource(parent),child=task('child'),copy=withSource(child);copy.projectOrigin={projectId:'project',sourceKey:'key',taskId:parent.id,reference:{sourceId:original.id,version:1,digest:original.versions[0].digest},copiedVersion:1,copiedDigest:copy.versions[0].digest};
 const first=taskResumeSuggestions([parent,child]).find(item=>item.taskId==='child')!;expect(first).toBeDefined();original.freshness='refresh-required';expect(taskResumeSuggestions([parent,child])).toEqual([]);original.freshness='fresh';
 for(const mutate of [(owner:Task)=>{owner.title+=' changed';},(owner:Task)=>{owner.goal+=' changed';},(owner:Task)=>{owner.requests[0].status='failed';},(owner:Task)=>{owner.session={...emptyTaskSession(),sourceSelection:{revision:1,sourceIds:['source']}};}]){const changed=structuredClone(child);mutate(changed);expect(taskResumeSuggestions([parent,changed]).find(item=>item.taskId==='child')?.binding).not.toBe(first.binding);}
 const completed=task('completed','completed');completed.requests[0].answer={artifactId:'answer',revision:1,digest:'e'.repeat(64)};completed.artifacts=[{id:'answer',revisions:[{revision:1,digest:'e'.repeat(64),title:'Answer',content:'PRIVATE ANSWER',mimeType:'text/plain',sourceRefs:[],createdAt:completed.updatedAt}]}];expect(taskResumeSuggestions([completed])[0]).toMatchObject({status:'completed',reason:'A completed response is saved in this task.',prompt:'Review the saved response and choose a follow-up.'});
});
it('persists default-off opt-in, bounded opaque dismissals and recompute across new instances',()=>{
 const saved=storage(),first=createTaskResumePreference(()=>saved.access);expect(first.getSnapshot()).toMatchObject({enabled:false,available:true,dismissed:[]});first.set(true);const binding='a'.repeat(64);first.dismiss(binding);const reopened=createTaskResumePreference(()=>saved.access);expect(reopened.getSnapshot()).toMatchObject({enabled:true,dismissed:[binding]});reopened.set(false);expect(createTaskResumePreference(()=>saved.access).getSnapshot().enabled).toBe(false);reopened.set(true);reopened.recompute();expect(reopened.getSnapshot().dismissed).toEqual([]);
 for(let i=0;i<105;i++)reopened.dismiss(i.toString(16).padStart(64,'0'));expect(reopened.getSnapshot().dismissed).toHaveLength(100);expect(JSON.stringify([...saved.data.values()])).not.toContain('PRIVATE');
});
it('fails closed on malformed/unavailable/quota/lost preference writes and refreshes from persisted choice',()=>{
 const saved=storage(),preference=createTaskResumePreference(()=>saved.access);saved.data.set(preference.key,'{"enabled":true}');expect(preference.getSnapshot()).toMatchObject({enabled:false,available:false});expect(()=>preference.set(true)).toThrow('could not be saved');expect(saved.data.get(preference.key)).toBe('{"enabled":true}');
 for(const access of [{getItem:()=>null,setItem:()=>{throw Error('Quota');}},{getItem:()=>null,setItem:()=>{} }]){const failed=createTaskResumePreference(()=>access);expect(()=>failed.set(true)).toThrow('could not be saved');expect(failed.getSnapshot()).toMatchObject({enabled:false,available:false});}
 const good=storage(),active=createTaskResumePreference(()=>good.access);active.set(true);good.data.set(active.key,JSON.stringify({schemaVersion:1,enabled:false,dismissed:[]}));active.refresh();expect(active.getSnapshot()).toMatchObject({enabled:false,available:true});
});

it('keeps a dismissed candidate stable through real core/store reopen when its relevant state is unchanged',async()=>{
 await mkdir('work/continuation',{recursive:true});const dataDir=resolve(await mkdtemp('work/continuation/resume-reopen-'));let core=await createCompanion({dataDir});
 try{const owner=await core.createTask({title:'Synthetic saved review'});await core.runRequest({taskId:owner.id,requestId:crypto.randomUUID(),kind:'explain',prompt:'Synthetic question'},async()=>{throw Error('Synthetic failed without network');});const before=taskResumeSuggestions(await core.listTasks())[0],saved=storage(),preference=createTaskResumePreference(()=>saved.access);preference.set(true);preference.dismiss(before.binding);await core.close();core=await createCompanion({dataDir});const after=taskResumeSuggestions(await core.listTasks())[0];expect(after.binding).toBe(before.binding);expect(createTaskResumePreference(()=>saved.access).getSnapshot().dismissed).toContain(after.binding);}finally{await core.close();}
});
