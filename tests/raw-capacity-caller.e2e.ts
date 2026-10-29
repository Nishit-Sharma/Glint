import {test,expect,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {MODULE_MIME} from '../src/shared/module-contract';
import {parseModuleAnswer} from '../src/core/interactive-modules';
import {capacityFrame as frame,enforceCapacityFrames} from './raw-capacity-frame';
import {workspace,document,review,begin,choose,confirm,assumptionName,frozenText} from './workflow-source-review-drafts.fixture';
import {literalCallerEntry} from './raw-capacity-caller.fixture';

type Entry=Awaited<ReturnType<typeof literalCallerEntry>>;
test.afterEach(async({},info)=>{await enforceCapacityFrames(info);});
const input=(page:Page)=>review(page).getByRole('textbox',{name:assumptionName,exact:true});
const create=(page:Page)=>review(page).getByRole('button',{name:'Create workflow experiment',exact:true});
async function raw(entry:Entry){const value=await entry.raw();if(!value?.value)throw Error('Expected exact owned raw review');return value;}
async function proof(entry:Entry){
 expect(entry.fixture.externalRequests).toEqual([]);expect(entry.fixture.commands.filter(command=>['model.run','browser.run','windows.capture','context.capture'].includes(command.type)||command.type.startsWith('export.'))).toEqual([]);
 expect(entry.requests).toHaveLength(1);const command=entry.requests[0];expect(command.taskId).toBe(entry.fixture.taskA.id);expect(command.basis).toEqual(entry.basis);expect(command.expectedSourceRefs).toEqual(entry.refs);expect(command.review.assumptions).toEqual(['g2 current confirmed']);
 for(const rule of command.review.rules){expect(rule.sourceId).toBe(entry.refs[0].sourceId);expect(entry.sourceText.slice(rule.start,rule.end)).toBe(rule.quote);}
 const intent=await entry.publication();if(!intent?.value)throw Error('Expected exact publication intent');expect(JSON.parse(intent.value.value).requestId).toBe(command.requestId);
 const task=await entry.fixture.core.getTask(entry.fixture.taskA.id);expect(task.requests).toHaveLength(1);expect(task.requests[0]).toMatchObject({id:command.requestId,status:'completed'});const artifact=task.artifacts.find(item=>item.revisions.at(-1)?.mimeType===MODULE_MIME);if(!artifact)throw Error('Expected actual reviewed module');const revision=artifact.revisions.at(-1)!;expect(revision.sourceRefs).toEqual(entry.refs);const module=parseModuleAnswer(JSON.parse(revision.content)).modules[0];if(module.data.kind!=='workflow-lab')throw Error('Expected workflow module');expect(module.data.basis).toMatchObject({kind:'reviewed-source',taskId:entry.fixture.taskA.id,artifact:entry.basis,sourceRefs:entry.refs});return task;
}
async function ledger(entry:Entry,name:string,extra:unknown){const path=test.info().outputPath(name+'.json');await writeFile(path,JSON.stringify({scope:'Actual React App and real disposable core/sidecar; only exact raw-store and actual postcommit reply delivery held. Synthetic draft.flush/resume and core recreation/renderer reload; no native quit, provider, screen capture or process restart.',task:await entry.fixture.core.getTask(entry.fixture.taskA.id),commands:entry.fixture.commands,requests:entry.requests,writes:entry.writes,records:await entry.records(),extra},null,2)+'\n');await test.info().attach(name,{path,contentType:'application/json'});}
async function start(page:Page,entry:Entry){
 await expect(workspace(page).getByRole('heading',{level:1,name:entry.fixture.taskA.title,exact:true})).toBeVisible();const task=await entry.fixture.core.getTask(entry.fixture.taskA.id),source=task.sources.find(item=>item.id===entry.refs[0].sourceId),artifact=task.artifacts.find(item=>item.id===entry.basis.artifactId);expect(source?.versions.at(-1)).toMatchObject({version:entry.refs[0].version,digest:entry.refs[0].digest,content:entry.sourceText,label:entry.sourceLabel});expect(artifact?.revisions.at(-1)).toMatchObject({revision:entry.basis.revision,digest:entry.basis.digest,title:entry.documentTitle,sourceRefs:entry.refs});
 const scope=await begin(page,entry.documentTitle);await expect(scope.locator('blockquote').first()).toHaveText('Draft + Submit -> In review');await choose(scope);await entry.flush();entry.holdRaw();await input(page).fill('  g1 first accepted  ');await expect.poll(entry.rawHold.reached).toBe(true);await confirm(page).check();await create(page).click();await expect(review(page).getByRole('button',{name:'Creating workflow experiment…',exact:true})).toBeDisabled();
 await input(page).fill('  g2 current confirmed  ');await expect(confirm(page)).not.toBeChecked();await expect(review(page).getByRole('button',{name:'Back to document',exact:true})).toBeEnabled();await confirm(page).check();await expect(create(page)).toBeEnabled();entry.holdReply();await create(page).click();await expect(review(page).getByRole('button',{name:'Creating workflow experiment…',exact:true})).toBeDisabled();
}

test('new confirmed literal review publishes after the older preflush retires',async({page})=>{
 const entry=await literalCallerEntry(page);
 try{
  await start(page,entry);await frame(page,input(page),'literal-g2-preflush-held');entry.rawHold.release();await expect.poll(entry.replyHold.reached).toBe(true);const submitted=await raw(entry);expect(JSON.parse(submitted.value!.value).assumptions).toBe('  g2 current confirmed  ');await proof(entry);
  entry.replyHold.release();const result=document(page).getByRole('region',{name:'Workflow experiment',exact:true});await expect(result).toBeVisible();await entry.flush();expect(await entry.raw()).toMatchObject({revision:submitted.revision+1,value:null});await frame(page,result.getByRole('heading',{name:'Workflow: '+entry.documentTitle,exact:true}),'literal-g2-current-result');await ledger(entry,'literal-current-result',{submitted});
 }finally{await entry.close();}
});

test('newer literal edit survives an older completed reply, synthetic quit and core reload',async({page})=>{
 const entry=await literalCallerEntry(page),quitId='owned-caller-g3-quit';
 try{
  await start(page,entry);entry.rawHold.release();await expect.poll(entry.replyHold.reached).toBe(true);const submitted=await raw(entry);await proof(entry);await input(page).fill('  g3 newer unapplied 界  ');
  await expect.poll(async()=>{const value=await entry.raw();return !!value?.value&&value.revision>submitted.revision&&JSON.parse(value.value.value).assumptions==='  g3 newer unapplied 界  ';}).toBe(true);const newer=await raw(entry);await entry.fixture.emit({type:'draft.flush',quitId});const paused=review(page).getByText(frozenText,{exact:true});await expect(paused).toBeVisible();expect(entry.acknowledgements(quitId)).toEqual([]);await frame(page,input(page),'literal-g3-held-before-quit-ack');await frame(page,paused,'literal-g3-quit-pause-explanation');expect(entry.acknowledgements(quitId)).toEqual([]);
  entry.replyHold.release();await expect.poll(()=>entry.acknowledgements(quitId).length).toBe(1);expect(entry.acknowledgements(quitId)[0].error).toBeUndefined();expect(await entry.raw()).toEqual(newer);expect(entry.writes.filter(write=>write.key===entry.rawKey&&write.value===null)).toEqual([]);await entry.fixture.emit({type:'draft.resume',quitId});await expect(input(page)).toHaveValue('  g3 newer unapplied 界  ');await expect(confirm(page)).not.toBeChecked();await expect(document(page).getByRole('region',{name:'Workflow experiment',exact:true})).toHaveCount(0);
  await entry.fixture.restartCore();await page.reload();await expect(workspace(page).getByRole('heading',{level:1,name:entry.fixture.taskA.title,exact:true})).toBeVisible();const current=await entry.fixture.core.getTask(entry.fixture.taskA.id);expect(current.sources.find(item=>item.id===entry.refs[0].sourceId)?.versions.at(-1)).toMatchObject({version:entry.refs[0].version,digest:entry.refs[0].digest,content:entry.sourceText,label:entry.sourceLabel});expect(current.artifacts.find(item=>item.id===entry.basis.artifactId)?.revisions.at(-1)).toMatchObject({revision:entry.basis.revision,digest:entry.basis.digest,title:entry.documentTitle,sourceRefs:entry.refs});
  await begin(page,entry.documentTitle);await expect(input(page)).toHaveValue('  g3 newer unapplied 界  ');await expect(confirm(page)).not.toBeChecked();expect(await entry.raw()).toEqual(newer);await frame(page,input(page),'literal-g3-after-core-renderer-reload');await ledger(entry,'literal-newer-raw',{submitted,newer,quitId});
 }finally{await entry.close();}
});
