import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
vi.mock('lucide-react',()=>({Check:()=>null}));
import {createElement} from 'react';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../../src/core/companion';
import {DocumentImports} from '../../src/host/document-import';
import {CsvStatistics} from '../../src/renderer/src/components/CsvStatistics';
import {CodeWorkspace} from '../../src/renderer/src/components/CodeWorkspace';
import type {CodeCommand,CodeFolders} from '../../src/shared/code-workspace';
import {HOST_VIEW_RETRY_MESSAGE,type HostViewGate} from '../../src/renderer/src/components/HostViewRetry';
import {readCsvStatisticsCommand} from '../../src/shared/csv-statistics';
import type {Command} from '../../src/shared/bridge';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

test('a view-guarded per-task read waits for the confirmed host view and offers one retry when the view cannot be opened',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-host-view-gate-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv');await writeFile(file,'Label,Value\nA,-4\nB,12\nC,0\n');const created=await core.createTask({title:'Owned view gate'});
  const imports=new DocumentImports(core,async()=>file),owner={taskId:created.id,attemptId:randomUUID()},review=await imports.pick(owner,()=>{});if(review.kind!=='review')throw Error('No actual CSV file review');const imported=await imports.add({...owner,label:'Owned gate data',content:review.text,role:'fact'},()=>{});
  const task=await core.getTask(created.id),reads:Command[]=[],retries:string[]=[];let tail:Promise<unknown>=Promise.resolve(),state:HostViewGate['state']='pending';
  vi.stubGlobal('crypto',{randomUUID});vi.stubGlobal('window',{companion:{invoke(input:Command){const command=readCsvStatisticsCommand(input);if(command.type!=='statistics.data')throw Error('Unexpected direct command');reads.push(command);const operation=core.previewCsvStatistics(command.taskId,command.source);tail=operation;return operation;}}});
  const renderer=createControlledRenderer(()=>createElement(CsvStatistics,{task,source:imported.reference,busy:false,run:async()=>undefined,isCurrent:()=>true,onSaved(){},hostView:{state,retry:()=>{retries.push(state);}}}));
  type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),allText=()=>renderer.nodes().filter(node=>node.type==='#text').map(text).join(' '),retry=()=>renderer.nodes().find(node=>node.type==='button'&&node.props['aria-label']==='Retry opening this task for CSV statistics'),retrying=()=>renderer.nodes().find(node=>node.type==='button'&&node.props['aria-label']==='Retrying opening this task for CSV statistics'),reading='Reading the exact saved CSV…',settle=async()=>{await tail;await Promise.resolve();renderer.render();};
  renderer.render();await settle();expect(reads).toEqual([]);expect(allText()).not.toContain(HOST_VIEW_RETRY_MESSAGE);expect(retry()).toBeUndefined();
  state='failed';renderer.render();await settle();expect(reads).toEqual([]);expect(renderer.nodes().filter(node=>node.props.role==='alert'&&text(node).includes(HOST_VIEW_RETRY_MESSAGE))).toHaveLength(1);expect(allText()).not.toContain(reading);expect(text(retry()!)).toBe('Retry');expect(retry()!.props.disabled).toBeUndefined();retry()!.props.onClick();expect(retries).toEqual(['failed']);
  // A pending retry keeps the same alert and button mounted (focus stays on it); the button is aria-disabled, never disabled, and ignores repeats.
  state='retrying';renderer.render();await settle();expect(reads).toEqual([]);expect(renderer.nodes().filter(node=>node.props.role==='alert'&&text(node).includes(HOST_VIEW_RETRY_MESSAGE))).toHaveLength(1);expect(retry()).toBeUndefined();expect(text(retrying()!)).toBe('Retrying…');expect(retrying()!.props['aria-disabled']).toBe(true);expect(retrying()!.props.disabled).toBeUndefined();expect(retrying()!.props.onClick).toBeUndefined();expect(allText()).not.toContain(reading);expect(retries).toEqual(['failed']);
  state='pending';renderer.render();await settle();expect(reads).toEqual([]);expect(retry()).toBeUndefined();
  state='ready';renderer.render();await settle();expect(reads).toHaveLength(1);expect(reads[0]).toMatchObject({type:'statistics.data',taskId:task.id,source:imported.reference});expect(allText()).not.toContain(HOST_VIEW_RETRY_MESSAGE);renderer.render();await settle();expect(reads).toHaveLength(1);
 }finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});

test('local code folder actions and their folder read wait for the confirmed host view',async()=>{
 const task={id:'owner',title:'Synthetic owner',goal:'',status:'active',createdAt:'2026-11-01T00:00:00Z',updatedAt:'2026-11-01T00:00:00Z',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}} as never as import('../../src/core/types').Task;
 const calls:CodeCommand[]=[],folders:CodeFolders={kind:'folders',folders:[],files:[]};let state:HostViewGate['state']='pending';
 const invoke=async<T,>(command:CodeCommand):Promise<T>=>{calls.push(command);return folders as T;};
 const r=createControlledRenderer(()=>createElement(CodeWorkspace,{task,cache:{} as never,disabled:false,isCurrent:()=>true,invoke,onTask:()=>{},hostView:{state,retry:()=>{}}}));type Node=ReturnType<typeof r.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label),settle=async()=>{await Promise.resolve();await Promise.resolve();r.render();};
 r.render();await settle();expect(calls).toEqual([]);expect(button('Choose local code folder').props.disabled).toBe(true);expect(button('Reload folder choices').props.disabled).toBe(true);
 state='failed';r.render();await settle();expect(calls).toEqual([]);expect(button('Choose local code folder').props.disabled).toBe(true);expect(r.nodes().some(node=>node.props['aria-label']==='Retry opening this task for code folders')).toBe(true);
 state='ready';r.render();await settle();expect(calls).toEqual([{type:'code.folder.get',taskId:task.id}]);expect(button('Choose local code folder').props.disabled).toBe(false);expect(button('Reload folder choices').props.disabled).toBe(false);expect(r.nodes().some(node=>String(node.props['aria-label']??'').startsWith('Retry'))).toBe(false);
});
