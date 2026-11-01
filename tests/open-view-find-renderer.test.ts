import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {setImmediate as yieldToRenderer} from 'node:timers/promises';
import {OpenViewFind as FindBar} from '../src/renderer/src/components/OpenViewFind';
import {OpenViewFind} from '../src/host/open-view-find';
import type {CompanionEvent,Command} from '../src/shared/bridge';
import {createControlledRenderer} from './controlled-renderer.fixture';

test('Find bar handles explicit open/literal query/count/navigation/Escape focus restoration and retires old-view search',async()=>{
 class PriorInput{isConnected=true;selectionStart=2;selectionEnd=5;focused=0;selection:number[]=[];focus(){this.focused++;}setSelectionRange(...range:number[]){this.selection=range;}}
 const prior=new PriorInput(),listeners=new Set<(event:CompanionEvent)=>void>(),calls:Command[]=[];let scope='owned/chat',tail:Promise<unknown>=Promise.resolve(),id=0;const controller=new OpenViewFind({findInPage:()=>++id,stopFindInPage(){}},event=>{for(const listener of listeners)listener(event);});
 vi.stubGlobal('HTMLElement',PriorInput);vi.stubGlobal('document',{activeElement:prior,addEventListener(){},removeEventListener(){}});vi.stubGlobal('window',{companion:{subscribe(listener:(event:CompanionEvent)=>void){listeners.add(listener);return()=>listeners.delete(listener);},invoke(input:Command){calls.push(input);const operation=Promise.resolve().then(()=>controller.handle(input));tail=operation;return operation;}}});
 try{
  const renderer=createControlledRenderer(()=>createElement(FindBar,{scope,active:true}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),settle=async()=>{await tail;await yieldToRenderer();renderer.render();};renderer.render();await settle();expect(renderer.nodes().some(node=>node.type==='section')).toBe(false);
  controller.open();renderer.render();await settle();const field=()=>renderer.find(node=>node.type==='input');field().props.onChange({currentTarget:{value:'Owned marker'}});renderer.render();await settle();controller.found({requestId:id,activeMatchOrdinal:1,matches:2,finalUpdate:true});renderer.render();expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join('')).toContain('1 of 2');field().props.onKeyDown({key:'Enter',shiftKey:true,preventDefault(){}});await settle();expect(calls.at(-1)).toMatchObject({action:'previous'});controller.open();renderer.render();field().props.onKeyDown({key:'Escape',preventDefault(){}});await settle();expect(prior.focused).toBe(1);expect(prior.selection).toEqual([2,5]);expect(renderer.nodes().some(node=>node.type==='section')).toBe(false);
  controller.open();renderer.render();await settle();field().props.onChange({currentTarget:{value:'Old view'}});renderer.render();await settle();const oldId=id;scope='owned/document';renderer.render();await settle();controller.found({requestId:oldId,activeMatchOrdinal:2,matches:2,finalUpdate:true});renderer.render();expect(renderer.nodes().some(node=>node.type==='section')).toBe(false);expect(calls.every(call=>call.type==='view.find')).toBe(true);
 }finally{vi.unstubAllGlobals();}
});
