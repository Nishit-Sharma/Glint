import {expect,test,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Task} from '../src/core/types';
import {createCompanion} from '../src/core/companion';
import {searchSavedWork,resolveSavedWorkMatch,savedWorkSearchLimits,type SavedWorkMatch} from '../src/shared/saved-work-search';
import {requestSavedWorkNavigation} from '../src/renderer/src/saved-work-navigation';

const at='2026-10-31T10:00:00Z';
const task=(id='a'):Task=>({id,title:'Owner '+id,goal:'',status:'active',createdAt:at,updatedAt:at,sources:[],artifacts:[{id:'reply',revisions:[{revision:1,title:'Original',content:'  Mesa original answer.\n<script>inert</script>  ',digest:'reply-1',mimeType:'text/markdown',sourceRefs:[],createdAt:at},{revision:2,title:'Edited',content:'Latest document without the old term.',digest:'reply-2',mimeType:'text/markdown',sourceRefs:[],createdAt:at}]}],requests:[{id:'turn',kind:'explain',prompt:'Mesa original question?',digest:'request-1',status:'completed',sourceRefs:[],startedAt:at,finishedAt:at,artifactId:'reply',answer:{artifactId:'reply',revision:1,digest:'reply-1'}}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
const messageHit=(value:Task,kind:'question'|'answer')=>searchSavedWork([value],'mesa','conversations').matches.find((hit):hit is Extract<SavedWorkMatch,{kind:'message'}>=>hit.kind==='message'&&hit.conversation.message===kind)!;
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};

test('conversation search finds literal questions and original answers across exact tasks and leaves stored text unchanged',()=>{
 const a=task(),b=task('b'),before=JSON.stringify([a,b]);
 const result=searchSavedWork([b,a],' mEsA ','conversations');expect(result).toMatchObject({query:'mEsA',scope:'conversations',matchCount:4,searched:4,partial:0,unsearchedMessages:0});expect(result.matches.map(hit=>[hit.taskId,hit.field])).toEqual([['a','Your question'],['a','Assistant answer'],['b','Your question'],['b','Assistant answer']]);
 const answer=messageHit(a,'answer');expect(answer.excerpt).toBe(a.artifacts[0].revisions[0].content);expect(resolveSavedWorkMatch(a,answer)).toEqual({kind:'message',conversation:answer.conversation});
 expect(searchSavedWork([a],'mesa','files').matches).toEqual([]);expect(searchSavedWork([a],'mesa').matchCount).toBe(2);expect(searchSavedWork([a],'.*','conversations').matchCount).toBe(0);expect(searchSavedWork([a],'answer.\n<script>','conversations').matchCount).toBe(1);expect(JSON.stringify([a,b])).toBe(before);
});

test('message reopening rejects changed or ambiguous identities while allowing later edits to the answer file',()=>{
 const original=task(),answer=messageHit(original,'answer'),question=messageHit(original,'question');
 const mutations:Array<(value:Task)=>void>=[v=>{v.id='foreign';},v=>{v.title='Other owner';},v=>{v.requests=[];},v=>{v.requests.push(structuredClone(v.requests[0]));},v=>{v.requests[0].digest='reused';},v=>{v.requests[0].prompt='Changed question';},v=>{v.requests[0].startedAt='other';},v=>{v.requests[0].status='interrupted';},v=>{v.requests[0].answer!.digest='wrong';},v=>{v.artifacts[0].revisions[0].content='Altered original';},v=>{v.artifacts[0].revisions[0].sourceRefs=[{sourceId:'other',version:1,digest:'changed'}];},v=>{v.artifacts[0].revisions.push(structuredClone(v.artifacts[0].revisions[0]));},v=>{v.artifacts.push(structuredClone(v.artifacts[0]));}];
 for(const mutate of mutations){const changed=structuredClone(original);mutate(changed);expect(()=>resolveSavedWorkMatch(changed,answer)).toThrow(/Search again/);}
 const later=structuredClone(original);later.artifacts[0].revisions.push({...later.artifacts[0].revisions[1],revision:3,content:'Another edit',digest:'reply-3'});expect(resolveSavedWorkMatch(later,answer).kind).toBe('message');expect(resolveSavedWorkMatch(later,question).kind).toBe('message');
});

test('conversation scope excludes live requests, brief prompts, error receipts, unsupported responses and image payloads',()=>{
 const value=task();value.requests[0].prompt='ordinary question';value.artifacts[0].revisions[0].content='Before ![Visible diagram](data:image/png;base64,opaque-image-payload) after.';value.requests[0].error='private-error-only';
 expect(searchSavedWork([value],'opaque-image-payload','conversations').matchCount).toBe(0);expect(searchSavedWork([value],'Visible diagram','conversations').matchCount).toBe(1);expect(searchSavedWork([value],'private-error-only','conversations').matchCount).toBe(0);
 for(const mimeType of ['application/json','text/html','image/png']){const changed=structuredClone(value);changed.artifacts[0].revisions[0].mimeType=mimeType;expect(searchSavedWork([changed],'Visible diagram','conversations').matchCount).toBe(0);}
 value.requests[0].status='running';expect(searchSavedWork([value],'ordinary','conversations').matches).toEqual([]);value.requests[0].status='failed';expect(searchSavedWork([value],'ordinary','conversations').matchCount).toBe(1);value.requests[0].kind='brief';expect(searchSavedWork([value],'ordinary','conversations').matchCount).toBe(0);
 const duplicate=task();duplicate.requests.push(structuredClone(duplicate.requests[0]));expect(searchSavedWork([duplicate],'mesa','conversations').matches).toEqual([]);
});

test('whole-message coverage and result limits are disclosed without partially searching messages',()=>{
 const value=task();value.requests[0].prompt='needle'+'x'.repeat(savedWorkSearchLimits.message);value.artifacts=[];expect(searchSavedWork([value],'needle','conversations')).toMatchObject({matches:[],searched:0,partial:0,unsearchedMessages:1});
 value.requests=Array.from({length:22},(_,index)=>({...value.requests[0],id:String(index),prompt:'needle'+'x'.repeat(savedWorkSearchLimits.message-6)}));expect(searchSavedWork([value],'needle','conversations')).toMatchObject({matchCount:20,searched:20,partial:0,unsearchedMessages:2});
 value.requests=Array.from({length:60},(_,index)=>({...value.requests[0],id:String(index),prompt:'needle'}));const capped=searchSavedWork([value],'needle','conversations');expect(capped.matchCount).toBe(60);expect(capped.matches).toHaveLength(50);
});

test('a held message lookup rechecks the fresh task list and retires when navigation changes',async()=>{
 for(const change of ['none','deleted','reused','new-list','retired']){
  const destination=task(),hit=messageHit(destination,'answer');let known:Task|undefined=destination,generation=1,current=true,release!:(value:Task)=>void;const open=vi.fn(),failed=vi.fn();
  requestSavedWorkNavigation(hit,{current:()=>current,listGeneration:()=>generation,knownTask:()=>known,guard:action=>{action();return true;},dirty:()=>false,flush:async()=>{},load:()=>new Promise(resolve=>{release=resolve;}),started:()=>{},finished:()=>{},failed,open});await tick();
  if(change==='deleted')known=undefined;if(change==='reused'){known=structuredClone(destination);known.requests[0].digest='reused';}if(change==='new-list')generation++;if(change==='retired')current=false;release(destination);await tick();
  expect(open).toHaveBeenCalledTimes(change==='none'?1:0);expect(failed).toHaveBeenCalledTimes(change==='none'||change==='retired'?0:1);
 }
});

test('search and exact response reopening preserve bytes across controlled core recreation',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'conversation-search-'));let core=await createCompanion({dataDir:directory});
 try{
  const owner=await core.createTask({title:'Saved conversation'});await core.runRequest({taskId:owner.id,requestId:'recorded',kind:'explain',prompt:'Mesa question?',sourceIds:[]},async()=>({title:'Original answer',content:'Mesa original reply.',mimeType:'text/markdown'}));const current=await core.getTask(owner.id),artifact=current.artifacts[0];await core.saveArtifact(owner.id,{artifactId:artifact.id,expectedRevision:1,title:'Edited file',content:'Updated document.'});
  const bytes=await readFile(join(directory,'tasks.json'),'utf8'),hit=searchSavedWork(await core.listTasks(),'mesa','conversations').matches.find(item=>item.kind==='message'&&item.conversation.message==='answer')!;expect(resolveSavedWorkMatch(await core.getTask(owner.id),hit).kind).toBe('message');expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(bytes);
  await core.close();core=await createCompanion({dataDir:directory});const reopened=await readFile(join(directory,'tasks.json'),'utf8');expect(resolveSavedWorkMatch(await core.getTask(owner.id),hit).kind).toBe('message');expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(reopened);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
