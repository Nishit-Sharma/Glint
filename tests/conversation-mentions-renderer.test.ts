import {afterEach,beforeEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
const dom=vi.hoisted(()=>({controlledValue:undefined as string|undefined,input:{value:'',selectionStart:0,selectionEnd:0,disabled:false,focus:()=>{},setSelectionRange:(_start:number,_end:number)=>{}}}));
vi.mock('../src/renderer/src/vendor/nexvyn/AiInput',async()=>{const {createElement}=await import('react');return {AiInput:(props:any)=>{props.ref.current=dom.input;if(dom.controlledValue!==props.value){dom.input.value=props.value;dom.controlledValue=props.value;}dom.input.disabled=props.disabled;return createElement('textarea',{...props,onKeyDown:(event:any)=>{props.onKeyDown(event);if(!event.defaultPrevented&&!event.nativeEvent.isComposing&&event.key==='Enter'&&!event.shiftKey)props.onSubmit(props.value);}});}};});
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {Composer} from '../src/renderer/src/components/Composer';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
import {conversationMentionToken,readConversationMentions} from '../src/shared/conversation-mentions';
const token=conversationMentionToken({kind:'bot',id:'bot731',revision:0,name:'Bao'});
let duplicate=false,hidden=false,delayed:Promise<void>|undefined,loadCalls:unknown[]=[];
beforeEach(()=>{dom.controlledValue=undefined;duplicate=false;hidden=false;delayed=undefined;loadCalls=[];vi.stubGlobal('document',{activeElement:null});dom.input.value='';dom.input.selectionStart=dom.input.selectionEnd=0;dom.input.disabled=false;dom.input.focus=()=>{Object.assign(document,{activeElement:dom.input});};dom.input.setSelectionRange=(start,end)=>{dom.input.selectionStart=start;dom.input.selectionEnd=end;};vi.stubGlobal('window',{companion:{invoke:vi.fn(async(command:{type:string})=>{loadCalls.push(command);if(delayed)await delayed;if(command.type==='bots.get')return {kind:'available',current:{kind:'ready',revision:1,defaultBotId:'bot731',legacyBotId:'bot731',examplePending:false,bots:duplicate?[{id:'bot731',revision:1,profile:{...DEFAULT_CHARACTER,personalName:'Momo'}},{id:'second-bot731',revision:1,profile:{...DEFAULT_CHARACTER,personalName:'Momo'}}]:[{id:'bot731',revision:0,hidden,profile:{...DEFAULT_CHARACTER,personalName:'Bao'}}]}};if(command.type==='schedules.get')return {items:[],runtime:{state:'stopped',message:'Test fixture'}};if(command.type==='skills.list')return {entries:duplicate?['ownerA','ownerB'].map(ownerTaskId=>({reference:{ownerTaskId,artifactId:'saved-skill731',revision:1,digest:'exact-digest731'},name:'Momo',description:'Saved example',instructions:'Never implicitly include me',resources:[],current:true})):[],unavailable:[],invocation:{revision:0,selection:null}};throw Error('Unexpected command');})}});});
afterEach(()=>vi.unstubAllGlobals());
function setup(){let value='',current=true;const props={active:true,disabled:false,frozen:false,running:false},onRun=vi.fn(),changes=vi.fn((change:{text?:string})=>{if(change.text!==undefined)value=change.text;}),isCurrent=()=>current;
 const renderer=createControlledRenderer(()=>createElement(Composer,{...props,idPrefix:'workspace',value,kind:'create',onChange:changes,connection:{configured:true} as any,onRun,onStop:()=>{},onConfigure:()=>{},mentions:{taskId:'owned',ownerTitles:{ownerA:'Ecology731',ownerB:'Rockets731'},isCurrent}}));renderer.render();const textarea=()=>renderer.find(n=>n.type==='textarea'),section=()=>renderer.find(n=>n.type==='section'&&n.props.className==='composer');
 function type(text='@Ba'){dom.input.focus();dom.input.value=text;dom.input.selectionStart=dom.input.selectionEnd=text.length;textarea().props.onValueChange(text);renderer.render();}
 function key(key='Enter',extra:Record<string,unknown>={}){const event={key,nativeEvent:{isComposing:false},defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,...extra};textarea().props.onKeyDown(event);return event;}
 const button=()=>renderer.find(n=>n.type==='button'&&n.children.some(child=>child.type==='span'&&child.props.children==='Bao'));
 return {renderer,textarea,section,type,key,button,props,onRun,changes,value:()=>value,setCurrent:(next:boolean)=>{current=next;},setValue:(text:string)=>{value=text;}};
}
async function settle(h:ReturnType<typeof setup>){for(let i=0;i<15;i++){await Promise.resolve();h.renderer.render();}}
test('actual Composer typed-@ list uses only readonly real catalogs; click stages a stable reference without Ask or entity activation',async()=>{
 const h=setup();h.type();await settle(h);expect(h.button().props.disabled).toBe(false);h.button().props.onClick();await settle(h);expect(h.value()).toBe(token+' ');expect(readConversationMentions(h.value())).toEqual([{kind:'bot',id:'bot731',revision:0,name:'Bao'}]);expect(h.onRun).not.toHaveBeenCalled();expect(loadCalls.every((c:any)=>['bots.get','schedules.get','skills.list'].includes(c.type))).toBe(true);expect(h.changes).toHaveBeenCalledTimes(2);
});
test('Arrow/Enter selection never leaks a Send; ordinary Tab and dismissed Enter keep their existing behavior',async()=>{
 const h=setup();h.type('@');await settle(h);expect(h.key('Tab').defaultPrevented).toBe(false);expect(h.key('ArrowDown').defaultPrevented).toBe(true);expect(h.key().defaultPrevented).toBe(true);await settle(h);expect(h.value()).toBe(token+' ');expect(h.onRun).not.toHaveBeenCalled();
 const dismissed=setup();dismissed.type();await settle(dismissed);expect(dismissed.key('Escape').defaultPrevented).toBe(true);dismissed.renderer.render();expect(dismissed.value()).toBe('@Ba');expect(dismissed.key().defaultPrevented).toBe(false);expect(dismissed.onRun).toHaveBeenCalledExactlyOnceWith('@Ba','create');
});
test('loading, IME, hidden/disabled/frozen/running surfaces and stale task/draft/caret cannot insert',async()=>{
 let release!:()=>void;delayed=new Promise<void>(resolve=>{release=resolve;});const loading=setup();loading.type();expect(loading.key().defaultPrevented).toBe(true);expect(loading.onRun).not.toHaveBeenCalled();release();delayed=undefined;await settle(loading);
 for(const field of ['active','disabled','frozen','running'] as const){const h=setup();h.type();await settle(h);const old=h.button().props.onClick;h.props[field]=field!=='active';h.renderer.render();old();await settle(h);expect(h.value()).toBe('@Ba');expect(h.onRun).not.toHaveBeenCalled();}
 const moved=setup();moved.type();await settle(moved);dom.input.selectionStart=0;moved.button().props.onClick();await settle(moved);expect(moved.value()).toBe('@Ba');
 const retired=setup();retired.type();await settle(retired);retired.setCurrent(false);retired.button().props.onClick();await settle(retired);expect(retired.value()).toBe('@Ba');
 const drift=setup();drift.type();await settle(drift);dom.input.value='Different DOM draft';drift.button().props.onClick();await settle(drift);expect(drift.value()).toBe('@Ba');
 const ime=setup();ime.type();await settle(ime);ime.textarea().props.onCompositionStart();ime.renderer.render();ime.key('Enter',{nativeEvent:{isComposing:true}});expect(ime.value()).toBe('@Ba');expect(ime.onRun).not.toHaveBeenCalled();
});
test('a late directory response and deleted/hidden entity never silently rebind or replace the typed text',async()=>{
 const h=setup();h.type();await settle(h);hidden=true;h.button().props.onClick();await settle(h);expect(h.value()).toBe('@Ba');expect(h.renderer.nodes().some(n=>n.type==='p'&&n.props.role==='alert')).toBe(true);expect(h.onRun).not.toHaveBeenCalled();
 hidden=false;let release!:()=>void;delayed=new Promise<void>(resolve=>{release=resolve;});const late=setup();late.type();late.setCurrent(false);late.props.active=false;late.renderer.render();release();delayed=undefined;await settle(late);expect(late.value()).toBe('@Ba');expect(late.onRun).not.toHaveBeenCalled();
});
test('duplicate same-kind names and revisions expose distinct stable identities and skill owner context before selection',async()=>{
 duplicate=true;const h=setup();h.type('@Momo');await settle(h);
 type Host=ReturnType<typeof h.renderer.nodes>[number];const text=(node:Host):string=>node.type==='#text'?String(node.props.text):node.children.map(text).join('');const rows=h.renderer.nodes().filter(n=>n.type==='button'&&n.children.some(child=>child.type==='span'&&child.props.children==='Momo')),labels=rows.map(text);
 expect(rows).toHaveLength(4);expect(new Set(labels).size).toBe(4);expect(labels.some(label=>label.includes('ID bot731'))).toBe(true);expect(labels.some(label=>label.includes('ID second-bot731'))).toBe(true);expect(labels.some(label=>label.includes('Task Ecology731'))).toBe(true);expect(labels.some(label=>label.includes('Task Rockets731'))).toBe(true);
 rows.find(row=>text(row).includes('Task Rockets731'))!.props.onClick();await settle(h);expect(readConversationMentions(h.value())).toEqual([{kind:'skill',ownerTaskId:'ownerB',artifactId:'saved-skill731',revision:1,digest:'exact-digest731',name:'Momo'}]);expect(h.onRun).not.toHaveBeenCalled();
});
