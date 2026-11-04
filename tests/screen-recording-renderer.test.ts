import {afterEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {ScreenRecordingCue,ScreenRecordingIndicator,ScreenRecordingSettings} from '../src/renderer/src/ScreenRecordingSettings';
import type {CompanionEvent} from '../src/shared/bridge';
import type {ScreenRecordingState} from '../src/shared/screen-recording';
import {createControlledRenderer} from './controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

/** Mirrors the host owner: a failed set leaves allowed=false, with confirmed=false only if re-protection also failed. */
function host(options:{allowed?:boolean;failSet?:'reprotected'|'unconfirmed';failGet?:()=>boolean}={}){
 const commands:any[]=[],listeners=new Set<(event:CompanionEvent)=>void>(),focused:string[]=[];
 let state:ScreenRecordingState={allowed:options.allowed??false,confirmed:true,scope:'this-session'};
 const emit=()=>{for(const listener of listeners)listener({type:'screen-recording.changed',state:{...state}});};
 vi.stubGlobal('document',{getElementById:(id:string)=>({focus:()=>focused.push(id)})});
 vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command);
  if(command.type==='screen-recording.get'){if(options.failGet?.())throw Error('host unavailable');return {...state};}
  if(command.type==='screen-recording.set'){
   if(options.failSet){state={allowed:false,confirmed:options.failSet==='reprotected',scope:'this-session'};emit();throw Error('Screen recording could not be changed.');}
   state={...state,allowed:command.allowed,confirmed:true};emit();return {...state};
  }
  throw Error('Unexpected command');},subscribe:(listener:(event:CompanionEvent)=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};}}});
 return {commands,focused,confirm:(next:Partial<ScreenRecordingState>)=>{state={...state,...next};emit();}};
}
const view=(component:()=>any)=>{
 const r=createControlledRenderer(()=>createElement(component)),text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 return {r,content:()=>r.nodes().filter(node=>node.type==='#text').map(node=>node.props.text).join(''),checkbox:()=>r.find(node=>node.type==='input'),button:(label:string)=>r.find(node=>node.type==='button'&&text(node)===label),has:(role:string)=>r.nodes().some(node=>node.props?.role===role)};
};

test('Settings shows the protected default, explains the exposure and launch reset, and applies the choice immediately',async()=>{
 const {commands}=host(),s=view(ScreenRecordingSettings);
 s.r.render();await settle();s.r.render();
 expect(s.checkbox().props.checked).toBe(false);expect(s.checkbox().props.disabled).toBe(false);
 expect(s.content()).toContain('Allow screen recording');expect(s.content()).toContain('Glint windows become visible to screen recording and screenshots.');expect(s.content()).toContain('The Muse key window stays hidden.');expect(s.content()).toContain('resets to protected each time Glint opens');
 s.checkbox().props.onChange({target:{checked:true}});s.r.render();expect(s.content()).toContain('Applying your screen recording choice');await settle();s.r.render();
 expect(commands.at(-1)).toEqual({type:'screen-recording.set',allowed:true});expect(s.checkbox().props.checked).toBe(true);expect(s.content()).not.toContain('Applying');
 s.checkbox().props.onChange({target:{checked:false}});await settle();s.r.render();
 expect(commands.at(-1)).toEqual({type:'screen-recording.set',allowed:false});expect(s.checkbox().props.checked).toBe(false);
});

test('"Hide from recording" moves focus to the task and announces protection in a region that outlives the indicator',async()=>{
 const {commands,focused}=host({allowed:true}),i=view(ScreenRecordingIndicator);
 i.r.render();await settle();i.r.render();expect(i.content()).toContain('Visible to screen recording');
 i.button('Hide from recording').props.onClick();await settle();i.r.render();
 expect(commands.at(-1)).toEqual({type:'screen-recording.set',allowed:false});expect(i.has('status')).toBe(false);expect(focused).toEqual(['main']);
 const live=i.r.find(node=>node.props?.['aria-live']==='polite');expect(i.content()).toBe('Glint windows are protected from screen recording.');expect(live).toBeTruthy();
});

test('a rejected "allow" re-reads the host and reports, with the right action, that Glint stays protected',async()=>{
 const {commands}=host({failSet:'reprotected'}),s=view(ScreenRecordingSettings);
 s.r.render();await settle();s.r.render();
 s.checkbox().props.onChange({target:{checked:true}});await settle();s.r.render();
 expect(commands.map(command=>command.type)).toEqual(['screen-recording.get','screen-recording.set','screen-recording.get']);
 expect(s.checkbox().props.checked).toBe(false);expect(s.content()).toContain('Screen recording could not be allowed. Glint windows stay protected.');
});

test('when re-protection also fails, Settings, the indicator and the cue say Glint may be visible, never protected',async()=>{
 host({allowed:true,failSet:'unconfirmed'});const s=view(ScreenRecordingSettings),i=view(ScreenRecordingIndicator),cue=view(()=>createElement(ScreenRecordingCue,{place:'anchor'}));
 for(const v of [s,i,cue])v.r.render();await settle();for(const v of [s,i,cue])v.r.render();
 i.button('Hide from recording').props.onClick();await settle();for(const v of [s,i,cue])v.r.render();
 for(const v of [s,i])expect(v.content()).toContain('could not all be protected. They may be visible to screen recording.');
 expect(s.content()).not.toContain('stay protected');expect(i.content()).not.toContain('protected from screen recording');
 expect(i.button('Hide from recording')).toBeTruthy();
 const dot=cue.r.find(node=>node.props?.role==='img');expect(dot.props['aria-label']).toContain('may be visible');expect(dot.props.className).toBe('screen-recording-cue screen-recording-cue--anchor');
});

test('a confirmed change event clears an earlier error and uncertainty',async()=>{
 let gets=0;const h=host({allowed:true,failSet:'unconfirmed',failGet:()=>++gets>2});const i=view(ScreenRecordingIndicator),cue=view(()=>createElement(ScreenRecordingCue,{place:'compact'}));
 i.r.render();cue.r.render();await settle();i.r.render();cue.r.render();
 i.button('Hide from recording').props.onClick();await settle();i.r.render();cue.r.render();
 expect(i.content()).toContain('could not be confirmed. Glint windows may be visible');
 h.confirm({allowed:false,confirmed:true});i.r.render();cue.r.render();
 expect(i.has('alert')).toBe(false);expect(i.has('status')).toBe(false);expect(cue.has('img')).toBe(false);
});

test('an unreadable state is never shown as protected',async()=>{
 host({failGet:()=>true});const s=view(ScreenRecordingSettings),cue=view(()=>createElement(ScreenRecordingCue,{place:'compact'}));
 s.r.render();cue.r.render();await settle();s.r.render();cue.r.render();
 expect(s.checkbox().props.disabled).toBe(true);expect(s.content()).toContain('could not be read. Glint windows may be visible');expect(s.content()).not.toContain('stay protected');
 expect(cue.r.find(node=>node.props?.role==='img').props['aria-label']).toContain('could not be read');
});

test('compact and anchor cues use non-colliding classes and appear only while Glint may be capturable',async()=>{
 const h=host();const cue=view(()=>createElement(ScreenRecordingCue,{place:'compact'}));cue.r.render();await settle();cue.r.render();
 expect(cue.has('img')).toBe(false);
 h.confirm({allowed:true});cue.r.render();
 const dot=cue.r.find(node=>node.props?.role==='img');expect(dot.props.title).toBe('Visible to screen recording');expect(dot.props.className.split(' ')).toEqual(['screen-recording-cue','screen-recording-cue--compact']);
 h.confirm({allowed:false});cue.r.render();expect(cue.has('img')).toBe(false);
});
