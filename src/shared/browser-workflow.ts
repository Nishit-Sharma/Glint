import {Schema} from 'effect';
import type {Artifact,ArtifactRef,Task} from '../core/types';
import type {BrowserObservation} from '../core/task-session';

export const BROWSER_WORKFLOW_MIME='application/vnd.glint.browser-workflow+json';
const short=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(500));
const template=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(10_000));
const target=Schema.Struct({role:Schema.Literal('text','textarea','select','button','submit','link'),label:short});
const check=Schema.Union(
 Schema.Struct({kind:Schema.Literal('text'),contains:template}),
 Schema.Struct({kind:Schema.Literal('value'),target,equals:template}),
);
const action=Schema.Union(
 Schema.Struct({kind:Schema.Literal('fill','select'),target,value:template}),
 Schema.Struct({kind:Schema.Literal('click'),target,fields:Schema.Array(Schema.Struct({target,value:template})).pipe(Schema.maxItems(20))}),
);
const definition=Schema.Struct({
 schemaVersion:Schema.Literal(1),kind:Schema.Literal('authored-browser-workflow'),name:short,
 description:short,origin:short,pathPrefix:short,
 inputs:Schema.Array(Schema.Struct({key:short,label:short})).pipe(Schema.maxItems(8)),
 steps:Schema.Array(Schema.Struct({name:short,before:Schema.Array(check).pipe(Schema.minItems(1),Schema.maxItems(8)),action,after:Schema.Array(check).pipe(Schema.minItems(1),Schema.maxItems(8))})).pipe(Schema.minItems(1),Schema.maxItems(6)),
});
export type BrowserWorkflow=typeof definition.Type;
export type WorkflowTarget=typeof target.Type;
export type WorkflowCheck=typeof check.Type;
export type WorkflowInputs=Record<string,string>;
export type BrowserWorkflowRun={taskId:string;requestId:string;workflow:ArtifactRef;url:string;inputs:WorkflowInputs};
export type BrowserWorkflowSave={taskId:string;requestId:string;definition:BrowserWorkflow;artifact?:ArtifactRef};
export type BrowserWorkflowSaved={task:Task;artifactId:string;revision:number};
export type BrowserWorkflowRunResult={task:Task;requestId:string;status:string;error?:string};
const commandId=Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.filter(value=>!value.includes('\0')));
const artifactRef=Schema.Struct({artifactId:commandId,revision:Schema.Int.pipe(Schema.positive(),Schema.filter(Number.isSafeInteger)),digest:Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))});
const saveInput=Schema.Struct({taskId:commandId,requestId:commandId,definition,artifact:Schema.optional(artifactRef)});
const runInput=Schema.Struct({taskId:commandId,requestId:commandId,workflow:artifactRef,url:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(4000)),inputs:Schema.Record({key:Schema.String,value:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(10_000),Schema.filter(value=>!!value.trim()&&!value.includes('\0')))})});
export function readBrowserWorkflowSave(value:unknown):BrowserWorkflowSave{
 const input=Schema.decodeUnknownSync(saveInput,{onExcessProperty:'error'})(value);
 return {...input,definition:readBrowserWorkflow(input.definition)};
}
export function readBrowserWorkflowRun(value:unknown):BrowserWorkflowRun{
 const input=Schema.decodeUnknownSync(runInput,{onExcessProperty:'error'})(value),url=new URL(input.url);
 if(url.username||url.password||url.hash||input.url.includes('\0')||!(url.protocol==='https:'||url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Choose a supported fresh browser target without sign-in details or a fragment.');
 if(Object.keys(input.inputs).length>8||Object.keys(input.inputs).some(key=>! /^[a-z][a-z0-9_]{0,39}$/.test(key))||JSON.stringify(input.inputs).length>30_000)throw Error('Supply bounded named browser workflow inputs.');
 return {...input,url:url.href};
}

export function readBrowserWorkflow(value:unknown):BrowserWorkflow{
 const parsed=Schema.decodeUnknownSync(definition,{onExcessProperty:'error'})(value);
 const url=new URL(parsed.origin);
 if(url.origin!==parsed.origin||url.username||url.password||!(url.protocol==='https:'||url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Use an exact HTTPS origin, or the disposable loopback site.');
 if(!parsed.pathPrefix.startsWith('/')||!parsed.pathPrefix.endsWith('/')||new URL(parsed.pathPrefix,parsed.origin).origin!==parsed.origin||new URL(parsed.pathPrefix,parsed.origin).pathname!==parsed.pathPrefix||/[?#\\]/.test(parsed.pathPrefix))throw Error('Use a normalized path prefix beginning and ending with /.');
 const keys=parsed.inputs.map(input=>input.key);
 if(new Set(keys).size!==keys.length||keys.some(key=>! /^[a-z][a-z0-9_]{0,39}$/.test(key)))throw Error('Give each input a unique lowercase key using letters, numbers or underscores.');
 const templates=parsed.steps.flatMap(step=>[...step.before,...step.after].map(check=>check.kind==='text'?check.contains:check.equals).concat(step.action.kind==='click'?step.action.fields.map(field=>field.value):[step.action.value]));
 for(const value of templates){const rest=value.replace(/\{\{([a-z][a-z0-9_]{0,39})\}\}/g,(_match,key:string)=>{if(!keys.includes(key))throw Error('A workflow step refers to an unknown input: '+key);return '';});if(rest.includes('{{')||rest.includes('}}'))throw Error('Use {{input_key}} for a workflow input.');}
 if(JSON.stringify(parsed).length>50_000)throw Error('This workflow exceeds the authoring limit.');
 return parsed;
}
export function workflowFromArtifact(artifact:Artifact):BrowserWorkflow{
 const revision=artifact.revisions.at(-1);
 if(!revision||revision.mimeType!==BROWSER_WORKFLOW_MIME||revision.encoding==='base64')throw Error('This saved file is not an authored browser workflow.');
 return readBrowserWorkflow(JSON.parse(revision.content));
}
export function currentBrowserWorkflow(task:Task,ref:ArtifactRef):BrowserWorkflow{
 const artifact=task.artifacts.find(item=>item.id===ref.artifactId),revision=artifact?.revisions.at(-1);
 if(!artifact||!revision||revision.revision!==ref.revision||revision.digest!==ref.digest)throw Error('The saved browser workflow changed. Reopen it and review the current steps.');
 return workflowFromArtifact(artifact);
}
export function browserWorkflowRequest(task:Task,ref:ArtifactRef){
 const run=task.session?.runs.filter(run=>run.workflow?.artifactId===ref.artifactId&&run.workflow.revision===ref.revision&&run.workflow.digest===ref.digest).at(-1);
 return run?task.requests.find(request=>request.id===run.id&&request.kind==='browser'):undefined;
}
export function workflowInvocation(workflow:BrowserWorkflow,url:string,inputs:WorkflowInputs){
 const start=new URL(url);
 if(start.origin!==workflow.origin||start.username||start.password||!start.pathname.startsWith(workflow.pathPrefix)||start.hash)throw Error('Choose a fresh target within the saved website and path prefix, without sign-in details or a fragment.');
 const keys=workflow.inputs.map(input=>input.key);
 if(Object.keys(inputs).length!==keys.length||Object.keys(inputs).some(key=>!keys.includes(key))||keys.some(key=>typeof inputs[key]!=='string'||!inputs[key].trim()||inputs[key].length>10_000))throw Error('Supply one non-empty value for every saved workflow input.');
 if(JSON.stringify(inputs).length>30_000)throw Error('These workflow inputs exceed the run limit.');
 return {url:start.href,inputs:{...inputs}};
}
export function resolveWorkflowText(template:string,inputs:WorkflowInputs):string{return template.replace(/\{\{([a-z][a-z0-9_]{0,39})\}\}/g,(_match,key:string)=>{if(!Object.hasOwn(inputs,key))throw Error('A saved workflow input is missing.');return inputs[key];});}
export function workflowTarget(observation:BrowserObservation,target:WorkflowTarget){
 const matches=observation.targets.filter(item=>item.role===target.role&&item.label===target.label);
 if(matches.length!==1)throw Error(`Expected one ${target.role} control labelled “${target.label}”; found ${matches.length}. No action was authorized.`);
 return matches[0];
}
export function workflowCheck(check:WorkflowCheck,observation:BrowserObservation,inputs:WorkflowInputs):string{
 if(check.kind==='text'){const expected=resolveWorkflowText(check.contains,inputs);if(!observation.text.includes(expected))throw Error('Visible page check failed: '+expected);return 'Visible page contains: '+expected;}
 const target=workflowTarget(observation,check.target),expected=resolveWorkflowText(check.equals,inputs);
 if(target.value!==expected)throw Error('Field check failed for “'+check.target.label+'”. No later step was authorized.');
 return check.target.label+' equals: '+expected;
}
/** Readable historical review only. This text never grants browser authority. */
export function browserWorkflowNotes(content:string):string{
 try{
  const workflow=readBrowserWorkflow(JSON.parse(content)),describe=(check:WorkflowCheck)=>check.kind==='text'?'Page contains: '+check.contains:check.target.label+' equals: '+check.equals;
  return [workflow.name,workflow.description,'Authored browser workflow. No recording inference or execution is established by this saved definition.','Website: '+workflow.origin,'Target path: '+workflow.pathPrefix,'Reusable inputs: '+(workflow.inputs.map(input=>input.label+' ({{'+input.key+'}})').join(', ')||'None'),...workflow.steps.map((step,index)=>[
   (index+1)+'. '+step.name,
   (step.action.kind==='click'?'Click ':step.action.kind==='fill'?'Enter text in ':'Select an option in ')+step.action.target.label+(step.action.kind==='click'?'':': '+step.action.value),
   'Before: '+step.before.map(describe).join('; '),'After: '+step.after.map(describe).join('; '),
   ...(step.action.kind==='click'&&step.action.fields.length?['Intended form values: '+step.action.fields.map(field=>field.target.label+' = '+field.value).join('; ')]:[]),
  ].join('\n')),'Each fresh run needs separate browser consent and approval for every interaction. Visible checks do not independently verify website effects.'].join('\n\n');
 }catch{return 'This saved browser workflow cannot be read safely. Its original file is kept. Open a valid current version to review its authored steps and checks.';}
}
/** Authored starter only. It has not observed a website or learned from a demonstration. */
export const browserWorkflowStarter:BrowserWorkflow={schemaVersion:1,kind:'authored-browser-workflow',name:'Save a request draft',description:'Enter a request title and delivery code, then check the saved draft.',origin:'http://127.0.0.1:4300',pathPrefix:'/requests/',inputs:[{key:'title',label:'Request title'},{key:'delivery',label:'Delivery value'}],steps:[
 {name:'Enter the request title',before:[{kind:'text',contains:'Request draft'}],action:{kind:'fill',target:{role:'text',label:'Request title'},value:'{{title}}'},after:[{kind:'value',target:{role:'text',label:'Request title'},equals:'{{title}}'}]},
 {name:'Enter the delivery code',before:[{kind:'value',target:{role:'text',label:'Request title'},equals:'{{title}}'}],action:{kind:'fill',target:{role:'text',label:'Delivery'},value:'{{delivery}}'},after:[{kind:'value',target:{role:'text',label:'Delivery'},equals:'{{delivery}}'}]},
 {name:'Save and inspect the draft',before:[{kind:'value',target:{role:'text',label:'Request title'},equals:'{{title}}'},{kind:'value',target:{role:'text',label:'Delivery'},equals:'{{delivery}}'}],action:{kind:'click',target:{role:'button',label:'Save draft'},fields:[{target:{role:'text',label:'Request title'},value:'{{title}}'},{target:{role:'text',label:'Delivery'},value:'{{delivery}}'}]},after:[{kind:'text',contains:'Draft saved: {{title}}'},{kind:'text',contains:'Delivery: {{delivery}}'}]},
]};
