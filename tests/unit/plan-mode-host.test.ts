import {TEACHBACK_MIME} from '../../src/shared/explanation-teachback';
import {DOCUMENT_SUGGESTIONS_MIME} from '../../src/shared/document-edit-suggestions';
import {prepareExplanationMode} from '../../src/host/explanation-modes';
import {prepareExplanationTeachback} from '../../src/host/explanation-teachback';
import {prepareDocumentSuggestions} from '../../src/host/document-edit-suggestions';
import {runOrdinaryQuestionRequest} from '../../src/host/request-question-runner';
import {createConversationMentionValidation} from '../../src/host/conversation-mention-validation';
import {expect,test,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
import {createCompanion} from '../../src/core/companion';
import {composeOrdinaryRequest,dispatchOrdinaryRequest} from '../../src/host/ordinary-request-composition';
import {taskResponseMode,PLAN_RESPONSE_GUIDANCE} from '../../src/shared/task-response-mode';
import {pendingFollowups} from '../../src/shared/queued-followup';
import type {QueuedFollowup} from '../../src/shared/queued-followup';

const file=ts.createSourceFile('index.ts',readFileSync(new URL('../../src/host/index.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const transpile=(source:string)=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
function declaration(name:string){let found:ts.FunctionDeclaration|undefined;const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found=node;ts.forEachChild(node,visit);};visit(file);if(!found)throw Error('Missing host function '+name);return found.getText(file);}
function modelRunCase(){let found:ts.Block|undefined;const visit=(node:ts.Node)=>{if(ts.isCaseClause(node)&&node.expression.getText(file)==="'model.run'"&&node.statements.length===1&&ts.isBlock(node.statements[0]))found=node.statements[0];ts.forEachChild(node,visit);};visit(file);if(!found)throw Error('Missing actual host model.run case');return transpile('(async function execute(c,queued,recurring)'+found.getText(file)+')');}

test('actual host freezes Plan before metadata waits and dispatches it through the existing folder-guidance ordinary route',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-plan-host-')),core=await createCompanion({dataDir:directory});try{
  const task=await core.createTask({title:'Host mode capture'});await core.setTaskResponseMode(task.id,0,'plan');let entered!:()=>void,release!:()=>void;const enteredPromise=new Promise<void>(done=>{entered=done;}),held=new Promise<void>(done=>{release=done;}),provider={status:async()=>({configured:true,provider:'Codex (temporary)'}),accountScope:async()=>'synthetic',run:vi.fn(async()=> 'Synthetic planned response')},folderGuidance={folderName:'Owned folder',relativePath:'instructions.md',reference:{artifactId:'folder-text',revision:1,digest:'b'.repeat(64)},text:'Retain folder instructions.'};
  const bindings={TEACHBACK_MIME,DOCUMENT_SUGGESTIONS_MIME,prepareExplanationMode,prepareExplanationTeachback,prepareDocumentSuggestions,runOrdinaryQuestionRequest,conversationMentions:createConversationMentionValidation({bots:async()=>{throw Error('Plain prompt must not read the bot catalog.');},routines:async()=>{throw Error('Plain prompt must not read schedules.');},skills:async()=>{throw Error('Plain prompt must not read skills.');}}),core:{getTask:(id:string)=>core.getTask(id),runRequest:core.runRequest.bind(core),assertRequestCurrent:core.assertRequestCurrent.bind(core),leaseUserMemory:async()=>undefined},keyEpoch:0,capturePrivacyEpoch:0,capturePrivacyAbort:new AbortController(),activeProvider:()=>provider,assertCurrentWork:()=>{},lifecycle:0,prepareCanvasGeneration:()=>undefined,prepareConceptMapGeneration:()=>undefined,prepareBriefActionPlan:()=>undefined,str:(value:string)=>value,taskResponseMode,instructionSkillSelection:()=>({revision:0,selection:null}),resolveTaskRequestInference:async()=>{entered();await held;return undefined;},responsePreferences:{lease:async()=>undefined},codeWorkspaces:{guidanceLease:async()=>({current:folderGuidance,signal:new AbortController().signal,scope:'folder-instructions:v1:'+'a'.repeat(64),check:async()=>{},assertCurrent:()=>{}})},selectedProvider:'codex',ordinaryTransmissionConsent:JSON.stringify([0,'codex','synthetic']),composeOrdinaryRequest,dispatchOrdinaryRequest,PLAN_RESPONSE_GUIDANCE,changed:()=>{},drainQueuedFollowups:()=>{},emit:()=>{},dialog:{showMessageBox:()=>{throw Error('A native Send dialog must not be used by this controlled test.');}}};
  const execute=Function(...Object.keys(bindings),'return '+modelRunCase())(...Object.values(bindings)),completion=execute({type:'model.run',taskId:task.id,requestId:'host-plan',kind:'explain',prompt:'Plan this safely',sourceIds:[]});await Promise.race([enteredPromise,completion.then(()=>{throw Error('Expected held metadata resolution.');})]);await core.setTaskResponseMode(task.id,1,'ordinary');release();const saved=await completion;
  expect(saved.requests[0].responseMode).toBe('plan');expect(saved.session.responseMode.mode).toBe('ordinary');expect(provider.run).toHaveBeenCalledTimes(1);const sent=provider.run.mock.calls[0] as unknown as [Record<string,any>];expect(sent[0].prompt).toContain(PLAN_RESPONSE_GUIDANCE);expect(JSON.parse(sent[0].taskContext).explicitFolderInstructions.text).toBe(folderGuidance.text);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});

test('actual queue-drain scope check receives the held Plan snapshot before ordinary dispatch',async()=>{
 const item:QueuedFollowup={id:'queued',revision:1,prompt:'Frozen plan',kind:'explain',createdAt:'time',sourceRefs:[],status:'queued',basis:'a'.repeat(64),scope:'b'.repeat(64),precedingRequestIds:[],responseMode:'plan'};let pending=true;
 const queuedScope=vi.fn(async(..._args:unknown[])=>({scope:item.scope,grant:'reviewed-session'})),command=vi.fn(async(..._args:unknown[])=>{pending=false;}),holdQueuedFollowups=vi.fn(),bindings={queueDrain:undefined,queueDrainRequested:false,quitting:false,contentBackupGate:{busy:false},pendingEffects:new Set<string>(),pendingFollowups,queuedScope,ordinaryTransmissionConsent:'reviewed-session',command,changed:()=>{},core:{listTasks:async()=>pending?[{id:'owner',requests:[],session:{queuedFollowups:[item]}}]:[],queuedFollowupBasis:async()=>item.basis,holdQueuedFollowups}};
 const controller=Function(...Object.keys(bindings),transpile(declaration('drainQueuedFollowups'))+'return {start:drainQueuedFollowups,get pending(){return queueDrain;}}')(...Object.values(bindings));controller.start();await controller.pending;expect(holdQueuedFollowups).not.toHaveBeenCalled();expect(queuedScope.mock.calls[0]).toEqual(['owner','Frozen plan',item.basis,undefined,null,{id:item.id,revision:item.revision},'plan',undefined]);expect(command.mock.calls[0][2]).toBe(item);
});
