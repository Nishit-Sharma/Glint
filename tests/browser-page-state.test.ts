import {afterEach,expect,it,vi} from 'vitest';
import {browserPageState,LocalBrowser} from '../src/host/browser/local-browser';
import {BrowserService} from '../src/host/browser/service';
import {createCompanion} from '../src/core/companion';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {ConnectionStatus} from '../src/shared/bridge';
const host=vi.hoisted(()=>({dialog:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox:host.dialog}}));
class DomNode {static TEXT_NODE=3;}
class TextNode {nodeType=3;constructor(readonly textContent:string){}}
class DomElement {
 nodeType=1;isConnected=true;hidden=false;parentElement:DomElement|null=null;childNodes:Array<DomElement|TextNode>=[];attributes:Record<string,string>={};style={display:'block',visibility:'visible',contentVisibility:'visible'};reads=0;
 constructor(readonly tagName:string,private nativeText=''){}
 append(...children:Array<DomElement|TextNode>){for(const child of children){if(child instanceof DomElement)child.parentElement=this;this.childNodes.push(child);}return this;}
 hasAttribute(name:string){return name==='hidden'?this.hidden:name in this.attributes;}
 getAttribute(name:string){return this.attributes[name]??null;}
 getRootNode(){return {};}
 get innerText(){this.reads++;return this.nativeText;}
 querySelector(selector:string):DomElement|null{for(const child of this.childNodes){if(!(child instanceof DomElement))continue;if(selector==='select'&&child instanceof Select)return child;const found=child.querySelector(selector);if(found)return found;}return null;}
}
class Select extends DomElement {options:Option[]=[];labels:DomElement[]=[];constructor(){super('SELECT');}add(...options:Option[]){this.options.push(...options);for(const option of options)if(!option.parentElement)option.parentElement=this;return this;}}
class Group extends DomElement {constructor(readonly label:string){super('OPTGROUP');}}
class Option extends DomElement {constructor(readonly label:string){super('OPTION');}}
class Input extends DomElement {labels:DomElement[]=[];constructor(){super('INPUT');}}
class TextArea extends DomElement {}
function setup(body:DomElement,controls:DomElement[]){vi.stubGlobal('Element',DomElement);vi.stubGlobal('HTMLElement',DomElement);vi.stubGlobal('HTMLSelectElement',Select);vi.stubGlobal('HTMLOptGroupElement',Group);vi.stubGlobal('HTMLInputElement',Input);vi.stubGlobal('HTMLTextAreaElement',TextArea);vi.stubGlobal('Node',DomNode);vi.stubGlobal('getComputedStyle',(element:DomElement)=>element.style);vi.stubGlobal('document',{body,title:'Owned page',querySelectorAll:()=>controls});vi.stubGlobal('location',{href:'https://owned.invalid/form'});}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('preserves native text bytes on a page with no select, including leading/trailing whitespace',()=>{const body=new DomElement('BODY','  exact native text\n\n  ');setup(body,[]);expect(browserPageState().text).toBe('  exact native text\n\n  ');expect(body.reads).toBe(1);});
it('projects visible neighboring text/options without reading leaky native select ancestors or hidden/script/style branches',()=>{
 const body=new DomElement('BODY','PRIVATE_BODY_FALLBACK'),before=new DomElement('P','Visible neighboring paragraph.'),code=new DomElement('PRE','  keep exact code indentation\nnext line  '),label=new DomElement('LABEL','PRIVATE_LABEL_FALLBACK'),select=new Select(),hidden=new Option('PRIVATE_OPTION'),visible=new Option('Ship parcel'),group=new Group('PRIVATE_GROUP');hidden.hidden=true;group.hidden=true;const grouped=new Option('PRIVATE_GROUP_OPTION');grouped.parentElement=group;group.parentElement=select;select.add(hidden,visible,grouped);select.labels=[label];label.append(new TextNode('Delivery '),select);const hiddenBranch=new DomElement('DIV','PRIVATE_HIDDEN_SIBLING'),hiddenCss=new DomElement('DIV','PRIVATE_CSS_SIBLING'),script=new DomElement('SCRIPT','PRIVATE_SCRIPT'),style=new DomElement('STYLE','PRIVATE_STYLE');hiddenBranch.hidden=true;hiddenCss.style.display='none';body.append(before,label,code,hiddenBranch,hiddenCss,script,style);setup(body,[select]);const state=browserPageState();expect(JSON.stringify(state).includes('PRIVATE_')).toBe(false);expect(state.text).toContain('Visible neighboring paragraph.');expect(state.text).toContain('Ship parcel');expect(state.text).toContain('  keep exact code indentation\nnext line  ');expect(browserPageState(select as unknown as Element).label).toBe('Delivery');for(const node of [body,label,hiddenBranch,hiddenCss,script,style])expect(node.reads).toBe(0);expect(body.childNodes).toEqual([before,label,code,hiddenBranch,hiddenCss,script,style]);
});
it('sanitizes link/button/input names with nested selects, hidden associated labels and a hidden ancestor',()=>{
 const body=new DomElement('BODY','PRIVATE_BODY'),link=new DomElement('A','PRIVATE_LINK_NATIVE'),button=new DomElement('DIV','PRIVATE_BUTTON_NATIVE'),label=new DomElement('LABEL','PRIVATE_INPUT_LABEL_NATIVE'),input=new Input(),hiddenLabel=new DomElement('LABEL','PRIVATE_ASSOCIATED_LABEL');hiddenLabel.hidden=true;const control=(container:DomElement,name:string)=>{const select=new Select(),hidden=new Option('PRIVATE_NESTED_OPTION'),visible=new Option('Visible choice');hidden.hidden=true;select.add(hidden,visible);container.append(new TextNode(name),select);return select;};control(link,'Read supporting detail');control(button,'Review support');control(label,'Other field');input.labels=[hiddenLabel,label];label.append(input);const hiddenParent=new DomElement('SECTION','PRIVATE_PARENT'),hiddenInput=new Input();hiddenParent.hidden=true;hiddenInput.labels=[new DomElement('LABEL','PRIVATE_ANCESTOR_LABEL')];hiddenParent.append(hiddenInput);body.append(link,button,label,hiddenParent);setup(body,[link,button,input,hiddenInput]);const state=browserPageState();expect(JSON.stringify(state).includes('PRIVATE_')).toBe(false);expect([link,button,input,hiddenInput].map(target=>browserPageState(target as unknown as Element).label)).toEqual(['Read supporting detail','Review support','Other field','']);expect(hiddenLabel.reads).toBe(0);expect(hiddenParent.reads).toBe(0);
});
it('traverses display:contents without its native text fallback and refuses unsupported deferred visibility',()=>{const body=new DomElement('BODY','PRIVATE_FALLBACK'),contents=new DomElement('DIV','PRIVATE_CONTENTS'),hidden=new DomElement('SPAN','PRIVATE_HIDDEN');contents.style.display='contents';hidden.hidden=true;contents.append(new TextNode('Visible contents'),hidden);body.append(contents,new Select());setup(body,[]);expect(browserPageState().text).toContain('Visible contents');expect(browserPageState().text.includes('PRIVATE_')).toBe(false);expect(contents.reads).toBe(0);contents.style.contentVisibility='auto';expect(()=>browserPageState()).toThrow('deferred rendering');});
it('allows ordinary open-shadow controls and refuses shadow selects before any native page text',()=>{const body=new DomElement('BODY','  native page bytes  '),host=new DomElement('DIV'),button=new DomElement('BUTTON','Owned shadow button');setup(body,[]);let selects=false;const shadow={querySelector:()=>selects?new Select():null,querySelectorAll:()=>[]};Object.assign(host,{shadowRoot:shadow});vi.stubGlobal('document',{body,title:'Owned page',querySelectorAll:(selector:string)=>selector==='*'?[host]:[]});expect(browserPageState().text).toBe('  native page bytes  ');expect(browserPageState(button as unknown as Element).label).toBe('Owned shadow button');selects=true;const reads=body.reads;expect(()=>browserPageState()).toThrow('Choice lists in open shadow roots');expect(body.reads).toBe(reads);});

it('uses visible referenced names in ID order before aria-label, native labels or control text',()=>{
 const body=new DomElement('BODY','Reference labels'),first=new DomElement('SPAN','Open'),second=new DomElement('SPAN','delivery details'),input=new Input();input.labels=[new DomElement('LABEL','Native fallback')];input.attributes={'aria-labelledby':' second\tfirst\nmissing ','aria-label':'Other fallback'};body.append(first,second,input);setup(body,[input]);input.getRootNode=()=>({getElementById:(id:string)=>({first,second}[id]??null)});
 expect(browserPageState(input as unknown as Element).label).toBe('delivery details Open');expect(input.labels[0].reads).toBe(1);
});

it.each(['hidden','display','visibility','ancestor','detached','script'] as const)('never reads a %s referenced label and uses the ordinary fallback',kind=>{
 const body=new DomElement('BODY','Visible page'),label=new DomElement(kind==='script'?'SCRIPT':'SPAN','PRIVATE_REFERENCE'),input=new Input();input.attributes={'aria-labelledby':'private missing','aria-label':'Visible fallback'};if(kind==='hidden')label.hidden=true;if(kind==='display')label.style.display='none';if(kind==='visibility')label.style.visibility='hidden';if(kind==='detached')label.isConnected=false;if(kind==='ancestor'){const parent=new DomElement('SECTION');parent.hidden=true;parent.append(label);}setup(body,[input]);input.getRootNode=()=>({getElementById:(id:string)=>id==='private'?label:null});expect(browserPageState(input as unknown as Element).label).toBe('Visible fallback');expect(label.reads).toBe(0);
});

it('sanitizes referenced labels containing a select and keeps same-tree shadow references',()=>{
 const body=new DomElement('BODY','PRIVATE_BODY'),label=new DomElement('SPAN','PRIVATE_NATIVE_LABEL'),select=new Select(),hidden=new Option('PRIVATE_CHOICE'),visible=new Option('Ship parcel'),button=new DomElement('BUTTON');hidden.hidden=true;select.add(hidden,visible);label.append(new TextNode('Delivery details'),select);button.attributes={'aria-labelledby':'local outside'};setup(body,[button]);const lookup=vi.fn((id:string)=>id==='local'?label:null);button.getRootNode=()=>({getElementById:lookup});Object.assign(document,{getElementById:()=>new DomElement('SPAN','PRIVATE_OTHER_TREE')});expect(browserPageState(button as unknown as Element).label).toBe('Delivery details');expect(lookup.mock.calls).toEqual([['local'],['outside']]);expect(label.reads).toBe(0);
});

it('handles self references without recursion and retains the existing 500-character name bound',()=>{
 const body=new DomElement('BODY'),button=new DomElement('BUTTON','Open details');button.attributes={'aria-labelledby':'self'};setup(body,[button]);button.getRootNode=()=>({getElementById:()=>button});expect(browserPageState(button as unknown as Element).label).toBe('Open details');const long=new DomElement('SPAN','x'.repeat(501));button.getRootNode=()=>({getElementById:()=>long});expect(browserPageState(button as unknown as Element).label).toBe('x'.repeat(500));
});

it('refuses more than 100 name references before reading any referenced text',()=>{
 const body=new DomElement('BODY'),button=new DomElement('BUTTON'),label=new DomElement('SPAN','Label'),lookup=vi.fn(()=>label);setup(body,[button]);button.getRootNode=()=>({getElementById:lookup});button.attributes={'aria-labelledby':Array(100).fill('label').join(' ')};expect(browserPageState(button as unknown as Element).label).toHaveLength(500);lookup.mockClear();button.attributes['aria-labelledby']+=' label';expect(()=>browserPageState(button as unknown as Element)).toThrow('observation limit');expect(lookup).not.toHaveBeenCalled();
});

/** The real observation/review/execute code uses an inert DOM and transport here. */
function namedBrowser(taskId='owned-task'){
 const body=new DomElement('BODY','Open details Remove record'),open=new DomElement('SPAN','Open details'),remove=new DomElement('SPAN','Remove record'),button=new DomElement('BUTTON');button.attributes={'aria-labelledby':'open'};body.append(open,remove,button);setup(body,[button]);for(const name of ['HTMLAnchorElement','HTMLButtonElement'])vi.stubGlobal(name,class {});const labels:Record<string,DomElement>={open,remove};button.getRootNode=()=>({getElementById:(id:string)=>labels[id]??null});let clicks=0;
 const handle={dispose:async()=>{},isVisible:async()=>true,evaluate:async(fn:Function,arg?:unknown)=>fn(button,arg),click:async()=>{clicks++;}};
 const page={on:()=>{},isClosed:()=>false,evaluate:async(fn:Function)=>fn(),locator:()=>({count:async()=>1,nth:()=>({isVisible:async()=>true,elementHandle:async()=>handle})})};
 const browser=Reflect.construct(LocalBrowser,[{close:async()=>{}},{on:()=>{},close:async()=>{}},page,taskId,'https://owned.invalid']) as LocalBrowser;
 return {browser,button,labels,get clicks(){return clicks;}};
}

it('shows a referenced name to the planner and approval and dispatches one exact approved click',async()=>{
 const f=namedBrowser(),snapshot=await f.browser.observe();expect(snapshot.targets[0]).toMatchObject({role:'button',label:'Open details'});const proposal=await f.browser.propose({kind:'click',snapshotId:snapshot.id,targetId:snapshot.targets[0].id});expect(await f.browser.review(proposal.id)).toMatchObject({target:{label:'Open details'}});await expect(f.browser.execute(proposal.id,'forged')).rejects.toThrow('Approval');const token=f.browser.approve(proposal.id),result=await f.browser.execute(proposal.id,token);expect(result.proposal.status).toBe('completed');expect(f.clicks).toBe(1);await expect(f.browser.execute(proposal.id,token)).rejects.toThrow('already');expect(f.clicks).toBe(1);
});

it.each(['proposal','review','execution'] as const)('fences a referenced-name retarget at %s even when page text and control fingerprint stay unchanged',async phase=>{
 const f=namedBrowser(),snapshot=await f.browser.observe(),intent={kind:'click' as const,snapshotId:snapshot.id,targetId:snapshot.targets[0].id};const proposal=phase==='proposal'?undefined:await f.browser.propose(intent),token=phase==='execution'?f.browser.approve(proposal!.id):undefined;f.button.attributes['aria-labelledby']='remove';await expect(phase==='proposal'?f.browser.propose(intent):phase==='review'?f.browser.review(proposal!.id):f.browser.execute(proposal!.id,token!)).rejects.toThrow('target changed');expect(f.clicks).toBe(0);
});

it.each(['hidden','replacement'] as const)('fences a %s referenced label after approval with unchanged page text',async kind=>{
 const f=namedBrowser(),snapshot=await f.browser.observe(),proposal=await f.browser.propose({kind:'click',snapshotId:snapshot.id,targetId:snapshot.targets[0].id}),token=f.browser.approve(proposal.id);if(kind==='hidden')f.labels.open.hidden=true;else f.labels.open=f.labels.remove;await expect(f.browser.execute(proposal.id,token)).rejects.toThrow('target changed');expect(f.clicks).toBe(0);
});

it('carries a referenced name through the host planner, trusted approval dialog and durable observed result',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'browser-reference-name-')),core=await createCompanion({dataDir:directory}),task=await core.createTask({title:'Read delivery details'}),f=namedBrowser(task.id);vi.spyOn(LocalBrowser,'open').mockResolvedValue(f.browser);host.dialog.mockReset().mockResolvedValue({response:1});let plans=0;
 const service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'owned',provider:{accountScope:async()=> 'synthetic-account',status:async()=>({configured:true,provider:'Codex (temporary)'} as ConnectionStatus),run:async input=>{const observation=JSON.parse(input.sources[0].content).currentObservation;expect(observation.targets[0].label).toBe('Open details');return JSON.stringify(plans++===0?{kind:'action',reason:'Open the delivery details',action:{kind:'click',targetId:observation.targets[0].id}}:{kind:'answer',markdown:'The page after opening details was observed.',modules:[]});}}}),changed:()=>{},progress:()=>{}});
 try{const saved=await service.run({taskId:task.id,requestId:'read-details',prompt:'Read the delivery details',url:'https://owned.invalid/form'});expect(host.dialog).toHaveBeenCalledTimes(2);expect(host.dialog.mock.calls[1][1].detail).toContain('Control: Open details');expect(f.clicks).toBe(1);expect(saved.session!.runs[0].operations[0]).toMatchObject({status:'observed',result:{targets:[{label:'Open details'}]}});}finally{service.close();await core.close();await rm(directory,{recursive:true,force:true});}
});
