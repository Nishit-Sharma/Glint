import {currentAnswerOrigin} from '../support/current-answer-origin.fixture';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {createGroundedJoinArtifact} from '../../src/core/grounded-join-host';
import {editModule,saveModuleDocument} from '../../src/core/module-state';
import {extractionFixture} from '../support/grounded-join-fixture';
import type {ArtifactRevision,Task} from '../../src/core/types';
import {exampleLesson} from '../../src/learning/example';
import {assertRawModuleOperationAllowed,MODULE_MIME} from '../../src/shared/module-contract';
import {publicErrorMessage} from '../../src/shared/public-messages';
import {RevisionReview} from '../../src/renderer/src/components/RevisionReview';

const hidden='UNSTARTED_TRANSFER_SECRET';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'module-safety-')),core=await createCompanion({dataDir:join(directory,'store')});
 cleanups.push(async()=>{await core.close();await rm(directory,{recursive:true,force:true});});
 return {directory,core};
}
function review(content:string,mimeType=MODULE_MIME){
 const revision:ArtifactRevision={revision:1,title:'Saved lesson',content,mimeType,sourceRefs:[],digest:'saved-digest',createdAt:'2026-10-24T10:00:00Z'};
 const artifact={id:'lesson',revisions:[revision]};
 const task:Task={id:'task',title:'Practice',goal:'',status:'active',createdAt:revision.createdAt,updatedAt:revision.createdAt,sources:[],artifacts:[artifact],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
 return renderToStaticMarkup(createElement(RevisionReview,{task,artifact,revision,back:()=>{},onLatest:()=>{}}));
}
function reviewTask(task:Task,artifactId:string){
 const artifact=task.artifacts.find(artifact=>artifact.id===artifactId)!,revision=artifact.revisions[0];
 return renderToStaticMarkup(createElement(RevisionReview,{task,artifact,revision,back:()=>{},onLatest:()=>{}}));
}
it('saved standalone join revisions show readable practice without unstarted transfer data',()=>{
 const data=structuredClone(exampleLesson);data.transfer.title=hidden;
 const content=JSON.stringify({schemaVersion:1,markdown:'A saved join lesson.',modules:[{id:'join',version:1,data,provenance:[]}]});
 const html=review(content);
 expect(html).toContain('Members and invitations');
 expect(html).not.toContain(hidden);
 expect(html).not.toContain('&quot;modules&quot;');
});
it('raw module export is rejected before a destination lookup or durable export action',async()=>{
 const {core,directory}=await fixture(),task=await core.createTask({title:'Module export'});
 const artifact=await core.saveArtifact(task.id,{title:'Interactive answer',mimeType:MODULE_MIME,content:JSON.stringify({schemaVersion:1,markdown:'Use the lesson controls.',modules:[{id:'join',version:1,data:exampleLesson,provenance:[]}]})});
 const before=await core.getTask(task.id);
 await expect(core.proposeExport(task.id,{artifactId:artifact.artifactId,revision:1,path:join(directory,'missing-parent','raw.json')})).rejects.toThrow('Save as document');
 expect(await core.getTask(task.id)).toEqual(before);
 expect(await readdir(directory)).toEqual(['store']);
});
it.each(['approve','execute'] as const)('restored legacy raw module proposals cannot %s and direct callers get recovery guidance',async operation=>{
 const {core,directory}=await fixture(),task=await core.createTask({title:'Legacy export'});
 const artifact=await core.saveArtifact(task.id,{title:'Legacy bytes',content:'{"legacy":"raw module"}'});
 const action=await core.proposeExport(task.id,{artifactId:artifact.artifactId,revision:1,path:join(directory,'legacy.json')});
 const approved=await core.approveExport(task.id,action.proposal.id,action.proposal.digest);
 await core.close();
 // Reproduce an old raw-module ledger in this disposable store only. Restart still retires its approval.
 const path=join(directory,'store','tasks.json'),state=JSON.parse(await readFile(path,'utf8'));
 state.tasks[0].artifacts[0].revisions[0].mimeType=MODULE_MIME;
 await writeFile(path,JSON.stringify(state));
 const restored=await createCompanion({dataDir:join(directory,'store')});cleanups.push(()=>restored.close());
 const before=await restored.getTask(task.id);
 await expect(operation==='approve'?restored.approveExport(task.id,action.proposal.id,action.proposal.digest):restored.executeExport(task.id,{actionId:action.proposal.id,approvalId:approved.approvalId!,requestId:'legacy-export'})).rejects.toThrow('Save as document');
 expect(await restored.getTask(task.id)).toEqual(before);
 expect(await readdir(directory)).toEqual(['store']);
});
it('the host raw revision policy rejects module replacement with readable recovery',()=>{
 let failure:unknown;
 try{assertRawModuleOperationAllowed(MODULE_MIME,'revise');}catch(error){failure=error;}
 expect(failure).toBeInstanceOf(Error);
 expect(publicErrorMessage(failure)).toContain('answer’s controls');
 expect(publicErrorMessage(failure)).toContain('Save as document');
});
it('saved source-grounded join review uses current saved choices and excludes unstarted transfer definitions',async()=>{
 const {core}=await fixture(),f=extractionFixture(),task=await core.createTask({title:'Grounded review'});
 await core.putSource(task.id,{kind:'text',role:'fact',label:'Owned table source',content:f.content});
 const basis=await currentAnswerOrigin(core,task.id,'module-safety-origin',{title:'Frozen basis',content:'Source-bound join example.'},(await core.getTask(task.id)).sources.map(source=>({sourceId:source.id,version:source.currentVersion,digest:source.versions.at(-1)!.digest})));
 const transfer=structuredClone(f.transfer);transfer.title=hidden;
 const result=await createGroundedJoinArtifact(core,{taskId:task.id,requestId:'grounded',id:'join',title:'Review source tables',version:1,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},proposal:f.proposal,transfer});
 expect(result.status).toBe('completed');
 await editModule(core,{taskId:task.id,artifactId:result.artifactId!,artifactRevision:1,moduleId:'join',action:{kind:'accept-extraction',expectedRevision:0}});
 const current=await core.getTask(task.id),html=reviewTask(current,result.artifactId!);
 expect(html).toContain('Current join: INNER equality on Members.Team = Invitations.Team.');
 expect(html).toContain('Lesson version 1; review revision 1.');
 expect(html).toContain('Predict the output row count to reveal computed pairs.');
 expect(html).not.toContain(hidden);
 expect(html).not.toContain('&quot;transfer&quot;');
 await expect(core.proposeExport(task.id,{artifactId:result.artifactId!,revision:1,path:'/unused/raw.json'})).rejects.toThrow('Save as document');
 const document=await saveModuleDocument(core,{taskId:task.id,artifactId:result.artifactId!,artifactRevision:1,sessionRevision:current.session!.revision});
 const saved=(await core.getTask(task.id)).artifacts.find(artifact=>artifact.id===document.artifactId)!.revisions[0];
 expect(saved.mimeType).toBe('text/markdown');expect(saved.content).not.toContain(hidden);
 expect(()=>assertRawModuleOperationAllowed(saved.mimeType,'revise')).not.toThrow();
});
it.each(['{"schemaVersion":99,"secret":"UNSTARTED_TRANSFER_SECRET"}','not valid JSON UNSTARTED_TRANSFER_SECRET'])('unfamiliar saved modules fail closed without a raw fallback: %s',content=>{
 const html=review(content);
 expect(html).toContain('unavailable or unfamiliar');expect(html).not.toContain(hidden);
 expect(()=>assertRawModuleOperationAllowed(MODULE_MIME,'export')).toThrow('Save as document');
 expect(()=>assertRawModuleOperationAllowed(MODULE_MIME,'revise')).toThrow('answer’s controls');
});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1sAAAAASUVORK5CYII=';
it.each([
 {mimeType:'text/plain',content:'Ordinary notes.'},
 {mimeType:'text/markdown',content:'**Ordinary** notes.'},
 {mimeType:'application/json',content:'{"ordinary":"json"}'},
 {mimeType:'image/png',content:png,encoding:'base64' as const},
])('ordinary $mimeType artifacts retain their existing export bytes and raw-operation policy',async format=>{
 const {core,directory}=await fixture(),task=await core.createTask({title:'Ordinary export'}),artifact=await core.saveArtifact(task.id,{title:'Ordinary artifact',...format});
 const path=join(directory,'ordinary-copy'),action=await core.proposeExport(task.id,{artifactId:artifact.artifactId,revision:1,path});
 const approved=await core.approveExport(task.id,action.proposal.id,action.proposal.digest);
 expect((await core.executeExport(task.id,{actionId:action.proposal.id,approvalId:approved.approvalId!,requestId:'ordinary-export'})).status).toBe('verified');
 expect(await readFile(path)).toEqual(Buffer.from(format.content,format.encoding==='base64'?'base64':'utf8'));
 expect(()=>assertRawModuleOperationAllowed(format.mimeType,'revise')).not.toThrow();
});
it('saved review retains plain text, Markdown and ordinary JSON display',()=>{
 expect(review('Ordinary notes.','text/plain')).toContain('Ordinary notes.');
 expect(review('**Ordinary** notes.','text/markdown')).toContain('<strong>Ordinary</strong>');
 expect(review('{"ordinary":"json"}','application/json')).toContain('<summary>View application/json file</summary>');
});
it('module export guidance survives public formatting without admitting appended diagnostics',()=>{
 let failure:unknown;try{assertRawModuleOperationAllowed(MODULE_MIME,'export');}catch(error){failure=error;}
 const message=publicErrorMessage(failure);
 expect(message).toContain('Save as document');expect(publicErrorMessage(message)).toBe(message);
 expect(publicErrorMessage(message+' /Users/private/file')).not.toContain('/Users');
});
