// Regression from review browser-a-review-b (F1): relaxing inherited lineage history for a relinked basis
// (local-workflow-publication.test.ts) must not admit a basis document whose own direct link is stale.
import {afterEach,expect,it} from 'vitest';
import {documentRecipeFixture} from '../support/document-recipe.fixture';
import {saveDocumentRecipe} from '../../src/core/document-recipe-host';
import {previewDocumentRecipe} from '../../src/shared/document-recipe';
const close:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const c of close.splice(0))await c();});
async function seed(sameSource:boolean){
 const f=await documentRecipeFixture();close.push(f.close);
 // Basis helper document linked to source S at v1 (S = the recipe input source, or an unrelated source).
 const sid=sameSource?'handoff-source':'other-source';
 const owner=await f.core.putSource(f.owner.taskId,{id:sid,kind:'text',role:'fact',label:'Fresh local notes',content:'Owner: Mira\nNext: v1'}),s=owner.sources.find(x=>x.id===sid)!,v1={sourceId:sid,version:1,digest:s.versions[0].digest};
 const basis=await f.core.saveArtifact(f.owner.taskId,{artifactId:f.owner.artifactId,expectedRevision:1,title:f.artifact.revisions[0].title,content:f.artifact.revisions[0].content,mimeType:f.artifact.revisions[0].mimeType,sourceRefs:[v1]});
 f.owner.artifactRevision=basis.revision.revision;f.owner.artifactDigest=basis.revision.digest;await f.teach();
 // The basis's own dependency changes; the basis is never reviewed/relinked.
 if(!sameSource)await f.core.putSource(f.owner.taskId,{id:sid,kind:'text',role:'fact',label:'Fresh local notes',content:'Owner: Mira\nNext: v2 changed'});
 const request=await f.source('Owner: Rowan\nNext: v2 changed'); // sameSource: this IS the basis dependency's v2
 const preview=previewDocumentRecipe(await f.core.getTask(f.owner.taskId),request);
 const artifacts=async()=>(await f.core.getTask(f.owner.taskId)).artifacts.length;
 return {artifacts,run:()=>saveDocumentRecipe(f.core,{...request,binding:preview.binding,confirmed:'save-reviewed-new-document'})};
}
it('a stale direct basis link on another source blocks the publication',async()=>{
 const {artifacts,run}=await seed(false),before=await artifacts();await expect(run()).rejects.toThrow(/Source changed/);expect(await artifacts()).toBe(before);
});
it('a stale direct basis link still blocks when the request cites the same source at its current version',async()=>{
 const {artifacts,run}=await seed(true),before=await artifacts();await expect(run()).rejects.toThrow();expect(await artifacts()).toBe(before);
});
