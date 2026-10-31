import type {HostStatus} from '../../shared/bridge';

export interface ShortcutEntry {
 id:string;
 action:string;
 keys:string;
 scope:string;
 availability:string;
 explanation:string;
 aliases:string;
}
type MenuShortcut=Pick<ShortcutEntry,'id'|'action'|'keys'|'scope'|'explanation'|'aliases'>;
// These roles are present in host/index.ts. Bindings match the pinned Darwin Electron menu.
const macMenu:readonly MenuShortcut[]=[
 {id:'undo',action:'Undo',keys:'Command+Z',scope:'Edit menu',explanation:'Undo an available edit in the focused editable field or document.',aliases:'revert typing'},
 {id:'redo',action:'Redo',keys:'Shift+Command+Z',scope:'Edit menu',explanation:'Redo an edit when the focused editor has an undo history.',aliases:'repeat edit'},
 {id:'cut',action:'Cut',keys:'Command+X',scope:'Edit menu',explanation:'Cut selected editable text to the clipboard.',aliases:'clipboard'},
 {id:'copy',action:'Copy',keys:'Command+C',scope:'Edit menu',explanation:'Copy the current text selection to the clipboard.',aliases:'clipboard'},
 {id:'paste',action:'Paste',keys:'Command+V',scope:'Edit menu',explanation:'Paste clipboard text into the focused editable field or document.',aliases:'clipboard insert'},
 {id:'select-all',action:'Select all',keys:'Command+A',scope:'Edit menu',explanation:'Select content in the focused field or document.',aliases:'select everything'},
 {id:'close',action:'Close window',keys:'Command+W',scope:'File menu',explanation:'Collapse Glint to its compact anchor through the window-close action.',aliases:'close app window collapse anchor'},
 {id:'reset-zoom',action:'Actual size',keys:'Command+0',scope:'View menu',explanation:'Reset the Glint window zoom.',aliases:'reset zoom normal size'},
 {id:'zoom-in',action:'Zoom in',keys:'Command+Plus',scope:'View menu',explanation:'Increase the Glint window zoom.',aliases:'larger bigger increase zoom'},
 {id:'zoom-out',action:'Zoom out',keys:'Command+Minus',scope:'View menu',explanation:'Decrease the Glint window zoom.',aliases:'smaller decrease zoom'},
 {id:'minimize',action:'Minimize',keys:'Command+M',scope:'Window menu',explanation:'Collapse Glint to its compact anchor.',aliases:'collapse tuck anchor'},
 {id:'hide',action:'Hide Glint',keys:'Command+H',scope:'Glint menu',explanation:'Hide Glint through the macOS app menu.',aliases:'hide app'},
 {id:'hide-others',action:'Hide others',keys:'Command+Option+H',scope:'Glint menu',explanation:'Hide other applications through the macOS app menu.',aliases:'hide other apps'},
 {id:'quit',action:'Quit Glint',keys:'Command+Q',scope:'Glint menu',explanation:'Quit through Glint’s existing unsaved-work review.',aliases:'exit app'},
];
const physicalAvailability:Record<NonNullable<HostStatus['modifierShortcutStatus']>,string>={ready:'Registered',starting:'Starting',stopped:'Stopped',unsupported:'Unsupported on this platform',unavailable:'Unavailable','permission-required':'Accessibility access required'};
function catalogue(host:HostStatus):ShortcutEntry[]{
 const entries:ShortcutEntry[]=[];
 if(host.platform==='darwin'||host.platform==='win32'){
  const state=host.modifierShortcutStatus;
  entries.push({id:'capture-physical',action:'Screen context · physical shortcut',keys:host.shortcut||'Checking…',scope:'Global · screen context',availability:state?physicalAvailability[state]:host.shortcutStatus==='registered'?'Registered':host.shortcutStatus==='unavailable'?'Unavailable':'Checking availability',explanation:'Press both physical modifier keys together. Screen capture still requires its existing setup and permission review.',aliases:'capture snapshot appshot physical '+(host.platform==='darwin'?'both alt option':'both ctrl control')});
 }
 entries.push({id:'capture-fallback',action:'Screen context · fallback shortcut',keys:host.fallbackShortcut||'Checking…',scope:'Global · screen context',availability:!host.fallbackShortcut?'Checking availability':host.fallbackShortcutStatus==='registered'?'Registered':host.fallbackShortcutStatus==='unavailable'?'Unavailable':'Checking availability',explanation:'The current fallback binding reported by Glint. Screen capture still requires its existing setup and permission review.',aliases:'capture snapshot appshot fallback hotkey'});
 if(host.platform==='darwin')entries.push(...macMenu.map(item=>({...item,availability:'When Glint is focused'})));
 return entries;
}
function normalize(value:string,platform:string):string[]{
 return value.toLocaleLowerCase().replace(/⌘/g,' command ').replace(/⌥/g,' alt ').replace(/⌃/g,' control ').replace(/⇧/g,' shift ').replace(/\b(commandorcontrol|cmdorctrl)\b/g,platform==='darwin'?'command':'control').replace(/\bcmd\b/g,'command').replace(/\bctrl\b/g,'control').replace(/\boption\b/g,'alt').replace(/−/g,' minus ').replace(/\+\s*\+/g,' plus ').replace(/\b(command|control|alt|shift)\s*\+\s*$/g,'$1 plus ').replace(/\+\s*-/g,' minus ').replace(/\b(command|control|alt|shift)\s*-\s*$/g,'$1 minus ').replace(/^\s*-\s*$/g,'minus').replace(/^\s*\+\s*$/g,'plus').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
export function searchShortcuts(host:HostStatus|undefined,query:string):ShortcutEntry[]{
 if(!host)return [];
 const terms=normalize(query,host.platform);
 return catalogue(host).filter(item=>{
  const words=normalize([item.action,item.keys,item.scope,item.availability,item.explanation,item.aliases].join(' '),host.platform);
  return terms.every(term=>words.some(word=>term.length===1?word===term:word.includes(term)));
 });
}
