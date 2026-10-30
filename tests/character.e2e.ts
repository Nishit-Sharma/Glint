import {test,expect} from '@playwright/test';
import {BrowserFixture} from './browser-fixture';
import {CharacterPreferences} from '../src/host/character-preferences';
import {join} from 'node:path';
import {taskTool} from './ui-tools';
import {readComposerDraft} from '../src/core/composer-draft';

const output='evidence/character';
test('saved character colors accent actions and selections while cancelled previews stay local',async({page})=>{
 await page.setViewportSize({width:1080,height:720});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
 const fixture=await BrowserFixture.open(page);
 try{
  await page.getByRole('button',{name:'Customize Companion'}).click();
  const save=page.getByRole('button',{name:'Save appearance',exact:true});
  const selectedShape=page.getByRole('button',{name:'Dumpling',exact:true});
  await expect(save).toHaveCSS('background-color','rgb(214, 181, 144)');
  const neutrals=await page.evaluate(()=>{const style=getComputedStyle(document.documentElement);return ['--paper','--ink','--muted','--line','--gen-ink','--gen-surface','--tig-ink','--tig-surface'].map(key=>[key,style.getPropertyValue(key)]);});
  await page.getByRole('button',{name:'Sage',exact:true}).click();
  await expect(save).toHaveCSS('background-color','rgb(214, 181, 144)');
  await expect(selectedShape).toHaveCSS('border-color','rgb(214, 181, 144)');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Customize Companion'}).click();
  await expect(page.getByRole('button',{name:'Dough',exact:true})).toHaveAttribute('aria-pressed','true');
  const palettes=[['Sage','rgb(129, 169, 147)'],['Iris','rgb(135, 147, 208)'],['Apricot','rgb(210, 155, 130)'],['Rose','rgb(198, 141, 158)'],['Sky','rgb(122, 171, 202)'],['Butter','rgb(204, 182, 110)'],['Dough','rgb(214, 181, 144)']] as const;
  for(const [label,color] of palettes){
   await page.getByRole('button',{name:label,exact:true}).click();await save.click();
   await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
   await expect(save).toHaveCSS('background-color',color);await expect(selectedShape).toHaveCSS('border-color',color);
   await expect(page.getByRole('button',{name:'Curious',exact:true})).toHaveCSS('border-color',color);
   await expect(page.getByRole('checkbox',{name:'Subtle movement'})).toHaveCSS('accent-color',color);
   await page.getByRole('textbox',{name:'Character name'}).focus();await expect(page.getByRole('textbox',{name:'Character name'})).toHaveCSS('outline-color',color);
   expect(await page.locator('.task-sidebar-task[aria-current=page]').evaluate(button=>getComputedStyle(button).boxShadow)).toBe('none');
   const contrast=await save.evaluate(button=>{
    const luminance=(color:string)=>{const rgb=color.startsWith('#')?color.slice(1).match(/../g)!.map(value=>parseInt(value,16)):color.match(/[\d.]+/g)!.slice(0,3).map(Number);const linear=rgb.map(value=>{const channel=value/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});return .2126*linear[0]+.7152*linear[1]+.0722*linear[2];};
    const ratio=(left:string,right:string)=>{const a=luminance(left),b=luminance(right);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    const root=document.documentElement,styles=getComputedStyle(button),surface=getComputedStyle(document.querySelector('.workspace')!),focus=getComputedStyle(document.querySelector('.appearance-name input')!);
    const overlays=()=>{const tokens=getComputedStyle(document.body);return ['gen','tig'].map(prefix=>ratio(tokens.getPropertyValue(`--${prefix}-line`).trim(),tokens.getPropertyValue(`--${prefix}-surface`).trim()));};
    const dark=overlays();root.dataset.theme='light';const light=overlays();delete root.dataset.theme;
    return {primary:ratio(styles.backgroundColor,styles.color),focus:ratio(focus.outlineColor,surface.backgroundColor),dark,light};
   });
   expect(contrast.primary).toBeGreaterThanOrEqual(4.5);expect(contrast.focus).toBeGreaterThanOrEqual(3);for(const ratio of [...contrast.dark,...contrast.light])expect(ratio).toBeGreaterThanOrEqual(4.5);
  }
  await page.getByRole('textbox',{name:'Character name'}).fill('Invalid\u200b');
  await expect(page.getByText('Use up to 40 characters without control characters.',{exact:true})).toHaveCSS('color','rgb(228, 199, 160)');
  expect(await page.evaluate(()=>{const style=getComputedStyle(document.documentElement);return ['--paper','--ink','--muted','--line','--gen-ink','--gen-surface','--tig-ink','--tig-surface'].map(key=>[key,style.getPropertyValue(key)]);})).toEqual(neutrals);
  await page.screenshot({path:output+'/palette-committed.png'});
 }finally{await fixture.close();}
});

test('saved Dough Sage and Iris reach the actual entry SVG after preferences reopen',async({page})=>{
 await page.setViewportSize({width:1080,height:720});await page.emulateMedia({colorScheme:'dark',reducedMotion:'no-preference'});
 const fixture=await BrowserFixture.open(page);
 try{
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal','settled');
  await page.addInitScript(()=>{Object.defineProperty(document.fonts,'ready',{configurable:true,value:new Promise<void>(resolve=>Reflect.set(window,'__releasePaletteFonts',resolve))});});
  let name='Companion';
  for(const [label,dark,light] of [['Dough','rgb(214, 181, 144)','rgb(130, 96, 56)'],['Sage','rgb(129, 169, 147)','rgb(62, 112, 88)'],['Iris','rgb(135, 147, 208)','rgb(86, 103, 164)']] as const){
   await page.getByRole('button',{name:'Customize '+name,exact:true}).click();name='Palette '+label;
   await page.getByRole('textbox',{name:'Character name'}).fill(name);await page.getByRole('button',{name:label,exact:true}).click();await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
   fixture.preferences=await CharacterPreferences.open(join(fixture.directory,'store'));await page.reload();await expect(page.getByRole('button',{name:'Customize '+name,exact:true})).toBeVisible();
   await page.evaluate(()=>Reflect.get(window,'__releasePaletteFonts')());
   const wire=page.locator('.t-gen-wire').first(),head=page.locator('.t-gen-head').first();await expect(wire).toHaveCSS('stroke',dark);await expect(head).toHaveCSS('fill',dark);
   await page.evaluate(()=>document.documentElement.dataset.theme='light');await expect(wire).toHaveCSS('stroke',light);await expect(head).toHaveCSS('fill',light);
   await page.evaluate(()=>delete document.documentElement.dataset.theme);await expect(wire).toHaveCSS('stroke',dark);
   await page.screenshot({path:output+`/palette-entry-${label.toLowerCase()}.png`});await expect(page.locator('.t-gen')).toHaveCount(0);
  }
 }finally{await fixture.close();}
});

test('actual requests move the original actor without replacing its canvas and reduced motion stays still',async({page})=>{
 await page.setViewportSize({width:1080,height:720});await page.emulateMedia({reducedMotion:'no-preference'});
 const fixture=await BrowserFixture.open(page);
 try{
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal','settled');
  await page.mouse.move(1060,700);
  const canvas=await page.locator('.character-control-sidebar canvas').elementHandle();expect(canvas).not.toBeNull();
  const pixels=()=>canvas!.evaluate(canvas=>(canvas as HTMLCanvasElement).toDataURL());
  const ready=await pixels();
  await page.getByRole('textbox',{name:'Ask about this task'}).fill('Read the brief.');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  await expect.poll(async()=>await pixels()!==ready,{timeout:2000}).toBe(true);
  expect(await canvas!.evaluate(canvas=>canvas.isConnected)).toBe(true);
  await page.waitForTimeout(700);const working=await pixels();
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(0);
  await expect.poll(async()=>await pixels()!==working,{timeout:2000}).toBe(true);
  expect(await canvas!.evaluate(canvas=>canvas.isConnected)).toBe(true);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(100);const still=await pixels();
  await page.getByRole('textbox',{name:'Ask about this task'}).fill('Read it without movement.');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  await page.waitForTimeout(200);expect(await pixels()).toBe(still);
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(0);await page.waitForTimeout(200);expect(await pixels()).toBe(still);
 }finally{await fixture.close();}
});

test('Appearance keeps Save and Cancel fully visible and keyboard controls clear of its footer',async({page})=>{
 await page.setViewportSize({width:1080,height:720});await page.emulateMedia({reducedMotion:'reduce'});
 const fixture=await BrowserFixture.open(page);
 try{
  await page.getByRole('button',{name:'Customize Companion'}).click();await page.getByRole('textbox',{name:'Character name'}).fill('Room to save');
  for(const viewport of [{width:1080,height:720},{width:390,height:744}]){
   await page.setViewportSize(viewport);
   await page.locator('.appearance-layout').evaluate(layout=>layout.scrollTop=0);
   for(const name of ['Save appearance','Cancel']){
    const box=await page.getByRole('button',{name,exact:true}).boundingBox();expect(box).not.toBeNull();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport.height-1);
   }
   await page.screenshot({path:output+`/appearance-footer-${viewport.width}x${viewport.height}.png`});
   if(!await page.locator('.character-more').evaluate(details=>(details as HTMLDetailsElement).open))await page.getByText('4 more shapes',{exact:true}).click();
   await page.getByRole('textbox',{name:'Character name'}).focus();
   for(let index=0;index<32;index++){
    await page.keyboard.press('Tab');
    const focus=await page.evaluate(()=>{const control=document.activeElement as HTMLElement,footer=document.querySelector('.appearance-actions')!,rect=control.getBoundingClientRect(),footerRect=footer.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return {inForm:!!control.closest('.appearance-editor'),inFooter:footer.contains(control),top:rect.top,bottom:rect.bottom,footerTop:footerRect.top,visible:!!hit&&(hit===control||control.contains(hit)),label:control.textContent?.trim()};});
    expect(focus.inForm).toBe(true);expect(focus.visible).toBe(true);expect(focus.top).toBeGreaterThanOrEqual(0);expect(focus.bottom).toBeLessThanOrEqual(viewport.height-1);
    if(!focus.inFooter)expect(focus.bottom).toBeLessThanOrEqual(focus.footerTop);
    if(focus.label==='Cancel')break;
    expect(index).toBeLessThan(31);
   }
  }
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('button',{name:'Customize Companion'})).toBeFocused();
 }finally{await fixture.close();}
});

test('Appearance saves on its own boundary, reconciles a lost reply, and keeps the task draft',async({page})=>{
 await page.setViewportSize({width:1120,height:744});
 const fixture=await BrowserFixture.open(page);
 try{
  await expect(page.getByRole('button',{name:'Customize Companion'})).toBeVisible();
  await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal',/settled|cancelled|skipped/);
  await expect(page.locator('[data-character-render=live]')).toHaveCount(1);
  await page.getByRole('textbox',{name:'Ask about this task'}).fill('Keep this unsent message.');
  await expect.poll(()=>fixture.core.getTask(fixture.taskA.id).then(task=>readComposerDraft(task.session).text)).toBe('Keep this unsent message.');
  const before=await fixture.core.getTask(fixture.taskA.id),commands=fixture.commands.length;
  await page.getByRole('button',{name:'Customize Companion'}).click();
  await expect(page.getByRole('form',{name:'Character appearance'})).toBeVisible();
  await expect(page.locator('[data-character-render=live]')).toHaveCount(2);
  await expect(page.getByRole('button',{name:'Dumpling',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.screenshot({path:output+'/appearance-default.png'});
  await page.getByRole('textbox',{name:'Character name'}).fill('  Pippa  ');
  await page.getByRole('button',{name:'Sage',exact:true}).click();
  await page.getByRole('checkbox',{name:'Subtle movement'}).uncheck();
  fixture.losePreferenceAcknowledgement=true;
  await page.getByRole('button',{name:'Save appearance'}).click();
  await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Customize Pippa'})).toBeVisible();
  expect(await fixture.core.getTask(fixture.taskA.id)).toEqual(before);
  expect(fixture.commands.slice(commands).map(command=>command.type)).toEqual(['preferences.update','preferences.get']);
  await page.screenshot({path:output+'/appearance.png'});
  await page.getByRole('button',{name:'Back to task',exact:true}).click();
  await expect(page.getByRole('button',{name:'Customize Pippa'})).toBeFocused();
  await expect(page.getByRole('textbox',{name:'Ask about this task'})).toHaveValue('Keep this unsent message.');
  fixture.preferences=await CharacterPreferences.open(join(fixture.directory,'store'));
  await page.reload();
  await expect(page.getByRole('button',{name:'Customize Pippa'})).toBeVisible();
  await page.screenshot({path:output+'/workspace.png'});
  await page.setViewportSize({width:430,height:550});
  await page.getByRole('button',{name:'Switch to compact companion'}).click();
  await expect(page.getByRole('button',{name:'Customize Pippa'})).toBeVisible();
  await expect(page.locator('[data-character-render=live]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Choose task: Task Alpha'})).toBeVisible();
  await page.screenshot({path:output+'/compact.png'});
  await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();
  await expect(page.getByRole('button',{name:'Open Glint',exact:true})).toBeVisible();
  await expect(page.locator('[data-character-render=live]')).toHaveCount(1);
  await page.screenshot({path:output+'/anchor.png'});
 }finally{await fixture.close();}
});

test('narrow workspace keeps a keyboard reachable character control and guards unsaved Appearance',async({page})=>{
 await page.setViewportSize({width:390,height:744});
 const fixture=await BrowserFixture.open(page);
 try{
  const control=page.getByRole('button',{name:'Customize Companion'});
  await expect(control).toBeVisible();await expect(control).toHaveCount(1);
  await control.focus();await page.keyboard.press('Enter');
  await page.getByRole('textbox',{name:'Character name'}).fill('Temporary');
  await control.click();
  await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?'})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Temporary');
  await expect(page.getByRole('textbox',{name:'Character name'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?'})).toBeVisible();
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Temporary');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(control).toBeFocused();
  await control.click();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('');
  await expect(page.locator('[data-character-render=live]')).toHaveCount(2);
  await page.screenshot({path:output+'/appearance-narrow.png'});
  await page.keyboard.press('Escape');
  await expect(control).toBeFocused();
  await taskTool(page,'Settings');
  await page.getByRole('tab',{name:'Appearance',exact:true}).click();
  await page.getByRole('textbox',{name:'Character name'}).fill('Other edit');
  await page.getByRole('tab',{name:'Storage',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Keep your unsaved edits?'})).toBeVisible();
  await page.getByRole('button',{name:'Keep editing',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Other edit');
  expect(fixture.commands.some(command=>command.type==='preferences.update')).toBe(false);
 }finally{await fixture.close();}
});

test('failed save retains edits and conflict requires loading the current saved profile',async({page})=>{
 await page.setViewportSize({width:1120,height:744});const fixture=await BrowserFixture.open(page);
 try{
  await page.getByRole('button',{name:'Customize Companion'}).click();
  await page.getByRole('textbox',{name:'Character name'}).fill('Unsaved');
  fixture.preferenceSaveError='Synthetic write denied';
  await page.getByRole('button',{name:'Save appearance'}).click();
  await expect(page.getByText('Your appearance could not be saved. Your edits are still here. Try Save again.')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Unsaved');
  await expect(page.getByRole('button',{name:'Customize Companion'})).toBeVisible();
  fixture.preferenceSaveError=undefined;
  await fixture.preferences.update({expectedRevision:0,profile:{personalName:'Elsewhere',look:{shape:'bean',color:'rose',face:'bright',motion:false}}});
  await page.getByRole('button',{name:'Save appearance'}).click();
  await expect(page.getByText('Your saved appearance changed elsewhere. Your edits have not been saved.')).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Unsaved');
  await expect(page.getByRole('button',{name:'Save appearance'})).toBeDisabled();
  await page.getByRole('button',{name:'Load saved appearance'}).click();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Elsewhere');
  await expect(page.getByRole('button',{name:'Bean',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('button',{name:'Customize Elsewhere'})).toBeVisible();
  await page.getByRole('button',{name:'Back to task',exact:true}).click();
  await page.getByRole('button',{name:'Customize Elsewhere'}).click();
  await expect(page.getByRole('textbox',{name:'Character name'})).toHaveValue('Elsewhere');
  await page.getByRole('textbox',{name:'Character name'}).fill('After conflict');
  await page.getByRole('button',{name:'Save appearance'}).click();
  await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();
  expect(await fixture.preferences.read()).toMatchObject({kind:'available',current:{revision:2,profile:{personalName:'After conflict'}}});
 }finally{await fixture.close();}
});

test('closing Appearance opened from compact focuses the reachable workspace character',async({page})=>{
 await page.setViewportSize({width:430,height:760});const fixture=await BrowserFixture.open(page,'companion');
 try{await page.getByRole('button',{name:'Customize Companion'}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('form',{name:'Character appearance'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Customize Companion'})).toBeFocused();await expect(page.getByRole('heading',{name:'Task Alpha',exact:true})).toBeVisible();}finally{await fixture.close();}
});

test('real compact widths keep the character, meaningful result and composer through streaming without entrance replay',async({page})=>{
 await page.setViewportSize({width:430,height:550});const fixture=await BrowserFixture.open(page,'companion');
 try{
  await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');
  const entrance=await page.locator('.compact-companion').getAttribute('data-presentation-entrance');
  const askPath=await page.getByRole('button',{name:'Ask',exact:true}).locator('path').getAttribute('d');
  await page.getByRole('textbox',{name:'Ask companion',exact:true}).fill('Summarize Alpha brief.');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  await fixture.stream('Alpha event is on October 23.');await expect(page.locator('.compact-response')).toContainText('October 23');await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  await fixture.stream('Alpha event is on October 23. Confirm the arrival details.');await expect(page.locator('.compact-response')).toContainText('arrival details');await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  const task=await fixture.core.getTask(fixture.taskA.id),source=task.sources[0],version=source.versions.at(-1)!;
  const sourceRefs=[{sourceId:source.id,version:version.version,digest:version.digest}];
  fixture.complete(JSON.stringify({schemaVersion:1,kind:'screen-brief',insight:'Alpha event is on October 23. Confirm the arrival details before travelling.',actions:[{label:'Make an arrival checklist',outcome:'An arrival checklist grounded in the brief.',requestKind:'create',seedPrompt:'Create an arrival checklist based only on Alpha brief.',sourceRefs}]}),undefined,'application/json');
  const action=page.getByRole('button',{name:'Make an arrival checklist',exact:true});await expect(action).toBeVisible();
  await expect.poll(()=>page.getByRole('button',{name:'Ask',exact:true}).evaluate((button,path)=>{const svg=button.querySelector('svg');if(svg?.querySelector('path')?.getAttribute('d')!==path)return false;let opacity=1;for(let element:Element|null=svg;element&&element!==button;element=element.parentElement)opacity*=Number(getComputedStyle(element).opacity);return opacity>.99;},askPath)).toBe(true);
  await expect.poll(()=>action.evaluate(button=>{const owner=button.closest<HTMLElement>('[data-artifact-motion]');if(!owner||/pending|running|waiting/.test(owner.dataset.artifactReveal??''))return false;let opacity=1;for(let element:Element|null=button;element&&element!==owner.parentElement;element=element.parentElement)opacity*=Number(getComputedStyle(element).opacity);return opacity>.99;})).toBe(true);
  await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
  expect(await page.locator('.compact-companion').getAttribute('data-presentation-entrance')).toBe(entrance);
  await page.screenshot({path:output+'/compact-430-result.png'});
  await page.setViewportSize({width:360,height:440});await expect(page.getByRole('textbox',{name:'Ask companion',exact:true})).toBeVisible();await expect(page.locator('[data-character-render=live]')).toHaveCount(1);await page.screenshot({path:output+'/compact-360-result.png'});
  await page.getByRole('button',{name:'Open task workspace',exact:true}).click();await page.setViewportSize({width:1120,height:744});await expect(page.locator('.workspace')).toHaveAttribute('data-surface-reveal','settled');await page.screenshot({path:output+'/workspace-result.png'});
  await page.getByRole('button',{name:'Customize Companion'}).click();await expect(page.getByRole('dialog',{name:'Make it yours',exact:true})).toBeVisible();await expect(page.getByRole('tablist')).toHaveCount(0);await page.screenshot({path:output+'/appearance-default-result.png'});
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Collapse to edge anchor',exact:true}).click();await expect(page.getByRole('button',{name:'Open Glint',exact:true})).toBeVisible();await page.setViewportSize({width:74,height:64});await page.screenshot({path:output+'/anchor-74x64.png'});const box=await page.getByRole('button',{name:'Open Glint',exact:true}).boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(64);
 }finally{await fixture.close();}
});

test('name-only save preserves the primary canvas and paused preview resizes before static context recovery',async({page})=>{
 await page.setViewportSize({width:1120,height:744});await page.emulateMedia({reducedMotion:'reduce'});const fixture=await BrowserFixture.open(page);
 try{
  await page.getByRole('button',{name:'Customize Companion'}).click();const primary=await page.locator('.character-control-sidebar canvas').elementHandle();expect(primary).not.toBeNull();
  await page.getByRole('textbox',{name:'Character name'}).fill('Still');await page.getByRole('button',{name:'Save appearance'}).click();await expect(page.getByText('Appearance saved.',{exact:true})).toBeVisible();expect(await primary!.evaluate(canvas=>canvas.isConnected)).toBe(true);
  await page.getByRole('checkbox',{name:'Subtle movement'}).uncheck();await page.getByRole('button',{name:'Save appearance'}).click();await expect(page.getByRole('button',{name:'Save appearance'})).toBeDisabled();
  await page.setViewportSize({width:390,height:744});const preview=page.locator('.appearance-preview canvas');await expect.poll(()=>preview.evaluate(canvas=>canvas instanceof HTMLCanvasElement?canvas.width:0)).toBe(160);await expect.poll(()=>preview.evaluate(canvas=>canvas instanceof HTMLCanvasElement?canvas.height:0)).toBe(176);
  await page.screenshot({path:output+'/appearance-paused-narrow.png'});
  await preview.evaluate(canvas=>{if(canvas instanceof HTMLCanvasElement)canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext();});await expect(page.locator('.appearance-preview [data-character-render=static]')).toHaveCount(1);await expect(page.getByRole('button',{name:'Try 3D again'})).toBeVisible();await expect(page.locator('.appearance-preview img')).toBeVisible();
  await page.getByRole('button',{name:'Try 3D again'}).click();await expect(page.locator('.appearance-preview [data-character-render=live]')).toHaveCount(1);await expect(page.getByRole('button',{name:'Save appearance'})).toBeDisabled();expect(await fixture.preferences.read()).toMatchObject({kind:'available',current:{revision:2,profile:{personalName:'Still',look:{motion:false}}}});
 }finally{await fixture.close();}
});

test('compact composer keeps a visible Ask arrow and Stop glyph with distinct fill and button colors',async({page})=>{
 await page.setViewportSize({width:360,height:440});const fixture=await BrowserFixture.open(page,'companion');
 try{
  await expect(page.locator('.compact-companion')).toHaveAttribute('data-surface-reveal','settled');
  const inspect=async(name:string)=>{
   const button=page.getByRole('button',{name,exact:true});const details=await button.evaluate(button=>{const svg=button.querySelector('svg'),path=svg?.querySelector('path');if(!svg||!path)throw Error('Composer glyph is missing.');const styles=getComputedStyle(button),box=svg.getBoundingClientRect();let glyphOpacity=1;for(let element:Element|null=svg;element&&element!==button;element=element.parentElement)glyphOpacity*=Number(getComputedStyle(element).opacity);const opacity=glyphOpacity*Number(styles.opacity);return {label:button.getAttribute('aria-label'),background:styles.backgroundColor,fill:getComputedStyle(path).fill,opacity,glyphOpacity,width:box.width,height:box.height,path:path.getAttribute('d')};});
   expect(details.width).toBeGreaterThanOrEqual(14);expect(details.height).toBeGreaterThanOrEqual(14);expect(details.fill).not.toBe(details.background);expect(details.opacity).toBeGreaterThan(.15);expect(details.path).toBeTruthy();return details;
  };
  const idle=await inspect('Ask');await page.getByRole('textbox',{name:'Ask companion',exact:true}).fill('Read the brief.');const ready=await inspect('Ask');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(1);
  await expect.poll(async()=>{try{const glyph=await inspect('Stop');return glyph.path!==ready.path&&glyph.glyphOpacity>.99;}catch{return false;}}).toBe(true);const stop=await inspect('Stop');await page.screenshot({path:output+'/compact-360-stop.png'});
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>fixture.pending.size).toBe(0);await expect.poll(async()=>{try{const glyph=await inspect('Ask');return glyph.path===idle.path&&glyph.glyphOpacity>.99;}catch{return false;}}).toBe(true);
  const stopped=await inspect('Ask');const {writeFile}=await import('node:fs/promises');await writeFile(output+'/composer-glyphs.json',JSON.stringify({idle,ready,stop,stopped},null,2));
 }finally{await fixture.close();}
});
