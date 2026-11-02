import {afterEach,beforeEach,expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
const dom=vi.hoisted(()=>({input:{value:'',selectionStart:0,selectionEnd:0,disabled:false,focus:()=>{},setSelectionRange:(_start:number,_end:number)=>{}}}));
vi.mock('../src/renderer/src/vendor/nexvyn/AiInput',async()=>{const {createElement}=await import('react');return {AiInput:(props:any)=>{props.ref.current=dom.input;dom.input.value=props.value;dom.input.disabled=props.disabled;return createElement('textarea',props);}};});
import {createElement} from 'react';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {Composer} from '../src/renderer/src/components/Composer';
import {createCompanion} from '../src/core/companion';
import {createComposerDrafts} from '../src/renderer/src/composer-drafts';
import {readComposerDraft} from '../src/core/composer-draft';
import {responsePromptSuggestions,responsePromptSuggestionsCurrent,type ResponsePromptSuggestions} from '../src/renderer/src/response-prompt-suggestions';
import {promptSuggestionPreference} from '../src/renderer/src/prompt-suggestion-preference';
const prompt='Explain “Photosynthesis” in more detail.',basis:ResponsePromptSuggestions={taskId:'owner',key:'exact-saved-response',responseText:'## Photosynthesis',prompts:[prompt]};
const data=new Map<string,string>();
beforeEach(()=>{vi.stubGlobal('window',{localStorage:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}}});vi.stubGlobal('document',{activeElement:null});dom.input.value='';dom.input.selectionStart=dom.input.selectionEnd=0;dom.input.disabled=false;dom.input.focus=()=>{Object.assign(document,{activeElement:dom.input});};dom.input.setSelectionRange=(start,end)=>{dom.input.selectionStart=start;dom.input.selectionEnd=end;};promptSuggestionPreference.set(true);});
afterEach(()=>vi.unstubAllGlobals());
function setup(initial='',offer:ResponsePromptSuggestions=basis){
 let value=initial,current=true;const changes=vi.fn((change:{text?:string})=>{if(change.text!==undefined)value=change.text;}),onRun=vi.fn(),onStop=vi.fn(),props={active:true,disabled:false,frozen:false,running:false,kind:'create' as const};const guard=vi.fn(()=>current);
 const renderer=createControlledRenderer(()=>createElement(Composer,{...props,idPrefix:'workspace',value,onChange:changes,connection:{configured:true} as any,onRun,onStop,onConfigure:()=>{},suggestions:offer,suggestionsCurrent:guard}));renderer.render();
 const input=()=>renderer.find(node=>node.type==='textarea'),section=()=>renderer.find(node=>node.type==='section'&&node.props.className==='composer'),button=()=>renderer.find(node=>node.type==='button'&&node.props.children===prompt);
 function focus(){dom.input.selectionStart=dom.input.selectionEnd=value.length;dom.input.focus();section().props.onFocusCapture();renderer.render();}
 function key(key='Tab',extra:Record<string,unknown>={}){const event={key,nativeEvent:{isComposing:false},preventDefault:vi.fn(),altKey:false,shiftKey:false,metaKey:false,ctrlKey:false,...extra};input().props.onKeyDown(event);return event;}
 return {renderer,input,section,button,focus,key,changes,onRun,onStop,props,guard,setCurrent:(next:boolean)=>{current=next;},setValue:(text:string)=>{value=text;},value:()=>value};
}
test('real Composer click and focused plain Tab stage editable text only; existing matching prefixes are preserved',()=>{
 const clicked=setup();clicked.button().props.onClick();expect(clicked.changes).toHaveBeenCalledExactlyOnceWith({text:prompt});expect(clicked.onRun).not.toHaveBeenCalled();expect(clicked.onStop).not.toHaveBeenCalled();
 const tabbed=setup('Explain ');tabbed.focus();expect(tabbed.renderer.nodes().some(node=>node.props.className==='composer-completion')).toBe(true);expect(tabbed.key().preventDefault).toHaveBeenCalledOnce();expect(tabbed.changes).toHaveBeenCalledExactlyOnceWith({text:prompt});tabbed.renderer.render();const edited=prompt+'\nMy own follow-up 日本語';dom.input.value=edited;dom.input.selectionStart=dom.input.selectionEnd=edited.length;tabbed.input().props.onValueChange(edited);expect(tabbed.value()).toBe(edited);expect(tabbed.onRun).not.toHaveBeenCalled();
});
test('normal Tab, modifiers, IME, selection, nonmatching text and lifecycle exclusions do not accept',()=>{
 for(const extra of [{shiftKey:true},{ctrlKey:true},{metaKey:true},{altKey:true},{nativeEvent:{isComposing:true}}]){const h=setup();h.focus();expect(h.key('Tab',extra).preventDefault).not.toHaveBeenCalled();expect(h.changes).not.toHaveBeenCalled();}
 for(const field of ['disabled','frozen','running'] as const){const h=setup();h.focus();const stale=h.button().props.onClick;h.props[field]=true;h.renderer.render();stale();expect(h.key().preventDefault).not.toHaveBeenCalled();expect(h.changes).not.toHaveBeenCalled();}
 const hidden=setup();hidden.focus();const stale=hidden.button().props.onClick;hidden.props.active=false;hidden.renderer.render();stale();expect(hidden.key().preventDefault).not.toHaveBeenCalled();expect(hidden.changes).not.toHaveBeenCalled();
 const selection=setup('Explain ');selection.focus();dom.input.selectionStart=0;expect(selection.key().preventDefault).not.toHaveBeenCalled();expect(selection.changes).not.toHaveBeenCalled();
 const unrelated=setup('Keep my unrelated\r\n日本語 draft');unrelated.focus();expect(unrelated.renderer.nodes().filter(node=>node.type==='button'&&node.props.children===prompt)).toHaveLength(0);expect(unrelated.key().preventDefault).not.toHaveBeenCalled();expect(unrelated.changes).not.toHaveBeenCalled();
 const ime=setup();ime.focus();ime.input().props.onCompositionStart();expect(ime.key().preventDefault).not.toHaveBeenCalled();expect(ime.changes).not.toHaveBeenCalled();
});
test('retained callbacks reject changed task/response guard, DOM drift, draft edit/revert, caret move, dismissal and toggle OFF/ON',()=>{
 const changed=setup();changed.focus();changed.setCurrent(false);changed.button().props.onClick();expect(changed.key().preventDefault).not.toHaveBeenCalled();expect(changed.changes).not.toHaveBeenCalled();
 const drift=setup();drift.focus();dom.input.value='New unsaved text';drift.button().props.onClick();expect(drift.changes).not.toHaveBeenCalled();
 const edit=setup();edit.focus();const old=edit.button().props.onClick;dom.input.value='x';edit.input().props.onValueChange('x');edit.setValue('');dom.input.value='';dom.input.selectionStart=dom.input.selectionEnd=0;old();expect(edit.changes).toHaveBeenCalledTimes(1);
 const moved=setup();moved.focus();const oldCaret=moved.button().props.onClick;moved.section().props.onSelect();oldCaret();expect(moved.changes).not.toHaveBeenCalled();
 const dismiss=setup();dismiss.focus();const oldDismiss=dismiss.button().props.onClick;expect(dismiss.key('Escape').preventDefault).toHaveBeenCalledOnce();dismiss.renderer.render();oldDismiss();dismiss.renderer.render();expect(dismiss.renderer.nodes().some(node=>node.type==='button'&&node.props.children===prompt)).toBe(false);expect(dismiss.changes).not.toHaveBeenCalled();
 const toggle=setup();toggle.focus();const oldToggle=toggle.button().props.onClick;promptSuggestionPreference.set(false);promptSuggestionPreference.set(true);oldToggle();expect(toggle.changes).not.toHaveBeenCalled();
});
test('preference failure is reported and cannot falsely enable local offers',()=>{
 const h=setup();promptSuggestionPreference.set(false);h.renderer.render();window.localStorage.setItem=()=>{throw Error('Quota');};h.renderer.find(node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked===false).props.onChange({currentTarget:{checked:true}});h.renderer.render();expect(h.renderer.nodes().some(node=>node.type==='#text'&&node.props.text.includes('Could not save the follow-up suggestion setting'))).toBe(true);expect(h.renderer.nodes().some(node=>node.type==='button'&&node.props.children===prompt)).toBe(false);
});
test('actual acceptance callback crosses the existing draft controller and survives core restart without new tasks/requests/queues or other-draft changes',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-local-followups-'));let core=await createCompanion({dataDir:directory});
 try{
  const created=await core.createTask({title:'Owned synthetic response'}),other=await core.createTask({title:'Other task'});await core.saveComposerDraft(other.id,0,{text:'OTHER exact\r\n日本語731',kind:'procedure'});
  // This deterministic in-process callback performs no provider or network work.
  await core.runRequest({taskId:created.id,requestId:'local-synthetic',kind:'explain',prompt:'Owned question',sourceIds:[]},async()=>({title:'Answer',content:'## Photosynthesis\nPlants use light energy.'}));
  let owner=await core.getTask(created.id);const originalOther=await core.getTask(other.id),before=structuredClone(owner),suggestions=responsePromptSuggestions(owner)!,drafts=createComposerDrafts((id,revision,value)=>core.saveComposerDraft(id,revision,value));drafts.hydrate([owner,originalOther]);drafts.edit(owner.id,{kind:'create'});await drafts.flush(owner.id);let guardDraft=drafts.getSnapshot()[owner.id];
  const onRun=vi.fn(),onStop=vi.fn(),onChange=vi.fn((change:{text?:string;kind?:any})=>drafts.edit(owner.id,change));
  const renderer=createControlledRenderer(()=>{const value=drafts.getSnapshot()[owner.id];return createElement(Composer,{active:true,idPrefix:'workspace',value:value.text,kind:value.kind,onChange,disabled:false,running:false,onRun,onStop,onConfigure:()=>{},suggestions,suggestionsCurrent:(basis,text)=>drafts.getSnapshot()[owner.id]===guardDraft&&guardDraft.text===text&&responsePromptSuggestionsCurrent(owner,basis)});});renderer.render();renderer.find(node=>node.type==='button'&&node.props.children===suggestions.prompts[0]).props.onClick();expect(onChange).toHaveBeenCalledExactlyOnceWith({text:suggestions.prompts[0]});await drafts.flush(owner.id);
  drafts.edit(owner.id,{text:suggestions.prompts[0]+'\n  My edit 日本語 👩🏽‍🚀  '});await drafts.flush(owner.id);const accepted=drafts.getSnapshot()[owner.id];expect(accepted.kind).toBe('create');expect(onRun).not.toHaveBeenCalled();expect(onStop).not.toHaveBeenCalled();await core.close();core=await createCompanion({dataDir:directory});owner=await core.getTask(created.id);expect(readComposerDraft(owner.session)).toMatchObject(accepted);expect(owner.requests).toEqual(before.requests);expect(owner.artifacts).toEqual(before.artifacts);expect(owner.sources).toEqual(before.sources);expect(owner.session?.queuedFollowups).toEqual(before.session?.queuedFollowups);expect((await core.listTasks()).map(t=>t.id).sort()).toEqual([created.id,other.id].sort());expect(readComposerDraft((await core.getTask(other.id)).session)).toEqual(readComposerDraft(originalOther.session));
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('accepted autocomplete remains editable with existing quote shortcut and native spell-check controls',()=>{
 const h=setup('Explain ');h.focus();expect(h.key().preventDefault).toHaveBeenCalledOnce();h.renderer.render();
 dom.input.selectionStart=0;dom.input.selectionEnd=h.value().length;
 const quoted=h.key('l',{metaKey:true});expect(quoted.preventDefault).toHaveBeenCalledOnce();expect(h.value()).toBe('> '+prompt);expect(h.onRun).not.toHaveBeenCalled();expect(h.onStop).not.toHaveBeenCalled();
 h.renderer.render();expect(h.input().props.spellCheck).toBe(true);
 const field=h.renderer.find(node=>node.type==='label'&&node.children.some(child=>child.props.text==='Native spell-check'));
 field.children.find(child=>child.type==='input')!.props.onChange({currentTarget:{checked:false}});h.renderer.render();expect(h.input().props.spellCheck).toBe(false);
});

test('a real long CJK response prefix offers its entire remaining suffix in the visible completion region before Tab',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-followup-visible-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Long heading response'});
  await core.runRequest({taskId:task.id,requestId:'long-heading',kind:'explain',prompt:'Explain this concept',sourceIds:[]},async()=>({title:'Answer',content:'## '+'界'.repeat(100)+'\nReal saved response text.'}));
  const offer=responsePromptSuggestions(await core.getTask(task.id))!,full=offer.prompts[0],h=setup(full.slice(0,-1),offer);h.focus();
  const completion=h.renderer.find(node=>node.props.className==='composer-completion');expect(completion.type).toBe('p');expect(completion.props.role).toBe('status');expect(completion.props['aria-hidden']).toBeUndefined();
  expect(completion.children.find(child=>child.type==='span')!.children[0].props.text).toBe('.');expect(completion.children.find(child=>child.type==='kbd')!.children[0].props.text).toBe('Tab');
  expect(h.key().preventDefault).toHaveBeenCalledOnce();expect(h.changes).toHaveBeenCalledExactlyOnceWith({text:full});expect(h.onRun).not.toHaveBeenCalled();
  const all=setup('',offer);all.focus();expect(all.renderer.find(node=>node.props.className==='composer-completion').children.find(child=>child.type==='span')!.children[0].props.text).toBe(full);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
