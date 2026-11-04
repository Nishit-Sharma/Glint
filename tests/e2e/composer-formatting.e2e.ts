import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,test} from '@playwright/test';
import {BrowserFixture} from '../support/browser-fixture';
import {readComposerDraft} from '../../src/core/composer-draft';
test.use({viewport:{width:430,height:900},reducedMotion:'reduce'});
// Format message is reached through the composer's Request details control (ui-compact, 2026-11-04).
test('actual composer formats selection, preserves shortcuts/drafts and exposes a native spellcheck toggle without dispatch',async({page})=>{
 const fixture=await BrowserFixture.open(page),directory=join(process.cwd(),'evidence/composer-formatting/source-host');
 try{
  await mkdir(directory,{recursive:true});const owner=await fixture.core.listTasks(),task=owner.find(task=>task.title==='Task Alpha');if(!task)throw Error('Existing fixture task is missing.');
  const composer=page.locator('.workspace .workspace-compose .composer'),input=composer.getByRole('textbox',{name:'Ask about this task',exact:true}),raw='prefix\nAlpha 👩🏽‍🚀\nBeta 日本語\nsuffix';
  await input.fill(raw);await page.locator('.workspace-compose').getByRole('button',{name:'Details',exact:true}).click();await composer.locator('.composer-formatting>summary').click();
  await input.evaluate((element:HTMLTextAreaElement)=>{element.focus();element.setSelectionRange(element.value.indexOf('Alpha'),element.value.indexOf('\nsuffix'));});
  // DOM composition events exercise the actual React handlers; this is not native IME proof.
  await input.evaluate((element:HTMLTextAreaElement)=>element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'漢'})));await expect(composer.getByRole('button',{name:'Bullets',exact:true})).toBeDisabled();
  await input.evaluate((element:HTMLTextAreaElement)=>element.dispatchEvent(new KeyboardEvent('keydown',{key:'l',metaKey:true,bubbles:true,cancelable:true})));await composer.getByRole('button',{name:'Bullets',exact:true}).evaluate((element:HTMLButtonElement)=>element.click());await expect(input).toHaveValue(raw);
  await input.evaluate((element:HTMLTextAreaElement)=>element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'漢'})));await expect(composer.getByRole('button',{name:'Bullets',exact:true})).toBeEnabled();
  await composer.getByRole('button',{name:'Bullets',exact:true}).click();await expect(input).toHaveValue('prefix\n- Alpha 👩🏽‍🚀\n- Beta 日本語\nsuffix');
  await composer.getByRole('button',{name:'Numbered list',exact:true}).focus();await page.keyboard.press('Enter');await expect(input).toHaveValue('prefix\n1. Alpha 👩🏽‍🚀\n2. Beta 日本語\nsuffix');
  await composer.getByRole('button',{name:'Indent',exact:true}).click();await expect(input).toHaveValue('prefix\n  1. Alpha 👩🏽‍🚀\n  2. Beta 日本語\nsuffix');await composer.getByRole('button',{name:'Outdent',exact:true}).click();
  await input.press('Meta+l');const quoted='prefix\n> 1. Alpha 👩🏽‍🚀\n> 2. Beta 日本語\nsuffix';await expect(input).toHaveValue(quoted);await expect(input).toBeFocused();expect(await input.evaluate((element:HTMLTextAreaElement)=>element.value.slice(element.selectionStart,element.selectionEnd))).toBe('> 1. Alpha 👩🏽‍🚀\n> 2. Beta 日本語');
  const spell=composer.getByRole('checkbox',{name:'Native spell-check',exact:true});await expect(input).toHaveAttribute('spellcheck','true');await spell.uncheck();await expect(input).toHaveAttribute('spellcheck','false');await spell.check();await expect(input).toHaveAttribute('spellcheck','true');await input.evaluate((element:HTMLTextAreaElement)=>{element.focus();element.setSelectionRange(element.value.length,element.value.length);});await input.press('Shift+Enter');const final=quoted+'\n';await expect(input).toHaveValue(final);
  await expect.poll(async()=>readComposerDraft((await fixture.core.getTask(task.id)).session).text).toBe(final);expect(fixture.modelInvocations).toEqual([]);expect(fixture.externalRequests).toEqual([]);await page.screenshot({path:join(directory,'composer-open-430.png')});
  await page.reload();await expect(input).toHaveValue(final);await page.locator('.workspace-compose').getByRole('button',{name:'Details',exact:true}).click();await composer.locator('.composer-formatting>summary').click();await expect(spell).toBeChecked();await page.setViewportSize({width:1080,height:900});await page.screenshot({path:join(directory,'composer-open-1080.png')});expect((await fixture.core.getTask(task.id)).requests).toEqual([]);expect(fixture.modelInvocations).toEqual([]);
 }finally{await fixture.close();}
});
