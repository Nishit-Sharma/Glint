import {randomUUID} from 'node:crypto';
import type {BrowserWindow,ContextMenuParams,Menu,MenuItemConstructorOptions,WebFrameMain} from 'electron';

const fieldKey='Glint.native-spelling-menu';
// Fixed app-only DOM probe: text stays inside the trusted renderer's ephemeral
// lease. Only a boolean crosses back; nothing is logged, stored or transmitted.
function fieldProbe(token:string,capture:boolean,spelling:boolean){return `(()=>{
 const key=Symbol.for(${JSON.stringify(fieldKey)}),token=${JSON.stringify(token)},field=document.activeElement;
 if(!(field instanceof HTMLElement)||!field.isConnected)return false;
 const plain=field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement;
 if(plain?(field.disabled||field.readOnly||field.type==='password'):!field.isContentEditable)return false;
 if(${spelling}&&!field.spellcheck)return false;
 const selection=plain?null:window.getSelection(),value=plain?field.value:field.textContent;
 const snapshot={token,field,value,start:plain?field.selectionStart:null,end:plain?field.selectionEnd:null,anchor:selection?.anchorNode,anchorOffset:selection?.anchorOffset,focus:selection?.focusNode,focusOffset:selection?.focusOffset};
 if(${capture}){Object.defineProperty(window,key,{value:snapshot,configurable:true,writable:true});return true;}
 const original=window[key];return !!original&&original.token===token&&original.field===field&&original.value===value&&original.start===snapshot.start&&original.end===snapshot.end&&original.anchor===snapshot.anchor&&original.anchorOffset===snapshot.anchorOffset&&original.focus===snapshot.focus&&original.focusOffset===snapshot.focusOffset;
})()`;}
function clearProbe(token:string){return `(()=>{const key=Symbol.for(${JSON.stringify(fieldKey)});if(window[key]?.token===${JSON.stringify(token)})delete window[key];})()`;}
type NativeMenu=Pick<Menu,'popup'|'closePopup'>;
type MenuFactory={buildFromTemplate(template:MenuItemConstructorOptions[]):NativeMenu};
type Lease={token:string;frame:WebFrameMain;scope:string;epoch:number;claimed:boolean;retired:boolean};

/** Main-panel-only native edit menu. Every action rechecks the exact field and
 * unchanged value/selection; a dismissed menu never silently retargets a field. */
export function installSpellingMenu(window:BrowserWindow,menus:MenuFactory,currentScope:()=>string|undefined){
 const contents=window.webContents;let epoch=0,disposed=false,active:Lease|undefined,popup:NativeMenu|undefined;
 function clear(lease:Lease){if(lease.retired)return;lease.retired=true;try{if(!lease.frame.isDestroyed())void lease.frame.executeJavaScript(clearProbe(lease.token)).catch(()=>{});}catch{/* A retired document owns no remaining action. */}}
 function retire(){epoch++;const menu=popup;popup=undefined;if(active){clear(active);active=undefined;}try{menu?.closePopup(window);}catch{/* The native window may already be closed. */}}
 function current(lease:Lease){try{return !disposed&&!lease.retired&&active===lease&&lease.epoch===epoch&&!window.isDestroyed()&&window.isVisible()&&window.isFocused()&&!contents.isDestroyed()&&!lease.frame.isDestroyed()&&contents.mainFrame===lease.frame&&contents.focusedFrame===lease.frame&&lease.frame.url===contents.getURL()&&currentScope()===lease.scope;}catch{return false;}}
 async function invoke(lease:Lease,spelling:boolean,action:()=>void){
  if(lease.claimed||!current(lease))return;lease.claimed=true;
  try{if(await lease.frame.executeJavaScript(fieldProbe(lease.token,false,spelling))!==true||!current(lease))return;action();}
  catch{/* No native edit is acknowledged after an unavailable field. */}
  finally{if(active===lease){active=undefined;popup=undefined;}clear(lease);}
 }
 async function open(params:ContextMenuParams){
  retire();const frame=params.frame,scope=currentScope();
  if(disposed||!params.isEditable||params.formControlType==='input-password'||!frame||scope===undefined)return;
  const lease:Lease={token:randomUUID(),frame,scope,epoch,claimed:false,retired:false};active=lease;
  if(!current(lease)){retire();return;}
  try{
   if(await frame.executeJavaScript(fieldProbe(lease.token,true,false))!==true||!current(lease)){if(active===lease)retire();else clear(lease);return;}
   const items:MenuItemConstructorOptions[]=[],suggestions=params.spellcheckEnabled&&params.misspelledWord?[...new Set(params.dictionarySuggestions)]:[];
   if(params.spellcheckEnabled&&params.misspelledWord){
    if(suggestions.length)for(const suggestion of suggestions)items.push({label:suggestion,click:()=>{void invoke(lease,true,()=>contents.replaceMisspelling(suggestion));}});
    else items.push({label:'No spelling suggestions',enabled:false});
    items.push({type:'separator'});
   }
   const edits=[['Undo','canUndo','undo'],['Redo','canRedo','redo'],['Cut','canCut','cut'],['Copy','canCopy','copy'],['Paste','canPaste','paste'],['Select All','canSelectAll','selectAll']] as const;
   for(const [label,flag,method] of edits)items.push({label,enabled:params.editFlags[flag],click:()=>{if(params.editFlags[flag])void invoke(lease,false,()=>contents[method]());}});
   const menu=menus.buildFromTemplate(items);popup=menu;
   menu.popup({window,frame,callback:()=>{if(popup===menu)popup=undefined;if(!lease.claimed){if(active===lease)active=undefined;clear(lease);}}});
  }catch{if(active===lease)retire();else clear(lease);}
 }
 const contextMenu=(_event:Electron.Event,params:ContextMenuParams)=>{void open(params);},input=(_event:Electron.Event,value:Electron.Input)=>{if(value.type==='keyDown')retire();},mouse=(_event:Electron.Event,value:Electron.MouseInputEvent)=>{if(value.type==='mouseDown'||value.type==='mouseWheel')retire();};
 contents.on('context-menu',contextMenu);contents.on('before-input-event',input);contents.on('before-mouse-event',mouse);contents.on('did-start-navigation',retire);contents.on('render-process-gone',retire);contents.on('destroyed',dispose);window.on('blur',retire);window.on('hide',retire);window.on('closed',dispose);
 function dispose(){if(disposed)return;disposed=true;retire();contents.removeListener('context-menu',contextMenu);contents.removeListener('before-input-event',input);contents.removeListener('before-mouse-event',mouse);contents.removeListener('did-start-navigation',retire);contents.removeListener('render-process-gone',retire);contents.removeListener('destroyed',dispose);window.removeListener('blur',retire);window.removeListener('hide',retire);window.removeListener('closed',dispose);}
 return {retire,dispose};
}
