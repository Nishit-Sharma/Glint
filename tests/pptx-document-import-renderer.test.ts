import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setImmediate as yieldToRenderer} from 'node:timers/promises';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';
import {readDocumentImportOwner,readDocumentImportAdd} from '../src/shared/document-import';
import {DocumentImport} from '../src/renderer/src/components/DocumentImport';
import type {Command} from '../src/shared/bridge';
import type {ExportCommand,ExportReply,OtherCommand} from '../src/shared/export-contract';
import type {SourceRef} from '../src/core/types';
import {createControlledRenderer} from './controlled-renderer.fixture';

test('actual PPTX picker review/cancel/Add UI preserves selected bytes, full provenance and existing task draft',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-pptx-ui-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.pptx');execFileSync('python3',['-c',String.raw`import sys,zipfile
p='http://schemas.openxmlformats.org/presentationml/2006/main';a='http://schemas.openxmlformats.org/drawingml/2006/main';r='http://schemas.openxmlformats.org/officeDocument/2006/relationships'
parts={'[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>','ppt/presentation.xml':f'<p:presentation xmlns:p="{p}" xmlns:r="{r}"><p:sldIdLst><p:sldId id="256" r:id="owned"/></p:sldIdLst></p:presentation>','ppt/_rels/presentation.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="owned" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>','ppt/slides/slide1.xml':f'<p:sld xmlns:p="{p}" xmlns:a="{a}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Owned slide 雪 &amp; &lt;one&gt;</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'}
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:
 for name,body in parts.items():z.writestr(name,body)
`,file],{timeout:10000});const bytes=await readFile(file),created=await core.createTask({title:'Owned PPTX context'});await core.saveComposerDraft(created.id,0,{text:'Keep this unsent question',kind:'explain'});const task=await core.getTask(created.id),before=task;let chosen:string|undefined,tail:Promise<unknown>=Promise.resolve(),added:SourceRef|undefined,complete:()=>void=()=>{};const completion=new Promise<void>(resolve=>{complete=resolve;}),imports=new DocumentImports(core,async()=>chosen),calls:Command[]=[];
  function invoke(input:Command):Promise<unknown>{calls.push(input);if(input.type==='source.import.choose')return imports.pick(readDocumentImportOwner({taskId:input.taskId,attemptId:input.attemptId}),()=>{});if(input.type==='source.import.add')return imports.add(readDocumentImportAdd({taskId:input.taskId,attemptId:input.attemptId,label:input.label,content:input.content,role:input.role}),()=>{});if(input.type==='source.import.cancel')return Promise.resolve(imports.cancel({taskId:input.taskId,attemptId:input.attemptId}));throw Error('Unexpected command');}
  vi.stubGlobal('window',{companion:{invoke}});
  async function run<C extends ExportCommand>(input:C):Promise<ExportReply<C>|undefined>;
  async function run<T=unknown>(input:OtherCommand):Promise<T|undefined>;
  async function run(input:Command):Promise<unknown>{const operation=invoke(input);tail=operation;return operation;}
  let renderer=createControlledRenderer(()=>createElement(DocumentImport,{task,busy:false,run,isCurrent:()=>true,beforeAdd(){},onAdded(value){added=value;complete();},onCancel(){}}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(name:string)=>renderer.find(node=>node.type==='button'&&text(node)===name),settle=async()=>{await tail;await yieldToRenderer();renderer.render();};
  renderer.render();expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('PowerPoint (.pptx)');button('Choose document…').props.onClick();await settle();expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('No file selected.');expect(await core.getTask(task.id)).toEqual(before);
  chosen=file;button('Choose document…').props.onClick();await settle();const reviewed=renderer.find(node=>node.type==='textarea').props.value as string;expect(reviewed).toContain('S1/P1 = "Owned slide 雪 & <one>"');expect(renderer.nodes().filter(node=>node.type==='#text').map(text).join(' ')).toContain('Review PowerPoint slide text');button('Cancel').props.onClick();await settle();expect(await core.getTask(task.id)).toEqual(before);
  renderer=createControlledRenderer(()=>createElement(DocumentImport,{task,busy:false,run,isCurrent:()=>true,beforeAdd(){},onAdded(value){added=value;complete();},onCancel(){}}));renderer.render();button('Choose document…').props.onClick();await settle();renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await completion;renderer.render();expect(added).toBeDefined();const saved=await core.getTask(task.id);expect(saved.sources).toHaveLength(1);expect(saved.sources[0].versions[0].content).toContain(reviewed);expect(saved.session?.draft).toBe(before.session?.draft);expect(saved.requests).toEqual(before.requests);expect(await readFile(file)).toEqual(bytes);expect(calls.every(command=>command.type.startsWith('source.import.'))).toBe(true);expect(await readFile('src/host/index.ts','utf8')).toContain("extensions:['pdf','docx','doc','txt','md','csv','xlsx','pptx']");
 }finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});
