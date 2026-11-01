import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
vi.mock('lucide-react',()=>({Check:()=>null}));
import {createElement} from 'react';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCompanion} from '../src/core/companion';
import {DocumentImports} from '../src/host/document-import';
import {CsvStatistics} from '../src/renderer/src/components/CsvStatistics';
import {readCsvStatisticsCommand,CSV_STATISTICS_MIME,type CsvStatisticsSaved} from '../src/shared/csv-statistics';
import type {Command} from '../src/shared/bridge';
import type {Artifact} from '../src/core/types';
import type {Run} from '../src/renderer/src/ui';
import {createControlledRenderer} from './controlled-renderer.fixture';

test('real statistics controls calculate selected data, freeze uncertain saves, version edits and keep historical results readable while blocking stale saves',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-statistics-ui-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv');await writeFile(file,'Label,Value\nA,-4\nB,12\nC,0\n');const created=await core.createTask({title:'Owned statistics UI'});await core.saveComposerDraft(created.id,0,{text:'  KEEP_STATS_UI_DRAFT\n',kind:'explain'});
  const imports=new DocumentImports(core,async()=>file),owner={taskId:created.id,attemptId:randomUUID()},review=await imports.pick(owner,()=>{});if(review.kind!=='review')throw Error('No actual CSV file review');const imported=await imports.add({...owner,label:'Owned statistics data',content:review.text,role:'fact'},()=>{});
  let task=await core.getTask(created.id),artifact:Artifact|undefined,tail:Promise<unknown>=Promise.resolve(),lose=true;const before=task,commands:Command[]=[],saves:CsvStatisticsSaved[]=[];
  vi.stubGlobal('crypto',{randomUUID});vi.stubGlobal('window',{companion:{invoke(input:Command){const command=readCsvStatisticsCommand(input);if(command.type!=='statistics.data')throw Error('Unexpected direct command');const operation=core.previewCsvStatistics(command.taskId,command.source);tail=operation;return operation;}}});
  const run:Run=<T,>(input:Command):Promise<T|undefined>=>{const command=readCsvStatisticsCommand(input);if(command.type!=='statistics.save')throw Error('Unexpected mutation');commands.push(command);const receipt=core.saveCsvStatistics(command).then(saved=>{if(lose){lose=false;return undefined;}return saved as T;});tail=receipt;return receipt;};
  const renderer=createControlledRenderer(()=>createElement(CsvStatistics,{task,source:imported.reference,artifact,busy:false,run,isCurrent:()=>true,onSaved(saved){saves.push(saved);task=saved.task;artifact=task.artifacts.find(item=>item.id===saved.artifactId);}}));
  type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),allText=()=>renderer.nodes().filter(node=>node.type==='#text').map(text).join(' '),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),title=()=>renderer.find(node=>node.type==='input'&&!node.props.type),settle=async()=>{await tail;await Promise.resolve();renderer.render();};
  renderer.render();await settle();expect(button('Save statistics').props.disabled).toBe(true);renderer.nodes().filter(node=>node.type==='input'&&node.props.type==='checkbox')[1].props.onChange({currentTarget:{checked:true}});renderer.render();expect(allText()).toContain('2.6666666666666665');expect(allText()).toContain('46.222222');expect(button('Save statistics').props.disabled).toBe(false);
  button('Save statistics').props.onClick();await settle();expect(button('Check same statistics save').props.disabled).toBe(false);expect(title().props.disabled).toBe(true);button('Check same statistics save').props.onClick();await settle();expect(commands[1]).toEqual(commands[0]);expect(saves).toHaveLength(1);expect(task.artifacts).toHaveLength(1);expect(task.artifacts[0].revisions[0].mimeType).toBe(CSV_STATISTICS_MIME);
  title().props.onChange({currentTarget:{value:'Edited statistics title'}});renderer.render();button('Save statistics changes').props.onClick();await settle();expect(task.artifacts[0].revisions).toHaveLength(2);expect(task.artifacts[0].revisions[1].title).toBe('Edited statistics title');
  task=await core.putSource(task.id,{id:imported.reference.sourceId,kind:'text',role:'fact',label:'Updated data',content:'Label,Value\nA,99\n'});artifact=task.artifacts.find(item=>item.id===artifact!.id);renderer.render();expect(allText()).toContain('Earlier source data');expect(allText()).toContain('2.6666666666666665');expect(button('Save statistics changes').props.disabled).toBe(true);expect(task.session?.draft).toBe(before.session?.draft);expect(task.requests).toEqual([]);expect(commands.every(command=>command.type==='statistics.save')).toBe(true);
 }
 finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});
