import type {NativeWindow} from './native';

export interface OwnApplication {processId:number;bundleId:string;executablePath:string;ownedProcessIds?:ReadonlySet<number>}
/** Separate instances and credential windows belong to the companion too. */
export function isCompanionWindow(window:NativeWindow,own:OwnApplication):boolean{
 const owner=window.owner,path=owner.path?.replaceAll('\\','/').toLowerCase(),executable=own.executablePath.replaceAll('\\','/').toLowerCase();
 return owner.processId===own.processId||own.ownedProcessIds?.has(owner.processId)===true||owner.bundleId===own.bundleId||!!path&&(path===executable||path.includes('/window companion.app/'))||owner.name==='Window Companion';
}
export function chooseContextTarget(foreground:NativeWindow|undefined,windows:NativeWindow[],own:OwnApplication){
 const choices=windows.filter(window=>!isCompanionWindow(window,own));
 const exact=foreground&&!isCompanionWindow(foreground,own)&&choices.find(window=>window.id===foreground.id&&window.owner.processId===foreground.owner.processId&&window.documentToken===foreground.documentToken);
 return exact?{kind:'target' as const,window:exact}:{kind:'choose' as const,windows:choices,reason:'Choose the window you want to use.'};
}
export function sameWindowIdentity(a:NativeWindow,b:NativeWindow):boolean{
 return a.id===b.id&&a.owner.processId===b.owner.processId&&a.documentToken===b.documentToken;
}
export function chooseShortcutTarget(foreground:NativeWindow|undefined,windows:NativeWindow[],own:OwnApplication){
 const result=chooseContextTarget(foreground,windows,own);
 return result.kind==='target'?result:{kind:'unavailable' as const,reason:'Switch to the window you want to use, then press the screen context shortcut again.'};
}
