import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import type {Artifact,Source,Task} from '../../src/core/types';
import type {Command} from '../../src/shared/bridge';
import type {Run} from '../../src/renderer/src/ui';
import {SourceComparison} from '../../src/renderer/src/components/SourceComparison';
import {sourceComparisonArtifact} from '../../src/shared/source-comparison';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

const sourceDigest=(id:string)=>(id==='invitation'?'a':id==='guide'?'b':'c').repeat(64);
const source=(id:string):Source=>({id,currentVersion:1,freshness:'fresh',versions:[{id,version:1,digest:sourceDigest(id),kind:'text',role:'fact',label:id,content:id+' PRIVATE BODY',capturedAt:'time'}]});
const task=():Task=>({id:'task',title:'Visit',goal:'Compare',status:'active',createdAt:'time',updatedAt:'time',sources:[source('invitation'),source('guide'),source('unselected')],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
const selected=(id:string)=>JSON.stringify([id,1,sourceDigest(id)]);
function fixture(run?:Run){
 let current=task(),active=true;const opened:Artifact[]=[],calls:unknown[]=[],r=createControlledRenderer(()=>createElement(SourceComparison,{task:current,busy:false,isCurrent:()=>active,run:run??(async (command:Command)=>{calls.push(command);const input=command as any,artifact:Artifact={id:'comparison',revisions:[{...sourceComparisonArtifact(current,input.refs,input.notes),mimeType:'text/markdown',sourceRefs:[...input.refs],revision:1,digest:'d'.repeat(64),createdAt:'time'}]};return {kind:'saved',taskId:input.taskId,intentId:input.intentId,binding:input.binding,artifact,revision:artifact.revisions[0]};}) as Run,onSaved:artifact=>opened.push(artifact),onBack:()=>{active=false;}}));
 const text=(node:ReturnType<typeof r.nodes>[number]):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 const choose=(index:number,id:string)=>{r.find(node=>node.type==='select'&&node.props['aria-label']===`Source ${index}`).props.onChange({target:{value:selected(id)}});r.render();};
 const edit=(value:string,type='textarea',index=0)=>{r.nodes().filter(node=>node.type===type)[index].props.onChange({target:{value}});r.render();};
 const submit=()=>r.find(node=>node.type==='form').props.onSubmit({preventDefault(){}}),save=()=>r.find(node=>node.type==='button'&&text(node)==='Save comparison');
 r.render();return {r,calls,opened,choose,edit,submit,save,text,setTask(next:Task){current=next;r.render();},get task(){return current},leave(){active=false;}};
}
test('explicit selection, authored uncertainty and one save use exact refs without copying source bodies',async()=>{
 const f=fixture();expect(f.save().props.disabled).toBe(true);expect(f.r.nodes().some(node=>node.type==='pre')).toBe(false);
 f.choose(2,'guide');expect(f.save().props.disabled).toBe(true);f.choose(1,'invitation');f.edit('Why are the times different?','input');f.edit('Arrival may be earlier than opening.');f.edit('Ask the organizer.','textarea',1);expect(f.save().props.disabled).toBe(false);
 const first=f.submit();await f.submit();await first;expect(f.calls).toHaveLength(1);expect(f.opened).toHaveLength(1);const command=f.calls[0] as any;expect(command.type).toBe('comparison.save');expect(command.refs.map((ref:any)=>ref.sourceId)).toEqual(['invitation','guide']);expect(JSON.stringify(command)).not.toContain('PRIVATE BODY');expect(JSON.stringify(command)).not.toContain('unselected');expect(command.notes.uncertainty).toContain('Ask the organizer.');
});
test('freshness changes hold saving and preserve notes without silently adopting a new snapshot',async()=>{
 const f=fixture();f.choose(1,'invitation');f.choose(2,'guide');f.edit('Question','input');f.edit('Exact human interpretation.');f.edit('Still unknown.','textarea',1);
 const old=f.task.sources[0].versions[0];f.setTask({...f.task,sources:[{...f.task.sources[0],currentVersion:2,versions:[old,{...old,version:2,digest:'invitation-2',content:'Updated'}]},...f.task.sources.slice(1)]});
 expect(f.save().props.disabled).toBe(true);expect(f.r.nodes().some(node=>f.text(node).includes('explicitly choose its current snapshot'))).toBe(true);expect(f.r.nodes().filter(node=>node.type==='textarea')[0].props.value).toBe('Exact human interpretation.');await f.submit();expect(f.calls).toEqual([]);
});
test('a late completion after navigation cannot open a different task, and a failed save keeps notes',async()=>{
 let resolve!:(value:any)=>void;const f=fixture((()=>new Promise<any>(done=>{resolve=done;})) as Run);f.choose(1,'invitation');f.choose(2,'guide');f.edit('Question','input');f.edit('Comparison');f.edit('Unknown','textarea',1);const pending=f.submit();f.leave();resolve({...f.task,artifacts:[{id:'late',revisions:[]}]});await pending;expect(f.opened).toEqual([]);
 const g=fixture((async()=>undefined) as Run);g.choose(1,'invitation');g.choose(2,'guide');g.edit('Question','input');g.edit('Keep these notes');g.edit('Unknown','textarea',1);await g.submit();g.r.render();expect(g.opened).toEqual([]);expect(g.r.nodes().filter(node=>node.type==='textarea')[0].props.value).toBe('Keep these notes');expect(g.r.nodes().some(node=>node.props.role==='alert'&&g.text(node).includes('Check Files'))).toBe(true);
});
test('clearing the first source preserves the second slot, and unrelated save results do not open as this comparison',async()=>{
 const f=fixture((async()=>({...task(),artifacts:[{id:'other',revisions:[{title:'Unrelated note',content:'Other work',revision:1,sourceRefs:[],mimeType:'text/markdown',digest:'other',createdAt:'time'}]}]})) as Run);
 f.choose(1,'invitation');f.choose(2,'guide');f.r.find(node=>node.type==='select'&&node.props['aria-label']==='Source 1').props.onChange({target:{value:''}});f.r.render();expect(f.r.find(node=>node.type==='select'&&node.props['aria-label']==='Source 2').props.value).toBe(selected('guide'));expect(f.save().props.disabled).toBe(true);
 f.choose(1,'invitation');f.edit('Question','input');f.edit('Keep my comparison');f.edit('Still unknown','textarea',1);await f.submit();f.r.render();expect(f.opened).toEqual([]);expect(f.r.nodes().some(node=>node.props.role==='alert'&&f.text(node).includes('without its exact comparison receipt'))).toBe(true);expect(f.r.nodes().filter(node=>node.type==='textarea')[0].props.value).toBe('Keep my comparison');
});
