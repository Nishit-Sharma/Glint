import {test,expect} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';

test('public anchor describes one snapshot and issues Escape cancellation',async({page})=>{
 const fixture=await BrowserFixture.open(page,'anchor',4193);
 try{
  const anchor=page.getByRole('button',{name:'Open Glint',exact:true});
  await expect(anchor).toBeVisible();
  await expect(anchor).toHaveAccessibleDescription('Drag onto a source window to attach and capture one local snapshot. Nothing is sent or followed automatically. Press Down Arrow to choose a window with the keyboard.');
  const before=await fixture.core.getTask(fixture.taskA.id);
  await fixture.emit({type:'source.drag',state:{kind:'target',title:'Owned source',ownerName:'Owned editor'}});
  await expect(anchor.getByRole('status')).toHaveText('Release to attach and capture one local snapshot of Owned source in Owned editor. Nothing is sent or followed automatically. Escape cancels.');
  await anchor.focus();await page.keyboard.press('Escape');
  await expect.poll(()=>fixture.commands.filter(command=>command.type==='source.drag.cancel').length).toBe(1);
  expect((await fixture.core.getTask(fixture.taskA.id)).sources).toEqual(before.sources);
  expect(fixture.commands.filter(command=>command.type==='model.run'||command.type==='context.capture')).toEqual([]);
 }finally{await fixture.close();}
});
