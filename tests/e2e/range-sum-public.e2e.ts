import {expect,test,type Locator,type Page} from '@playwright/test';
import {offlineTaskEntry} from '../support/offline-task-entry.fixture';
import {taskTool} from '../support/ui-tools';
import {pickingPublicFrame as frame} from '../support/picking-public-frame';
import {saveSourceFormula,inspectSourceFormulaSave} from '../../src/core/source-formula-host';
import {inspectTargetPractice,inspectOriginalTargetPractice,submitTargetPractice} from '../../src/core/experiment-target-practice-host';
import {evaluateExperiment} from '../../src/core/experiments';
import {projectTaskDialogue} from '../../src/core/task-dialogue';
const source='total = 2\nfor item in range(5):\n    total += item',title='Source-derived CS range learning',modelTitle='Reviewed integer range sum';
const ws=(page:Page)=>page.locator('.workspace:visible'),doc=(page:Page)=>page.getByRole('dialog',{name:'Document',exact:true}),context=(page:Page)=>page.getByRole('dialog',{name:'Context',exact:true});
async function expand(details:Locator){if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();await expect(details).toHaveAttribute('open','');}
async function open(page:Page,id:string){await taskTool(page,'Files');await page.getByRole('dialog',{name:'Files',exact:true}).locator(`.artifact-row[data-view-focus="artifact:${id}"]`).click();await expect(doc(page)).toBeVisible();}

test('derive a bounded integer loop model from exact source, explain and change it, then preserve distinct first target reasoning and source holds on reopen',async({page},info)=>{
 const entry=await offlineTaskEntry(page,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180),{ready:true}),invoke=entry.fixture.invoke.bind(entry.fixture),frames:Awaited<ReturnType<typeof frame>>[]=[];
 let loseAnswer=true;
 entry.fixture.invoke=async command=>{
  const record=()=>entry.fixture.commands.push(structuredClone(command));
  if(command.type==='experiment.source.save'){record();const {type,...input}=command,result=await saveSourceFormula(entry.fixture.core,input);await entry.fixture.emit({type:'changed',taskId:command.input.taskId});return result;}
  if(command.type==='experiment.source.inspect'){record();return inspectSourceFormulaSave(entry.fixture.core,command.input);}
  if(command.type==='experiment.evaluate'){record();return evaluateExperiment(command.spec,command.inputs);}
  if(command.type==='experiment.target.inspect'){record();const {type,...input}=command;return inspectTargetPractice(entry.fixture.core,input);}
  if(command.type==='experiment.target.inspect-original'){record();const {type,...input}=command;return inspectOriginalTargetPractice(entry.fixture.core,input);}
  if(command.type==='experiment.target.submit'){record();const {type,...input}=command,result=await submitTargetPractice(entry.fixture.core,input);await entry.fixture.emit({type:'changed',taskId:command.taskId});if(loseAnswer){loseAnswer=false;throw Error('Owned fixture dropped a committed target-answer reply.');}return result;}
  return invoke(command);
 };
 const task=async()=>{const found=(await entry.fixture.core.listTasks()).find(t=>t.title===title);if(!found)throw Error('Owned task is not committed.');return entry.fixture.core.getTask(found.id);};
 const capture=async(anchor:Locator,name:string)=>frames.push(await frame(page,anchor,name));
 try{
  await ws(page).getByRole('complementary',{name:'Task navigation',exact:true}).getByRole('button',{name:'New task',exact:true}).click();
  await ws(page).getByRole('button',{name:'Paste text',exact:true}).click();const start=ws(page).getByRole('region',{name:'Start with text',exact:true});
  await start.getByLabel('Title (optional)',{exact:true}).fill(title);await start.getByLabel('Source text',{exact:true}).fill(source);await start.getByRole('button',{name:'Create task',exact:true}).click();
  await expect.poll(async()=>{const found=(await entry.fixture.core.listTasks()).find(t=>t.title===title);return found?.sources[0]?.versions.at(-1)?.content;}).toBe(source);
  await expect(ws(page).getByRole('heading',{level:1,name:title,exact:true})).toBeVisible();await context(page).getByRole('button',{name:'Back to task',exact:true}).click();await expect(context(page)).toBeHidden();
  await taskTool(page,'Files');const files=page.getByRole('dialog',{name:'Files',exact:true});await files.getByRole('button',{name:'New file',exact:true}).click();await files.getByRole('button',{name:'Experiment',exact:true}).click();
  const workbench=page.getByRole('dialog',{name:'Experiment',exact:true}).getByRole('region',{name:'Source formula workbench',exact:true});await expand(workbench.locator(':scope > details'));
  const original=await task(),savedSource=original.sources[0],ref={sourceId:savedSource.id,version:1,digest:savedSource.versions[0].digest};
  await workbench.getByLabel('Saved formula source',{exact:true}).selectOption(JSON.stringify(ref));const recognized=workbench.getByRole('region',{name:'Recognized integer loop model',exact:true});
  await expect(recognized.locator('pre')).toHaveText(source);await capture(recognized.locator('pre'),'01-exact-complete-source-idiom-full');
  await recognized.getByRole('button',{name:'Stage bounded range-sum model for review',exact:true}).click();await expect(workbench.getByLabel('Formula count domain',{exact:true})).toHaveValue('integer');
  await workbench.getByRole('button',{name:'Review cited formula and calculation',exact:true}).click();await expect(workbench.getByText('Calculated result: 12 1.',{exact:true})).toBeVisible();
  await capture(workbench.getByRole('heading',{name:'Derived arithmetic model — not executed Python',exact:true}),'02-reviewed-derived-model-boundary-full');
  await workbench.getByLabel('I reviewed the exact formula publication',{exact:true}).check();await workbench.getByRole('button',{name:'Save reviewed cited experiment',exact:true}).click();
  await expect.poll(async()=>(await task()).artifacts.length).toBe(1);let snapshot=await task();const model=structuredClone(snapshot.artifacts[0]);expect(model.revisions[0].sourceRefs).toEqual([ref]);expect(JSON.parse(model.revisions[0].content).citation).toMatchObject({quote:source,lineCount:3});
  await open(page,model.id);const review=doc(page).getByRole('region',{name:'Experiment review',exact:true}),calculate=review.getByRole('button',{name:'Calculate',exact:true});
  await calculate.click();const explanation=review.getByRole('region',{name:'Understand the derived range sum',exact:true});await expect(explanation).toContainText('not an executed Python trace');
  await capture(explanation.getByText(/The 5 illustrative iterations add integers 0 through 4/),'03-quick-exclusive-stop-and-result-full');
  await explanation.getByRole('button',{name:'Deep',exact:true}).click();await capture(explanation.getByText(/For a whole-number count n, pair the terms/),'04-deep-arithmetic-derivation-full');
  await explanation.getByRole('button',{name:'Visual',exact:true}).click();await capture(explanation.getByRole('listitem').filter({hasText:'item = 4: total 8 + 4 → 12.'}),'05-illustrative-accumulator-state-full');
  await review.getByRole('button',{name:'Use as comparison baseline',exact:true}).click();await review.getByLabel('Count',{exact:true}).fill('5.5');await expect(calculate).toBeDisabled();
  await capture(review.getByText('Enter a whole-number value.',{exact:true}),'06-fractional-loop-count-refused-full');
  await review.getByLabel('Count',{exact:true}).fill('6');await calculate.click();await expect(review.getByRole('region',{name:'Calculation result',exact:true})).toContainText('17');
  await explanation.getByRole('button',{name:'Quick',exact:true}).click();await page.setViewportSize({width:360,height:640});
  await capture(explanation.getByText(/The 6 illustrative iterations add integers 0 through 5/),'07-changed-count-result-narrow');await page.setViewportSize({width:1080,height:800});
  const practice=review.getByRole('region',{name:'Target-outcome practice',exact:true});await expand(practice.locator(':scope > details'));await practice.getByLabel('Target missing input',{exact:true}).selectOption('count');
  const target=practice.getByRole('heading',{name:'Calculated target: 30',exact:true});await expect(target).toBeVisible();await expect(practice).toContainText('using whole numbers only');await expect(practice).not.toContainText('One sampled input');await capture(target,'08-distinct-integer-target-full');
  await practice.getByRole('button',{name:'Check target practice record',exact:true}).click();await practice.getByLabel('Target proposed input',{exact:true}).fill('7');
  const first='  I counted the excluded stop as a term.\nKeep my first reasoning.  ',newer='  New unsent reasoning remains separate.  ';
  await practice.getByLabel('Target reasoning',{exact:true}).fill(first);await expect(practice.getByRole('button',{name:'Save first target answer',exact:true})).toBeDisabled();
  await practice.getByLabel('Share this saved target answer with task context',{exact:true}).check();await practice.getByRole('button',{name:'Save first target answer',exact:true}).click();
  await expect(practice.getByRole('status').filter({hasText:'The target-practice save was not confirmed.'})).toBeVisible();await practice.getByRole('button',{name:'Inspect original target answer',exact:true}).click();
  const feedback=practice.getByRole('region',{name:'Original target-practice feedback',exact:true});await expect(feedback).toContainText('Your first answer: 7 1');await expect(feedback).toContainText(first.trim());
  await capture(feedback.getByText('Calculated output from your answer: 23 1',{exact:false}),'09-first-wrong-answer-and-feedback-full');
  await practice.getByLabel('Target reasoning',{exact:true}).fill(newer);await entry.fixture.flushDrafts();snapshot=await task();const answer=structuredClone(snapshot.artifacts.find(a=>a.id!==model.id)!);expect(answer.revisions[0].content).toContain(first);expect(projectTaskDialogue(snapshot,'not-dispatched',[])).not.toContain(newer);
  await review.getByRole('button',{name:'Save result to task',exact:true}).click();await expect(doc(page)).toHaveCount(0);snapshot=await task();const result=structuredClone(snapshot.artifacts.find(a=>a.id!==model.id&&a.id!==answer.id)!);expect(result.revisions[0].content).toContain('Baseline result: 12 1');expect(result.revisions[0].content).toContain('Calculated difference: 5 1');expect(result.revisions[0].sourceRefs).toEqual([ref]);
  await open(page,result.id);await capture(doc(page).getByText('Calculated difference: 5 1',{exact:false}),'10-explicitly-saved-source-linked-comparison-full');await entry.fixture.flushDrafts();await entry.restartNewCore();
  await open(page,model.id);const reopened=doc(page).getByRole('region',{name:'Target-outcome practice',exact:true});await expand(reopened.locator(':scope > details'));await expect(reopened.getByLabel('Target reasoning',{exact:true})).toHaveValue(newer);
  await page.setViewportSize({width:360,height:640});await capture(reopened.getByLabel('Target reasoning',{exact:true}),'11-newer-reasoning-restored-narrow');await page.setViewportSize({width:1080,height:800});
  await taskTool(page,'Sources');await context(page).locator('.source-list-row').filter({hasText:title}).click();await context(page).getByRole('button',{name:'Source options',exact:true}).click();await context(page).getByRole('button',{name:'Edit / refresh',exact:true}).click();
  await context(page).getByLabel('Source text',{exact:true}).fill(source.replace('range(5)','range(7)'));await context(page).getByRole('button',{name:'Save new version',exact:true}).click();await context(page).getByRole('button',{name:'Back to task',exact:true}).click();
  await open(page,model.id);await expand(reopened.locator(':scope > details'));await reopened.getByRole('button',{name:'Inspect original target answer',exact:true}).click();
  await expect(reopened.getByRole('region',{name:'Original target-practice feedback',exact:true})).toContainText(first.trim());await expect(reopened.getByLabel('Target reasoning',{exact:true})).toHaveValue(newer);await expect(reopened.getByRole('button',{name:'Save first target answer',exact:true})).toBeDisabled();
  await capture(reopened.getByText('This formula or a cited source changed. New answers are held. You can still inspect the exact original saved answer.',{exact:true}),'12-source-change-holds-new-practice-full');
  snapshot=await task();expect(snapshot.sources[0].currentVersion).toBe(2);expect(snapshot.artifacts.find(a=>a.id===model.id)).toEqual(model);expect(snapshot.artifacts.find(a=>a.id===answer.id)).toEqual(answer);expect(snapshot.artifacts.find(a=>a.id===result.id)).toEqual(result);expect(snapshot.requests).toHaveLength(2);
  expect(entry.fixture.commands.filter(c=>c.type==='experiment.target.submit')).toHaveLength(1);expect(entry.fixture.commands.filter(c=>c.type==='model.run'||/^(browser|windows|export)\./.test(c.type))).toEqual([]);expect(entry.fixture.external).toEqual([]);expect(frames).toHaveLength(12);
  await info.attach('range-sum-boundary',{body:JSON.stringify({scope:'Initialized identity/example fixture; journey-owned task/source/derived-model review, explanation, changed calculation, distinct target, first answer/reasoning, explicit ordinary result and source correction use public App controls. Actual finite arithmetic/target/core/store/cache; OS/provider/transport and one lost committed reply controlled. This is a bounded derived arithmetic illustration, not Python execution, general code understanding, independently unseen exposure or mastery. Core recreation retains the existing sidecar instance and is not native restart. Twelve actual viewport anchors; exact other source/document/raw data are separate DOM/core assertions.',frames,ref,model,answer,result,commands:entry.fixture.commands},null,2),contentType:'application/json'});
 }finally{await entry.close();}
});
