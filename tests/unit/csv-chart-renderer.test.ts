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
import {CsvChartEditor,CsvChartSvgView} from '../../src/renderer/src/components/CsvChartEditor';
import {readCsvChartCommand,readCsvChart,CSV_CHART_MIME,CSV_CHART_SVG_MIME,type CsvChartSaved} from '../../src/shared/csv-chart';
import type {Command} from '../../src/shared/bridge';
import type {Artifact} from '../../src/core/types';
import type {Run} from '../../src/renderer/src/ui';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

test('real chart UI uses selected columns, preserves uncertain creation identity, edits type/labels/zoom and opens truthful SVG copy without any provider',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-csv-chart-ui-')),core=await createCompanion({dataDir:join(directory,'store')});
 try{
  const file=join(directory,'owned.csv'),csv='Category,Value\n"A & <one>",-4\nB,12\nC,0\n';await writeFile(file,csv);
  const created=await core.createTask({title:'Owned chart UI'});await core.saveComposerDraft(created.id,0,{text:'  KEEP_CHART_DRAFT\n',kind:'explain'});const imports=new DocumentImports(core,async()=>file),owner={taskId:created.id,attemptId:randomUUID()},preview=await imports.pick(owner,()=>{});if(preview.kind!=='review')throw Error('No actual file review');const imported=await imports.add({...owner,label:'Owned CSV',content:preview.text,role:'fact'},()=>{});
  let task=await core.getTask(created.id),artifact:Artifact|undefined,tail:Promise<unknown>=Promise.resolve(),lose=true;const before=task,commands:Command[]=[],saves:CsvChartSaved[]=[];
  vi.stubGlobal('crypto',{randomUUID});vi.stubGlobal('window',{companion:{invoke(input:Command){const command=readCsvChartCommand(input);if(command.type!=='chart.data')throw Error('Unexpected direct command');const operation=core.previewCsvChart(command.taskId,command.source);tail=operation;return operation;}}});
  const run:Run=<T,>(input:Command):Promise<T|undefined>=>{const command=readCsvChartCommand(input);commands.push(command);if(command.type==='chart.data')throw Error('Unexpected mutation');const operation=command.type==='chart.save'?core.saveCsvChart(command):core.saveCsvChartSvg(command.taskId,command.artifact),receipt=operation.then(saved=>{if(command.type==='chart.save'&&lose){lose=false;return undefined;}return saved as T;});tail=receipt;return receipt;};
  const onSaved=(saved:CsvChartSaved)=>{saves.push(saved);task=saved.task;artifact=task.artifacts.find(item=>item.id===saved.artifactId);};
  const renderer=createControlledRenderer(()=>artifact?.revisions.at(-1)?.mimeType===CSV_CHART_SVG_MIME?createElement(CsvChartSvgView,{task,artifact,busy:false,run}):createElement(CsvChartEditor,{task,source:imported.reference,artifact,busy:false,run,isCurrent:()=>true,onSaved}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),select=(index:number)=>renderer.nodes().filter(node=>node.type==='select')[index],input=(index:number)=>renderer.nodes().filter(node=>node.type==='input')[index],settle=async()=>{await tail;await Promise.resolve();renderer.render();};
  renderer.render();await settle();expect(button('Save chart').props.disabled).toBe(true);select(1).props.onChange({currentTarget:{value:'0'}});renderer.render();select(2).props.onChange({currentTarget:{value:'1'}});renderer.render();input(0).props.onChange({currentTarget:{value:'Owned initial chart'}});renderer.render();button('Save chart').props.onClick();await settle();
  expect(button('Check same chart save').props.disabled).toBe(false);expect(input(0).props.disabled).toBe(true);const first=commands[0];button('Check same chart save').props.onClick();await settle();expect(commands[1]).toEqual(first);expect(saves).toHaveLength(1);expect(task.artifacts).toHaveLength(1);expect(task.artifacts[0].revisions).toHaveLength(1);expect(task.artifacts[0].revisions[0].mimeType).toBe(CSV_CHART_MIME);
  select(0).props.onChange({currentTarget:{value:'line'}});renderer.render();input(0).props.onChange({currentTarget:{value:'Edited chart & labels'}});renderer.render();input(2).props.onChange({currentTarget:{value:'Categories QA'}});renderer.render();input(3).props.onChange({currentTarget:{value:'Values QA'}});renderer.render();select(3).props.onChange({currentTarget:{value:'2'}});renderer.render();expect(renderer.find(node=>node.type==='img').props.style.width).toBe(2000);expect(decodeURIComponent(renderer.find(node=>node.type==='img').props.src)).toContain('<polyline');
  button('Save chart changes').props.onClick();await settle();expect(readCsvChart(JSON.parse(task.artifacts[0].revisions.at(-1)!.content)).settings).toMatchObject({type:'line',title:'Edited chart & labels',xLabel:'Categories QA',yLabel:'Values QA',zoom:2});expect(task.artifacts[0].revisions).toHaveLength(2);
  button('Save SVG copy').props.onClick();await settle();expect(artifact?.revisions.at(-1)?.mimeType).toBe(CSV_CHART_SVG_MIME);expect(renderer.nodes().some(node=>node.props['aria-label']==='Chart SVG copy')).toBe(true);expect(button('Export chart SVG').props.disabled).toBe(false);expect(task.sources).toEqual(before.sources);expect(task.session?.draft).toBe(before.session?.draft);expect(task.requests).toEqual([]);expect(commands.every(command=>command.type==='chart.save'||command.type==='chart.svg')).toBe(true);
 }
 finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});
