import {expect,test} from 'vitest';
import type {Task} from '../../src/core/types';
import {searchSavedWork,resolveSavedWorkMatch,savedWorkSearchLimits} from '../../src/shared/saved-work-search';
const at='2026-10-29T10:00:00Z';
const task=(id='a'):Task=>({id,title:'Work '+id,goal:'Plan the orchard visit.',status:'active',createdAt:at,updatedAt:at,sources:[],artifacts:[{id:'file',revisions:[{revision:1,title:'Visit notes',content:'  Bring MESA crates.\nKeep both spaces.  \n',mimeType:'text/markdown',sourceRefs:[],digest:'digest-'+id,createdAt:at}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
test('literal case-insensitive search finds task goals and latest saved text files across exact owners without mutation',()=>{
 const first=task(),second=task('b');second.artifacts[0].revisions.push({...second.artifacts[0].revisions[0],revision:2,digest:'b-2',content:'New notes with [MESA].'});const before=JSON.stringify([first,second]);
 const result=searchSavedWork([second,first],' mesa ');expect(result.query).toBe('mesa');expect(result.matchCount).toBe(2);expect(result.matches.map(match=>match.taskId)).toEqual(['a','b']);expect(result.matches[0].excerpt).toBe(first.artifacts[0].revisions[0].content);expect(result.matches[1]).toMatchObject({revision:2,digest:'b-2',field:'File text'});
 expect(searchSavedWork([first],'ORCHARD').matches[0]).toMatchObject({kind:'task',field:'Task goal'});expect(searchSavedWork([first],'Work a','files').matches).toEqual([]);expect(searchSavedWork([first],'mesa','tasks').matches).toEqual([]);expect(searchSavedWork([second],'[mesa]').matchCount).toBe(1);expect(searchSavedWork([first],'.*').matchCount).toBe(0);expect(searchSavedWork([first],'MESA crates.\nKeep').matchCount).toBe(1);expect(JSON.stringify([first,second])).toBe(before);
});
test('file scope uses current plain-text and Markdown, excluding sources, receipts, request prompts, images and internal structured artifacts',()=>{
 const t=task();t.goal='';t.artifacts[0].revisions[0].content='old-only';t.artifacts[0].revisions.push({...t.artifacts[0].revisions[0],revision:2,digest:'2',content:'current only'});
 for(const [mimeType,encoding] of [['application/json',undefined],['text/html',undefined],['image/png','base64'],['text/plain','base64']] as const)t.artifacts.push({id:mimeType,revisions:[{...t.artifacts[0].revisions[0],mimeType,encoding,content:'secret-only'}]});
 t.sources=[{id:'source',currentVersion:1,freshness:'fresh',versions:[{id:'source',version:1,digest:'s',kind:'text',role:'fact',label:'secret-only',content:'secret-only',capturedAt:at}]}];t.requests=[{id:'r',kind:'explain',prompt:'secret-only',status:'failed',digest:'r',sourceRefs:[],startedAt:at,error:'secret-only'}];
 expect(searchSavedWork([t],'old-only','files').matchCount).toBe(0);expect(searchSavedWork([t],'secret-only','files').matchCount).toBe(0);expect(searchSavedWork([t],'current only','files').matchCount).toBe(1);
 t.artifacts[0].revisions[1].mimeType='text/plain';expect(searchSavedWork([t],'current only').matchCount).toBe(1);
});
test('blank/oversized input is rejected and a capped result reports every searched match and exact coverage',()=>{
 expect(()=>searchSavedWork([task()], '   ')).toThrow(/up to 200/);expect(()=>searchSavedWork([task()],'x'.repeat(201))).toThrow(/up to 200/);
 const tasks=Array.from({length:60},(_,i)=>{const t=task(String(i).padStart(2,'0'));t.artifacts[0].revisions[0].content='needle';return t;});const result=searchSavedWork(tasks,'needle','files');expect(result.matches).toHaveLength(50);expect(result.matchCount).toBe(60);expect(result.searched).toBe(60);expect(result.partial).toBe(0);expect(result.omitted).toBe(0);
 const long=task();long.artifacts[0].revisions[0].content='x'.repeat(savedWorkSearchLimits.file)+'far-tail';const limited=searchSavedWork([long],'far-tail','files');expect(limited).toMatchObject({matchCount:0,searched:0,partial:0,omitted:0,unsearchedFiles:1});
 const huge=Array.from({length:25},(_,i)=>{const t=task(String(i).padStart(2,'0'));t.artifacts[0].revisions[0].content='needle'+'x'.repeat(150_000);return t;});expect(searchSavedWork(huge,'needle','files')).toMatchObject({searched:0,partial:0,omitted:0,matchCount:0,unsearchedFiles:25});
});
test('task names and file names are searched, excerpts stay bounded and exact whitespace remains inert',()=>{
 const t=task();t.artifacts[0].revisions[0].title='<script>not executable</script>';expect(searchSavedWork([t],'<script>').matches[0]).toMatchObject({field:'File name',excerpt:'<script>not executable</script>'});expect(searchSavedWork([t],'Work a').matches[0].field).toBe('Task name');
 const query='x'.repeat(200);t.artifacts[0].revisions[0].content='before '.repeat(100)+query+'after '.repeat(100);const found=searchSavedWork([t],query).matches[0];expect(found.excerpt).toContain(query);expect(found.excerpt.length).toBeLessThanOrEqual(242);
});
test('exact lookup refuses changed latest revisions, titles, owners, digests, formats or deleted/ambiguous artifacts',()=>{
 const original=task(),hit=searchSavedWork([original],'mesa').matches[0];expect(resolveSavedWorkMatch(original,hit)).toMatchObject({kind:'file',revision:{revision:1}});expect(()=>resolveSavedWorkMatch(task('b'),hit)).toThrow(/Search again/);
 for(const mutate of [(t:Task)=>{t.title='Renamed owner';},(t:Task)=>{t.artifacts=[];},(t:Task)=>{t.artifacts.push(structuredClone(t.artifacts[0]));},(t:Task)=>{t.artifacts[0].revisions.push({...t.artifacts[0].revisions[0],revision:2});},(t:Task)=>{t.artifacts[0].revisions[0].digest='changed';},(t:Task)=>{t.artifacts[0].revisions[0].title='Changed title';},(t:Task)=>{t.artifacts[0].revisions[0].mimeType='text/html';},(t:Task)=>{t.artifacts[0].revisions[0].encoding='base64';},(t:Task)=>{t.artifacts[0].revisions[0].content+='Changed length';},(t:Task)=>{t.artifacts[0].revisions[0].content=t.artifacts[0].revisions[0].content.replace('MESA','MEZA');}]){const changed=structuredClone(original);mutate(changed);expect(()=>resolveSavedWorkMatch(changed,hit)).toThrow(/Search again/);}
 const goalHit=searchSavedWork([original],'orchard').matches[0],changed=structuredClone(original);changed.goal='Changed goal';expect(()=>resolveSavedWorkMatch(changed,goalHit)).toThrow(/Search again/);expect(resolveSavedWorkMatch(original,goalHit)).toEqual({kind:'task'});
});
test('ambiguous IDs are excluded while identical labels retain their separate task identities',()=>{
 const first=task(),second=task('b');expect(searchSavedWork([first,second],'mesa').matches.map(match=>match.taskId)).toEqual(['a','b']);expect(searchSavedWork([first,structuredClone(first)],'mesa').matches).toEqual([]);first.artifacts.push(structuredClone(first.artifacts[0]));expect(searchSavedWork([first],'mesa').matches).toEqual([]);
});
