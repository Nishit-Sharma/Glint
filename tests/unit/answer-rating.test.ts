import {expect,test,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AnswerRatings} from '../../src/host/answer-rating';
import {readAnswerRatingCommand,type AnswerRatingSaved} from '../../src/shared/answer-rating';
import {ratingHash,ratingTask,ratingSelection} from '../support/answer-rating.fixture';
import type {Task} from '../../src/core/types';

test('exact original answer ratings persist privately through reopen and per-answer CAS serializes collisions without changing conversation state',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-')),task=ratingTask(),other=ratingTask('other-owner'),selection=ratingSelection(task),before=JSON.stringify([task,other]),readTask=async(id:string)=>structuredClone(id===task.id?task:other),open=()=>new AnswerRatings(directory,readTask),ratings=open(),read={type:'answerRating.read' as const,selection};
 try{
  expect(await ratings.read(read)).toEqual({kind:'available',selection,revision:0,rating:null});await expect(readFile(join(directory,'answer-ratings.json'))).rejects.toMatchObject({code:'ENOENT'});
  const up={type:'answerRating.set' as const,selection,expectedRevision:0,rating:'up' as const},down={...up,rating:'down' as const},results=await Promise.allSettled([ratings.set(up),ratings.set(down)]);expect(results[0].status).toBe('fulfilled');expect(results[1].status).toBe('rejected');expect(await open().read(read)).toEqual({kind:'available',selection,revision:1,rating:'up'});
  const raw=await readFile(join(directory,'answer-ratings.json'),'utf8');expect(raw).not.toMatch(/PRIVATE ORIGINAL QUESTION|PRIVATE UNSENT DRAFT|Exact original saved answer|LATER FILE CONTENT/);expect((await stat(join(directory,'answer-ratings.json'))).mode&0o777).toBe(0o600);expect(await ratings.set({...up,expectedRevision:1})).toMatchObject({revision:1,rating:'up'});expect(await readFile(join(directory,'answer-ratings.json'),'utf8')).toBe(raw);
  const otherSelection=ratingSelection(other);expect(await ratings.set({...down,selection:otherSelection})).toMatchObject({revision:1,rating:'down'});expect(await ratings.set({...down,expectedRevision:1})).toMatchObject({revision:2,rating:'down'});expect(await open().read(read)).toMatchObject({revision:2,rating:'down'});expect(await open().read({type:'answerRating.read',selection:otherSelection})).toMatchObject({revision:1,rating:'down'});expect(JSON.stringify([task,other])).toBe(before);expect((await readdir(directory)).some(name=>name.endsWith('.tmp'))).toBe(false);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('strict commands and exact original answer identity reject stale, foreign, unfinished, ambiguous and changed-byte targets without a write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-targets-')),original=ratingTask(),selection=ratingSelection(original);let task=structuredClone(original);const ratings=new AnswerRatings(directory,async()=>structuredClone(task)),read={type:'answerRating.read' as const,selection},set={type:'answerRating.set' as const,selection,expectedRevision:0,rating:'up' as const};
 try{
  for(const command of [{...read,telemetry:true},{...set,report:'bad'},{...set,rating:'neutral'},{...set,expectedRevision:-1},{...read,type:'answerRating.report'}])expect(()=>readAnswerRatingCommand(command)).toThrow();
  const mutations:Array<(task:Task)=>void>=[value=>{value.id='foreign-owner';},value=>{value.status='paused';},value=>{value.requests[0].status='running';},value=>{value.requests[0].status='failed';},value=>{value.requests[0].digest=ratingHash('changed request');},value=>{value.requests[0].answer!.revision=2;},value=>{value.requests[0].answer!.digest=ratingHash('changed answer');},value=>{value.requests[0].artifactId='another-file';},value=>{value.artifacts[0].revisions[0].content='CHANGED ORIGINAL BYTES';},value=>{value.requests.push(structuredClone(value.requests[0]));},value=>{value.artifacts.push(structuredClone(value.artifacts[0]));},value=>{value.artifacts[0].revisions.push(structuredClone(value.artifacts[0].revisions[0]));}];
  for(const mutate of mutations){task=structuredClone(original);mutate(task);await expect(ratings.read(read)).rejects.toThrow();await expect(ratings.set(set)).rejects.toThrow();await expect(readFile(join(directory,'answer-ratings.json'))).rejects.toMatchObject({code:'ENOENT'});}
  task=structuredClone(original);task.artifacts[0].revisions.push({...task.artifacts[0].revisions[1],revision:3});expect(await ratings.set(set)).toMatchObject({revision:1,rating:'up'});expect(await ratings.read(read)).toMatchObject({revision:1,rating:'up'});
 }finally{await rm(directory,{recursive:true,force:true});}
});

test.each(['corrupt','unknown-field','duplicate','oversized','full'])('preserves %s private storage instead of overwriting it',async kind=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-store-')),task=ratingTask(),selection=ratingSelection(task),ratings=new AnswerRatings(directory,async()=>structuredClone(task)),entry={selection,revision:1,rating:'up'},set={type:'answerRating.set' as const,selection,expectedRevision:0,rating:'up' as const};
 const raw=kind==='corrupt'?'{broken':kind==='unknown-field'?JSON.stringify({schemaVersion:1,entries:[],future:'keep'}):kind==='duplicate'?JSON.stringify({schemaVersion:1,entries:[entry,entry]}):kind==='oversized'?'x'.repeat(2*1024*1024+1):JSON.stringify({schemaVersion:1,entries:Array.from({length:1000},(_,index)=>({...entry,selection:{...selection,requestId:'other-'+index}}))});
 try{await writeFile(join(directory,'answer-ratings.json'),raw);if(kind==='full')await expect(ratings.set(set)).rejects.toThrow(/1,000/);else{expect(await ratings.read({type:'answerRating.read',selection})).toMatchObject({kind:'unavailable'});expect(await ratings.set(set)).toMatchObject({kind:'unavailable'});}expect(await readFile(join(directory,'answer-ratings.json'),'utf8')).toBe(raw);}finally{await rm(directory,{recursive:true,force:true});}
});

test.each(['answer','owner'])('fresh %s validation immediately before publication keeps a stale rating from being saved',async change=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-fresh-')),task=ratingTask(),selection=ratingSelection(task);let reads=0,active=true;const ratings=new AnswerRatings(directory,async()=>{if(++reads===3){if(change==='answer')task.artifacts[0].revisions[0].content='CHANGED BEFORE PUBLICATION';else active=false;}return structuredClone(task);});
 try{await expect(ratings.set({type:'answerRating.set',selection,expectedRevision:0,rating:'down'},()=>{if(!active)throw Error('Owner changed');})).rejects.toThrow();await expect(readFile(join(directory,'answer-ratings.json'))).rejects.toMatchObject({code:'ENOENT'});expect(await readdir(directory)).toEqual([]);}finally{await rm(directory,{recursive:true,force:true});}
});

test.each(['answer','owner'])('same-rating no-op rejects a changed %s after its asynchronous store read without rewriting the vote',async change=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-noop-')),task=ratingTask(),selection=ratingSelection(task);let active=true;const ratings=new AnswerRatings(directory,async()=>structuredClone(task)),command={type:'answerRating.set' as const,selection,expectedRevision:0,rating:'up' as const},guard=()=>{if(!active)throw Error('Owner changed');};
 try{
  await ratings.set(command,guard);const before=await readFile(join(directory,'answer-ratings.json')),loader=ratings as unknown as {load:()=>Promise<AnswerRatingSaved>},load=loader.load.bind(ratings);
  vi.spyOn(loader,'load').mockImplementationOnce(async()=>{const saved=await load();await Promise.resolve();if(change==='answer')task.artifacts[0].revisions[0].content='CHANGED DURING NOOP READ';else active=false;return saved;});
  await expect(ratings.set({...command,expectedRevision:1},guard)).rejects.toThrow();expect(await readFile(join(directory,'answer-ratings.json'))).toEqual(before);
 }finally{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});}
});

test.each(['answer','owner'])('a committed vote with changed %s during readback rejects its acknowledgement and recovers by read only',async change=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-answer-rating-readback-')),task=ratingTask(),selection=ratingSelection(task),original=structuredClone(task);let active=true;const ratings=new AnswerRatings(directory,async()=>structuredClone(task)),loader=ratings as unknown as {load:()=>Promise<AnswerRatingSaved>},load=loader.load.bind(ratings);let reads=0;
 try{
  vi.spyOn(loader,'load').mockImplementation(async()=>{const saved=await load();if(++reads===2){if(change==='answer')task.artifacts[0].revisions[0].content='CHANGED DURING ACK READ';else active=false;}return saved;});
  await expect(ratings.set({type:'answerRating.set',selection,expectedRevision:0,rating:'down'},()=>{if(!active)throw Error('Owner changed');})).rejects.toThrow();const committed=await readFile(join(directory,'answer-ratings.json'));expect(JSON.parse(committed.toString()).entries[0]).toMatchObject({revision:1,rating:'down'});Object.assign(task,original);active=true;
  expect(await ratings.read({type:'answerRating.read',selection})).toMatchObject({revision:1,rating:'down'});expect(await readFile(join(directory,'answer-ratings.json'))).toEqual(committed);
 }finally{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});}
});
