import {expect,test,type Page} from '@playwright/test';
import {localTaskDurableEntry} from '../support/local-task-durable-app.fixture';
import {pickingPublicFrame as frame} from '../support/saved-text-source-frame';
import {taskTool} from '../support/ui-tools';
import {AnswerRatings} from '../../src/host/answer-rating';
import {readAnswerRatingCommand} from '../../src/shared/answer-rating';

test.use({viewport:{width:1080,height:800}});

const workspace=(page:Page)=>page.locator('.workspace:visible');
const context=(page:Page)=>workspace(page).getByRole('dialog',{name:'Context',exact:true});
const snapshot=(page:Page)=>context(page).getByRole('region',{name:'Source snapshot',exact:true});
const files=(page:Page)=>workspace(page).getByRole('dialog',{name:'Files',exact:true});
const document=(page:Page)=>workspace(page).getByRole('dialog',{name:'Document',exact:true});

test('find saved work for a changed source and reopen it without changing its basis',async({page},info)=>{
 const entry=await localTaskDurableEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),frames:unknown[]=[];
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await workspace(page).getByRole('complementary',{name:'Task navigation'}).getByRole('button',{name:'New task',exact:true}).click();
  await workspace(page).getByRole('button',{name:'Paste text',exact:true}).click();
  const start=workspace(page).getByRole('region',{name:'Start with text',exact:true});await start.getByRole('textbox',{name:'Title (optional)',exact:true}).fill('Owned source continuity');await start.getByRole('textbox',{name:'Source text',exact:true}).fill('Original source A.');await start.getByRole('button',{name:'Create task',exact:true}).click();
  await expect(snapshot(page)).toContainText('Original source A.');const created=(await entry.fixture.core.listTasks()).find(t=>t.title==='Owned source continuity')!;const a=created.sources[0],a1={sourceId:a.id,version:1,digest:a.versions[0].digest};
  await taskTool(page,'Files');await files(page).getByRole('button',{name:'New file',exact:true}).click();await files(page).getByRole('button',{name:'Draft',exact:true}).click();
  await document(page).getByRole('textbox',{name:'Draft title',exact:true}).fill('Source A notes');
  const body=document(page).getByRole('textbox',{name:'Draft content',exact:true});if(await body.evaluate(el=>el.tagName)!=='TEXTAREA'){await document(page).getByRole('button',{name:'Document options',exact:true}).click();await document(page).getByRole('button',{name:'Edit Markdown',exact:true}).click();}
  await body.fill('Preserve this original answer.');await document(page).getByRole('button',{name:'Save draft',exact:true}).click();await expect(document(page)).toHaveCount(0);
  const saved=await entry.fixture.core.getTask(created.id),artifact=structuredClone(saved.artifacts[0]);expect(artifact.revisions[0].sourceRefs).toEqual([a1]);
  await taskTool(page,'Sources');await context(page).getByRole('button',{name:'Add source',exact:true}).click();await context(page).getByRole('button',{name:'Paste text',exact:true}).click();await context(page).getByLabel('Source name (optional)',{exact:true}).fill('Unrelated B');await context(page).getByLabel('Source text',{exact:true}).fill('Independent source B.');await context(page).getByRole('button',{name:'Add text',exact:true}).click();await expect(snapshot(page)).toContainText('Independent source B.');await expect(snapshot(page).getByRole('region',{name:'Saved work to review'})).toHaveCount(0);
  await snapshot(page).getByRole('button',{name:'All context',exact:true}).click();await context(page).getByRole('button',{name:'Owned source continuity Source material',exact:true}).click();await snapshot(page).getByRole('button',{name:'Source options',exact:true}).click();await snapshot(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();await context(page).getByLabel('Source text',{exact:true}).fill('Changed source A.');await context(page).getByRole('button',{name:'Save new version',exact:true}).click();
  const affected=snapshot(page).getByRole('region',{name:'Saved work to review',exact:true});await expect(affected).toContainText('Source A notes');await expect(affected).toContainText('Version 1');frames.push(await frame(page,affected.getByRole('heading',{name:'Saved work to review',exact:true}),'01-changed-source-work'));
  const changed=await entry.fixture.core.getTask(created.id);expect(changed.sources[0].currentVersion).toBe(2);expect(changed.artifacts[0]).toEqual(artifact);
  await affected.getByRole('button',{name:/Source A notes/}).click();await expect(document(page)).toBeVisible();await expect(document(page)).toContainText('Preserve this original answer.');frames.push(await frame(page,document(page).getByRole('heading',{name:'Source A notes',exact:true}),'02-open-earlier-result'));expect((await entry.fixture.core.getTask(created.id)).artifacts[0]).toEqual(artifact);
  await entry.recreateCoreAndStore();await taskTool(page,'Sources');await context(page).getByRole('button',{name:'Owned source continuity Source material 1 saved item to review',exact:true}).click();const reopened=snapshot(page).getByRole('region',{name:'Saved work to review',exact:true});await expect(reopened).toContainText('Version 1');frames.push(await frame(page,reopened.getByRole('heading',{name:'Saved work to review',exact:true}),'03-reopened-work'));await reopened.getByRole('button',{name:/Source A notes/}).click();await expect(document(page)).toContainText('Preserve this original answer.');expect((await entry.fixture.core.getTask(created.id)).artifacts[0]).toEqual(artifact);
  expect(entry.fixture.commands.filter(c=>/^(windows\.capture|context\.(start|capture)|source\.follow|model\.run|browser\.run|export\.)/.test(c.type))).toEqual([]);
  await info.attach('source-continuity-boundary',{body:JSON.stringify({scope:'Public text source, saved document, source edit and source-specific navigation; actual disposable core/store and synthetic renderer/core recreation. No native capture, follow, provider or live freshness claim.',source:a1,artifact,frames,commands:entry.fixture.commands,external:entry.fixture.external},null,2),contentType:'application/json'});
 }finally{await entry.close();}
});

test('a rated saved answer keeps its private rating through task switches and a source change',async({page},info)=>{
 const entry=await localTaskDurableEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),{fixture}=entry,base=fixture.invoke.bind(fixture),ratings=new AnswerRatings(fixture.directory,id=>fixture.core.getTask(id)),log:{type:string;taskId:string;outcome:string}[]=[],frames:unknown[]=[];
 // Host order: the requested view is recorded on arrival and becomes current only after the queued selection; rating guards require both.
 let requested:string|undefined,current:string|undefined,failView:string|undefined,failedViews=0,holdView:{taskId:string;wait:Promise<void>}|undefined;
 fixture.invoke=async command=>{
  if(command.type==='context.view'){if(failView&&command.taskId===failView){failView=undefined;failedViews++;throw Error('Synthetic view selection failure.');}if(holdView&&command.taskId===holdView.taskId){const held=holdView;holdView=undefined;await held.wait;}requested=command.taskId;const result=await base(command);if(requested===command.taskId)current=command.taskId;return result;}
  if(command.type!=='answerRating.read'&&command.type!=='answerRating.set')return base(command);
  fixture.commands.push(structuredClone(command));const parsed=readAnswerRatingCommand(command),owner=parsed.selection.taskId,record={type:parsed.type,taskId:owner,outcome:'pending'},guard=()=>{if(current!==owner||requested!==owner)throw Error('Return to the original saved answer before rating it.');};log.push(record);
  try{guard();const result=parsed.type==='answerRating.read'?await ratings.read(parsed,guard):await ratings.set(parsed,guard);record.outcome=result.kind==='available'?String(result.rating):result.kind;return result;}catch(error){record.outcome='rejected';throw error;}
 };
 try{
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const core=fixture.core,created=await core.createTask({title:'Rated source lesson'}),owner=await core.putSource(created.id,{kind:'text',label:'Rated source',role:'fact',content:'Original rated source.'}),source=owner.sources[0];
  await core.runRequest({taskId:owner.id,requestId:'rated-source-answer',kind:'explain',prompt:'Explain the rated source.',sourceIds:[source.id],expectedSourceRefs:[{sourceId:source.id,version:1,digest:source.versions[0].digest}]},async()=>({title:'Rated answer',content:'Exact saved answer for the rated source.'}));
  const other=await core.createTask({title:'Other rated owner'});await fixture.emit({type:'changed'});const answered=await core.getTask(owner.id);
  const nav=workspace(page).getByRole('complementary',{name:'Task navigation'}),rating=workspace(page).getByRole('region',{name:'Private rating for this answer',exact:true}),helpful=rating.getByRole('button',{name:'Helpful',exact:true}),stale=workspace(page).getByText('Reload this rating to inspect the saved state before choosing again.',{exact:false});
  const open=async(title:string)=>{await nav.getByRole('button',{name:title,exact:true}).click();await expect(workspace(page).locator('h1')).toHaveText(title);};
  failView=owner.id;await open('Rated source lesson');const viewRetry=workspace(page).getByRole('alert').filter({hasText:'Couldn’t open this task’s saved state.'});await expect(viewRetry).toHaveCount(1);await expect(helpful).toBeDisabled();expect(log).toEqual([]);let release=()=>{};holdView={taskId:owner.id,wait:new Promise<void>(done=>{release=done;})};await viewRetry.getByRole('button',{name:'Retry opening this task',exact:true}).click();
  const pendingRetry=viewRetry.getByRole('button',{name:'Retrying opening this task',exact:true});await expect(pendingRetry).toHaveText('Retrying…');await expect(pendingRetry).toBeFocused();await expect(pendingRetry).toHaveAttribute('aria-disabled','true');expect(await pendingRetry.evaluate(node=>{const box=node.getBoundingClientRect();return Math.min(box.width,box.height);})).toBeGreaterThanOrEqual(24);release();await expect(viewRetry).toHaveCount(0);expect(failedViews).toBe(1);
  await expect(rating).toContainText('This answer has no private rating yet.');await helpful.click();await expect(rating).toContainText('Private rating saved on this Mac.');await expect(helpful).toHaveAttribute('aria-pressed','true');
  await open('Other rated owner');await open('Rated source lesson');await expect(rating).toContainText('Saved private rating loaded.');await expect(helpful).toHaveAttribute('aria-pressed','true');await expect(stale).toHaveCount(0);
  await taskTool(page,'Sources');await context(page).locator(`.source-list-row[data-source-id="${source.id}"]`).click();await context(page).getByRole('button',{name:'Source options',exact:true}).click();await context(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();await context(page).getByLabel('Source text',{exact:true}).fill('Changed rated source.');await context(page).getByRole('button',{name:'Save new version',exact:true}).click();
  await expect.poll(async()=>(await core.getTask(owner.id)).sources[0].currentVersion).toBe(2);await taskTool(page,'Work');
  await expect(rating).toContainText('Saved private rating loaded.');await expect(helpful).toHaveAttribute('aria-pressed','true');await expect(stale).toHaveCount(0);frames.push(await frame(page,rating.getByText('Saved private rating loaded.',{exact:true}),'04-rating-after-source-change'));
  const changed=await core.getTask(owner.id);expect(changed.requests).toEqual(answered.requests);expect(changed.artifacts).toEqual(answered.artifacts);
  expect(log.filter(item=>item.outcome==='rejected')).toEqual([]);expect(log.filter(item=>item.taskId!==owner.id)).toEqual([]);expect(log.filter(item=>item.type==='answerRating.set')).toEqual([{type:'answerRating.set',taskId:owner.id,outcome:'up'}]);expect(log.filter(item=>item.type==='answerRating.read').length).toBeGreaterThanOrEqual(3);
  const views=fixture.commands.flatMap((command,index)=>command.type==='context.view'||command.type==='answerRating.read'?[{index,type:command.type,taskId:command.type==='context.view'?command.taskId:command.selection.taskId}]:[]);
  for(const read of views.filter(item=>item.type==='answerRating.read'))expect(views.filter(item=>item.type==='context.view'&&item.index<read.index).at(-1)?.taskId).toBe(owner.id);
  expect(fixture.commands.filter(c=>/^(windows\.capture|context\.(start|capture)|source\.follow|model\.run|browser\.run|export\.)/.test(c.type))).toEqual([]);expect(other.requests).toEqual([]);
  await info.attach('rating-source-change-boundary',{body:JSON.stringify({scope:'Public rating controls, task switches and text source edit with actual core/store and actual private rating store; host view/rating guard order modeled by the fixture. No native IPC, provider or capture.',ratings:log,commands:fixture.commands.filter(c=>c.type==='context.view'||c.type.startsWith('answerRating.')),frames},null,2),contentType:'application/json'});
 }finally{await entry.close();}
});
