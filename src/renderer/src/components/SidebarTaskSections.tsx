import {useEffect,useLayoutEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import type {Task} from '../../../core/types';
import {readTaskSectionsState,type TaskSectionChange,type TaskSectionsCommand,type TaskSectionsState} from '../../../shared/task-sections';
import {useNavigationDraft} from '../draft-navigation';
import './sidebar-task-sections.css';

type Editor={token:number;kind:'create'|'rename';sectionId:string;name:string;initialName:string;taskId?:string};
type Moving={taskId:string;title:string;target:string;initialTarget:string};
type Props={tasks:readonly Task[];allTasks:readonly Task[];renderTask:(task:Task)=>ReactNode;invoke?:(command:TaskSectionsCommand)=>Promise<unknown>};
const invokeDefault=(command:TaskSectionsCommand)=>window.companion.invoke(command);
const normalize=(name:string)=>name.trim().normalize('NFC');

/** Saved sections are independent of task/project/pin data. Render the supplied
 * filtered/ordered page; never turn unseen task IDs into unavailable tasks. */
export function SidebarTaskSections({tasks,allTasks,renderTask,invoke=invokeDefault}:Props){
 const [state,setState]=useState<TaskSectionsState>(),[editor,setEditor]=useState<Editor>(),[moving,setMoving]=useState<Moving>(),[pending,setPending]=useState(false),[blocked,setBlocked]=useState(false),[message,setMessage]=useState('');
 const saved=useRef(state),edit=useRef(editor),move=useRef(moving),lock=useRef<false|'read'|'write'>(false),held=useRef(false),alive=useRef(true),generation=useRef(0);saved.current=state;edit.current=editor;move.current=moving;
 const root=useRef<HTMLElement>(null),nameField=useRef<HTMLInputElement>(null),destinationField=useRef<HTMLSelectElement>(null),newSectionButton=useRef<HTMLButtonElement>(null),trigger=useRef<HTMLElement|undefined>(undefined),triggerTask=useRef<string|undefined>(undefined),focusedEditor=useRef(''),restoreFocus=useRef(false);
 const rememberTrigger=(element?:HTMLElement,taskId?:string)=>{trigger.current=element;triggerTask.current=taskId;};
 function focusAndReveal(element:HTMLElement|undefined|null){
  if(!element?.isConnected||element.closest('[hidden],[inert]')||element.matches(':disabled'))return false;
  const bounds=element.getBoundingClientRect();if(!bounds.width||!bounds.height)return false;
  element.focus({preventScroll:true});const pane=root.current?.closest<HTMLElement>('.task-sidebar-task-list');
  if(pane){const viewport=pane.getBoundingClientRect(),panel=element.closest<HTMLElement>('.sidebar-section-editor'),panelBounds=panel?.getBoundingClientRect(),target=panelBounds&&panelBounds.height<viewport.height-16?panelBounds:bounds;if(target.top<viewport.top+8)pane.scrollTop-=viewport.top+8-target.top;else if(target.bottom>viewport.bottom-8)pane.scrollTop+=target.bottom-viewport.bottom+8;}
  return element.ownerDocument.activeElement===element;
 }
 useLayoutEffect(()=>{
  const identity=editor?'editor:'+editor.token:moving?'move:'+moving.taskId:'';
  if(identity&&identity!==focusedEditor.current){focusedEditor.current=identity;focusAndReveal(editor?nameField.current:destinationField.current);}
  else if(!identity&&!pending&&(focusedEditor.current||restoreFocus.current)){
   focusedEditor.current='';restoreFocus.current=false;
   const currentTaskControl=triggerTask.current?[...(root.current?.querySelectorAll<HTMLButtonElement>('[data-section-move-task]')??[])].find(element=>element.dataset.sectionMoveTask===triggerTask.current):undefined;
   if(!focusAndReveal(currentTaskControl)&&!focusAndReveal(trigger.current))focusAndReveal(newSectionButton.current);
  }
 },[editor?.token,moving?.taskId,pending]);
 const hold=(value:boolean)=>{held.current=value;setBlocked(value);};
 const replaceEditor=(value:Editor|undefined)=>{edit.current=value;setEditor(value);};
 const replaceMoving=(value:Moving|undefined)=>{move.current=value;setMoving(value);};
 const discard=()=>{generation.current++;restoreFocus.current=true;replaceEditor(undefined);replaceMoving(undefined);};
 const dirty=!!editor&&editor.name!==editor.initialName||!!moving&&moving.target!==moving.initialTarget;
 const clearDraft=useNavigationDraft(dirty||pending&&lock.current==='write',discard);
 const accept=(next:TaskSectionsState)=>{saved.current=next;setState(next);};
 async function load(){
  if(lock.current)return;lock.current='read';setPending(true);
  try{
   const next=readTaskSectionsState(await invoke({type:'task-sections.get'}));if(!alive.current)return;accept(next);
   if(next.kind!=='available'){hold(true);setMessage(next.message);return;}
   hold(false);const form=edit.current,current=form&&next.sections.find(item=>item.id===form.sectionId);
   if(form&&current&&current.name===normalize(form.name)&&(!form.taskId||current.taskIds.includes(form.taskId))){discard();clearDraft();setMessage('The original section change is saved.');}
   else setMessage('Saved sections loaded. Any unfinished choice is still here.');
  }catch{if(alive.current){hold(true);setMessage('Sections could not be read. Your choice is kept. Reload before saving.');}}
  finally{lock.current=false;if(alive.current)setPending(false);}
 }
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;generation.current++;};},[]);
 async function change(value:TaskSectionChange['change'],form?:Editor,selection?:Moving){
  const basis=saved.current;if(lock.current||held.current||basis?.kind!=='available'||form&&edit.current!==form||selection&&move.current!==selection||!form&&!selection&&(edit.current||move.current))return;
  lock.current='write';setPending(true);setMessage('');
  try{
   const next=readTaskSectionsState(await invoke({type:'task-sections.change',expectedRevision:basis.revision,change:value}));
   if(!alive.current)return;accept(next);
   if(next.kind!=='available'){hold(true);setMessage(next.message);return;}
   if((!form||edit.current===form)&&(!selection||move.current===selection)){discard();clearDraft();setMessage(value.kind==='remove'?'Section removed. Its tasks are Unassigned; no tasks were deleted.':'Sidebar organization saved. Task content and pins are unchanged.');}
  }catch{if(alive.current){hold(true);setMessage('The section change could not be confirmed. Your choice is kept. Reload saved sections before another change.');}}
  finally{lock.current=false;if(alive.current)setPending(false);}
 }
 const locked=pending||blocked||state?.kind!=='available';
 function beginCreate(taskId?:string,element?:HTMLElement){if(lock.current||held.current||locked||edit.current||move.current)return;rememberTrigger(element,taskId);generation.current++;replaceEditor({token:generation.current,kind:'create',sectionId:crypto.randomUUID(),name:'',initialName:'',...(taskId?{taskId}:{})});setMessage('');}
 function beginMove(task:Task,element?:HTMLElement){if(lock.current||held.current||locked||edit.current||move.current)return;rememberTrigger(element,task.id);const basis=saved.current,section=basis?.kind==='available'?basis.sections.find(item=>item.taskIds.includes(task.id)):undefined,target=section?'section:'+section.id:'';replaceMoving({taskId:task.id,title:task.title,target,initialTarget:target});setMessage('');}
 function rename(sectionId:string,name:string,element?:HTMLElement){if(lock.current||held.current||locked||edit.current||move.current)return;rememberTrigger(element);generation.current++;replaceEditor({token:generation.current,kind:'rename',sectionId,name,initialName:name});setMessage('');}
 function save(event:FormEvent,form:Editor){
  event.preventDefault();if(edit.current!==form||lock.current||held.current)return;const name=normalize(form.name);
  if(!name||name.length>80||/[\p{Cc}\p{Cf}]/u.test(name)){setMessage('Enter a section name of 1–80 characters without control characters.');return;}
  void change(form.kind==='rename'?{kind:'rename',sectionId:form.sectionId,name}:{kind:'create',sectionId:form.sectionId,name,...(form.taskId?{taskId:form.taskId}:{})},form);
 }
 function saveMove(selection:Moving){
  if(move.current!==selection||lock.current||held.current||locked)return;
  if(!allTasks.some(task=>task.id===selection.taskId)){setMessage('This task is no longer in the current task list. Cancel and reload tasks.');return;}
  if(selection.target==='new'){
   generation.current++;replaceMoving(undefined);replaceEditor({token:generation.current,kind:'create',sectionId:crypto.randomUUID(),name:'',initialName:'',taskId:selection.taskId});return;
  }
  void change({kind:'move',taskId:selection.taskId,sectionId:selection.target?selection.target.slice('section:'.length):null},undefined,selection);
 }
 const sections=state?.kind==='available'?state.sections:[],assigned=new Set(sections.flatMap(item=>item.taskIds));
 const rows=(items:readonly Task[])=>items.map(task=><li className="sidebar-section-task" key={task.id} onContextMenu={event=>{if(!locked&&!editor&&!moving){event.preventDefault();beginMove(task,event.currentTarget.querySelector<HTMLButtonElement>('.sidebar-section-move')??undefined);}}}>{renderTask(task)}<button type="button" className="sidebar-section-move" data-section-move-task={task.id} aria-label={'Move '+task.title+' to section'} disabled={locked||!!editor||!!moving} onClick={event=>beginMove(task,event?.currentTarget)}>Move</button></li>);
 return <nav ref={root} aria-label="Saved tasks">
  <div className="sidebar-section-tools"><strong>Tasks</strong><button ref={newSectionButton} type="button" disabled={locked||!!editor||!!moving||sections.length>=100} onClick={event=>beginCreate(undefined,event?.currentTarget)}>New section</button><button type="button" disabled={pending} onClick={()=>void load()}>Reload sections</button></div>
  {message&&<p className="task-sidebar-empty" role={blocked?'alert':'status'}>{message}</p>}
  {editor&&<form className="sidebar-section-editor" aria-label={editor.kind==='rename'?'Rename sidebar section':'Create sidebar section'} onSubmit={event=>save(event,editor)}>
   <label>Section name<input ref={nameField} maxLength={80} value={editor.name} disabled={locked} onChange={event=>{if(!lock.current&&edit.current===editor)replaceEditor({...editor,name:event.currentTarget.value});}}/></label>
   {editor.taskId&&<p>This creates the section and moves the chosen task into it.</p>}
   <div><button type="submit" disabled={locked||!normalize(editor.name)}>{editor.kind==='rename'?'Save section name':'Create section'}</button><button type="button" disabled={pending} onClick={()=>{if(lock.current||edit.current!==editor)return;discard();clearDraft();setMessage('Unfinished section change cancelled.');}}>Cancel section</button></div>
  </form>}
  {moving&&<div className="sidebar-section-editor" role="group" aria-label={'Move '+moving.title+' to section'}><label>Destination section<select ref={destinationField} value={moving.target} disabled={locked} onChange={event=>{if(!lock.current&&move.current===moving)replaceMoving({...moving,target:event.currentTarget.value});}}><option value="">Unassigned</option>{sections.map(item=><option key={item.id} value={'section:'+item.id}>{item.name}</option>)}<option value="new">New section…</option></select></label><div><button type="button" disabled={locked} onClick={()=>saveMove(moving)}>Move task</button><button type="button" disabled={pending} onClick={()=>{if(lock.current||move.current!==moving)return;discard();clearDraft();}}>Cancel move</button></div></div>}
  {sections.map(section=>{const matching=tasks.filter(task=>section.taskIds.includes(task.id)),missing=state?.kind==='available'?section.taskIds.filter(id=>state.unavailableTaskIds.includes(id)):[];return <section key={section.id} className="sidebar-task-section" aria-label={'Task section '+section.name}><div className="sidebar-section-heading"><h3>{section.name}</h3><button type="button" disabled={locked||!!editor||!!moving} aria-label={'Rename section '+section.name} onClick={event=>rename(section.id,section.name,event?.currentTarget)}>Rename</button><button type="button" disabled={locked||!!editor||!!moving} aria-label={'Remove section '+section.name+' and keep its tasks'} onClick={event=>{rememberTrigger(event?.currentTarget);void change({kind:'remove',sectionId:section.id});}}>Remove</button></div><small>{matching.length} shown · {section.taskIds.length} assigned</small>{missing.length>0&&<p className="task-sidebar-empty">{missing.length} saved task IDs are unavailable. Membership is kept until you explicitly remove this section.</p>}<ul>{rows(matching)}</ul>{!matching.length&&<p className="task-sidebar-empty">No tasks from this section match this view.</p>}</section>;})}
  <section className="sidebar-task-section" aria-label="Unassigned tasks"><h3>Unassigned</h3><ul>{rows(tasks.filter(task=>!assigned.has(task.id)))}</ul>{!tasks.some(task=>!assigned.has(task.id))&&<p className="task-sidebar-empty">No unassigned tasks in this view.</p>}</section>
 </nav>;
}
