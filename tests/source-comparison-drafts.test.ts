import {afterEach,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {comparisonDraftFixture,basis,slot} from './source-comparison-drafts.fixture';
import {emptySourceComparisonDraft,readSourceComparisonDraft,sourceComparisonOwner} from '../src/shared/source-comparison-draft';
import {learningDraftKey,parseLearningDraftFile,parseLearningDraftValue,serializeLearningDraftJson} from '../src/shared/learning-drafts';
import {parseLearningDraftFile as oldParse} from './fixtures/a91/src/shared/learning-drafts';
import {sourceComparisonArtifact} from '../src/renderer/src/source-comparison';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of close.splice(0))await f();});
const envelope=(raw:unknown)=>({initial:serializeLearningDraftJson(emptySourceComparisonDraft),value:serializeLearningDraftJson(raw),basis});
test('closed comparison owner/slot/raw pair bounds retain exact whitespace without authority fields',()=>{
 const owner=sourceComparisonOwner('task'),ref={sourceId:'source',version:1,digest:'a'.repeat(64)},raw={refs:[ref,null],question:'x'.repeat(200),comparison:'y'.repeat(6000),uncertainty:'z'.repeat(6000)};
 expect(parseLearningDraftValue(envelope(raw),owner,slot)).toEqual(envelope(raw));expect(readSourceComparisonDraft(raw)).toEqual(raw);expect(parseLearningDraftValue(envelope({...raw,question:'\u0001'.repeat(200),comparison:'\u0001'.repeat(6000),uncertainty:'\u0001'.repeat(6000)}),owner,slot)).not.toBeNull();
 for(const change of [{refs:[ref]},{refs:[ref,null,null]},{refs:[{...ref,version:0},null]},{refs:[{...ref,digest:'wrong'},null]},{refs:[{...ref,content:'PRIVATE BODY'},null]},{question:'x'.repeat(201)},{comparison:'x'.repeat(6001)},{uncertainty:'x'.repeat(6001)},{authority:'fresh'}])expect(()=>parseLearningDraftValue(envelope({...raw,...change}),owner,slot)).toThrow();
 expect(()=>parseLearningDraftValue({...envelope(raw),basis:'new-source'},owner,slot)).toThrow();expect(()=>parseLearningDraftValue(envelope(raw),owner,'comparison:other')).toThrow();expect(()=>parseLearningDraftValue({...envelope(raw),initial:'{}'},owner,slot)).toThrow();
 let reads=0;const unsafe={...raw};Object.defineProperty(unsafe,'question',{enumerable:true,get(){reads++;return 'executed';}});expect(()=>envelope(unsafe)).toThrow();expect(reads).toBe(0);
 expect(learningDraftKey(owner,slot)).not.toBe(learningDraftKey(sourceComparisonOwner('other'),slot));
});
test('real cache quit-flush and core/store reopening retain exact raw refs through stale/revoked sources without publication',async()=>{
 const f=await comparisonDraftFixture();close.push(f.close);expect(f.edit()).toMatchObject({kind:'accepted'});f.cache.setFrozen(true);await f.cache.flushForQuit();await f.recreate(true);
 expect(f.cache.readForm(f.owner,slot,emptySourceComparisonDraft,basis)).toMatchObject({status:'ready',value:f.raw});await f.refresh();await f.revoke();
 expect(f.cache.tryEdit(f.owner,slot,emptySourceComparisonDraft,basis,current=>({...current,comparison:current.comparison+'Later private note.'}))).toMatchObject({kind:'accepted'});await f.recreate(true);
 const recovered=f.cache.readForm(f.owner,slot,emptySourceComparisonDraft,basis);expect(recovered.value.refs).toEqual(f.raw.refs);expect(recovered.value.comparison).toContain('Later private note.');expect(()=>sourceComparisonArtifact(f.task,recovered.value.refs.map(ref=>ref??undefined),{question:recovered.value.question,comparison:recovered.value.comparison,uncertainty:recovered.value.uncertainty})).toThrow();
 expect(f.task.artifacts).toEqual([]);expect(f.task.requests).toEqual([]);const bytes=await readFile(f.directory+'/learning-drafts.json','utf8');expect(bytes).not.toContain('PRIVATE BODY');expect(parseLearningDraftFile(JSON.parse(bytes)).records).toHaveLength(1);expect(()=>oldParse(JSON.parse(bytes))).toThrow();expect(await readFile(f.directory+'/learning-drafts.json','utf8')).toBe(bytes);
 await f.second();expect(f.cache.readForm(sourceComparisonOwner(f.task.id),slot,emptySourceComparisonDraft,basis).value).toEqual(emptySourceComparisonDraft);
});
test('host accepts retained historical text refs but rejects foreign/digest/missing references before disk mutation',async()=>{
 const f=await comparisonDraftFixture();close.push(f.close);await f.refresh();await f.revoke();expect(await f.store.save(f.owner,slot,'initial',0,envelope(f.raw))).toMatchObject({kind:'saved'});
 const before=await readFile(f.directory+'/learning-drafts.json','utf8');
 for(const change of [{sourceId:'missing'},{digest:'b'.repeat(64)},{version:999}])await expect(f.store.save(f.owner,slot,'initial',1,envelope({...f.raw,refs:[{...f.refs[0],...change},f.refs[1]]}))).rejects.toThrow();
 await f.second();await expect(f.store.save(sourceComparisonOwner(f.task.id),slot,'initial',0,envelope(f.raw))).rejects.toThrow();expect(await readFile(f.directory+'/learning-drafts.json','utf8')).toBe(before);
});
test('write failure holds quit and raw notes; retry and exact-generation acknowledgement use existing CAS tombstones',async()=>{
 const f=await comparisonDraftFixture();close.push(f.close);f.failWrites();f.edit();await expect(f.cache.flush()).rejects.toThrow('Owned draft write failure');expect(f.cache.readForm(f.owner,slot,emptySourceComparisonDraft,basis).value).toEqual(f.raw);f.cache.setFrozen(true);await expect(f.cache.flushForQuit()).rejects.toThrow();f.cache.setFrozen(false);f.failWrites(false);await f.cache.retry(f.owner,slot);await f.cache.flush();
 const stale=f.cache.capture(f.owner,slot)!;f.cache.tryEdit(f.owner,slot,emptySourceComparisonDraft,basis,current=>({...current,question:current.question+'new'}));expect(f.cache.acknowledge(stale)).toBe(false);await f.cache.flush();const exact=f.cache.capture(f.owner,slot)!;expect(f.cache.acknowledge(exact)).toBe(true);await f.recreate();expect(f.cache.readForm(f.owner,slot,emptySourceComparisonDraft,basis).value).toEqual(emptySourceComparisonDraft);expect((await f.store.read()).kind).toBe('available');
});

test('optional private save identity roundtrips while legacy raw fields and strict identity shape remain intact',()=>{
 const raw={...emptySourceComparisonDraft,question:'Unsent raw \u0001',saveIntent:{id:crypto.randomUUID(),binding:'a'.repeat(64)}};expect(readSourceComparisonDraft(raw)).toEqual(raw);expect(readSourceComparisonDraft(emptySourceComparisonDraft)).toEqual(emptySourceComparisonDraft);for(const intent of [{...raw.saveIntent,id:'not-a-save-id'},{...raw.saveIntent,binding:'bad'},{...raw.saveIntent,authority:true}])expect(()=>readSourceComparisonDraft({...raw,saveIntent:intent})).toThrow();
});
