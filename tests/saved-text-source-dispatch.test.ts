import {expect,it,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {sourceTextDraftOwner,sourceTextDraftBasis,emptySourceTextDraft,sourceTextDraftWithIntent,SOURCE_TEXT_DRAFT_SLOT} from '../src/shared/source-text-draft';
import {sourceTextSavePayload,sourceTextSaveBindingText,SOURCE_TEXT_SAVE_BINDING_PREFIX} from '../src/shared/source-text-save';
import {offlineTaskEntry} from './offline-task-entry.fixture';
import {OnboardingFixture} from './onboarding-fixture';
import type {Command} from '../src/shared/bridge';

it('the used offline-to-onboarding route dispatches closed source inspection to the real core without source or sidecar writes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'saved-source-used-dispatch-')),core=await createCompanion({dataDir:directory});
 let open:ReturnType<typeof vi.spyOn>|undefined;
 try{
  const created=await core.createTask({title:'Owned real used-route dispatch'}),task=await core.putSource(created.id,{kind:'text',label:'Current source',content:'Committed initial.',role:'fact'}),source=task.sources[0],v=source.versions[0],expectedSource={sourceId:source.id,version:v.version,digest:v.digest,freshness:source.freshness},raw={label:'Original raw Ω',content:'Original body remains recoverable.',role:'inspiration' as const},payload=sourceTextSavePayload(task.id,expectedSource,raw),intentId=randomUUID(),binding=SOURCE_TEXT_SAVE_BINDING_PREFIX+createHash('sha256').update(sourceTextSaveBindingText(payload)).digest('hex');
  const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(task=>task.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();const owner=sourceTextDraftOwner(task.id,source.id),basis=sourceTextDraftBasis(expectedSource,'fresh');cache.edit(owner,SOURCE_TEXT_DRAFT_SLOT,emptySourceTextDraft,basis,()=>sourceTextDraftWithIntent({...emptySourceTextDraft,present:true,...raw},raw,intentId,binding));await cache.flush();
  // Replace only browser opening. The actual offline wrapper, actual fallback
  // OnboardingFixture.invoke method and actual core/sidecar execute below.
  const fixture=Object.assign(Object.create(OnboardingFixture.prototype),{core,directory,commands:[] as Command[],learningDrafts:store}) as OnboardingFixture;
  open=vi.spyOn(OnboardingFixture,'open').mockResolvedValue(fixture);
  const entry=await offlineTaskEntry(undefined as never),inspect:Command={type:'source.text.inspect',taskId:task.id,sourceId:source.id,expectedSource,intentId,binding};
  const before=await core.getTask(task.id),bytes=await readFile(join(directory,'learning-drafts.json'));
  expect(await entry.fixture.invoke(inspect)).toMatchObject({kind:'uncommitted',expectedUnchanged:true,intentId,binding});expect(await core.getTask(task.id)).toEqual(before);expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(bytes);expect(fixture.commands).toEqual([inspect]);
  const confirmed=await core.saveTextSource({...payload,intentId,binding}),after=await core.getTask(task.id);expect(await entry.fixture.invoke(inspect)).toMatchObject({kind:'confirmed',reference:confirmed.reference,intentId,binding});expect(await core.getTask(task.id)).toEqual(after);expect(after.sources[0].versions).toHaveLength(2);expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(bytes);
  await expect(entry.fixture.invoke({...inspect,extra:true} as Command)).rejects.toThrow();expect(await core.getTask(task.id)).toEqual(after);expect(await readFile(join(directory,'learning-drafts.json'))).toEqual(bytes);
 }finally{open?.mockRestore();await core.close();await rm(directory,{recursive:true,force:true});}
});
