import {describe,it,expect} from 'vitest';
import {chooseContextTarget,chooseShortcutTarget,isCompanionWindow} from '../src/host/context-target';
import type {NativeWindow} from '../src/host/native';
const own={processId:21,bundleId:'local.nishit.windowcompanion',executablePath:'/Applications/Glint.app/Contents/MacOS/Glint'};
function window(id:number,owner:Partial<NativeWindow['owner']>={}):NativeWindow{return{id:'window:'+id,osId:id,title:'Synthetic '+id,owner:{name:'Synthetic editor',processId:100+id,...owner},bounds:{x:0,y:0,width:600,height:400},displayId:'1',scaleFactor:2,documentToken:'identity-'+id,requiresExplicitCapture:true};}
describe('explicit context target policy',()=>{
 it('excludes only the owned browser process while keeping a personal browser with the same name eligible',()=>{
  const browser=window(1,{name:'Google Chrome for Testing',processId:501,path:'/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'}),personal=window(2,{name:'Google Chrome for Testing',processId:502,path:browser.owner.path});
  const application={...own,ownedProcessIds:new Set([501])};
  expect(isCompanionWindow(browser,application)).toBe(true);expect(isCompanionWindow(personal,application)).toBe(false);
  expect(chooseShortcutTarget(browser,[browser,personal],application).kind).toBe('unavailable');
  expect(chooseContextTarget(browser,[browser,personal],application)).toMatchObject({kind:'choose',windows:[personal]});
  expect(chooseShortcutTarget(personal,[browser,personal],application)).toEqual({kind:'target',window:personal});
 });
 it('shortcut pins only the exact external foreground without a picker or background fallback',()=>{
  const a=window(1),b=window(2);expect(chooseShortcutTarget(b,[a,b],own)).toEqual({kind:'target',window:b});
  for(const foreground of [undefined,{...b,documentToken:'changed'},window(99),window(3,{processId:own.processId})]){
   const result=chooseShortcutTarget(foreground,[a,b],own);expect(result.kind).toBe('unavailable');expect(result).not.toHaveProperty('windows');
  }
 });
 it('selects the exact foreground identity, never the first background window',()=>{const a=window(1),b=window(2);expect(chooseContextTarget(b,[a,b],own)).toEqual({kind:'target',window:b});});
 it.each([{processId:21},{bundleId:own.bundleId},{path:'/Applications/Glint.app/Contents/MacOS/Glint'},{path:'/Applications/Window Companion.app/Contents/MacOS/Window Companion'},{name:'Window Companion'}])('excludes every own application window (%j)',owner=>{const self=window(1,owner),foreign=window(2);expect(isCompanionWindow(self,own)).toBe(true);expect(chooseContextTarget(self,[self,foreign],own)).toEqual({kind:'choose',windows:[foreign],reason:'Choose the window you want to use.'});});
 it('requires selection for missing/stale foreground without choosing an unrelated source',()=>{const current=window(1);for(const foreground of [undefined,{...current,documentToken:'stale'},window(99)])expect(chooseContextTarget(foreground,[current],own).kind).toBe('choose');});
 it('keeps an unrelated Glint.app bundle eligible while Glint\'s own windows stay excluded',()=>{const other=window(1,{name:'Glint',processId:99,bundleId:'com.other.glint',path:'/Users/x/Apps/Glint.app/Contents/MacOS/Glint'}),self=window(2,{name:'Glint',processId:own.processId,bundleId:own.bundleId,path:own.executablePath});expect(isCompanionWindow(other,own)).toBe(false);expect(isCompanionWindow(self,own)).toBe(true);expect(chooseContextTarget(other,[other,self],own)).toEqual({kind:'target',window:other});expect(chooseShortcutTarget(self,[other,self],own).kind).toBe('unavailable');});
 it('does not exclude another Electron application by its generic runtime name',()=>{const other=window(1,{name:'Electron',path:'/Applications/Other.app/Contents/MacOS/Electron'});expect(chooseContextTarget(other,[other],own).kind).toBe('target');});
});
