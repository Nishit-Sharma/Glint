import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {setImmediate as yieldToRenderer} from 'node:timers/promises';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';
import {csvWorkbook} from '../src/host/csv-workbook';
import {csvChartSource} from '../src/core/csv-chart-source';
import {readDocumentImportOwner,readDocumentImportAdd} from '../src/shared/document-import';
import {DocumentImport} from '../src/renderer/src/components/DocumentImport';
import type {Command} from '../src/shared/bridge';
import type {ExportCommand,ExportReply,OtherCommand} from '../src/shared/export-contract';
import type {SourceRef} from '../src/core/types';
import {createControlledRenderer} from './controlled-renderer.fixture';

test('normal XLSX picker review/cancel/Add UI uses immutable accepted workbook bytes and preserves existing task drafts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-xlsx-ui-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const created=await core.createTask({title:'Owned worksheet context'}),sourceTask=await core.putSource(created.id,{kind:'text',role:'fact',label:'Owned CSV',content:'Category,Value\n"A & <one>",-4\nB,12\nC,0\n'}),version=sourceTask.sources[0].versions[0],reference={sourceId:sourceTask.sources[0].id,version:version.version,digest:version.digest},file=join(directory,'owned.xlsx'),bytes=csvWorkbook(csvChartSource(sourceTask,reference)).bytes;await writeFile(file,bytes);await core.saveComposerDraft(created.id,0,{text:'Preserve this unsent question',kind:'explain'});const task=await core.getTask(created.id),before=task;let chosen:string|undefined,tail:Promise<unknown>=Promise.resolve(),added:SourceRef|undefined,complete:()=>void=()=>{};const completion=new Promise<void>(resolve=>{complete=resolve;}),imports=new DocumentImports(core,async()=>chosen),calls:Command[]=[];
  function invoke(input:Command):Promise<unknown>{calls.push(input);if(input.type==='source.import.choose')return imports.pick(readDocumentImportOwner({taskId:input.taskId,attemptId:input.attemptId}),()=>{});if(input.type==='source.import.add')return imports.add(readDocumentImportAdd(input.type==='source.import.add'?{taskId:input.taskId,attemptId:input.attemptId,label:input.label,content:input.content,role:input.role}:{}),()=>{});if(input.type==='source.import.cancel')return Promise.resolve(imports.cancel({taskId:input.taskId,attemptId:input.attemptId}));throw Error('Unexpected command');}
  vi.stubGlobal('window',{companion:{invoke}});
  async function run<C extends ExportCommand>(input:C):Promise<ExportReply<C>|undefined>;
  async function run<T=unknown>(input:OtherCommand):Promise<T|undefined>;
  async function run(input:Command):Promise<unknown>{const operation=invoke(input);tail=operation;return operation;}
  let renderer=createControlledRenderer(()=>createElement(DocumentImport,{task,busy:false,run,isCurrent:()=>true,beforeAdd(){},onAdded(value){added=value;complete();},onCancel(){}}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(name:string)=>renderer.find(node=>node.type==='button'&&text(node)===name),settle=async()=>{await tail;await yieldToRenderer();renderer.render();};
  renderer.render();expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('Excel (.xlsx)');button('Choose document…').props.onClick();await settle();expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('No file selected.');expect(await core.getTask(task.id)).toEqual(before);
  chosen=file;button('Choose document…').props.onClick();await settle();const reviewed=renderer.find(node=>node.type==='textarea').props.value as string;expect(reviewed).toContain('A2 [text] = "A & <one>"');expect(reviewed).toContain('B2 [text] = "-4"');expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('Review Excel workbook context');button('Cancel').props.onClick();await settle();expect(await core.getTask(task.id)).toEqual(before);
  renderer=createControlledRenderer(()=>createElement(DocumentImport,{task,busy:false,run,isCurrent:()=>true,beforeAdd(){},onAdded(value){added=value;complete();},onCancel(){}}));
  renderer.render();button('Choose document…').props.onClick();await settle();renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await completion;renderer.render();expect(added).toBeDefined();const saved=await core.getTask(task.id);expect(saved.sources).toHaveLength(before.sources.length+1);expect(saved.sources.at(-1)!.versions[0].content).toContain(reviewed);expect(saved.session?.draft).toBe(before.session?.draft);expect(saved.requests).toEqual(before.requests);expect(await readFile(file)).toEqual(bytes);expect(calls.every(command=>command.type.startsWith('source.import.'))).toBe(true);expect(await readFile('src/host/index.ts','utf8')).toContain("extensions:['pdf','docx','doc','txt','md','csv','xlsx','pptx']");
 }finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});
