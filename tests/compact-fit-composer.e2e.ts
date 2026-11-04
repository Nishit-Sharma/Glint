// Native compact fit (c26 FAIL S4.1/C3.1): the window opened at the 220px host floor with the input below it.
// This emulates the host contract from src/host/index.ts fitCompact: height = clamp(request, 220, maxHeight),
// and the window becomes that height. The renderer must request enough for the answer, context line, chips
// and pinned input, and the input must stay inside the window even if the host keeps the floor.
import {test,expect,type Page} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
test.use({reducedMotion:'reduce'});
test.describe.configure({mode:'serial'});
const FLOOR=220,MAX=900;let offRequest=0;
async function host(page:Page,f:BrowserFixture,stuck:number|false=false){
 const base=Reflect.get(f,'invoke').bind(f),requests:number[]=[];
 Reflect.set(f,'invoke',async(command:any)=>{if(command.type!=='surface.fit')return base(command);if(command.phase==='running')return {height:page.viewportSize()!.height,maxHeight:MAX};requests.push(command.height);const height=stuck||Math.max(FLOOR,Math.min(command.height,MAX));await page.setViewportSize({width:360,height});return {height,maxHeight:MAX};});
 return requests;
}
async function open(page:Page,setup:(f:BrowserFixture)=>Promise<void>,stuck:number|false=false,answer=true){
 await page.setViewportSize({width:360,height:stuck||FLOOR});const f=await BrowserFixture.open(page,'anchor');
 if(answer)await f.core.runRequest({taskId:f.taskA.id,requestId:crypto.randomUUID(),kind:'explain',prompt:'What does the brief ask for?'},async()=>({title:'Brief summary',content:'The brief asks for a short plan with three steps: confirm the venue, list the guests, and send invitations by Friday.',mimeType:'text/markdown'}));
 await setup(f);await f.changed(f.taskA.id);const requests=await host(page,f,stuck);await f.enter('companion',{id:'fit-'+crypto.randomUUID(),maxHeight:MAX});
 await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal',/^(settled|cancelled)$/);await expect(page.getByLabel('Ask companion',{exact:true})).toBeAttached();
 return {f,requests};
}
async function panelRowShown(page:Page){
 // (a) The first Details row is inside the composer's visible area and above the pinned input.
 await expect.poll(()=>page.evaluate(()=>{const row=document.querySelector('.compact-compose .request-details>*')!.getBoundingClientRect(),input=document.querySelector('.compact-compose .prompt-suggestion-input')!.getBoundingClientRect(),box=document.querySelector('.compact-compose')!.getBoundingClientRect();return row.height>0&&row.top>=box.top-1&&row.bottom<=input.top+1;})).toBe(true);
}
const answerRoom=(page:Page)=>page.locator('.compact-main').evaluate(el=>el.clientHeight);
async function geometry(page:Page){
 return page.evaluate(()=>{const rect=(s:string)=>document.querySelector(s)?.getBoundingClientRect();const input=rect('#compact-prompt')!,context=rect('.compact-compose div.request-context>details>summary')!,chips=rect('.compact-compose .request-chips');
  return {viewport:innerHeight,inputTop:input.top,inputBottom:input.bottom,contextTop:context.top,contextBottom:context.bottom,chipsBottom:chips?.bottom,chips:document.querySelectorAll('.compact-compose .request-chip').length};});
}
test('compact fit requests room for the answer, context line and pinned input with chips off',async({page})=>{
 const off=await open(page,async f=>{await f.core.saveComposerDraft(f.taskA.id,0,{text:'',kind:'experiment'});});
 try{
  const a=await geometry(page);expect(a.chips).toBe(0);
  expect(Math.max(...off.requests)).toBeGreaterThan(FLOOR);expect(a.viewport).toBeGreaterThan(FLOOR);
  expect(a.inputTop).toBeGreaterThanOrEqual(0);expect(a.inputBottom).toBeLessThanOrEqual(a.viewport);expect(a.contextBottom).toBeLessThanOrEqual(a.inputTop);
  await expect(page.locator('.compact-main')).toContainText('three steps');offRequest=Math.max(...off.requests);
 }finally{await off.f.close();}
});
test('with included-context chips on, the fit asks for more and the input stays in the window',async({page})=>{
 const on=await open(page,async f=>{await f.core.setTaskResponseMode(f.taskA.id,0,'plan');const skill=await f.core.saveInstructionSkill({taskId:f.taskA.id,intentId:crypto.randomUUID(),name:'Evidence-first venue and guest planning checklist',description:'',instructions:'Cite the source line for each claim.',resources:[]});await f.core.setInstructionSkill(f.taskA.id,0,skill.reference);});
 try{
  const b=await geometry(page);expect(b.chips).toBeGreaterThanOrEqual(2);
  expect(offRequest).toBeGreaterThan(FLOOR);expect(Math.max(...on.requests)).toBeGreaterThan(offRequest);
  expect(b.inputTop).toBeGreaterThanOrEqual(0);expect(b.inputBottom).toBeLessThanOrEqual(b.viewport);expect(b.chipsBottom!).toBeLessThanOrEqual(b.inputTop);
  await expect(page.locator('.compact-compose').getByRole('button',{name:'Plan mode',exact:true})).toBeVisible();
  expect(on.f.modelInvocations).toEqual([]);expect(on.f.externalRequests).toEqual([]);
 }finally{await on.f.close();}
});
test('if the host keeps the 220px floor the input stays fully inside the window',async({page})=>{
 const stuck=await open(page,async f=>{await f.core.setTaskResponseMode(f.taskA.id,0,'plan');},FLOOR);
 try{
  const c=await geometry(page);expect(c.viewport).toBe(FLOOR);expect(c.inputTop).toBeGreaterThanOrEqual(0);expect(c.inputBottom).toBeLessThanOrEqual(FLOOR);expect(c.contextTop).toBeGreaterThanOrEqual(0);
  // Review B: at the floor the answer keeps one full line and the included-context disclosure stays visible above the input.
  expect(await page.locator('.compact-main').evaluate(el=>el.clientHeight)).toBeGreaterThanOrEqual(54);await expect(page.locator('.compact-main')).toHaveAttribute('data-more','false');
  const folded=page.locator('.compact-compose').getByRole('button',{name:/^Included with your next message: Plan mode, Memory · (on|checking)\. Request details$/});
  await expect(folded).toBeVisible();await expect(folded).toHaveText('+2 included');
  const fold=await folded.boundingBox();expect(fold!.y+fold!.height).toBeLessThanOrEqual(c.inputTop);expect(fold!.y).toBeGreaterThanOrEqual(0);
  await folded.click();await expect(page.locator('.compact-compose').getByRole('group',{name:'Request details',exact:true})).toBeVisible();await panelRowShown(page);
  expect(await answerRoom(page)).toBeGreaterThanOrEqual(54);await folded.click();
  await page.getByLabel('Ask companion',{exact:true}).fill('Still reachable at the floor.');await expect(page.getByLabel('Ask companion',{exact:true})).toHaveValue('Still reachable at the floor.');
 }finally{await stuck.f.close();}
});
test('a fresh task with a saved source and no answer is not left at the floor with the input below the window',async({page})=>{
 // The native c26 case ("Shelf note"): little answer content, so a shrunken composer used to keep every request at 220.
 const fresh=await open(page,async()=>{},false,false);
 try{
  const d=await geometry(page);expect(Math.max(...fresh.requests)).toBeGreaterThan(FLOOR);
  expect(d.inputTop).toBeGreaterThanOrEqual(0);expect(d.inputBottom).toBeLessThanOrEqual(d.viewport);expect(d.contextBottom).toBeLessThanOrEqual(d.inputTop);
 }finally{await fresh.f.close();}
});
test('at 300 with Details open the composer shows a scroll shadow and keeps the input in the window',async({page})=>{
 const tall=await open(page,async f=>{await f.core.setTaskResponseMode(f.taskA.id,0,'plan');},300);
 try{
  await page.locator('.compact-compose').getByRole('button',{name:'Details',exact:true}).click();
  await panelRowShown(page);
  // (d) one full answer line (16 + 22 + 4) stays with the panel open at 300.
  expect(await answerRoom(page)).toBeGreaterThanOrEqual(42);
  // (b) when composer content sits under the pinned input, the cue is on the input region's top edge.
  await page.locator('.compact-compose').evaluate(el=>{el.scrollTop=0;});await expect(page.locator('.compact-compose')).toHaveAttribute('data-below','true');
  expect(await page.locator('.compact-compose .prompt-suggestion-input').evaluate(el=>getComputedStyle(el).boxShadow)).not.toBe('none');
  const e=await geometry(page);expect(e.inputBottom).toBeLessThanOrEqual(300);
 }finally{await tall.f.close();}
});
