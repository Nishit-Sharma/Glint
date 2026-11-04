import {expect,test,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import {createCompanion} from '../../src/core/companion';
import {createSignalPractice} from '../../src/core/signal-sequential-practice-host';
import {searchSavedWork,resolveSavedWorkMatch} from '../../src/shared/saved-work-search';
import {requestSavedWorkNavigation} from '../../src/renderer/src/saved-work-navigation';
import {signalPracticeDisplay} from '../../src/renderer/src/signal-practice-display';
import {withoutEmbeddedImageData} from '../../src/shared/saved-work-search-text';
import type {Task} from '../../src/core/types';
const task=(id='a'):Task=>({id,title:'Owner '+id,goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'f',revisions:[{revision:1,digest:'d',title:'Notes',content:'Mesa crates',mimeType:'text/markdown',sourceRefs:[],createdAt:'time'}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('actual source-linked signal practice excludes only its verified internal marker and keeps authored reasoning',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'search-projection-')),core=await createCompanion({dataDir:directory});try{
  let current=await core.createTask({title:'Practice'});current=await core.putSource(current.id,{kind:'text',role:'fact',label:'Source',content:'q <= d;'});const source=current.sources[0].versions[0],refs=[{sourceId:source.id,version:1,digest:source.digest}],basis=await core.saveArtifact(current.id,{title:'Basis',content:'Linked.',sourceRefs:refs}),reasoning='Authored reasoning with <!--signal-sequential-practice-v1:USER--> kept literally.',created=await createSignalPractice(core,{taskId:current.id,basis:{artifactId:basis.artifactId,revision:1,digest:basis.revision.digest},expectedSourceRefs:refs,sourceId:source.id,start:0,end:7,quote:'q <= d;',confirmed:true,answer:1,reasoning});current=await core.getTask(current.id);const artifact=current.artifacts.find(item=>item.id===created.artifactId)!,revision=artifact.revisions[0],encoded=revision.content.match(/\n<!--signal-sequential-practice-v1:([A-Za-z0-9_-]+)-->$/)![1],before=JSON.stringify(current);expect(signalPracticeDisplay(current,artifact,revision,revision.content)).not.toContain(encoded);expect(searchSavedWork([current],encoded.slice(0,40),'files').matches).toEqual([]);expect(searchSavedWork([current],'Authored reasoning','files').matchCount).toBe(1);expect(searchSavedWork([current],'signal-sequential-practice-v1:USER','files').matchCount).toBe(1);expect(JSON.stringify(current)).toBe(before);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
test('actual image data destinations are omitted while labels, adjacent prose, reference names and literal code examples remain',()=>{
 const t=task(),payload='c2VjcmV0LW9ubHk=';t.artifacts[0].revisions[0].content=`Before ![Visible diagram](data:image/png;base64,${payload}) after.\n\n![Reference label][picture]\n\n[picture]: data:image/png;base64,${payload}\n\n<img alt="HTML label" src="data:image/png;base64,${payload}">\n`;
 expect(searchSavedWork([t],payload,'files').matches).toEqual([]);expect(searchSavedWork([t],'Visible diagram','files').matchCount).toBe(1);expect(searchSavedWork([t],'Reference label','files').matchCount).toBe(1);expect(searchSavedWork([t],'Before','files').matchCount).toBe(1);for(const hit of searchSavedWork([t],'diagram','files').matches)expect(hit.excerpt).not.toContain(payload);
 t.artifacts[0].revisions[0].content='`![Literal](data:image/png;base64,visible-code)`\n\n~~~\n![Example](data:image/png;base64,visible-fence)\n~~~\n\nOrdinary user note <!--signal-sequential-practice-v1:USER-->.';expect(searchSavedWork([t],'visible-code','files').matchCount).toBe(1);expect(searchSavedWork([t],'visible-fence','files').matchCount).toBe(1);expect(searchSavedWork([t],'signal-sequential-practice-v1:USER','files').matchCount).toBe(1);
});
test('bounded projection refuses cut image destinations, preserves literal code, and reports ambiguous text honestly',()=>{
 const content='`![Example](data:image/png;base64,same-payload)` then ![Visible](data:image/png;base64,same-payload) after.';
 expect(withoutEmbeddedImageData(content)).toBe('`![Example](data:image/png;base64,same-payload)` then ![Visible]() after.');
 const t=task();t.artifacts[0].revisions[0].content='![Visible diagram](data:image/png;base64,'+'hidden-payload'.repeat(10_000)+')';expect(searchSavedWork([t],'hidden-payload','files')).toMatchObject({matchCount:0,searched:0,partial:0,unavailable:0,unsearchedFiles:1});expect(searchSavedWork([t],'Visible diagram','files').matches).toEqual([]);
 t.artifacts[0].revisions[0].content='> First line\n> ![Diagram](data:image/png;base64,opaque-nested)';expect(searchSavedWork([t],'opaque-nested','files')).toMatchObject({matchCount:0,searched:0,unavailable:1});
});
async function appFunction(){
 const source=await readFile(new URL('../../src/renderer/src/App.tsx',import.meta.url),'utf8'),file=ts.createSourceFile('App.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let found:ts.FunctionDeclaration|undefined;const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='openSavedWork')found=node;ts.forEachChild(node,visit);};visit(file);expect(found).toBeDefined();return ts.transpileModule('('+found!.getText(file)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
}
test('the extracted actual App rejects a held destination after the accepted list deletes or revises it',async()=>{
 const code=await appFunction();for(const change of ['deleted','revised','same-identity-new-list']){
  const origin=task(),destination=task('b'),match=searchSavedWork([destination],'Mesa').matches[0];let release!:(value:Task)=>void;const held=new Promise<Task>(resolve=>{release=resolve;}),setTask=vi.fn(),scope={current:()=>true,started:vi.fn(),finished:vi.fn(),failed:vi.fn()},taskListSnapshot={current:{generation:1,tasks:[origin,destination]}};
  const bindings={requestSavedWorkNavigation,resolveSavedWorkMatch,taskRef:{current:origin},newQuestionEpoch:{current:1},incomingActivationEpoch:{current:1},surfaceIntentEpoch:{current:1},surfaceModeRef:{current:'workspace'},taskListSnapshot,deletedTaskIds:{current:new Set()},draftNavigation:{api:{guard:(action:()=>void)=>(action(),true),hasDirty:()=>false}},drafts:{flush:async()=>{},hydrate:()=>{}},bridge:{invoke:()=>held},viewSelectionEpoch:{current:1},viewRestored:{current:true},retireContext:()=>{},setLocalStart:()=>{},setAddingBot:()=>{},setArrivalIdentities:()=>{},setTask,setTasks:()=>{},setBasePage:()=>{},setError:()=>{},setNotice:()=>{},setRevisionOrigin:()=>{},setReviewRevision:()=>{},setPage:()=>{}};
  const open=new Function(...Object.keys(bindings),'return '+code)(...Object.values(bindings));open(match,scope);await tick();taskListSnapshot.current={generation:2,tasks:change==='deleted'?[origin]:[origin,change==='revised'?{...destination,artifacts:[{...destination.artifacts[0],revisions:[...destination.artifacts[0].revisions,{...destination.artifacts[0].revisions[0],revision:2,digest:'new-digest',content:'Changed destination'}]}]} :destination]};release(destination);await tick();expect(setTask).not.toHaveBeenCalled();expect(scope.failed).toHaveBeenCalledOnce();expect(scope.finished).toHaveBeenCalledOnce();
 }
});
test('a retired App fence clears only scoped local pending state without opening or reporting a stale error',async()=>{
 let current=true,release!:(value:Task)=>void;const destination=task('b'),match=searchSavedWork([destination],'Mesa').matches[0],finished=vi.fn(),failed=vi.fn(),open=vi.fn();requestSavedWorkNavigation(match,{listGeneration:()=>1,knownTask:()=>destination,current:()=>current,guard:action=>(action(),true),dirty:()=>false,flush:async()=>{},load:()=>new Promise(resolve=>{release=resolve;}),started:()=>{},finished,failed,open});await tick();current=false;release(destination);await tick();expect(open).not.toHaveBeenCalled();expect(failed).not.toHaveBeenCalled();expect(finished).toHaveBeenCalledOnce();
});
