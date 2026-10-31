import {expect,test} from 'vitest';
import type {HostStatus} from '../src/shared/bridge';
import {searchShortcuts} from '../src/renderer/src/shortcut-search';
const host:HostStatus={platform:'darwin',screenPermission:'granted',accessibilityPermission:'granted',shortcut:'Both Option keys',shortcutStatus:'registered',modifierShortcutStatus:'ready',fallbackShortcut:'Control+Alt+F8',fallbackShortcutStatus:'registered',captureMode:'explicit-frozen',memoryEnabled:false,dataDir:'/unused'};
test('shortcut search finds actual actions, key aliases and the current configured fallback',()=>{
 expect(searchShortcuts(host,'').map(item=>item.id)).toEqual(['capture-physical','capture-fallback','undo','redo','cut','copy','paste','select-all','close','reset-zoom','zoom-in','zoom-out','minimize','hide','hide-others','quit']);
 expect(searchShortcuts(host,'copy').map(item=>item.id)).toEqual(['copy']);
 expect(searchShortcuts(host,'cmd+c').map(item=>item.id)).toEqual(['copy']);
 expect(searchShortcuts(host,'⌘ C').map(item=>item.id)).toEqual(['copy']);
 expect(searchShortcuts(host,'ctrl option f8').map(item=>item.id)).toEqual(['capture-fallback']);
 expect(searchShortcuts(host,'both alt').map(item=>item.id)).toEqual(['capture-physical']);
 expect(searchShortcuts(host,'does-not-exist')).toEqual([]);
});
test('capture bindings and their availability reflect HostStatus without exposing host paths',()=>{
 const unavailable={...host,modifierShortcutStatus:'permission-required' as const,shortcutStatus:'unavailable' as const,fallbackShortcutStatus:'unavailable' as const};
 expect(searchShortcuts(unavailable,'physical')[0]).toMatchObject({keys:'Both Option keys',availability:'Accessibility access required'});
 expect(searchShortcuts(unavailable,'fallback')[0]).toMatchObject({keys:'Control+Alt+F8',availability:'Unavailable'});
 expect(JSON.stringify(searchShortcuts(unavailable,''))).not.toContain('/unused');
 expect(searchShortcuts({...host,fallbackShortcut:'Super+F10'},'f10')[0].keys).toBe('Super+F10');
 expect(searchShortcuts({...host,fallbackShortcut:undefined},'fallback')[0]).toMatchObject({keys:'Checking…',availability:'Checking availability'});
 expect(searchShortcuts(undefined,'')).toEqual([]);
});
test('other platforms do not acquire invented native menu or physical shortcuts',()=>{
 const linux={...host,platform:'linux',shortcut:'Control+Alt+F8',modifierShortcutStatus:'unsupported' as const};
 expect(searchShortcuts(linux,'').map(item=>item.id)).toEqual(['capture-fallback']);
 expect(searchShortcuts({...host,platform:'win32',shortcut:'Both Ctrl keys'},'physical')[0].keys).toBe('Both Ctrl keys');
});
test('symbol keys and platform aliases identify their actual shortcut without broad matches',()=>{
 for(const query of ['Command++','⌘+','+'])expect(searchShortcuts(host,query).map(item=>item.id)).toEqual(['zoom-in']);
 for(const query of ['Command+-','⌘-','⌘−','-'])expect(searchShortcuts(host,query).map(item=>item.id)).toEqual(['zoom-out']);
 expect(searchShortcuts(host,'both control')).toEqual([]);
 expect(searchShortcuts({...host,platform:'win32',shortcut:'Both Ctrl keys'},'both option')).toEqual([]);
 for(const platform of ['darwin','win32','linux'])for(const binding of ['CommandOrControl+F10','CmdOrCtrl+F10']){
  const current={...host,platform,fallbackShortcut:binding};
  expect(searchShortcuts(current,(platform==='darwin'?'command':'control')+' F10').map(item=>item.id)).toEqual(['capture-fallback']);
  expect(searchShortcuts(current,binding)[0].keys).toBe(binding);
 }
 expect(searchShortcuts(host,'close window')[0].explanation).toContain('compact anchor');
});
