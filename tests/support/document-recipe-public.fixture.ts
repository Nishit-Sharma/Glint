import {legacyDocumentRecipeSave} from './legacy-helper-report-publication.fixture';
import {expect,type Page} from '@playwright/test';
import {OnboardingFixture} from './onboarding-fixture';
import {createDocumentRecipe,saveDocumentRecipe,inspectDocumentRecipeSave} from '../../src/core/document-recipe-host';
import {previewDocumentRecipe} from '../../src/shared/document-recipe';
export async function documentRecipePublic(page:Page){
 const fixture=await OnboardingFixture.open(page,{ready:true,port:Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)}),catalog=await fixture.ready(),task=await fixture.core.createTask({title:'Repeatable local handoff',assignedBotId:catalog.defaultBotId});
 await fixture.core.putSource(task.id,{id:'fresh-notes',kind:'text',role:'fact',label:'Fresh local notes',content:'Owner: Rowan\nNext: Inspect stock'});
 await fixture.core.putSource(task.id,{id:'private-notes',kind:'text',role:'fact',label:'Protected local notes',content:'PRIVATE\nOwner: Rowan\nNext: Inspect stock'});
 let dropSave=false,retireSave=false;const invoke=fixture.invoke.bind(fixture);
 fixture.invoke=async command=>{
  if(command.type==='helper.document.create'){expect(command.taskId).toBe(task.id);fixture.commands.push(structuredClone(command));const {type,...input}=command,saved=await createDocumentRecipe(fixture.core,input);await fixture.emit({type:'changed',taskId:task.id});return saved;}
  if(command.type==='helper.document.preview'){fixture.commands.push(structuredClone(command));const {type,...input}=command;return previewDocumentRecipe(await fixture.core.getTask(command.taskId),input);}
  if(command.type==='helper.document.save'){fixture.commands.push(structuredClone(command));let checks=0;const {type,...input}=command,saved=await (retireSave?legacyDocumentRecipeSave:saveDocumentRecipe)(fixture.core,input,()=>{if(retireSave&&++checks===3){retireSave=false;throw Error('Owned fixture retired the admitted save before output commit.');}});if(dropSave){dropSave=false;throw Error('Owned fixture lost the save response after the document was committed.');}await fixture.emit({type:'changed',taskId:task.id});return saved;}
  if(command.type==='helper.document.inspect'){fixture.commands.push(structuredClone(command));const {type,...input}=command;return inspectDocumentRecipeSave(fixture.core,input);}
  return invoke(command);
 };
 // A mounted App can persist its current view while fixture data is being seeded.
 // Choose the visible owner through the public task navigation before opening Files.
 await page.reload();
 const selectedTask=page.getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('navigation',{name:'Saved tasks',exact:true}).getByRole('button',{name:task.title,exact:true});
 await selectedTask.click();await expect(selectedTask).toHaveAttribute('aria-current','page');await expect(page.locator('.workspace').getByRole('heading',{level:1,name:task.title,exact:true})).toBeVisible();
 await expect.poll(()=>fixture.viewPreferences.read()).toEqual({kind:'available',taskId:task.id});
 return {fixture,task,retireNextSave(){retireSave=true;},loseNextSave(){dropSave=true;},async changeSource(){await fixture.core.putSource(task.id,{id:'fresh-notes',kind:'text',role:'fact',label:'Fresh local notes',content:'Owner: Rowan\nNext: Review changed stock'});await fixture.emit({type:'changed',taskId:task.id});}};
}
