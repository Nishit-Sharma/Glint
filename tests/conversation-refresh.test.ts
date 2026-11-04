import {withOrdinaryAppBindings} from './concurrent-app-bindings.fixture';
import {expect,test,vi} from 'vitest';
vi.mock('lucide-react',()=>({RefreshCw:()=>null}));
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import {createCompanion} from '../src/core/companion';
import type {Task} from '../src/core/types';
import type {Command} from '../src/shared/bridge';
import {createComposerDrafts,type SaveComposerDraft} from '../src/renderer/src/composer-drafts';
import {ConversationRefresh} from '../src/renderer/src/components/ConversationRefresh';
import {createControlledRenderer} from './controlled-renderer.fixture';

const file=ts.createSourceFile('App.tsx',readFileSync(new URL('../src/renderer/src/App.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function javascript(source:string){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;}
function declaration(name:string){let found:ts.FunctionDeclaration|undefined;const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);};visit(file);if(!found)throw Error('Missing actual App function '+name);return javascript('('+found.getText(file)+')');}
function task(id='task'):Task{return {id,title:'Saved conversation',goal:'',status:'active',createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',sources:[],requests:[],artifacts:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{revision:1,draft:'Saved draft',draftRevision:1,draftKind:'explain',runs:[],moduleStates:[]}};}
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
type Feedback={navigation:number;pending:boolean;error?:string;message?:string};

/** Real App declarations and refresh JSX; controlled host delivery, real draft cache. */
function harness(initial=task(),drafts=createComposerDrafts(async(_id,revision,value)=>({...value,revision:revision+1}))){
 let feedback:Record<string,Feedback>={},tasks=[initial];
 const taskRef={current:initial as Task|undefined},taskListSnapshot={current:{generation:0,read:0,tasks}},newQuestionEpoch={current:0},viewSelectionEpoch={current:0},incomingActivationEpoch={current:0},deletedTaskIds={current:new Set<string>()};
 const invoke=vi.fn<(command:Command)=>Promise<unknown>>().mockRejectedValue(Error('Unexpected command'));
 const bindings={taskRef,taskListSnapshot,newQuestionEpoch,viewSelectionEpoch,incomingActivationEpoch,deletedTaskIds,bridge:{invoke},drafts,messageRefreshLocks:{current:new Set<string>()},setMessageRefresh:(update:(previous:Record<string,Feedback>)=>Record<string,Feedback>)=>{feedback=update(feedback);},setTaskValue:vi.fn(),setTasks:vi.fn((next:Task[])=>{tasks=next;}),requestRef:{current:undefined},arrivedRequests:{current:new Set<string>()},viewRestored:{current:true},setTasksHydrated:vi.fn(),setError:vi.fn()};
 const make=(name:string,extras:Record<string,unknown>={})=>{const environment=withOrdinaryAppBindings(file,{...bindings,...extras});return Function(...Object.keys(environment),'return '+declaration(name))(...Object.values(environment));};
 const setTask=make('setTask') as (next:Task|undefined)=>void,refresh=make('refresh',{setTask}) as ()=>Promise<void>,refreshConversation=make('refreshConversation',{setTask}) as ()=>Promise<void>,saveComposerDraft=make('saveComposerDraft',{refresh}) as SaveComposerDraft;
 drafts.hydrate([initial]);
 let entry:ts.JsxSelfClosingElement|undefined;const visit=(node:ts.Node)=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='ConversationRefresh')entry=node;ts.forEachChild(node,visit);};visit(file);if(!entry)throw Error('No reachable actual refresh entry');
 function props(){const environment={task:taskRef.current,messageRefresh:feedback,newQuestionEpoch,refreshConversation},props:Record<string,unknown>={};for(const property of entry!.attributes.properties){if(ts.isJsxAttribute(property)&&property.initializer&&ts.isJsxExpression(property.initializer)&&property.initializer.expression)props[property.name.getText(file)]=Function(...Object.keys(environment),'return '+javascript('('+property.initializer.expression.getText(file)+')'))(...Object.values(environment));}return props as Parameters<typeof ConversationRefresh>[0];}
 const renderer=createControlledRenderer(()=>createElement(ConversationRefresh,props()));
 const text=(node:ReturnType<typeof renderer.nodes>[number]):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 return {...bindings,refresh,refreshConversation,saveComposerDraft,setTask,props,renderer,text,drafts,feedback:()=>feedback,task:()=>taskRef.current,tasks:()=>tasks};
}

test('actual reachable refresh button waits on tasks.get, announces progress, and locks duplicate invocation',async()=>{
 const h=harness(),held=deferred<Task>();h.bridge.invoke.mockReturnValue(held.promise);h.renderer.render();
 const button=()=>h.renderer.find(node=>node.type==='button');expect(button().props.type).toBe('button');expect(h.text(button())).toBe('Refresh saved messages');button().props.onClick();h.renderer.render();
 expect(h.bridge.invoke.mock.calls).toEqual([[{type:'tasks.get',taskId:'task'}]]);expect(button().props.disabled).toBe(true);expect(h.text(button())).toBe('Refreshing saved messages…');
 const status=h.renderer.find(node=>node.props.role==='status');expect(h.text(status)).toBe('Refreshing saved messages…');expect(status.props['aria-live']).toBe('polite');expect(status.props['aria-atomic']).toBe('true');
 await h.refreshConversation();expect(h.bridge.invoke).toHaveBeenCalledTimes(1);expect(h.task()).toBe(h.taskRef.current);
 const updated={...task(),title:'Reloaded title',checkpoints:[{id:'note',note:'Saved activity',sourceRefs:[],artifacts:[],createdAt:'2026-11-02T01:00:00Z'}]};held.resolve(updated);await vi.waitFor(()=>expect(h.feedback().task.pending).toBe(false));h.renderer.render();
 expect(h.task()).toBe(updated);expect(h.taskRef.current).toBe(updated);expect(h.tasks()).toEqual([updated]);expect(h.taskListSnapshot.current.generation).toBe(1);expect(h.text(h.renderer.find(node=>node.props.role==='status'))).toBe('Saved messages refreshed.');expect(button().props.disabled).toBe(false);
});

test('actual get rejection retains history and draft, exposes retry, and a new read can succeed',async()=>{
 const initial={...task(),checkpoints:[{id:'note',note:'Keep history',sourceRefs:[],artifacts:[],createdAt:'2026-11-02T01:00:00Z'}]},h=harness(initial);h.bridge.invoke.mockRejectedValueOnce(Error('Unavailable')).mockResolvedValueOnce({...initial,title:'Retry result'});
 await h.refreshConversation();h.renderer.render();expect(h.task()).toBe(initial);expect(h.tasks()).toEqual([initial]);expect(h.drafts.getSnapshot().task.text).toBe('Saved draft');expect(h.text(h.renderer.find(node=>node.props.role==='alert'))).toContain('could not be refreshed');expect(h.text(h.renderer.find(node=>node.type==='button'))).toBe('Retry refreshing saved messages');
 await h.refreshConversation();expect(h.task()?.title).toBe('Retry result');expect(h.feedback().task.error).toBeUndefined();expect(h.bridge.invoke).toHaveBeenCalledTimes(2);expect(h.task()?.checkpoints).toEqual(initial.checkpoints);
});

test('refresh hydration preserves unsent edits while real draft persistence is held',async()=>{
 const save=deferred<{text:string;kind:'explain';revision:number}>(),drafts=createComposerDrafts(()=>save.promise),h=harness(task(),drafts),held=deferred<Task>();h.bridge.invoke.mockReturnValue(held.promise);
 drafts.edit('task',{text:'My unsent question'});const reading=h.refreshConversation();drafts.edit('task',{text:'My latest unsent question'});held.resolve({...task(),session:{...task().session!,revision:2,draft:'Old durable draft'}});await reading;
 expect(drafts.getSnapshot().task.text).toBe('My latest unsent question');expect(h.task()?.session?.draft).toBe('Old durable draft');save.resolve({text:'My latest unsent question',kind:'explain',revision:2});await drafts.flush('task');expect(drafts.getSnapshot().task.text).toBe('My latest unsent question');
});

test.each(['navigation','selection','activation','deletion','same-owner-publication','away-and-back'] as const)('held get cannot overwrite newer %s state before React commits',async change=>{
 const initial=task(),h=harness(initial),held=deferred<Task>();h.bridge.invoke.mockReturnValue(held.promise);const reading=h.refreshConversation(),newer={...initial,title:'New live task'};
 if(change==='navigation')h.newQuestionEpoch.current++;else if(change==='selection')h.viewSelectionEpoch.current++;else if(change==='activation')h.incomingActivationEpoch.current++;else if(change==='deletion')h.deletedTaskIds.current.add(initial.id);else if(change==='same-owner-publication')h.setTask(newer);else {h.setTask(task('other'));h.setTask(initial);}
 held.resolve({...initial,title:'Stale read'});await reading;expect(h.task()?.title).toBe(change==='same-owner-publication'?'New live task':'Saved conversation');expect(h.feedback().task).toEqual({navigation:0,pending:false});expect(h.taskListSnapshot.current.generation).toBe(0);
 if(change==='same-owner-publication')expect(h.setTaskValue).toHaveBeenCalledWith(newer);
});

test('navigation retires an old failure and keeps a newly selected conversation usable',async()=>{
 const h=harness(),held=deferred<Task>();h.bridge.invoke.mockReturnValueOnce(held.promise).mockResolvedValueOnce(task('other'));const old=h.refreshConversation();h.newQuestionEpoch.current++;h.viewSelectionEpoch.current++;h.setTask(task('other'));
 await h.refreshConversation();held.reject(Error('Old failure'));await old;expect(h.task()?.id).toBe('other');expect(h.feedback().task.error).toBeUndefined();expect(h.feedback().other.pending).toBe(false);expect(h.props().error).toBeUndefined();expect(h.props().pending).toBe(false);
});

test('a newer accepted changed-event list wins over a held get',async()=>{
 const h=harness(),get=deferred<Task>(),list=deferred<Task[]>();h.bridge.invoke.mockImplementation(command=>command.type==='tasks.get'?get.promise:list.promise);
 const reading=h.refreshConversation(),updating=h.refresh(),newer={...task(),title:'Live update'};list.resolve([newer]);await updating;get.resolve({...task(),title:'Older get'});await reading;expect(h.task()).toBe(newer);expect(h.feedback().task.pending).toBe(false);
});

test('a successful get protects its accepted state from an older delayed list reply',async()=>{
 const h=harness(),get=deferred<Task>(),list=deferred<Task[]>();h.bridge.invoke.mockImplementation(command=>command.type==='tasks.get'?get.promise:list.promise);
 const listing=h.refresh(),reading=h.refreshConversation(),newer={...task(),title:'Fresh saved messages'};get.resolve(newer);await reading;list.resolve([{...task(),title:'Old list'}]);await listing;expect(h.task()).toBe(newer);expect(h.tasks()).toEqual([newer]);expect(h.taskListSnapshot.current.generation).toBe(1);
});

test('an older accepted list does not retire a newer successful get',async()=>{
 const h=harness(),get=deferred<Task>(),list=deferred<Task[]>();h.bridge.invoke.mockImplementation(command=>command.type==='tasks.get'?get.promise:list.promise);const listing=h.refresh(),reading=h.refreshConversation();list.resolve([{...task(),title:'Earlier list'}]);await listing;const updated={...task(),title:'Newer saved messages'};get.resolve(updated);await reading;expect(h.task()).toBe(updated);expect(h.tasks()).toEqual([updated]);
});

test('a later failed list does not suppress a successful get with no newer accepted publication',async()=>{
 const h=harness(),get=deferred<Task>(),list=deferred<Task[]>();h.bridge.invoke.mockImplementation(command=>command.type==='tasks.get'?get.promise:list.promise);const reading=h.refreshConversation(),listing=h.refresh().catch(()=>undefined),updated={...task(),title:'Successfully refreshed messages'};get.resolve(updated);await reading;list.reject(Error('Later read unavailable'));await listing;expect(h.task()).toBe(updated);expect(h.tasks()).toEqual([updated]);expect(h.feedback().task.message).toBe('Saved messages refreshed.');
});

test('a failing explicit get must not retire a held postcommit list needed to publish a completed answer',async()=>{
 const h=harness(),get=deferred<Task>(),list=deferred<Task[]>();h.bridge.invoke.mockImplementation(command=>command.type==='tasks.get'?get.promise:list.promise);
 const postcommit=h.refresh(),reading=h.refreshConversation(),completed={...task(),title:'Completed saved answer'};list.resolve([completed]);await postcommit;get.reject(Error('Read failed'));await reading;expect(h.task()).toBe(completed);expect(h.tasks()).toEqual([completed]);expect(h.feedback().task.pending).toBe(false);
});

test('older overlapping list responses cannot overwrite the latest accepted list',async()=>{
 const h=harness(),first=deferred<Task[]>(),second=deferred<Task[]>();h.bridge.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const a=h.refresh(),b=h.refresh(),latest={...task(),title:'Latest list'};second.resolve([latest]);await b;first.resolve([{...task(),title:'Stale list'}]);await a;expect(h.task()).toBe(latest);expect(h.tasks()).toEqual([latest]);
});

test('a newer failed background list must not suppress a successful postcommit list publication',async()=>{
 const h=harness(),first=deferred<Task[]>(),second=deferred<Task[]>();h.bridge.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const postcommit=h.refresh(),background=h.refresh().catch(()=>undefined),completed={...task(),title:'Completed answer stays visible'};first.resolve([completed]);await postcommit;second.reject(Error('Background read unavailable'));await background;expect(h.task()).toBe(completed);expect(h.tasks()).toEqual([completed]);
});

test.each(['foreign','archived'] as const)('rejects %s get results without replacing the current transcript',async kind=>{
 const h=harness(),updated=kind==='foreign'?task('foreign'):{...task(),archive:{archivedAt:'2026-11-02T01:00:00Z',previousStatus:'active'}};h.bridge.invoke.mockResolvedValue(updated);await h.refreshConversation();expect(h.task()?.id).toBe('task');expect(h.feedback().task.error).toContain('could not be refreshed');
});

test('pending refresh uses the existing mounted Conversation busy region with live feedback outside it',()=>{
 let conversation:ts.JsxSelfClosingElement|undefined;const visit=(node:ts.Node)=>{if(ts.isJsxSelfClosingElement(node)&&node.tagName.getText(file)==='Conversation')conversation=node;ts.forEachChild(node,visit);};visit(file);expect(conversation).toBeDefined();
 const property=conversation!.attributes.properties.find(property=>ts.isJsxAttribute(property)&&property.name.getText(file)==='refreshing') as ts.JsxAttribute;
 expect(property.initializer?.getText(file)).toContain('messageRefresh[task.id]?.pending');expect(conversation!.attributes.properties.some(property=>ts.isJsxAttribute(property)&&property.name.getText(file)==='key')).toBe(false);
 const source=readFileSync(new URL('../src/renderer/src/components/Conversation.tsx',import.meta.url),'utf8');expect(source).toContain('aria-busy={refreshing||undefined}');
 const component=readFileSync(new URL('../src/renderer/src/components/ConversationRefresh.tsx',import.meta.url),'utf8');expect(component).not.toContain('aria-busy');expect(component).not.toContain('setTimeout');
});

test('production refresh reloads real saved messages from the existing core get route and retains unsent composer text',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-message-refresh-')),core=await createCompanion({dataDir:directory});try{
  const created=await core.createTask({title:'Saved conversation'});await core.saveComposerDraft(created.id,0,{text:'Unsent local question',kind:'explain'});const before=await core.getTask(created.id),h=harness(before),provider=vi.fn(async()=>({title:'Saved reply',content:'A reply saved after this conversation opened.'}));
  await core.runRequest({taskId:created.id,requestId:randomUUID(),kind:'explain',prompt:'Saved question',sourceIds:[]},provider);
  h.bridge.invoke.mockImplementation(command=>{if(command.type!=='tasks.get')throw Error('Unexpected authority '+command.type);return core.getTask(command.taskId);});await h.refreshConversation();
  expect(h.task()?.requests).toHaveLength(1);expect(h.task()?.requests[0].prompt).toBe('Saved question');expect(h.task()?.requests[0].status).toBe('completed');expect(h.task()?.artifacts[0].revisions[0].content).toBe('A reply saved after this conversation opened.');expect(h.drafts.getSnapshot()[created.id].text).toBe('Unsent local question');expect(h.bridge.invoke.mock.calls).toEqual([[{type:'tasks.get',taskId:created.id}]]);expect(provider).toHaveBeenCalledTimes(1);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('actual App autosave publishes current task/session identity and preserves unsent composer text',async()=>{
 const initial=task(),h=harness(initial),saved={text:'Unsent question',kind:'explain' as const,revision:2},updated={...initial,updatedAt:'2026-11-03T01:00:00Z',session:{...initial.session!,revision:2,draft:saved.text,draftRevision:2}},held=deferred<Task[]>();h.bridge.invoke.mockImplementation(command=>command.type==='draft.save'?Promise.resolve(saved):held.promise);
 const cache=createComposerDrafts(h.saveComposerDraft);cache.hydrate([initial]);cache.edit(initial.id,{text:saved.text});await vi.waitFor(()=>expect(h.bridge.invoke).toHaveBeenCalledWith({type:'tasks.list'}));expect(h.task()).toBe(initial);held.resolve([updated]);await cache.flush();expect(h.task()).toBe(updated);expect(h.tasks()).toEqual([updated]);expect(cache.getSnapshot().task.text).toBe(saved.text);expect(h.setError).not.toHaveBeenCalled();
 expect(file.getText()).toContain('createComposerDrafts(saveComposerDraft,');
});

test('a context refresh failure after successful autosave retains the durable acknowledgement and reports the distinct recovery',async()=>{
 const h=harness(),saved={text:'Saved unsent message',kind:'explain' as const,revision:2};h.bridge.invoke.mockImplementation(command=>command.type==='draft.save'?Promise.resolve(saved):Promise.reject(Error('Read unavailable')));await expect(h.saveComposerDraft('task',1,saved)).resolves.toEqual(saved);expect(h.setError).toHaveBeenCalledWith(expect.stringContaining('Your message was saved.'));expect(h.task()?.session?.draft).toBe('Saved draft');
});

test('a held autosave refreshes the currently selected task without returning navigation to its original owner',async()=>{
 const initial=task(),other=task('other'),h=harness(initial),held=deferred<unknown>(),saved={text:'Owned unsent message',kind:'explain' as const,revision:2};h.bridge.invoke.mockImplementation(command=>command.type==='draft.save'?held.promise:Promise.resolve([{...initial,session:{...initial.session!,revision:2,draft:saved.text,draftRevision:2}},other]));const saving=h.saveComposerDraft(initial.id,1,saved);h.setTask(other);held.resolve(saved);await saving;expect(h.task()).toBe(other);expect(h.task()?.id).toBe('other');expect(h.setError).not.toHaveBeenCalled();
});

test('a rejected draft save never refreshes or claims the message was saved',async()=>{
 const h=harness();h.bridge.invoke.mockRejectedValue(Error('Save rejected'));await expect(h.saveComposerDraft('task',1,{text:'Unsent',kind:'explain'})).rejects.toThrow('Save rejected');expect(h.bridge.invoke).toHaveBeenCalledTimes(1);expect(h.setError).not.toHaveBeenCalled();
});
