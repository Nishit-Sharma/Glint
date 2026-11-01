import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {setImmediate as yieldToRenderer} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {pasteImageSource} from '../src/host/image-paste';
import {ClipboardImageAttachment} from '../src/renderer/src/components/ClipboardImageAttachment';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {ImagePasteCommand,ImagePasteResult} from '../src/shared/image-paste';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');

test('real explicit image paste review keeps text paste/default draft, cancel, same lost-ack identity retry and owner guards without clipboard reads',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-image-paste-ui-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const task=await core.createTask({title:'Owned composer'});let owner=true,tail:Promise<unknown>=Promise.resolve(),calls:ImagePasteCommand[]=[],loseAck=true;const attach=async(input:ImagePasteCommand):Promise<ImagePasteResult>=>{calls.push(input);const operation=pasteImageSource(input,core,()=>({isEmpty:()=>false,getSize:()=>({width:1,height:1}),toPNG:()=>png}),()=>{if(!owner)throw Error('Changed owner');});tail=operation;const result=await operation;if(loseAck){loseAck=false;throw Error('Lost acknowledgment');}return result;};
  const renderer=createControlledRenderer(()=>createElement(ClipboardImageAttachment,{task,inputId:'workspace-prompt',active:true,disabled:false,isCurrent:()=>owner,onAttach:attach,children:pending=>createElement('textarea',{id:'workspace-prompt',value:'Preserve typed message',disabled:pending})}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(name:string)=>renderer.find(node=>node.type==='button'&&text(node)===name),wrapper=()=>renderer.find(node=>node.type==='div'&&node.props['aria-label']==='Composer image paste'),settle=async()=>{await tail;await yieldToRenderer();renderer.render();};
  const event=(images:number)=>{let prevented=false;return {target:{tagName:'TEXTAREA',id:'workspace-prompt'},clipboardData:{items:Array.from({length:images},()=>({kind:'file',type:'image/png',getAsFile:()=>new File([new Uint8Array(png)],'owned.png',{type:'image/png'})}))},preventDefault(){prevented=true;},get prevented(){return prevented;}};};
  renderer.render();const ordinary=event(0);wrapper().props.onPasteCapture(ordinary);expect(ordinary.prevented).toBe(false);expect(renderer.find(node=>node.type==='textarea').props.value).toBe('Preserve typed message');const multiple=event(2);wrapper().props.onPasteCapture(multiple);await settle();expect(multiple.prevented).toBe(true);expect(calls).toHaveLength(0);
  let finishRead:(value:ArrayBuffer)=>void=()=>{};const deferred=new Promise<ArrayBuffer>(resolve=>{finishRead=resolve;}),cancelled=event(1);cancelled.clipboardData.items[0].getAsFile=()=>({size:png.length,type:'image/png',arrayBuffer:()=>deferred}) as File;const reading=wrapper().props.onPasteCapture(cancelled);renderer.render();button('Cancel image reading').props.onClick();finishRead(new Uint8Array(png).buffer);await reading;renderer.render();expect((await core.getTask(task.id)).sources).toHaveLength(0);
  const pasted=event(1);await wrapper().props.onPasteCapture(pasted);renderer.render();expect(pasted.prevented).toBe(true);expect(renderer.find(node=>node.type==='textarea').props.disabled).toBe(true);expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('may already be in Context');expect(renderer.nodes().some(node=>node.type==='button'&&text(node)==='Add image to context')).toBe(false);button('Retry same image').props.onClick();await settle();expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect((await core.getTask(task.id)).sources).toHaveLength(1);expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('Image added to selected context');expect(renderer.find(node=>node.type==='textarea').props.value).toBe('Preserve typed message');owner=false;wrapper().props.onPasteCapture(event(1));await settle();expect(calls).toHaveLength(2);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
