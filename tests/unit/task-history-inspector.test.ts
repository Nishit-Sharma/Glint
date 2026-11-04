import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import type {Task} from '../../src/core/types';
import {TaskHistoryInspector} from '../../src/renderer/src/components/TaskHistoryInspector';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

afterEach(()=>vi.unstubAllGlobals());
const task:Task={id:'owner',title:'History inspection',goal:'',status:'active',createdAt:'now',updatedAt:'now',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
const preview={taskId:task.id,taskUpdatedAt:task.updatedAt,sessionRevision:0,sourceRefs:[],history:JSON.stringify({schemaVersion:1,previousTurns:[{userRequest:{text:'SAVED_HISTORY'}}]})};
async function settled(){for(let i=0;i<12;i++)await Promise.resolve();}

it('uses only the read-only command and retires shown and delayed results on draft/context changes',async()=>{
 let prompt='Current question',changed:(event:{type:string})=>void=()=>{},release:(value:unknown)=>void=()=>{};const invoke=vi.fn(()=>new Promise(resolve=>{release=resolve;}));
 vi.stubGlobal('window',{companion:{invoke,subscribe:(listener:typeof changed)=>{changed=listener;return()=>{};}}});
 const r=createControlledRenderer(()=>createElement(TaskHistoryInspector,{task,sourceIds:[],prompt})),button=()=>r.find(n=>n.type==='button'),text=()=>r.nodes().filter(n=>n.type==='#text').map(n=>n.props.text).join('');
 r.render();button().props.onClick();expect(invoke).toHaveBeenLastCalledWith({type:'history.preview',taskId:'owner',sourceIds:[],expectedSourceRefs:[]});release(preview);await settled();r.render();expect(text()).toContain('SAVED_HISTORY');expect(text()).toContain('Nothing was sent');
 prompt='Changed question';r.render();expect(text()).not.toContain('SAVED_HISTORY');button().props.onClick();const obsolete=release;changed({type:'changed'});r.render();expect(button().props.disabled).toBe(false);button().props.onClick();const fresh=release;obsolete(preview);await settled();r.render();expect(text()).not.toContain('SAVED_HISTORY');fresh(preview);await settled();r.render();expect(text()).toContain('SAVED_HISTORY');
});

it('binds the exact selected revisions and rejects mismatched or malformed replies',async()=>{
 const source={id:'s',currentVersion:1,freshness:'fresh' as const,versions:[{id:'s',version:1,digest:'a'.repeat(64),kind:'text' as const,label:'Selected',role:'fact' as const,content:'Private source body',capturedAt:'now'}]},owner={...task,sources:[source]};
 const invoke=vi.fn(async()=>({...preview,sourceRefs:[],history:'not-json'}));vi.stubGlobal('window',{companion:{invoke,subscribe:()=>()=>{}}});
 const r=createControlledRenderer(()=>createElement(TaskHistoryInspector,{task:owner,sourceIds:['s'],prompt:'Question'}));r.render();r.find(n=>n.type==='button').props.onClick();await settled();r.render();expect(invoke).toHaveBeenCalledWith({type:'history.preview',taskId:'owner',sourceIds:['s'],expectedSourceRefs:[{sourceId:'s',version:1,digest:'a'.repeat(64)}]});expect(r.nodes().some(n=>n.props.role==='status')).toBe(true);expect(r.nodes().some(n=>n.type==='pre')).toBe(false);
});
