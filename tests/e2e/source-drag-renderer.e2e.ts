import {test,expect,type Locator,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {BrowserFixture} from '../support/browser-fixture';
import type {Command,ContextActivation,WindowChoice} from '../../src/shared/bridge';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/native-drag-renderer';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});
/** Capture the real viewport after checking its visible UI anchor. No DOM/style substitution. */
async function viewportFrame(page:Page,anchor:Locator,name:string){
 await anchor.scrollIntoViewIfNeeded();await expect(anchor).toBeVisible();await expect(anchor).toBeInViewport({ratio:1});
 await expect.poll(()=>anchor.evaluate(element=>{
  const surface=element.closest<HTMLElement>('[data-runtime-scope="whole-surface"]');
  if(!surface||!['settled','cancelled','skipped'].includes(surface.dataset.surfaceReveal??''))return false;
  let opacity=1;
  for(let node:Element|null=element;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse')return false;opacity*=Number(style.opacity);}
  return opacity>.99;
 }),{message:'The actual surface reveal must finish and its UI anchor must be painted before capture.'}).toBe(true);
 const bounds=await anchor.boundingBox(),viewport=page.viewportSize();if(!bounds||!viewport)throw Error('The frame anchor has no viewport bounds.');
 expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height);
 await page.screenshot({path:join(evidence,name+'.png'),fullPage:false,caret:'initial'});
}

/** Renderer qualification fixture only. Native input, placement, pixels and consent
 * are replaced at the bridge; production host/capture fences have separate tests. */
async function sourceBoundary(page:Page,fixture:BrowserFixture){
 const target:WindowChoice={id:'window:42',title:'Synthetic drag source',owner:{name:'Synthetic editor'},bounds:{x:300,y:100,width:500,height:400}};
 let pending:ContextActivation|undefined,fail=false,noRoom=false,captures=0;
 const commands:Command[]=[];
 const activation=async(origin:'user-drop'|'source-picker',newTask?:boolean):Promise<ContextActivation>=>{
  const view=await fixture.viewPreferences.read(),owner=view.kind==='available'?view.taskId:undefined;
  return {activationId:crypto.randomUUID(),tucked:origin==='user-drop',origin,intent:'attach',analyze:true,...(newTask||!owner?{newTask:true}:{ownerTaskId:owner}),...(origin==='user-drop'?{target,choices:[]}:{choices:[target]})};
 };
 await page.exposeFunction('__sourceDragInvoke',async(command:Command)=>{
  commands.push(structuredClone(command));
  if(command.type==='source.drag.cancel')return null;
  if(command.type==='context.pending')return pending?{kind:'ready',activation:pending}:{kind:'none'};
  if(command.type==='context.cancel'){if(pending?.activationId===command.activationId)pending=undefined;return null;}
  if(command.type==='source.choose'){
   const tucked=await page.locator('.anchor-wrap').isVisible();pending={...await activation('source-picker'),tucked};
   // Production expands an anchor through presentation.enter before surface.
   if(tucked)await fixture.enter('workspace');else await fixture.emit({type:'surface',mode:'workspace'});
   await fixture.emit({type:'context.activate',activation:pending});return null;
  }
  if(command.type==='context.capture'){
   const current=pending;if(!current||current.activationId!==command.activationId||command.windowId!==target.id||current.ownerTaskId!==command.taskId)throw Error('Screen selection expired.');
   if(fail){pending=undefined;throw Error('Capture cancelled. No pixels were captured.');}
   if(noRoom)return {state:'no-room',activationId:current.activationId,tucked:current.tucked};
   pending=undefined;captures++;
   let task=command.taskId?await fixture.core.getTask(command.taskId):await fixture.core.createTask({title:'Synthetic drag task'});
   task=await fixture.core.putSource(task.id,{kind:'window',label:target.title,role:'fact',content:JSON.stringify({fixture:'metadata-only, no source pixels'}),windowId:target.id,windowProcessId:123,documentToken:'synthetic-drag-metadata'});
   await fixture.changed(task.id);if(current.tucked)await fixture.enter('companion');
   return {state:'captured',activationId:current.activationId,tucked:current.tucked,task,sourceId:task.sources.at(-1)!.id};
  }
  throw Error('Unexpected source fixture command.');
 });
 const install=()=>{
  const wrap=(bridge:Window['companion'])=>{
   const invoke=bridge.invoke.bind(bridge);
   Object.defineProperty(bridge,'invoke',{configurable:true,value:(command:Command)=>{if(['source.drag.cancel','source.choose','context.pending','context.capture','context.cancel'].includes(command.type))return Reflect.get(window,'__sourceDragInvoke')(command);if(command.type==='export.propose'||command.type==='export.approve'||command.type==='export.inspect')return invoke(command);return invoke(command);}});
   return bridge;
  };
  let current=window.companion;if(current)current=wrap(current);
  Object.defineProperty(window,'companion',{configurable:true,get:()=>current,set:(value:Window['companion'])=>{current=wrap(value);}});
 };
 await page.evaluate(install);await page.addInitScript(install);
 return {commands,target,captures:()=>captures,fail:(value:boolean)=>{fail=value;},noRoom:(value:boolean)=>{noRoom=value;},queue:async(newTask?:boolean)=>{pending=await activation('user-drop',newTask);},drop:async(newTask?:boolean)=>{pending=await activation('user-drop',newTask);await fixture.emit({type:'context.activate',activation:pending});}};
}

test.use({viewport:{width:1080,height:720},reducedMotion:'reduce'});
test('anchor preserves ordinary click and suppresses a dragged click while renderer commands remain cancel or choose only',async({page})=>{
 const fixture=await BrowserFixture.open(page,'anchor');
 try{
  const boundary=await sourceBoundary(page,fixture),anchor=page.getByRole('button',{name:'Open Glint',exact:true});await expect(anchor).toBeVisible();
  await anchor.click();await expect(page.locator('.workspace')).toBeVisible();const opened=fixture.commands.filter(command=>command.type==='surface.expand').length;
  await fixture.emit({type:'surface',mode:'anchor'});const box=await anchor.boundingBox();if(!box)throw Error('Anchor is unavailable.');
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();await page.mouse.move(box.x+40,box.y+30);await page.mouse.up();
  expect(fixture.commands.filter(command=>command.type==='surface.expand')).toHaveLength(opened);await anchor.focus();await page.keyboard.press('Escape');expect(boundary.commands.some(command=>command.type==='source.drag.cancel')).toBe(true);
  expect(boundary.commands.every(command=>['context.pending','source.drag.cancel'].includes(command.type))).toBe(true);
 }finally{await fixture.close();}
});
test('keyboard source choice captures only the chosen window without automatically asking a model',async({page})=>{
 const fixture=await BrowserFixture.open(page,'anchor');
 try{
  const boundary=await sourceBoundary(page,fixture),anchor=page.getByRole('button',{name:'Open Glint',exact:true});await expect(anchor).toBeVisible();await anchor.focus();await page.keyboard.press('ArrowDown');
  const intake=page.getByRole('region',{name:'Screen context',exact:true}),choices=intake.getByRole('group',{name:'Window to inspect',exact:true});
  await expect(intake.getByRole('heading',{name:'Which window?',exact:true})).toBeVisible();expect(boundary.captures()).toBe(0);
  await viewportFrame(page,choices,'native-choose');
  await choices.locator('.context-window-choice').click();
  await expect.poll(boundary.captures).toBe(1);expect(fixture.pending.size).toBe(0);expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);expect((await fixture.core.getTask(fixture.taskA.id)).sources.at(-1)?.versions[0].windowId).toBe('window:42');expect(fixture.externalRequests).toEqual([]);
 }finally{await fixture.close();}
});
test('same-task dropped context preserves the composer draft and overrides tucked and analyze automatic-model branches',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const boundary=await sourceBoundary(page,fixture);await page.getByLabel('Ask about this task',{exact:true}).fill('Keep this exact unsent draft.');await fixture.emit({type:'surface',mode:'anchor'});await boundary.drop();
  await expect(page.getByLabel('Ask companion',{exact:true})).toHaveValue('Keep this exact unsent draft.');await expect.poll(boundary.captures).toBe(1);expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);expect((await fixture.core.getTask(fixture.taskA.id)).requests).toEqual([]);
  await page.setViewportSize({width:360,height:440});await expect(page.getByLabel('Ask companion',{exact:true})).toHaveValue('Keep this exact unsent draft.');
  await viewportFrame(page,page.getByLabel('Ask companion',{exact:true}),'native-attached');
 }finally{await fixture.close();}
});
test('new-task dropped context creates its captured task without automatic analysis',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const boundary=await sourceBoundary(page,fixture);await fixture.core.deleteTask(fixture.taskA.id);await fixture.core.deleteTask(fixture.taskB.id);await page.reload();await expect(page.getByRole('heading',{name:'Bring a window into this task.',exact:true})).toBeVisible();await boundary.drop(true);
  await expect.poll(boundary.captures).toBe(1);const tasks=await fixture.core.listTasks();expect(tasks).toHaveLength(1);expect(tasks[0].requests).toEqual([]);expect(boundary.commands.find(command=>command.type==='context.capture')).not.toHaveProperty('taskId');expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);
 }finally{await fixture.close();}
});
test('cancelled new-task drop retries through the attach-only picker without reusing the old task',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const boundary=await sourceBoundary(page,fixture),workspace=page.locator('.workspace'),intake=workspace.getByRole('region',{name:'Screen context',exact:true});await page.locator('.workspace .chrome').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace .chrome').getByRole('button',{name:'New task',exact:true}).click();await expect(page.getByRole('heading',{name:'Bring a window into this task.',exact:true})).toBeVisible();
  boundary.fail(true);await boundary.drop(true);await expect(workspace.getByText('The window attachment may remain in place.',{exact:true})).toBeVisible();await expect.poll(async()=>{const view=await fixture.viewPreferences.read();return view.kind==='available'?view.taskId:'unavailable';}).toBeNull();
  await expect(intake.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();await expect(intake.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  await viewportFrame(page,intake.getByRole('button',{name:'Try again',exact:true}),'native-cancelled');
  boundary.fail(false);await intake.getByRole('button',{name:'Try again',exact:true}).click();await expect(intake.getByRole('heading',{name:'Which window?',exact:true})).toBeVisible();await intake.getByRole('group',{name:'Window to inspect',exact:true}).locator('.context-window-choice').click();await expect.poll(boundary.captures).toBe(1);
  expect(boundary.commands.filter(command=>command.type==='context.capture').every(command=>!('taskId' in command))).toBe(true);expect((await fixture.core.getTask(fixture.taskA.id)).sources).toHaveLength(1);expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);
 }finally{await fixture.close();}
});
test('cached pending activation retains attach-only intent after renderer reload',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const boundary=await sourceBoundary(page,fixture);await boundary.queue();await page.reload();await expect.poll(boundary.captures).toBe(1);expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);expect((await fixture.core.getTask(fixture.taskA.id)).requests).toEqual([]);
 }finally{await fixture.close();}
});
test('no-room recovery retains attach-only intent when the user explicitly opens the app',async({page})=>{
 const fixture=await BrowserFixture.open(page);
 try{
  const boundary=await sourceBoundary(page,fixture),intake=page.getByRole('region',{name:'Screen context',exact:true});boundary.noRoom(true);await boundary.drop();await expect(intake.getByRole('heading',{name:'No space beside this window',exact:true})).toBeVisible();expect(boundary.captures()).toBe(0);
  await viewportFrame(page,intake.getByRole('button',{name:'Open app instead',exact:true}),'native-no-room');
  boundary.noRoom(false);await intake.getByRole('button',{name:'Open app instead',exact:true}).click();await expect.poll(boundary.captures).toBe(1);expect(fixture.commands.filter(command=>command.type==='model.run')).toEqual([]);
 }finally{await fixture.close();}
});
