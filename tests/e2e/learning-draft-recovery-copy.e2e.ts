import {expect,test} from '@playwright/test';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workflowEntry} from '../support/workflow-entry.fixture';

const evidence=process.env.LEARNING_DRAFT_EVIDENCE??'evidence/learning-draft-recovery-copy';
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});});

test('unconfirmed recovery discloses a retained incomplete backup and keeps open input',async({page})=>{
 const entry=await workflowEntry(page),{fixture}=entry,workspace=page.locator('.workspace');
 try{
  await workspace.getByRole('button',{name:'Task options',exact:true}).click();
  await workspace.getByRole('button',{name:'Files',exact:true}).click();
  const files=page.getByRole('dialog',{name:'Files',exact:true});
  await files.getByRole('button',{name:'New file',exact:true}).click();
  await files.getByRole('button',{name:'Workflow example',exact:true}).click();
  const scope=page.getByRole('dialog',{name:'Document',exact:true});
  await scope.getByText('Change Edit from Ready',{exact:true}).click();
  const reason=scope.getByLabel('Edit from Ready reason',{exact:true});
  await reason.fill('Earlier saved value.');await fixture.flushDrafts();
  const save=fixture.learningDrafts.save.bind(fixture.learningDrafts);let failSave=true;
  fixture.learningDrafts.save=async(...args)=>{if(failSave){failSave=false;throw Error('Synthetic draft write failure.');}return save(...args);};
  await reason.fill('  Open input remains available.  ');
  await expect(scope.getByText('Unfinished practice could not be saved. Your input is kept in this open app. Resolve this before quitting.',{exact:true})).toBeVisible();
  const path=join(fixture.directory,'learning-drafts.json'),original=Buffer.from('{unreadable synthetic bytes');
  await writeFile(path,original);
  await scope.getByRole('button',{name:'Retry saving practice drafts',exact:true}).click();
  const maintenance=scope.getByRole('region',{name:'Practice draft recovery',exact:true});
  const partialName='learning-drafts-recovery-00000000-0000-4000-8000-000000000001.json',partial=original.subarray(0,10);
  const invoke=fixture.invoke.bind(fixture);let attempts=0;
  // Simulate an interrupted copy at the declared transport boundary. The host store's
  // partial-write behavior is tested separately; this fixture does not intercept fs.
  fixture.invoke=async command=>{
   if(command.type==='learning-drafts.recover'&&++attempts===1){
    fixture.commands.push(structuredClone(command));
    await writeFile(join(fixture.directory,partialName),partial,{flag:'wx'});
    throw Error('Synthetic recovery acknowledgement failure after a partial backup.');
   }
   return invoke(command);
  };
  await maintenance.getByText('Recover unreadable practice drafts',{exact:true}).click();
  await maintenance.getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}).click();
  await expect(maintenance).toContainText('Practice storage recovery was not confirmed. Original bytes and open input are kept. A recovery attempt may leave a complete or incomplete backup in the app data folder; deleting a task does not remove it. Check the storage problem, then retry.');
  await expect(maintenance).toContainText('Saved practice could not be read. Its original bytes are preserved in the original file or a local recovery backup; lesson results and messages are separate.');
  await expect(maintenance).not.toContainText('Fresh practice draft storage is ready');
  await expect(reason).toHaveValue('  Open input remains available.  ');
  expect(await readFile(path)).toEqual(original);expect(await readFile(join(fixture.directory,partialName))).toEqual(partial);
  const failure=maintenance.getByRole('status');await failure.scrollIntoViewIfNeeded();await expect(failure).toBeVisible();
  const unclipped=await failure.evaluate(element=>{
   const rect=element.getBoundingClientRect();
   if(rect.left<0||rect.top<0||rect.right>innerWidth||rect.bottom>innerHeight)return false;
   for(let parent=element.parentElement;parent;parent=parent.parentElement){
    const style=getComputedStyle(parent),bounds=parent.getBoundingClientRect();
    if(/auto|scroll|hidden|clip/.test(style.overflowX)&&(rect.left<bounds.left+parent.clientLeft||rect.right>bounds.left+parent.clientLeft+parent.clientWidth))return false;
    if(/auto|scroll|hidden|clip/.test(style.overflowY)&&(rect.top<bounds.top+parent.clientTop||rect.bottom>bounds.top+parent.clientTop+parent.clientHeight))return false;
   }
   return true;
  });
  expect(unclipped,'The complete failure message must fit within its visible scroll containers.').toBe(true);
  await page.screenshot({path:join(evidence,'unconfirmed-recovery-copy.png')});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
  expect(attempts).toBe(1);
  // Reread explicitly to obtain a current recovery token before trying again.
  await maintenance.getByRole('button',{name:'Retry reading practice drafts',exact:true}).click();
  await maintenance.getByText('Recover unreadable practice drafts',{exact:true}).click();
  await maintenance.getByRole('button',{name:'Preserve file and start fresh practice drafts',exact:true}).click();
  await expect(maintenance).toContainText('Original file preserved in a local backup. Fresh practice draft storage is ready');
  expect(attempts).toBe(2);expect(await readFile(join(fixture.directory,partialName))).toEqual(partial);
  const backups=(await readdir(fixture.directory)).filter(name=>name.startsWith('learning-drafts-recovery-'));
  expect(backups).toHaveLength(2);
  const complete=backups.find(name=>name!==partialName);if(!complete)throw Error('Expected the confirmed backup.');
  expect(await readFile(join(fixture.directory,complete))).toEqual(original);
  expect(JSON.parse(await readFile(path,'utf8')).records).toEqual([]);
  const recovery=scope.locator('.learning-draft-recovery');
  await recovery.getByText('Earlier unapplied edits need review',{exact:true}).click();
  await expect(recovery).toContainText('  Open input remains available.  ');
 }finally{await fixture.close();}
});
