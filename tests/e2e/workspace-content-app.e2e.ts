import {test,expect} from '@playwright/test';
import {OnboardingFixture} from '../support/onboarding-fixture';
import {taskTool} from '../support/ui-tools';
import {settleCapture,revealForInspection} from '../support/settled-capture';
import {chooseLocalResearch,readLocalResearchCommand} from '../../src/shared/local-research-suggestions';

test.use({viewport:{width:1080,height:800},reducedMotion:'reduce'});

for(const enabled of [false,true])test(`actual App preserves workspace content with local research ${enabled?'enabled':'off by default'}`,async({page},testInfo)=>{
 const fixture=await OnboardingFixture.open(page,{ready:true});
 try{
  const invoke=fixture.invoke.bind(fixture);
  // Real disposable stores and classifier; OS/provider transport remains substituted.
  fixture.invoke=async command=>{
   if(!command.type.startsWith('research.'))return invoke(command);
   fixture.commands.push(structuredClone(command));
   const input=readLocalResearchCommand(command),saved=await fixture.viewPreferences.readLocalResearch();
   if(input.type==='research.settings.get')return saved;
   if(input.type!=='research.preview'&&input.type!=='research.choose')throw Error('Unexpected research mutation');
   if(saved.kind!=='available'||!saved.current.enabled||saved.current.revision!==input.preferenceRevision)throw Error('Research is off or changed');
   const lease=await fixture.core.leaseLocalResearch(input.taskId,saved.current);
   try{await lease.check();lease.assertCurrent();return input.type==='research.preview'?lease.view:chooseLocalResearch(lease.view,input);}finally{lease.release();}
  };
  const catalog=await fixture.ready(),alpha=await fixture.core.createTask({title:'Workspace Alpha',assignedBotId:catalog.defaultBotId}),beta=await fixture.core.createTask({title:'Workspace Beta',assignedBotId:catalog.defaultBotId});
  await fixture.core.runRequest({taskId:alpha.id,requestId:'workspace-render-smoke',kind:'explain',prompt:'Why does this local example work?',sourceIds:[]},async()=>({title:'Saved local answer',content:'The saved answer belongs to Workspace Alpha.',mimeType:'text/markdown'}));
  await fixture.core.checkpoint(alpha.id,'Saved activity for Workspace Alpha.');
  if(enabled)await fixture.viewPreferences.changeLocalResearch({type:'research.settings',expectedRevision:0,enabled:true,memory:false,notices:false});
  else expect(await fixture.viewPreferences.readLocalResearch()).toMatchObject({current:{revision:0,enabled:false,memory:false,notices:false}});
  await fixture.viewPreferences.select(alpha.id);await page.reload();
  const main=page.locator('main#main');
  await expect(main).toBeVisible();await expect(main).toHaveAttribute('tabindex','-1');
  await expect(main.locator('.conversation-question')).toContainText('Why does this local example work?');
  await expect(main.locator('.conversation-answer')).toContainText('The saved answer belongs to Workspace Alpha.');
  await main.locator('.conversation-question').scrollIntoViewIfNeeded();await settleCapture(page);await page.screenshot({path:testInfo.outputPath('workspace-saved-conversation.png')});
  const research=main.getByRole('region',{name:'Local research suggestions',exact:true});
  if(enabled){
   await expect(research).toBeVisible();expect(fixture.commands.filter(command=>command.type==='research.preview')).toEqual([]);
   await research.getByRole('button',{name:'Find local research suggestions',exact:true}).click();
   await expect(research.getByRole('button',{name:'Add question to message',exact:true})).toHaveCount(3);
   await revealForInspection(page,research.locator('.saved-helper').first());await page.screenshot({path:testInfo.outputPath('workspace-research-preview.png')});
   const generic=await research.locator('.saved-helper>p').first().innerText();
   await research.getByRole('button',{name:'Add question to message',exact:true}).first().click();
   const composer=page.getByRole('textbox',{name:'Ask about this task',exact:true});await expect(composer).toHaveValue(generic);await composer.fill('');
  }else{await expect(research).toHaveCount(0);expect(fixture.commands.filter(command=>command.type==='research.preview'||command.type==='research.choose')).toEqual([]);}
  await taskTool(page,'History');await expect(page.getByRole('dialog')).toContainText('Saved activity for Workspace Alpha.');
  await settleCapture(page);await page.screenshot({path:testInfo.outputPath('workspace-history.png')});
  await page.getByRole('button',{name:'Back to task',exact:true}).click();await expect(main.locator('.conversation-question')).toContainText('Why does this local example work?');
  const navigation=page.locator('.workspace:visible').getByRole('complementary',{name:'Task navigation'});
  await navigation.getByRole('button',{name:'Workspace Beta',exact:true}).click();await expect(main).not.toContainText('The saved answer belongs to Workspace Alpha.');await expect(page.locator('.workspace .chrome h1')).toHaveText(beta.title);
  await navigation.getByRole('button',{name:'Workspace Alpha',exact:true}).click();await expect(main.locator('.conversation-answer')).toContainText('The saved answer belongs to Workspace Alpha.');
  await navigation.getByRole('button',{name:'New task',exact:true}).click();await expect(main.getByRole('button',{name:'Paste text',exact:true})).toBeVisible();await expect(main.getByRole('button',{name:'Write a draft',exact:true})).toBeVisible();await expect(research).toHaveCount(0);
  expect(fixture.commands.filter(command=>command.type==='model.run'||command.type==='browser.run'||command.type==='research.settings')).toEqual([]);expect(fixture.external).toEqual([]);
  await settleCapture(page);await page.screenshot({path:testInfo.outputPath('workspace-new-task.png')});
 }finally{await fixture.close();}
});
