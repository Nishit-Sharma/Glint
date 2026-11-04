import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {sourceFormulaFixture} from '../support/source-formula.fixture';
import {saveSourceFormula} from '../../src/core/source-formula-host';
import {LearningDraftStore} from '../../src/host/learning-drafts';
import {createLearningDrafts} from '../../src/renderer/src/learning-drafts';
import {unfinishedDocuments} from '../../src/renderer/src/unfinished-documents';
import {TARGET_REVIEW_SLOT,TARGET_INTENT_SLOT,emptyTargetReview,emptyTargetIntent,targetDraftBasis,type TargetDraftOwner} from '../../src/shared/experiment-target-draft';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis,savedDocumentDraftOwner} from '../../src/shared/saved-document-draft';

it('indexes only the ordinary document while exact target reasoning and pending intent remain isolated and recoverable in the same sidecar',async()=>{
 const f=await sourceFormulaFixture();try{
  const formula=await saveSourceFormula(f.core,{input:f.input}),saved=await f.core.saveArtifact(f.task.id,{title:'Ordinary visit note',content:'Saved note.',mimeType:'text/markdown',sourceRefs:[f.input.sourceRef]}),task=await f.core.getTask(f.task.id),owner:TargetDraftOwner={kind:'experiment-target-practice',taskId:task.id,artifactId:formula.artifactId,artifactRevision:formula.revision,artifactDigest:formula.digest};
  const store=new LearningDraftStore({directory:f.directory,lookupTask:async id=>(await f.core.listTasks()).find(item=>item.id===id)}),make=()=>createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)}),cache=make();await cache.load();
  const targetRaw={...emptyTargetReview,variable:'time',answer:'unfinished 2e-',reasoning:'  PRIVATE_TARGET_REASONING\nkeep exact  '},intentRaw={pendingText:'PRIVATE_TARGET_INTENT: incomplete original text'},documentOwner=savedDocumentDraftOwner(task.id,saved.artifactId),documentRaw={present:true,title:'PRIVATE_DOCUMENT_TITLE',content:'',sourceRefs:[f.input.sourceRef]};
  expect(cache.tryEdit(owner,TARGET_REVIEW_SLOT,emptyTargetReview,targetDraftBasis(owner,TARGET_REVIEW_SLOT),()=>targetRaw).kind).toBe('accepted');expect(cache.tryEdit(owner,TARGET_INTENT_SLOT,emptyTargetIntent,targetDraftBasis(owner,TARGET_INTENT_SLOT),()=>intentRaw).kind).toBe('accepted');expect(cache.tryEdit(documentOwner,SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis(task,saved.artifactId,saved.revision),()=>documentRaw).kind).toBe('accepted');await cache.flush();
  const before=await readFile(f.directory+'/learning-drafts.json'),state=cache.getSnapshot(),rows=unfinishedDocuments([task],state);
  expect(rows.map(row=>[row.match.taskId,row.match.artifactId,row.match.title])).toEqual([[task.id,saved.artifactId,'Ordinary visit note']]);expect(JSON.stringify(rows)).not.toContain('PRIVATE_');expect(cache.getSnapshot()).toBe(state);expect(await readFile(f.directory+'/learning-drafts.json')).toEqual(before);
  const reopened=make();await reopened.load();expect(reopened.readForm(owner,TARGET_REVIEW_SLOT,emptyTargetReview,targetDraftBasis(owner,TARGET_REVIEW_SLOT))).toMatchObject({status:'ready',value:targetRaw});expect(reopened.readForm(owner,TARGET_INTENT_SLOT,emptyTargetIntent,targetDraftBasis(owner,TARGET_INTENT_SLOT))).toMatchObject({status:'ready',value:intentRaw});expect(reopened.readForm(documentOwner,SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis(task,saved.artifactId,saved.revision))).toMatchObject({status:'ready',value:documentRaw});expect(await f.core.getTask(task.id)).toEqual(task);expect(await readFile(f.directory+'/learning-drafts.json')).toEqual(before);
 }finally{await f.close();}
});
