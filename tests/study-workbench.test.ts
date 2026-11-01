import {expect,it} from 'vitest';
import {parseStudyNotes,readStudySet} from '../src/shared/study-workbench';
import {createCompanion} from '../src/core/companion';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

it('derives editable definition and cloze cards from previously unseen notes with exact Unicode source spans and visible unsupported lines',()=>{
 const text='# Plant transport\nXylem :: Carries water from roots.\nPhloem: Carries sugars between tissues.\nThe leaf releases {{water vapour}} through stomata.\nRésumé 東京 is a source annotation, not a keyed question.\n';
 const result=parseStudyNotes(text);expect(result.cards).toHaveLength(3);expect(result.cards.map(card=>card.answer)).toEqual(['Carries water from roots.','Carries sugars between tissues.','water vapour']);
 for(const card of result.cards)expect(text.slice(card.anchor.start,card.anchor.end)).toBe(card.anchor.quote);
 expect(result.cards[0]).toMatchObject({topic:'Plant transport',term:'Xylem'});expect(result.cards[2].question).toContain('_____');expect(result.issues.some(issue=>issue.quote.includes('Résumé 東京'))).toBe(true);
});

it('anchors c1 cloze answers after their marker even when the answer repeats the marker text',()=>{
 const notes='Name is {{c1::c1}}.\nCount is {{c1::1}}.\n',parsed=parseStudyNotes(notes);expect(parsed.cards).toHaveLength(2);for(const card of parsed.cards){expect(card.anchor.termStart).toBe(card.anchor.start+card.anchor.quote.indexOf('::')+2);expect(notes.slice(card.anchor.termStart,card.anchor.termEnd)).toBe(card.answer);}
});

it('surfaces conflicting source keys and rejects ambiguous or whitespace-only manual questions in the canonical save path',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-study-ambiguity-')),core=await createCompanion({dataDir:directory});try{const task=await core.createTask({title:'Ambiguous reviewed notes'}),put=await core.putSource(task.id,{kind:'text',label:'Capital notes',role:'fact',content:'Capital :: London.\nCapital :: Paris.\n'}),source=put.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest},preview=await core.previewStudyNotes(task.id,reference),blank=await core.saveStudySet({type:'study.create',taskId:task.id,intentId:randomUUID()});expect(preview.issues.some(issue=>/ambigu/i.test(issue.reason))).toBe(true);
  const save={type:'study.save' as const,taskId:task.id,artifactId:blank.artifactId,expectedRevision:1,name:'Explicit reviewed capitals',reference,cards:preview.cards};await expect(core.saveStudySet(save)).rejects.toThrow(/distinct|conflict|ambigu/i);expect((await core.getTask(task.id)).artifacts[0].revisions).toHaveLength(1);
  const cards=preview.cards.map((card,index)=>({...card,question:index?'What is the second explicitly noted capital?':'What is the first explicitly noted capital?'}));await expect(core.saveStudySet({...save,cards:cards.map((card,index)=>index?card:{...card,answer:'   '})})).rejects.toThrow();expect(()=>readStudySet({kind:'study-set',schemaVersion:1,creationId:'owned',name:'Notes',material:preview.material,cards:cards.map((card,index)=>index?card:{...card,question:'  ',topic:'\t'})})).toThrow();expect((await core.saveStudySet({...save,cards})).revision.revision).toBe(2);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('persists exact-version study sets, mixed keyed scores and a second unanswered attempt without provider requests or draft changes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-study-core-'));let core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned study topic'});await core.saveComposerDraft(task.id,0,{text:'Keep unsent question731\n',kind:'explain'});const put=await core.putSource(task.id,{kind:'text',label:'Plant notes',content:'# Transport\nXylem :: Carries water.\nPhloem :: Carries sugar.\n',role:'fact'}),source=put.sources[0],version=source.versions[0],reference={sourceId:source.id,version:1,digest:version.digest},preview=await core.previewStudyNotes(task.id,reference),blank=await core.saveStudySet({type:'study.create',taskId:task.id,intentId:randomUUID()}),saved=await core.saveStudySet({type:'study.save',taskId:task.id,artifactId:blank.artifactId,expectedRevision:1,name:'Plant transport',reference,cards:preview.cards}),deckRef={artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest};
  let view=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'start',expectedRevision:0,attemptId:'pending-first',mode:'diagnostic',questionIds:preview.cards.map(card=>card.id)}});expect(view.events).toMatchObject([{kind:'needs-input',attemptId:'pending-first',requestRef:{kind:'study-attempt',deckRef}}]);
  view=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'start',expectedRevision:view.state.revision,attemptId:'second-completes',mode:'review',questionIds:preview.cards.map(card=>card.id)}});
  for(const [index,card]of preview.cards.entries()){view=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'answer',expectedRevision:view.state.revision,attemptId:'second-completes',cardId:card.id,answer:index===0?card.answer:'An intentionally different answer.'}});if(index===0)expect(view.events.find(event=>event.attemptId==='second-completes')?.question?.cardId).toBe(preview.cards[1].id);}
  expect(view.events.find(event=>event.attemptId==='second-completes')?.question).toBeUndefined();expect(view.events.find(event=>event.attemptId==='second-completes')?.summary).toMatch(/submit/i);
  view=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'submit',expectedRevision:view.state.revision,attemptId:'second-completes'}});expect(view.events).toEqual(expect.arrayContaining([expect.objectContaining({kind:'needs-input',attemptId:'pending-first'}),expect.objectContaining({kind:'completed',attemptId:'second-completes',score:{correct:1,total:2}})]));expect(view.progress[0]).toMatchObject({assessed:2,correct:1,reviewCardIds:[preview.cards[1].id]});const originalState=view.state;
  await core.close();core=await createCompanion({dataDir:directory});const reopened=await core.getStudyView(task.id,deckRef);expect(reopened.state).toEqual(originalState);expect(reopened.task.session?.draft).toBe('Keep unsent question731\n');expect(reopened.task.requests).toEqual([]);expect(reopened.task.artifacts[0].revisions).toHaveLength(2);
  await core.putSource(task.id,{id:source.id,kind:'text',label:'Changed notes',content:'Xylem :: Edited source text must not regrade old work.',role:'fact'});await expect(core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'resume',expectedRevision:originalState.revision,attemptId:'pending-first'}})).rejects.toThrow(/Source changed/);const historical=await core.getStudyView(task.id,deckRef);expect(historical.current).toBe(false);expect(historical.state).toEqual(originalState);expect(historical.state.attempts[1].results[0].expected).toBe('Carries water.');expect(historical.events.find(event=>event.attemptId==='pending-first')).toMatchObject({kind:'needs-input',applicable:false,blockedReason:expect.any(String)});
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

it('uses authoritative completion order across an out-of-start-order finish and real store reopen',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-study-order-'));let core=await createCompanion({dataDir:directory});
 try{const task=await core.createTask({title:'Completion order'}),put=await core.putSource(task.id,{kind:'text',role:'fact',label:'Orbit notes',content:'Orbit :: A path around a body.'}),source=put.sources[0],reference={sourceId:source.id,version:1,digest:source.versions[0].digest},preview=await core.previewStudyNotes(task.id,reference),blank=await core.saveStudySet({type:'study.create',taskId:task.id,intentId:randomUUID()}),saved=await core.saveStudySet({type:'study.save',taskId:task.id,artifactId:blank.artifactId,expectedRevision:1,name:'Orbit',reference,cards:preview.cards}),deckRef={artifactId:saved.artifactId,revision:saved.revision.revision,digest:saved.revision.digest};let revision=0;
  for(const attemptId of ['started-first','started-second']){const result=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'start',expectedRevision:revision,attemptId,mode:'diagnostic',questionIds:preview.cards.map(card=>card.id)}});revision=result.state.revision;}
  for(const [attemptId,answer]of [['started-second',preview.cards[0].answer],['started-first','Wrong later answer']]){let result=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'answer',expectedRevision:revision,attemptId,cardId:preview.cards[0].id,answer}});result=await core.actOnStudy({type:'study.action',taskId:task.id,deckRef,action:{kind:'submit',expectedRevision:result.state.revision,attemptId}});revision=result.state.revision;}
  expect((await core.getStudyView(task.id,deckRef)).progress[0]).toMatchObject({correct:0,assessed:1,reviewCardIds:[preview.cards[0].id]});await core.close();core=await createCompanion({dataDir:directory});expect((await core.getStudyView(task.id,deckRef)).progress[0].correct).toBe(0);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
