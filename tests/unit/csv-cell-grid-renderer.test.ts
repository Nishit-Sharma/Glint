import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {DocumentImports} from '../../src/host/document-import';
import {DocumentImport,CsvImportPreview} from '../../src/renderer/src/components/DocumentImport';
import {writeCodeBlockCopy,type CodeBlockCopyCommand} from '../../src/shared/code-block-copy';
import type {Command} from '../../src/shared/bridge';
import type {DocumentImportOwner,DocumentImportResult} from '../../src/shared/document-import';
import type {Run} from '../../src/renderer/src/ui';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

test('normal document choose/import preview selects ranges, arrows, copies exact cells and preserves Add provenance, owner and draft',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-grid-ui-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv'),csv='Name,Note,Value\r\n"Zoë, 東京","First\nSecond ""quoted"" line",7\r\nOther,plain,3\r\n';await writeFile(file,csv);
  const task=await core.createTask({title:'Owned CSV preview'});await core.saveComposerDraft(task.id,0,{text:'  UNSENT_CSV_QA\n',kind:'explain'});const before=await core.getTask(task.id),imports=new DocumentImports(core,async()=>file),writes:string[]=[],commands:string[]=[];let tail:Promise<unknown>=Promise.resolve();
  vi.stubGlobal('crypto',{randomUUID});vi.stubGlobal('window',{companion:{invoke(input:Command){if(input.type==='code-block.copy'){commands.push(input.type);const operation=Promise.resolve(writeCodeBlockCopy(input,text=>writes.push(text)));tail=operation;return operation;}if(input.type==='source.import.cancel')return Promise.resolve(imports.cancel(input));throw Error('Unexpected command');}}});
  const run:Run=async<T,>(command:Command):Promise<T>=>{commands.push(command.type);let operation:Promise<unknown>;if(command.type==='source.import.choose')operation=imports.pick(command,()=>{});else if(command.type==='source.import.add')operation=imports.add(command,()=>{});else throw Error('Unexpected import command');tail=operation;return await operation as T;};
  const added:DocumentImportResult['reference'][]=[];const renderer=createControlledRenderer(()=>createElement(DocumentImport,{task:before,busy:false,run,isCurrent:()=>true,beforeAdd:()=>{},onAdded:reference=>added.push(reference),onCancel:()=>{}}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),cell=(address:string)=>renderer.find(node=>node.props['data-csv-cell']===address);
  renderer.render();button('Choose document…').props.onClick();await tail;await Promise.resolve();renderer.render();expect(renderer.nodes().some(node=>node.props.role==='grid')).toBe(true);expect(await core.getTask(task.id)).toEqual(before);
  cell('A2').props.onClick({shiftKey:false});renderer.render();cell('C3').props.onClick({shiftKey:true});renderer.render();expect(renderer.nodes().filter(node=>node.props.role==='gridcell'&&node.props['aria-selected']).map(node=>node.props['data-csv-cell'])).toEqual(['A2','B2','C2','A3','B3','C3']);
  const event={key:'ArrowLeft',shiftKey:true,ctrlKey:false,metaKey:false,nativeEvent:{isComposing:false},preventDefault:vi.fn()};cell('C3').props.onKeyDown(event);renderer.render();expect(event.preventDefault).toHaveBeenCalledOnce();button('Copy selected cells').props.onClick();await tail;renderer.render();expect(writes).toEqual(['Zoë, 東京\t"First\nSecond ""quoted"" line"\nOther\tplain']);
  expect(renderer.find(node=>node.type==='textarea').props.value).toBe(csv);expect(await core.getTask(task.id)).toEqual(before);
  renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});await tail;await Promise.resolve();await Promise.resolve();renderer.render();
  const saved=await core.getTask(task.id);expect(saved.sources).toHaveLength(1);expect(saved.sources[0].versions[0].content).toContain(csv);expect(saved.session?.draft).toBe(before.session?.draft);expect(saved.requests).toEqual([]);expect(await readFile(file,'utf8')).toBe(csv);expect(commands).toEqual(['source.import.choose','code-block.copy','source.import.add']);expect(added).toHaveLength(1);
 }
 finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});

test('all 10,000 data rows, all100 columns and long values are reachable; edited content retires selection and stale copy acknowledgements',async()=>{
 const headings=Array.from({length:100},(_,index)=>'H'+index).join(','),many='Name\n'+Array.from({length:10000},(_,index)=>'R'+index).join('\n');let content=many,resolveCopy:(()=>void)|undefined;const writes:CodeBlockCopyCommand[]=[],renderer=createControlledRenderer(()=>createElement(CsvImportPreview,{content}));
 vi.stubGlobal('window',{companion:{invoke(command:CodeBlockCopyCommand){writes.push(command);return new Promise<void>(resolve=>resolveCopy=resolve);}}});
 try{
  type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),cell=(address:string)=>renderer.find(node=>node.props['data-csv-cell']===address);
  renderer.render();renderer.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({currentTarget:{value:'10001'}});renderer.render();button('Go to record').props.onClick();renderer.render();expect(text(cell('A10001'))).toBe('R9999');button('Copy selected cells').props.onClick();expect(writes[0].text).toBe('R9999');
  content=headings+'\n'+Array.from({length:100},(_,index)=>index===99?'LONG_VALUE_'+ '界'.repeat(600):'v'+index).join(',');renderer.render();expect(renderer.nodes().some(node=>node.props.role==='grid'&&node.props['aria-colcount']===100)).toBe(true);resolveCopy?.();await Promise.resolve();renderer.render();expect(renderer.nodes().some(node=>node.props.role==='status')).toBe(false);
  cell('CV2').props.onClick({shiftKey:false});renderer.render();const value=renderer.find(node=>node.props['aria-label']==='Full active cell value');expect(text(value)).toContain('LONG_VALUE_'+ '界'.repeat(600));expect(renderer.nodes().filter(node=>node.props.role==='gridcell'&&node.props['aria-selected']).map(node=>node.props['data-csv-cell'])).toEqual(['CV2']);
 }
 finally{vi.unstubAllGlobals();}
});
