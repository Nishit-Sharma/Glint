import {expect,test} from 'vitest';
import {EventEmitter} from 'node:events';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import type {BrowserWindow,ContextMenuParams,MenuItemConstructorOptions,PopupOptions,WebFrameMain} from 'electron';
import {installSpellingMenu} from '../src/host/spelling-menu';

/** Native window/menu/DOM are controlled substitutes. The actual installed helper,
 * fixed DOM probes, lifecycle listeners and click callbacks execute unchanged. */
function fixture(){
 class Element{isConnected=true;isContentEditable=false;spellcheck=true;value='teh';textContent='teh';selectionStart=0;selectionEnd=3;disabled=false;readOnly=false;type='text';}
 class Textarea extends Element{}
 class Input extends Element{}
 const field=new Textarea(),document={activeElement:field as Element},renderer={document,HTMLElement:Element,HTMLInputElement:Input,HTMLTextAreaElement:Textarea,window:{getSelection:()=>null}};
 let focused=true,visible=true,destroyed=false,scope:string|undefined='taskA:workspace:revision1',barrier:Promise<void>|undefined;
 const frame={url:'file:///owned/glint/index.html',isDestroyed:()=>destroyed,executeJavaScript:async(code:string)=>{if(barrier)await barrier;return runInNewContext(code,renderer);}};
 const calls:string[]=[],contents=Object.assign(new EventEmitter(),{mainFrame:frame,focusedFrame:frame as typeof frame|null,getURL:()=>frame.url,isDestroyed:()=>destroyed,replaceMisspelling:(word:string)=>calls.push('replace:'+word),undo:()=>calls.push('undo'),redo:()=>calls.push('redo'),cut:()=>calls.push('cut'),copy:()=>calls.push('copy'),paste:()=>calls.push('paste'),selectAll:()=>calls.push('selectAll')});
 const window=Object.assign(new EventEmitter(),{webContents:contents,isDestroyed:()=>destroyed,isFocused:()=>focused,isVisible:()=>visible});
 const menus:Array<{items:MenuItemConstructorOptions[];options?:PopupOptions;closes:number}>=[];
 const controller=installSpellingMenu(window as unknown as BrowserWindow,{buildFromTemplate(items){const menu={items,options:undefined as PopupOptions|undefined,closes:0};menus.push(menu);return{popup(options){menu.options=options;},closePopup(){menu.closes++;menu.options?.callback?.();}};}},()=>scope);
 const flags={canUndo:true,canRedo:false,canCut:true,canCopy:true,canPaste:true,canDelete:true,canSelectAll:true,canEditRichly:false};
 const params:Pick<ContextMenuParams,'frame'|'isEditable'|'formControlType'|'spellcheckEnabled'|'misspelledWord'|'dictionarySuggestions'|'editFlags'>={frame:frame as unknown as WebFrameMain,isEditable:true,formControlType:'text-area',spellcheckEnabled:true,misspelledWord:'teh',dictionarySuggestions:['the'],editFlags:flags};
 const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
 const open=async(change:Partial<typeof params>={})=>{contents.emit('context-menu',{}, {...params,...change});await flush();};
 const click=async(label:string)=>{const menu=menus.at(-1);if(!menu)throw Error('No controlled native menu');const item=menu.items.find(item=>item.label===label);if(!item?.click)throw Error('Missing native action '+label);Reflect.apply(item.click,undefined,[]);menu.options?.callback?.();await flush();};
 return{field,document,renderer,contents,window,menus,calls,controller,params,open,click,flush,Element,Textarea,setScope(value:string|undefined){scope=value;},setFocus(value:boolean){focused=value;},setVisible(value:boolean){visible=value;},setDestroyed(value:boolean){destroyed=value;},hold(value:Promise<void>|undefined){barrier=value;}};
}

test('real installed menu helper uses native suggestions/flags and explicit main window/frame; menu closing does not cancel its chosen correction',async()=>{
 const f=fixture();try{await f.open();const menu=f.menus[0];expect(menu.options?.window).toBe(f.window);expect(menu.options?.frame).toBe(f.params.frame);expect(menu.items.map(item=>item.label).filter(Boolean)).toEqual(['the','Undo','Redo','Cut','Copy','Paste','Select All']);expect(menu.items.find(item=>item.label==='Redo')?.enabled).toBe(false);expect(menu.items.some(item=>/dictionary|language|settings/i.test(String(item.label)))).toBe(false);await f.click('the');expect(f.calls).toEqual(['replace:the']);expect(Reflect.ownKeys(f.renderer.window).filter(key=>typeof key==='symbol')).toEqual([]);
  await f.open({spellcheckEnabled:false});expect(f.menus.at(-1)?.items.some(item=>item.label==='the')).toBe(false);await f.click('Paste');expect(f.calls).toEqual(['replace:the','paste']);
 }finally{f.controller.dispose();}
});

test('every native action rejects a different field, changed value/selection, disabled spellcheck, task/surface change, unfocused window and stale async probe',async()=>{
 for(const change of ['field','value','selection','spellcheck','scope','focus','navigation','input'] as const){const f=fixture();try{await f.open();if(change==='field')f.document.activeElement=new f.Textarea();if(change==='value')f.field.value='other';if(change==='selection')f.field.selectionStart=1;if(change==='spellcheck')f.field.spellcheck=false;if(change==='scope')f.setScope('taskB:companion:revision2');if(change==='focus')f.setFocus(false);if(change==='navigation')f.contents.emit('did-start-navigation');if(change==='input')f.contents.emit('before-input-event',{}, {type:'keyDown'});await f.click('the');expect(f.calls,change).toEqual([]);}finally{f.controller.dispose();}}
 const f=fixture();try{await f.open();let resolve!:()=>void;f.hold(new Promise<void>(done=>resolve=done));const action=f.click('the');f.setScope('taskB:workspace:revision2');resolve();await action;expect(f.calls).toEqual([]);}finally{f.controller.dispose();}
});

test('untrusted/readonly contexts never open a menu, replacement menu and window lifecycle retire old callbacks, and actual host installs/disposes the helper',async()=>{
 const f=fixture();try{await f.open({isEditable:false});await f.open({frame:{...f.params.frame} as WebFrameMain});expect(f.menus).toHaveLength(0);f.field.readOnly=true;await f.open();expect(f.menus).toHaveLength(0);f.field.readOnly=false;await f.open();const old=f.menus[0].items.find(item=>item.label==='the')!;await f.open();Reflect.apply(old.click!,undefined,[]);await f.flush();expect(f.calls).toEqual([]);f.window.emit('blur');expect(f.menus.at(-1)?.closes).toBe(1);await f.click('the');expect(f.calls).toEqual([]);f.controller.dispose();expect(f.contents.listenerCount('context-menu')).toBe(0);expect(f.window.listenerCount('blur')).toBe(0);
  const host=await readFile(new URL('../src/host/index.ts',import.meta.url),'utf8');expect(host).toContain('nativeSpellingMenu=installSpellingMenu(panel,Menu,');expect(host).toContain("if(c.type==='context.view'||c.type.startsWith('surface.'))nativeSpellingMenu?.retire()");expect(host).toMatch(/async function stopForQuit\(\)\{[\s\S]*?nativeSpellingMenu\?\.retire\(\);[\s\S]*?await floatingSave;/);
 }finally{f.controller.dispose();}
});

test('actual stopForQuit hook retires only the open menu so Keep app open or failed Quit can reuse installation; actual window close still disposes',async()=>{
 const f=fixture();try{
  await f.open();const host=await readFile(new URL('../src/host/index.ts',import.meta.url),'utf8'),hook=/async function stopForQuit\(\)\{([\s\S]*?)await floatingSave;/.exec(host)?.[1];if(!hook)throw Error('Actual stopForQuit prefix is missing.');runInNewContext(hook,{nativeSpellingMenu:f.controller,museConnectionTest:{cancel(){}}});
  expect(f.menus[0].closes).toBe(1);expect(f.contents.listenerCount('context-menu')).toBe(1);
  f.setScope(undefined);await f.open();expect(f.menus).toHaveLength(1);
  f.setScope('taskA:workspace:revision2');await f.open();await f.click('the');expect(f.calls).toEqual(['replace:the']);
  f.window.emit('closed');expect(f.contents.listenerCount('context-menu')).toBe(0);await f.open();expect(f.menus).toHaveLength(2);
 }finally{f.controller.dispose();}
});
