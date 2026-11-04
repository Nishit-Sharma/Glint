import {expect,test} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {BrowserFixture} from '../support/browser-fixture';
import {emptyTaskSession} from '../../src/core/task-session';
import {BrowserReconciliation} from '../../src/host/browser/reconciliation';
import {LocalBrowser} from '../../src/host/browser/local-browser';
import {pickingPublicFrame as frame,revealPublicViewport} from '../support/picking-public-frame';
import {installLoopbackTestEngine} from '../support/loopback-browser.fixture';
// Loopback-locked engine only: these specs never launch or select the person's installed browsers.
installLoopbackTestEngine();

test.use({viewport:{width:1080,height:800},reducedMotion:'reduce'});

test('compare saved action evidence, inspect a still-unknown outcome and restore its history without replay',async({page},info)=>{
 const fixture=await BrowserFixture.open(page,undefined,Number(process.env.WINDOW_COMPANION_TEST_PORT??4180)),originalOpen=LocalBrowser.open,frames:unknown[]=[],geometry:unknown[]=[],origin='https://owned.example',taskId=fixture.taskA.id,runId='owned-evidence-run';
 const longText='ORIGINAL_BEGIN\n'+Array.from({length:64},(_,i)=>`Saved detail ${i+1}: Mesa draft, historical page content.\n`).join('')+'<script>not executed</script>\n'+'x'.repeat(180)+'\nORIGINAL_END';
 try{
  await fixture.core.runRequest({taskId,requestId:runId,kind:'browser',prompt:'Prepare Mesa details, then confirm the draft once.',sourceIds:[]},async()=>{throw Error('The website action has an uncertain outcome.');});
  const initial=(await fixture.core.getTask(taskId)).session??emptyTaskSession(),observation={id:'before',taskId,browserId:'owned-browser',documentId:'owned-form',url:origin+'/form',title:'Owned form',text:'Before the saved details',digest:'before-digest',targets:[]};
  await fixture.core.replaceSession(taskId,initial.revision,{...initial,runs:[...initial.runs,{id:runId,endpointKey:'scripted-owned-fixture',origin,browserId:'owned-browser',initialObservation:observation,operations:[
   {id:'prepare-details',intent:{kind:'click',snapshotId:'before',targetId:'prepare'},reason:'Save preliminary details',status:'observed',receipt:{status:200,url:origin+'/details-receipt',body:'Saved details: Mesa. This is a stored page excerpt.'},result:{...observation,id:'after-details',url:origin+'/details',text:longText,targets:[{id:'unshown',role:'hidden',label:'Unselected control',value:'UNSHOWN_TARGET_VALUE'}]}},
   {id:'confirm-draft',intent:{kind:'click',snapshotId:'after-details',targetId:'confirm'},reason:'Confirm Mesa draft once',status:'uncertain'},
  ]}]});
  await fixture.changed(taskId);
  const before=await fixture.core.getTask(taskId),turn=page.locator('.workspace .conversation-turn').filter({hasText:'Prepare Mesa details, then confirm the draft once.'});
  const details=turn.locator('li').filter({hasText:'Save preliminary details'}),uncertain=turn.locator('li').filter({hasText:'Confirm Mesa draft once'});
  await details.getByText('Compare saved action evidence',{exact:true}).click();
  const original=details.getByRole('region',{name:'Original action evidence',exact:true}),stored=original.getByRole('region',{name:'Saved post-action page text',exact:true});
  await expect(original).toContainText('Recorded response status: 200');await expect(stored).toHaveText(longText);await expect(details).not.toContainText('UNSHOWN_TARGET_VALUE');await expect(details.locator('script,iframe,img,a')).toHaveCount(0);
  frames.push(await frame(page,original.getByRole('heading',{name:'Original action',exact:true}),'01-original-evidence-full'));
  const captureLong=async(name:string)=>{
   await revealPublicViewport(page,stored,name+'-before');await stored.focus();await expect(stored).toBeFocused();await expect(stored).toHaveAttribute('tabindex','0');await expect(stored).toHaveCSS('white-space','pre-wrap');await expect(stored).toHaveCSS('overflow-wrap','anywhere');
   const metrics=()=>stored.evaluate(element=>({scrollTop:element.scrollTop,scrollHeight:element.scrollHeight,clientHeight:element.clientHeight,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth,focused:document.activeElement===element}));
   const start=await metrics();expect(start.scrollHeight).toBeGreaterThan(start.clientHeight);expect(start.scrollWidth).toBeLessThanOrEqual(start.clientWidth+1);await stored.hover();await page.mouse.wheel(0,start.scrollHeight);await expect.poll(async()=>{const value=await metrics();return value.scrollHeight-value.clientHeight-value.scrollTop;}).toBeLessThanOrEqual(1);frames.push(await frame(page,stored,name));geometry.push({name,start,end:await metrics(),boundary:'Full saved text is asserted; original end frame and natural wheel reach only. No claim that every offscreen glyph was visually reviewed.'});
  };
  await captureLong('02-long-original-end-full');
  await uncertain.getByText('Compare saved action evidence',{exact:true}).click();
  const missing=uncertain.getByRole('region',{name:'Original action evidence',exact:true});await expect(missing).toContainText('This is missing evidence, not an empty page.');await expect(missing).not.toContainText('Recorded response status: 200');frames.push(await frame(page,missing.getByText('No post-action page observation was saved. This is missing evidence, not an empty page.',{exact:true}),'03-missing-original-full'));
  expect((await fixture.core.getTask(taskId)).session?.runs).toEqual(before.session?.runs);expect(fixture.commands.filter(command=>command.type==='browser.inspect')).toEqual([]);
  const reconciliation=new BrowserReconciliation(fixture.core);let reads=0;
  LocalBrowser.open=(async()=>({id:'scripted-inspection-browser',observe:async()=>{reads++;return {...observation,id:'inspection-'+reads,browserId:'scripted-inspection-browser',url:origin+'/receipts',text:'REVIEW_BEGIN\nOne Mesa draft is listed, but its confirmation is not established.\nREVIEW_END',digest:'review-digest-'+reads};},close:async()=>{}})) as unknown as typeof LocalBrowser.open;
  fixture.browserInspection=async command=>{const inspected=await reconciliation.inspect(command);await reconciliation.resolve(inspected.id,async()=>({outcome:'uncertain',note:'The reviewed page still does not settle confirmation.'}));return fixture.core.getTask(taskId);};
  await uncertain.getByRole('button',{name:'Inspect outcome',exact:true}).click();
  const reviewed=uncertain.getByRole('region',{name:'Later outcome review',exact:true});await expect(reviewed).toContainText('Your review left the outcome uncertain.');await expect(reviewed.getByRole('region',{name:'Saved reviewed page text',exact:true})).toContainText('REVIEW_END');await expect(turn.locator('.conversation-status')).toHaveText('Outcome needs review');await expect(uncertain.getByRole('button',{name:'Inspect outcome',exact:true})).toBeEnabled();frames.push(await frame(page,reviewed.getByText('Your review left the outcome uncertain.',{exact:true}),'04-still-uncertain-review-full'));
  const reviewedTask=await fixture.core.getTask(taskId);expect(reviewedTask.session!.runs[0].operations[0]).toEqual(before.session!.runs[0].operations[0]);expect(reviewedTask.session!.runs[0].operations[1].status).toBe('uncertain');expect(reads).toBe(1);
  await fixture.restartCore();await page.reload();
  await details.getByText('Compare saved action evidence',{exact:true}).click();await uncertain.getByText('Compare saved action evidence',{exact:true}).click();await expect(reviewed).toContainText('The reviewed page still does not settle confirmation.');await page.setViewportSize({width:360,height:640});frames.push(await frame(page,reviewed.getByText('Your review left the outcome uncertain.',{exact:true}),'05-restored-review-narrow'));await captureLong('06-long-original-end-narrow');
  const restored=await fixture.core.getTask(taskId);expect(restored.session?.runs).toEqual(reviewedTask.session?.runs);expect(restored.artifacts).toEqual(before.artifacts);expect(restored.actions).toEqual(before.actions);expect(reads).toBe(1);expect(fixture.commands.filter(command=>command.type==='browser.inspect')).toHaveLength(1);expect(fixture.commands.filter(command=>command.type==='browser.run'||command.type==='model.run'||command.type==='browser.review.notes'||command.type.startsWith('export.')||command.type.includes('capture'))).toEqual([]);expect(fixture.externalRequests).toEqual([]);expect(frames).toHaveLength(6);
  const path=info.outputPath('browser-action-evidence.json');await writeFile(path,JSON.stringify({source:process.env.PICKING_PUBLIC_APP_SOURCE??null,boundary:'Actual App/core and reconciliation with synthetic persisted observations/receipt and a scripted read-only LocalBrowser substitute. No real browser launch or website access, retry, native approval, provider or external action. Core recreation is not native process restart. 360px is narrow workspace, not CompactCompanion.',frames,geometry,reads,session:restored.session,commands:fixture.commands},null,2));await info.attach('browser-action-evidence',{path,contentType:'application/json'});
 }finally{LocalBrowser.open=originalOpen;await fixture.close();}
});
