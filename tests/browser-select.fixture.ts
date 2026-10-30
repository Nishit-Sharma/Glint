import {vi} from 'vitest';
import {LocalBrowser,browserPageState} from '../src/host/browser/local-browser';

export const choiceOrigin='https://owned.invalid';
export function choiceLabel(text:string,selectText=''){return {visibleText:text,textContent:text+selectText,cloneNode(){let content=text+selectText;return {get textContent(){return content;},querySelectorAll:()=>selectText?[{remove(){content=text;}}]:[]};}};}
class Element {
 tagName='SELECT';name='delivery';type='select-one';value='desk';multiple=false;disabled=false;isConnected=true;labels=[choiceLabel('Delivery')];textContent='Collect at deskShip parcel';
 options=[{value:'desk',label:'Collect at desk',disabled:false,hidden:false,style:{display:'block',visibility:'visible'},parentElement:null as unknown},{value:'parcel',label:'Ship parcel',disabled:false,hidden:false,style:{display:'block',visibility:'visible'},parentElement:null as unknown}];
 get selectedOptions(){return this.options.filter(option=>option.value===this.value);}
 getAttribute(name:string){return name==='name'?this.name:name==='disabled'&&this.disabled?'':null;}
 matches(){return this.disabled;}
}
class Select extends Element {}
class Other {}
export function stubChoiceDom(){vi.stubGlobal('getComputedStyle',(element:{style?:unknown})=>element.style??({display:'block',visibility:'visible'}));for(const [name,value] of Object.entries({HTMLInputElement:Other,HTMLTextAreaElement:Other,HTMLSelectElement:Select,HTMLAnchorElement:Other,HTMLButtonElement:Other,HTMLOptGroupElement:Other}))vi.stubGlobal(name,value);}

/** Inert DOM/transport boundary: actual observation, fingerprint, intent, review,
 * approval and execution run. No browser process, JavaScript page or network. */
export function choiceBrowser(taskId:string){
 const element=new Select();let closed=false,selections=0,failSelection=false,loseObservation=false,selectionHook:(()=>Promise<void>)|undefined;
 const selected:Array<unknown>=[];
 const name=()=>{const visible=element.options.filter(option=>[option,...(option.parentElement instanceof HTMLOptGroupElement?[option.parentElement as any]:[])].every(item=>{const style=getComputedStyle(item as any);return !item.hidden&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);}));return (element.labels.map(label=>label.visibleText).join(' ')||visible.map(option=>option.label).join(' ')).trim();};
 const handle={dispose:async()=>{},isVisible:async()=>true,evaluate:async(fn:Function,arg?:unknown)=>fn===browserPageState?{label:name()}:fn(element,arg),selectOption:async(value:{value:string;label:string})=>{selections++;selected.push(value);element.value=value.value;await selectionHook?.();if(failSelection)throw Error('Selection response was lost.');return [value.value];}};
 const page={on:()=>{},goto:async()=>{},isClosed:()=>closed,evaluate:async()=>{if(loseObservation&&selections)throw Error('Observation was lost.');return {text:'Delivery choices',title:'Owned form',url:choiceOrigin+'/form'};},locator:()=>({count:async()=>1,nth:()=>({isVisible:async()=>true,elementHandle:async()=>handle})})};
 const browser=Reflect.construct(LocalBrowser,[{close:async()=>{closed=true;}},{on:()=>{},close:async()=>{closed=true;}},page,taskId,choiceOrigin]) as LocalBrowser;
 return {browser,page,element,selected,get selections(){return selections;},failSelection(){failSelection=true;},loseObservation(){loseObservation=true;},onSelection(hook:()=>Promise<void>){selectionHook=hook;}};
}
