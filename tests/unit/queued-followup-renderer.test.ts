import {expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('../support/controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {QueuedFollowups} from '../../src/renderer/src/components/QueuedFollowups';
import {createComposerDrafts} from '../../src/renderer/src/composer-drafts';
import {emptyTaskSession} from '../../src/core/task-session';
import type {Task} from '../../src/core/types';
import type {QueuedFollowup} from '../../src/shared/queued-followup';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';

const prompt='  Exact held text\r\n日本語 café  ',reason='An earlier response did not complete. This follow-up cannot run. To reuse its text, choose Cancel follow-up, then Use text in composer. Finish or clear the current message first.';
function owner(){
 const item:QueuedFollowup={id:'held',revision:2,prompt,kind:'explain',createdAt:'time',sourceRefs:[],status:'held',reason,basis:'a'.repeat(64),scope:'b'.repeat(64),precedingRequestIds:['cancelled-parent']};
 const task:Task={id:'owner',title:'Held queue owner',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[],requests:[{id:'cancelled-parent',kind:'explain',prompt:'Earlier question',digest:'c'.repeat(64),status:'cancelled',sourceRefs:[],startedAt:'time'}],procedures:[],checkpoints:[],actions:[],memory:{enabled:false},session:{...emptyTaskSession(),queuedFollowups:[item]}};
 return {task,item};
}
function text(node:{type:string;props:Record<string,any>;children:any[]}):string{return node.type==='#text'?node.props.text:node.children.map(text).join('');}
it('shows the blocked prerequisite recovery and saves exact edited text with a neutral label',async()=>{
 const {task,item}=owner(),onHold=vi.fn(async()=>{}),onSave=vi.fn(async()=>{}),onCancel=vi.fn(async()=>{}),onRecover=vi.fn(),r=createControlledRenderer(()=>createElement(QueuedFollowups,{task,disabled:false,canRecover:true,onHold,onSave,onCancel,onRecover})),button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
 r.render();expect(r.nodes().filter(node=>node.type==='#text').map(text).join('')).toContain(reason);expect(r.find(node=>node.props.className==='queue-prompt').children.map(text).join('')).toBe(prompt);
 button('Review or edit').props.onClick();await vi.waitFor(()=>{r.render();expect(r.find(node=>node.type==='textarea').props.value).toBe(prompt);});expect(onHold).toHaveBeenCalledOnce();
 const edited='  Reviewed exact text\r\n日本語  ';r.find(node=>node.type==='textarea').props.onChange({target:{value:edited}});r.render();expect(r.nodes().filter(node=>node.type==='button').map(text)).not.toContain('Save and queue with current context');button('Save follow-up').props.onClick();await vi.waitFor(()=>expect(onSave).toHaveBeenCalledWith(item,edited));expect(item.precedingRequestIds).toEqual(['cancelled-parent']);expect(item.prompt).toBe(prompt);expect(onRecover).not.toHaveBeenCalled();expect(onCancel).not.toHaveBeenCalled();
});
it('recovers cancelled text through the actual App callback only while the composer remains empty',async()=>{
 const {task,item}=owner(),drafts=createComposerDrafts(async(_id,revision,value)=>({...value,revision:revision+1}));drafts.hydrate([task]);
 const app=readFileSync('src/renderer/src/App.tsx','utf8'),source=app.match(/ onRecover=\{(item=>\{.+?\})\}\/><Composer/)?.[1];expect(source).toBeTruthy();const script=ts.transpileModule('const recover='+source+';', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,recover=Function('drafts','task',script+'return recover;')(drafts,task);
 const onCancel=vi.fn(async()=>{task.session={...task.session!,queuedFollowups:[{...item,status:'cancelled'}]};}),r=createControlledRenderer(()=>createElement(QueuedFollowups,{task,disabled:false,canRecover:!drafts.getSnapshot()[task.id]?.text.trim(),onHold:async()=>{},onSave:async()=>{},onCancel,onRecover:recover})),button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
 r.render();button('Cancel follow-up').props.onClick();await vi.waitFor(()=>{r.render();expect(task.session?.queuedFollowups?.[0].status).toBe('cancelled');});expect(item.prompt).toBe(prompt);const capturedRecover=button('Use text in composer').props.onClick;expect(button('Use text in composer').props.disabled).toBe(false);
 drafts.edit(task.id,{text:'Newer unsent composer text',kind:'create'});r.render();expect(button('Use text in composer').props.disabled).toBe(true);capturedRecover();expect(drafts.getSnapshot()[task.id].text).toBe('Newer unsent composer text');
 drafts.edit(task.id,{text:'',kind:'create'});r.render();button('Use text in composer').props.onClick();expect(drafts.getSnapshot()[task.id]).toEqual({text:prompt,kind:item.kind});expect(item.precedingRequestIds).toEqual(['cancelled-parent']);expect(task.requests).toHaveLength(1);expect(onCancel).toHaveBeenCalledOnce();
});
