import {afterEach,expect,it,vi} from 'vitest';
import {Schema} from 'effect';
import {BrowserObservationSchema} from '../../src/core/task-session';
import {browserPageState,LocalBrowser} from '../../src/host/browser/local-browser';
const external=vi.hoisted(()=>({launch:vi.fn()}));
vi.mock('playwright-core',()=>({chromium:{launch:external.launch}}));
const site='https://owned.invalid';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();external.launch.mockReset();});

class TextNode {nodeType=3;constructor(readonly textContent:string){}}
class DomNode {static TEXT_NODE=3;}
class ElementNode {
 nodeType=1;isConnected=true;parentElement:ElementNode|null=null;childNodes:Array<ElementNode|TextNode>=[];attributes:Record<string,string>={};style={display:'block',visibility:'visible',contentVisibility:'visible',webkitTextSecurity:'none',getPropertyValue(name:string){return name==='-webkit-text-security'?this.webkitTextSecurity:'';}};reads=0;
 constructor(readonly tagName:string,text=''){if(text)this.childNodes.push(new TextNode(text));}
 hasAttribute(name:string){return name in this.attributes;}
 getAttribute(name:string){return this.attributes[name]??null;}
 getRootNode(){return document;}
 get contentEditable(){return this.getAttribute('contenteditable')??'inherit';}
 get isContentEditable():boolean{const mode=this.contentEditable;return mode==='true'||mode===''||mode==='plaintext-only'||mode!=='false'&&!!this.parentElement?.isContentEditable;}
 get textContent():string{return this.childNodes.map(node=>node.textContent).join('');}
 set textContent(value:string){this.childNodes=value?[new TextNode(value)]:[];}
 get innerText():string{this.reads++;return this.childNodes.map(node=>node instanceof ElementNode?(node.hasAttribute('hidden')||node.style.display==='none'?'':node.tagName==='BR'?'\n':node.innerText):node.textContent).join('');}
 append(...children:Array<ElementNode|TextNode>){for(const child of children){if(child instanceof ElementNode)child.parentElement=this;this.childNodes.push(child);}return this;}
 querySelectorAll(selector:string):ElementNode[]{const children=this.childNodes.filter((child):child is ElementNode=>child instanceof ElementNode);return children.flatMap(child=>[...(selector==='*'||selector==='select'&&child.tagName==='SELECT'||selector==='[contenteditable]'&&child.hasAttribute('contenteditable')?[child]:[]),...child.querySelectorAll(selector)]);}
 querySelector(selector:string){return this.querySelectorAll(selector)[0]??null;}
}
class Other extends ElementNode {}
class InputNode extends ElementNode {value='Ordinary field value';type='text';autocomplete='';labels:ElementNode[]=[];constructor(){super('INPUT');}}
class TextareaNode extends ElementNode {value='Ordinary text area';labels:ElementNode[]=[];constructor(){super('TEXTAREA');}}
class SelectNode extends ElementNode {value='';multiple=false;options:unknown[]=[];selectedOptions:unknown[]=[];labels:ElementNode[]=[];constructor(){super('SELECT');}}
class AnchorNode extends ElementNode {get href(){return site+(this.getAttribute('href')??'');}}
class ButtonNode extends ElementNode {type='button';form=null;}
function editor(text='Original ordinary note',mode='true'){const element=new ElementNode('DIV',text);element.attributes={contenteditable:mode,role:'textbox','aria-label':'Delivery note'};return element;}

/** Real adapter callbacks over inert DOM/transport: no Chromium, page script or network is launched. */
function fixture(taskId='editor-task'){
 const body=new ElementNode('BODY'),heading=new ElementNode('P','Delivery instructions'),element=editor();body.append(heading,element);
 const doc={body,title:'Owned editor',querySelectorAll:(selector:string)=>body.querySelectorAll(selector),getElementById:(id:string)=>body.querySelectorAll('*').find(node=>node.getAttribute('id')===id)??null};
 for(const [name,value] of Object.entries({Element:ElementNode,HTMLElement:ElementNode,HTMLInputElement:InputNode,HTMLTextAreaElement:TextareaNode,HTMLSelectElement:SelectNode,HTMLAnchorElement:AnchorNode,HTMLButtonElement:ButtonNode,HTMLOptGroupElement:Other,Node:DomNode,document:doc,location:{href:site+'/notes'},getComputedStyle:(node:ElementNode)=>node.style}))vi.stubGlobal(name,value);
 let fills=0,closed=false,failRead=false,fillHook:(()=>Promise<void>)|undefined,visibilityHook:(()=>Promise<void>)|undefined;
 const visible=(node:ElementNode)=>{for(let parent:ElementNode|null=node;parent;parent=parent.parentElement)if(!parent.isConnected||parent.hasAttribute('hidden')||parent.style.display==='none'||['hidden','collapse'].includes(parent.style.visibility))return false;return true;};
 const handles=new Map<ElementNode,{dispose:()=>Promise<void>;isVisible:()=>Promise<boolean>;evaluate:(fn:Function,arg?:unknown)=>Promise<any>;fill:(value:string)=>Promise<void>}>();
 const handle=(node:ElementNode)=>{let value=handles.get(node);if(!value){value={dispose:async()=>{},isVisible:async()=>{await visibilityHook?.();return visible(node);},evaluate:async(fn,arg)=>fn(node,arg),fill:async text=>{fills++;if(node instanceof InputNode||node instanceof TextareaNode)node.value=text;else node.textContent=text;await fillHook?.();}};handles.set(node,value);}return value;};
 const page={on:()=>{},goto:async()=>{},isClosed:()=>closed,evaluate:async(fn:Function)=>{if(failRead&&fills)throw Error('PRIVATE_LOST_READ');return fn();},locator:(_selector:string)=>{const candidates=body.querySelectorAll('*').filter(node=>['BUTTON','INPUT','TEXTAREA','SELECT'].includes(node.tagName)||node.tagName==='A'&&node.hasAttribute('href')||node.getAttribute('role')==='button');return {count:async()=>candidates.length,nth:(index:number)=>({isVisible:async()=>visible(candidates[index]),elementHandle:async()=>handle(candidates[index])})};}};
 const context={on:()=>{},newPage:async()=>page,route:async(_pattern:string,_handler:Function)=>{},routeWebSocket:async()=>{},addInitScript:async()=>{},close:async()=>{closed=true;}};
 const engine={newContext:async()=>context,close:async()=>{closed=true;}};
 const browser=Reflect.construct(LocalBrowser,[engine,context,page,taskId,site]) as LocalBrowser;
 return {browser,element,body,page,context,engine,get fills(){return fills;},onFill(hook:()=>Promise<void>){fillHook=hook;},beforeVisibility(hook:()=>Promise<void>){visibilityHook=hook;},loseRead(){failRead=true;}};
}

it.each(['true','','plaintext-only'])('reads ordinary %s editor text without adding an action target or private schema field',async mode=>{
 const f=fixture();f.element.attributes.contenteditable=mode;f.element.append(new ElementNode('BR'),new TextNode('Keep the parcel dry.'));
 const snapshot=await f.browser.observe();expect(Schema.decodeUnknownSync(BrowserObservationSchema,{onExcessProperty:'error'})(snapshot)).toEqual(snapshot);expect(snapshot.text).toContain('Original ordinary note\nKeep the parcel dry.');expect(snapshot.targets).toEqual([]);expect(snapshot).not.toHaveProperty('blockedEditor');
 for(const kind of ['fill','click'] as const)await expect(f.browser.propose({kind,snapshotId:snapshot.id,targetId:'invented-editor',...(kind==='fill'?{value:'Replacement'}:{})})).rejects.toThrow('target changed');expect(f.fills).toBe(0);expect(external.launch).not.toHaveBeenCalled();
});

it.each(['rich','nested','button-role','native-child','hidden','readonly'])('keeps %s editing contexts read-only to the assistant',async kind=>{
 const f=fixture();if(kind==='rich')f.element.append(new ElementNode('B','Ordinary rich note'));if(kind==='nested')f.element.append(editor('Nested note'));if(kind==='button-role')f.element.attributes.role='button';if(kind==='native-child')f.element.append(new ButtonNode('BUTTON','Continue'),new InputNode());if(kind==='hidden')f.element.attributes.hidden='';if(kind==='readonly')f.element.attributes['aria-readonly']='true';
 const snapshot=await f.browser.observe();expect(snapshot.targets).toEqual([]);if(kind==='hidden')expect(snapshot.text).not.toContain('Original ordinary note');else expect(snapshot.text).toContain('Original ordinary note');expect(f.fills).toBe(0);
});

it.each(['autocomplete','name','id','type','inputmode','aria-label','aria-labelledby','ancestor','masked'])('omits recognized sensitive %s editor text without reading its native text fallback',async kind=>{
 const f=fixture();f.element.textContent='PRIVATE_EDITOR_BYTES';if(kind==='aria-labelledby'){const label=new ElementNode('LABEL','Account password');label.attributes.id='credential-label';f.body.append(label);f.element.attributes['aria-labelledby']='credential-label';}else if(kind==='ancestor')f.body.attributes.autocomplete='one-time-code';else if(kind==='masked')f.element.style.webkitTextSecurity='disc';else f.element.attributes[kind]=kind==='autocomplete'?'cc-number':'account-password';
 const snapshot=await f.browser.observe();expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_EDITOR_BYTES');expect(snapshot.targets).toEqual([]);expect(f.element.reads).toBe(0);expect(f.fills).toBe(0);
});

it('omits sensitive nested editor text while retaining ordinary visible neighboring text',async()=>{
 const f=fixture(),sensitive=editor('PRIVATE_NESTED_EDITOR');sensitive.attributes.autocomplete='current-password';f.element.append(new TextNode(' Visible surrounding text. '),sensitive);
 const snapshot=await f.browser.observe();expect(snapshot.text).toContain('Original ordinary note');expect(snapshot.text).toContain('Visible surrounding text.');expect(snapshot.text).not.toContain('PRIVATE_NESTED_EDITOR');expect(snapshot.targets).toEqual([]);expect(sensitive.reads).toBe(0);
});

it.each(['false','inherited-false','ordinary'])('preserves existing native controls under an %s boundary',async boundary=>{
 const f=fixture(),container=new ElementNode('SECTION');f.body.childNodes=[];if(boundary==='false')container.attributes.contenteditable='false';
 if(boundary==='inherited-false'){const outer=new ElementNode('DIV'),island=new ElementNode('DIV');outer.attributes.contenteditable='true';island.attributes.contenteditable='false';outer.append(island);island.append(container);f.body.append(outer);}else f.body.append(container);
 const controls=[new InputNode(),new TextareaNode(),new SelectNode(),new ButtonNode('BUTTON','Continue'),new AnchorNode('A','Read details')];controls[4].attributes.href='/details';controls.forEach((control,index)=>{control.attributes['aria-label']='Native '+index;container.append(control);});
 const snapshot=await f.browser.observe();expect(snapshot.targets.map(target=>target.label)).toEqual(['Native 0','Native 1','Native 2','Native 3','Native 4']);expect(snapshot.targets.map(target=>target.role)).toEqual(['text','textarea','select','button','link']);expect(snapshot.targets[0].value).toBe('Ordinary field value');expect(f.fills).toBe(0);
});

it('preserves an exactly approved ordinary native-field fill in a false island',async()=>{
 const f=fixture(),field=new InputNode(),island=new ElementNode('DIV');f.body.childNodes=[];island.attributes.contenteditable='false';field.attributes['aria-label']='Ordinary field';island.append(field);f.body.append(island);
 const snapshot=await f.browser.observe(),proposal=await f.browser.propose({kind:'fill',snapshotId:snapshot.id,targetId:snapshot.targets[0].id,value:'Approved native text'});await expect(f.browser.execute(proposal.id,'forged')).rejects.toThrow('Approval');expect(f.fills).toBe(0);const token=f.browser.approve(proposal.id),result=await f.browser.execute(proposal.id,token);expect(result.proposal.result!.targets[0].value).toBe('Approved native text');expect(f.fills).toBe(1);await expect(f.browser.execute(proposal.id,token)).rejects.toThrow('already');expect(f.fills).toBe(1);
});

it('does not expose native controls through a false island of a sensitive editor',async()=>{
 const f=fixture(),outer=editor(''),island=new ElementNode('DIV'),field=new InputNode();f.body.childNodes=[];outer.attributes['aria-label']='Account password';island.attributes.contenteditable='false';field.value='PRIVATE_NESTED_FIELD';field.attributes['aria-label']='Ordinary label';island.append(field,new ButtonNode('BUTTON','Continue'));outer.append(island);f.body.append(outer);
 const snapshot=await f.browser.observe();expect(snapshot.targets).toEqual([]);expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_NESTED_FIELD');expect(f.fills).toBe(0);
});

it.each(['proposal','execution'])('rejects a previously ordinary native target that is now in an active editor at %s',async phase=>{
 const f=fixture(),container=new ElementNode('DIV'),field=new InputNode();f.body.childNodes=[];field.attributes['aria-label']='Ordinary field';container.append(field);f.body.append(container);
 const snapshot=await f.browser.observe(),intent={kind:'fill' as const,snapshotId:snapshot.id,targetId:snapshot.targets[0].id,value:'New text'},proposal=phase==='execution'?await f.browser.propose(intent):undefined,token=proposal?f.browser.approve(proposal.id):undefined;
 container.attributes.contenteditable='true';await expect(proposal?f.browser.execute(proposal.id,token!):f.browser.propose(intent)).rejects.toThrow('target changed');expect(f.fills).toBe(0);
});

it.each(['aria-reference','native-label','false-island-reference','false-island-label'] as const)('does not read a sensitive editor descendant through an external %s name',async kind=>{
 const f=fixture(),sensitive=editor(''),privateLabel=new ElementNode('LABEL','PRIVATE_REFERENCED_EDITOR_TEXT'),outside=new InputNode();f.body.childNodes=[];sensitive.attributes.autocomplete='current-password';privateLabel.attributes.id='private-label';outside.attributes['aria-label']='Public fallback';
 if(kind.startsWith('false-island')){const island=new ElementNode('DIV');island.attributes.contenteditable='false';island.append(privateLabel);sensitive.append(island);}else sensitive.append(privateLabel);
 const publicLabel=new ElementNode('LABEL','Public fallback');if(kind.endsWith('reference'))outside.attributes['aria-labelledby']='private-label';else{delete outside.attributes['aria-label'];outside.labels=[privateLabel,publicLabel];}f.body.append(sensitive,outside,publicLabel);
 const snapshot=await f.browser.observe();expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_REFERENCED_EDITOR_TEXT');expect(snapshot.targets).toHaveLength(1);expect(snapshot.targets[0]).toMatchObject({role:'text',label:'Public fallback',value:'Ordinary field value'});expect(privateLabel.reads).toBe(0);expect(f.fills).toBe(0);
});
