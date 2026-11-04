import {isSourceIntakeCommand} from '../../src/shared/source-intake';
import {reconcileTaskResponseModes} from '../../src/shared/task-response-mode';
import ts from 'typescript';
import {createOrdinaryTaskRequests} from '../../src/renderer/src/ordinary-task-requests';
import {isConcurrentOrdinary,INDEPENDENT_TASK_LIMIT} from '../../src/shared/task-concurrency';
/** Existing App extractor tests keep their own React/bridge delivery semantics.
 * Add the real new concurrency dependencies, retaining all original assertions. */
export function withOrdinaryAppBindings(file:ts.SourceFile,environment:Record<string,any>){
 const values:Record<string,any>={isSourceIntakeCommand,reconcileTaskResponseModes,setEditingBotId:()=>{},newQuestionEpoch:{current:0},incomingActivationEpoch:{current:0},surfaceIntentEpoch:{current:0},ordinaryRequests:createOrdinaryTaskRequests(),operationBusy:false,isConcurrentOrdinary,INDEPENDENT_TASK_LIMIT,taskListSnapshot:{current:{generation:0,read:0,acceptedRead:0,tasks:[]}},scopeRef:{current:{}},sourceSelectionLocks:{current:new Set<string>()},requestRef:{current:undefined},...environment},names=['taskRunning','ordinaryTaskCount','ordinaryTaskReady'],found:string[]=[];
 const visit=(node:ts.Node)=>{if(ts.isFunctionDeclaration(node)&&node.body&&node.name&&names.includes(node.name.text))found.push(node.getText(file));ts.forEachChild(node,visit);};visit(file);if(found.length!==names.length)throw Error('Actual App concurrency helper missing.');
 const javascript=ts.transpileModule(found.join('\n')+'\nreturn {'+names.join(',')+'};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 return {...values,...Function(...Object.keys(values),javascript)(...Object.values(values))};
}
