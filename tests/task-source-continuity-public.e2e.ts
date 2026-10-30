import {test,expect,type Locator} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {continuityTask} from './task-source-continuity.fixture';
import {taskTool} from './ui-tools';
import {settleCapture} from './settled-capture';
import {sourceResumeContext} from '../src/core/source-resume';
import type {Command} from '../src/shared/bridge';

/** Prepared controlled public App journey. Seeded owned task data; real core/store,
 * actual Resume/navigation/dirty controls; substituted OS/IPC, no provider. */
test('Resume shows local source continuity while guarded task changes, late replies and incoming context keep their owners',async({page})=>{
 const fixture=await OnboardingFixture.open(page,{ready:true,port:Number(process.env.WINDOW_COMPANION_TEST_PORT??4196)}),workspace=page.locator('.workspace:visible'),sidebar=workspace.getByRole('complementary',{name:'Task navigation',exact:true});
 const region=()=>workspace.getByRole('region',{name:'Saved procedure source continuity',exact:true});
 const options=workspace.locator('.chrome').getByRole('button',{name:'Task options',exact:true});
 let holdResume=false,resumeStarted=false,releaseResume:(()=>void)|undefined;
 const invoke=fixture.invoke.bind(fixture);
 fixture.invoke=async(command:Command)=>{
  if(command.type==='tasks.resume'){
   fixture.commands.push(structuredClone(command));const result=await fixture.core.resume(command.taskId);
   if(holdResume){holdResume=false;resumeStarted=true;await new Promise<void>(done=>releaseResume=done);}
   await fixture.emit({type:'changed',taskId:command.taskId});return result;
  }
  if(command.type==='tasks.pause'){fixture.commands.push(structuredClone(command));const result=await fixture.core.pause(command.taskId);await fixture.emit({type:'changed',taskId:command.taskId});return result;}
  return invoke(command);
 };
 const frame=async(anchor:Locator,name:string)=>{await anchor.scrollIntoViewIfNeeded();await settleCapture(page);const path=test.info().outputPath(name+'.png');await page.screenshot({path,fullPage:false});await test.info().attach(name,{path,contentType:'image/png'});};
 try{
  const a=await continuityTask(fixture.core,'Orchard'),b=await continuityTask(fixture.core,'Mesa',false);await fixture.core.invalidateSource(a.task.id,a.ref.sourceId,'Freshness is unknown');await fixture.core.pause(a.task.id);await page.reload();
  await sidebar.getByRole('button',{name:'Orchard',exact:true}).click();await expect(sidebar.getByRole('button',{name:'Orchard',exact:true})).toHaveAttribute('aria-current','page');await expect(workspace.getByRole('button',{name:'Choose task',exact:true})).toContainText('Orchard');
  await expect.poll(async()=>{const view=await fixture.viewPreferences.read();return view.kind==='available'?view.taskId:view.kind;}).toBe(a.task.id);await page.reload();
  await expect(workspace.getByRole('button',{name:'Choose task',exact:true})).toContainText('Orchard');
  await workspace.locator('.warning').getByRole('button',{name:'Resume task',exact:true}).click();await expect.poll(async()=>(await fixture.core.getTask(a.task.id)).status).toBe('active');
  await expect(region()).toBeVisible();await region().locator('details').first().locator('summary').first().focus();await page.keyboard.press('Enter');await expect(region()).toContainText('Orchard procedure');await expect(region()).toContainText('An earlier saved source version');await expect(region()).toContainText('Refresh or review is required');await expect(region()).not.toContainText('PRIVATE_');await frame(region(),'resumed-source-context-full');
  await taskTool(page,'Task details');await workspace.getByRole('textbox',{name:'Task name',exact:true}).fill('Unsaved local task name');await sidebar.getByRole('button',{name:'Mesa',exact:true}).click();const guard=page.getByRole('dialog',{name:'Keep your unsaved edits?',exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Keep editing',exact:true}).click();await expect(workspace.getByRole('textbox',{name:'Task name',exact:true})).toHaveValue('Unsaved local task name');
  await sidebar.getByRole('button',{name:'Mesa',exact:true}).click();await guard.getByRole('button',{name:'Leave and discard edits',exact:true}).click();await expect(workspace.getByRole('button',{name:'Choose task',exact:true})).toContainText('Mesa');await expect(region()).toHaveCount(0);expect((await fixture.core.getTask(a.task.id)).title).toBe('Orchard');
  await sidebar.getByRole('button',{name:'Orchard',exact:true}).click();await taskTool(page,'Pause task');await expect(workspace.locator('.warning').getByRole('button',{name:'Resume task',exact:true})).toBeVisible();await options.click();await expect(workspace.locator('.chrome').getByRole('button',{name:'Resume task',exact:true})).toBeEnabled();await options.click();holdResume=true;await workspace.locator('.warning').getByRole('button',{name:'Resume task',exact:true}).click();await expect.poll(()=>resumeStarted).toBe(true);
  await sidebar.getByRole('button',{name:'Mesa',exact:true}).click();await expect(workspace.getByRole('button',{name:'Choose task',exact:true})).toContainText('Mesa');await expect(sidebar.getByRole('button',{name:'Mesa',exact:true})).toHaveAttribute('aria-current','page');let updated=await fixture.core.putSource(b.task.id,{id:b.ref.sourceId,kind:'text',role:'fact',label:'Mesa new notes',content:'PRIVATE_LATE_BODY'});await fixture.core.saveArtifact(b.task.id,{title:'New Mesa result',content:'A local result saved while Orchard resume was held.',sourceRefs:[]});await fixture.emit({type:'changed',taskId:b.task.id});await expect(region()).toContainText('Mesa procedure');await expect(region()).not.toContainText('Orchard');
  await fixture.emit({type:'context.activate',activation:{activationId:'owned-incoming',tucked:false,ownerTaskId:b.task.id,choices:[]}});const incoming=workspace.getByRole('region',{name:'Screen context',exact:true});await expect(incoming).toBeVisible();await expect(region()).toHaveCount(0);
  await options.click();const pause=workspace.locator('.chrome').getByRole('button',{name:'Pause task',exact:true});await expect(pause).toBeDisabled();
  // App clears busy only after consuming the reply and awaiting its task-list refresh.
  releaseResume?.();await expect(pause).toBeEnabled();await options.click();expect(fixture.commands.filter(command=>command.type==='tasks.resume')).toHaveLength(2);await expect(incoming).toBeVisible();await expect(region()).toHaveCount(0);await expect(workspace.getByRole('button',{name:'Choose task',exact:true})).toContainText('Mesa');expect(fixture.commands.filter(command=>command.type==='context.cancel'&&command.activationId==='owned-incoming')).toEqual([]);await incoming.getByRole('button',{name:'Cancel',exact:true}).click();await expect(region()).toBeVisible();await region().locator('details').first().locator('summary').first().click();await expect(region()).toContainText('Mesa procedure');await expect(region()).not.toContainText('Orchard');await expect(workspace.locator('.conversation-manual-files').getByRole('button',{name:'New Mesa result',exact:true})).toBeVisible();
  const ref={sourceId:updated.sources[0].id,version:updated.sources[0].currentVersion,digest:updated.sources[0].versions.at(-1)!.digest};
  for(let index=0;index<40;index++)updated=await fixture.core.saveProcedure(b.task.id,{title:'Mesa saved procedure '+index,steps:[{intent:'PRIVATE_STEP',target:'PRIVATE_TARGET',preconditions:[],expectedResult:'PRIVATE_RESULT'}],sourceRefs:[ref]});
  updated=await fixture.core.putSource(b.task.id,{id:ref.sourceId,kind:'text',role:'fact',label:'Mesa latest notes',content:'PRIVATE_LATEST_BODY'});await fixture.emit({type:'changed',taskId:b.task.id});const omitted=sourceResumeContext(updated).omissions;
  await expect(region()).toContainText(`${omitted.affectedProcedures} entire procedures, ${omitted.procedureRevisions} revisions and ${omitted.procedureSourceRefs} source references`);await expect(region()).toContainText('Omitted dependencies remain unknown');
  await page.setViewportSize({width:360,height:640});await expect.poll(()=>region().evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await frame(region().locator('summary').first(),'source-context-narrow');
  await expect.poll(async()=>{const view=await fixture.viewPreferences.read();return view.kind==='available'?view.taskId:view.kind;}).toBe(b.task.id);await fixture.restart();await expect(workspace.getByRole('button',{name:'Choose task',exact:true})).toContainText('Mesa');await expect(region()).toContainText('Omitted dependencies remain unknown');expect((await fixture.core.getTask(b.task.id)).procedures).toEqual(updated.procedures);
  expect(fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type==='source.follow.enable'||command.type==='context.start'||command.type==='context.capture'||command.type==='windows.capture'||command.type.startsWith('export.'))).toEqual([]);expect(fixture.external).toEqual([]);
 }finally{releaseResume?.();await fixture.close();}
});
