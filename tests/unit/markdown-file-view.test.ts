import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
vi.mock('../../src/renderer/src/draft-navigation',()=>({useNavigationDraft:()=>()=>{},useGuardedAction:()=>((action:()=>void)=>action())}));
vi.mock('../../src/renderer/src/components/ReadableText',()=>({ReadableText:({text}:{text:string})=>createElement('article',{'aria-label':'Actual Markdown renderer input'},text)}));
import {createElement} from 'react';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../../src/core/companion';
import {DocumentImports} from '../../src/host/document-import';
import {DocumentImport} from '../../src/renderer/src/components/DocumentImport';
import type {Run} from '../../src/renderer/src/ui';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
afterEach(()=>vi.unstubAllGlobals());

it('opens a picker-owned Markdown file rendered by default, edits the same text, and cancels without changing task data',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-markdown-file-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned-notes.md'),text='# Garden notes\n\n- **Mint**\n- Café 東京\n\nName | Count\n--- | ---\nMint | 2\n\n```text\n  literal  \n```\n';await writeFile(file,text);
  const initial=await core.createTask({title:'Markdown review'});await core.saveComposerDraft(initial.id,0,{text:'Keep this unsent draft',kind:'explain'});const task=await core.getTask(initial.id),before=structuredClone(task),imports=new DocumentImports(core,async()=>file);let cancelled=0,added=0,pick:Promise<unknown>|undefined;const commands:string[]=[];
  vi.stubGlobal('window',{companion:{invoke:async(command:any)=>{commands.push(command.type);if(command.type==='source.import.cancel')return imports.cancel(command);throw Error('Unexpected command');}}});
  const run=(async(command:any)=>{commands.push(command.type);if(command.type==='source.import.choose')return pick=imports.pick(command,()=>{});if(command.type==='source.import.add')return imports.add(command,()=>{});throw Error('Unexpected command');}) as Run;
  const r=createControlledRenderer(()=>createElement(DocumentImport,{task,busy:false,run,isCurrent:()=>true,beforeAdd:()=>{},onAdded:()=>{added++;},onCancel:()=>{cancelled++;}}));
  const content=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(content).join('');const button=(label:string)=>r.find(node=>node.type==='button'&&content(node)===label);
  r.render();button('Choose document…').props.onClick();await pick;for(let i=0;i<12;i++)await Promise.resolve();r.render();
  expect(r.find(node=>node.type==='section'&&node.props['aria-label']==='Rendered Markdown file')).toBeTruthy();expect(r.nodes().some(node=>node.type==='textarea')).toBe(false);expect(content(r.find(node=>node.type==='article'))).toBe(text);expect(await core.getTask(task.id)).toEqual(before);
  button('Edit Markdown source').props.onClick();r.render();const source=r.find(node=>node.type==='textarea');expect(source.props.value).toBe(text);source.props.onChange({target:{value:text+'\nReviewed locally.\n'}});r.render();button('Show rendered Markdown').props.onClick();r.render();expect(content(r.find(node=>node.type==='article'))).toBe(text+'\nReviewed locally.\n');expect(added).toBe(0);
  button('Cancel').props.onClick();for(let i=0;i<8;i++)await Promise.resolve();expect(cancelled).toBe(1);expect(await core.getTask(task.id)).toEqual(before);expect(commands.every(type=>type.startsWith('source.import.'))).toBe(true);
 }finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
