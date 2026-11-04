import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('../support/controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {mkdir} from 'node:fs/promises';
import {createControlledRenderer} from '../support/controlled-renderer.fixture';
import {sourceIntakeHostFixture,hold} from '../support/source-intake-host.fixture';
import {checkedSuggestionHelper} from '../support/helper-suggestions.fixture';
import {HelperSuggestions} from '../../src/renderer/src/components/HelperSuggestions';
import type {HelperSuggestionCommand} from '../../src/shared/helper-suggestions';
type R=ReturnType<typeof createControlledRenderer>;type N=ReturnType<R['nodes']>[number];const text=(n:N):string=>n.type==='#text'?n.props.text:n.children.map(text).join('');const button=(r:R,name:string)=>r.find(n=>n.type==='button'&&text(n)===name);
afterEach(()=>vi.unstubAllGlobals());
async function fixture(goal='Trim labels for printing'){
 await mkdir('work/continuation',{recursive:true});const f=await sourceIntakeHostFixture();await f.core.updateTask(f.task.id,{title:'Stock',goal});await checkedSuggestionHelper(f.core,f.task.id);const task=await f.core.getTask(f.task.id),commands:HelperSuggestionCommand[]=[],opened:any[]=[],links:string[]=[];let scope='1',current=true,gate:ReturnType<typeof hold>|undefined;const pending:Promise<unknown>[]=[];
 const invoke=(command:HelperSuggestionCommand)=>{commands.push(command);const promise=f.host.dispatch(command).then(async result=>{if(gate){gate.enter();await gate.wait;}return result;});pending.push(promise);return promise;};
 const r=createControlledRenderer(()=>createElement(HelperSuggestions,{task,scope,disabled:false,isCurrent:()=>current,invoke,onOpen:result=>opened.push(result),onCatalogue:()=>links.push('catalogue'),onCreate:()=>links.push('create')}));r.render();
 const settle=async()=>{await Promise.allSettled(pending.splice(0));await new Promise<void>(resolve=>setImmediate(resolve));r.render();};return {f,r,commands,opened,links,settle,setScope(value:string){scope=value;r.render();},retire(){current=false;scope='retired';r.render();},hold(){gate=hold();return gate;}};
}
it('actual controls remain inert until requested, show relevant evidence/current versions, then open review without activation',async()=>{
 const f=await fixture(),before=await f.f.core.contentSnapshot();expect(f.commands).toEqual([]);button(f.r,'Find helper suggestions').props.onClick();await f.settle();expect(f.commands.map(c=>c.type)).toEqual(['helper.suggestions.preview']);expect(f.r.nodes().some(n=>text(n).includes('Possible fit:'))).toBe(true);expect(f.r.nodes().some(n=>text(n).includes('Trim labels for printing'))).toBe(true);expect(f.r.nodes().some(n=>text(n).includes('Inactive · saved version 1'))).toBe(true);button(f.r,'Open helper for preview').props.onClick();await f.settle();expect(f.commands.map(c=>c.type)).toEqual(['helper.suggestions.preview','helper.suggestions.open']);expect(f.opened).toHaveLength(1);expect(await f.f.core.contentSnapshot()).toEqual(before);expect(f.f.calls.transports).toBe(0);
});
it('rapid duplicate requests produce one read and a retired result never populates a new scope',async()=>{
 const f=await fixture(),gate=f.hold(),click=button(f.r,'Find helper suggestions').props.onClick;click();click();await gate.started;expect(f.commands).toHaveLength(1);f.retire();gate.release();await f.settle();expect(f.r.nodes().some(n=>text(n).includes('Possible fit:'))).toBe(false);expect(f.opened).toEqual([]);
});
it('no-match explains the local limit and keeps create/catalogue as separate explicit navigation',async()=>{
 const f=await fixture('Calculate orbital periods');button(f.r,'Find helper suggestions').props.onClick();await f.settle();expect(f.r.nodes().some(n=>text(n).includes('No exact-word matches within this search'))).toBe(true);button(f.r,'Create a helper in this task').props.onClick();button(f.r,'Browse saved helpers').props.onClick();expect(f.links).toEqual(['create','catalogue']);expect(f.commands).toHaveLength(1);expect(f.opened).toEqual([]);
});
