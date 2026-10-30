import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import type {Task} from '../src/core/types';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {UnfinishedDocuments} from '../src/renderer/src/components/UnfinishedDocuments';
import type {SavedWorkOpenScope} from '../src/renderer/src/components/SavedWorkSearch';
import {SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis,savedDocumentDraftOwner} from '../src/shared/saved-document-draft';
import {createControlledRenderer} from './controlled-renderer.fixture';
type Node=ReturnType<ReturnType<typeof createControlledRenderer>['nodes']>[number];
const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
function task(title:string,index:number):Task{
 const sourceId='source-'+index,sourceDigest='c'.repeat(64),ref={sourceId,version:1,digest:sourceDigest};
 return {id:'task-'+index,title,goal:'Saved owner',status:'active',createdAt:'time',updatedAt:'time',sources:index===2?[{id:sourceId,currentVersion:2,freshness:'fresh',versions:[{id:sourceId,version:1,digest:sourceDigest,kind:'text',role:'fact',label:'Owned source',content:'Old source',capturedAt:'time'},{id:sourceId,version:2,digest:'d'.repeat(64),kind:'text',role:'fact',label:'Owned source',content:'New source',capturedAt:'time'}]}]:[],artifacts:[{id:'document-'+index,revisions:[{revision:1,digest:(index===1?'a':'b').repeat(64),title:title+' plan',content:'SAVED_BODY_PRIVATE_'+index,mimeType:'text/markdown',encoding:'utf8',sourceRefs:index===2?[ref]:[],createdAt:'time'}]}],procedures:[],requests:[],checkpoints:[],actions:[],memory:{enabled:false}};
}
async function fixture(){
 let tasks=[task('Orchard',1),task('Mesa',2)];const scopes:SavedWorkOpenScope[]=[],opened:unknown[]=[];
 const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records:[]}),save:async(owner,slot,epoch,revision,value)=>({kind:'saved',epoch,record:{owner,slot,revision:revision+1,value}})});await cache.load();
 for(const owner of tasks){const artifact=owner.artifacts[0],revision=artifact.revisions[0];expect(cache.tryEdit(savedDocumentDraftOwner(owner.id,artifact.id),SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis(owner,artifact.id,revision),()=>({present:true,title:'RAW_TITLE_PRIVATE_'+owner.id,content:owner.id==='task-2'?'':'RAW_BODY_PRIVATE',sourceRefs:revision.sourceRefs})).kind).toBe('accepted');}await cache.flush();
 const r=createControlledRenderer(()=>createElement(UnfinishedDocuments,{tasks,cache,onOpen:(match,scope)=>{opened.push(match);scopes.push(scope);scope.started();}}));r.render();
 const row=(name:string)=>r.find(node=>node.type==='button'&&node.props['aria-label']===`Open document edits: ${name} plan in ${name}`),query=(value:string)=>{r.find(node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value}});r.render();},filter=(value:string)=>{r.find(node=>node.type==='select').props.onChange({target:{value}});r.render();};
 return {r,cache,row,query,filter,scopes,opened,get tasks(){return tasks},setTasks:(next:Task[])=>{tasks=next;r.render();}};
}
test('renders ownership and recovery status, with filters over saved names only and no raw text disclosure',async()=>{
 const f=await fixture(),shown=f.r.nodes().map(text).join('\n');expect(shown).toContain('Task: Mesa');expect(shown).toContain('Source links need review');expect(shown).toContain('Continue editing');expect(shown).not.toContain('RAW_TITLE_PRIVATE');expect(shown).not.toContain('RAW_BODY_PRIVATE');expect(shown).not.toContain('SAVED_BODY_PRIVATE');expect(f.opened).toEqual([]);
 f.filter('review');expect(f.r.nodes().some(node=>node.props['aria-label']==='Open document edits: Orchard plan in Orchard')).toBe(false);expect(f.row('Mesa').props.disabled).toBe(false);
 f.query('Orchard');expect(f.r.nodes().some(node=>node.props.role==='status'&&text(node)==='No unfinished document edits match this view.')).toBe(true);f.filter('all');expect(f.row('Orchard').props.disabled).toBe(false);f.query('RAW_TITLE_PRIVATE');expect(f.r.nodes().some(node=>node.type==='button')).toBe(false);expect(f.opened).toEqual([]);
});
test('opens the saved owning identity once and retires a pending selection when the filter changes',async()=>{
 const f=await fixture(),click=f.row('Mesa').props.onClick;click();click();f.r.render();expect(f.opened).toHaveLength(1);expect(JSON.stringify(f.opened)).not.toContain('RAW_');expect(f.scopes[0].current()).toBe(true);expect(f.row('Mesa').props.disabled).toBe(true);
 f.query('Orchard');expect(f.scopes[0].current()).toBe(false);f.scopes[0].failed(Error('Old scoped error'));f.scopes[0].finished();click();f.r.render();expect(f.opened).toHaveLength(1);expect(f.r.nodes().some(node=>node.props.role==='alert')).toBe(false);
});
test('a changed draft or deleted owner retires its selected row while completion still clears local pending state',async()=>{
 const f=await fixture();f.row('Orchard').props.onClick();const owner=f.tasks[0],artifact=owner.artifacts[0];f.cache.tryEdit(savedDocumentDraftOwner(owner.id,artifact.id),SAVED_DOCUMENT_DRAFT_SLOT,emptySavedDocumentDraft,savedDocumentDraftBasis(owner,artifact.id,artifact.revisions[0]),value=>({...value,content:'Newer exact local input'}));await f.cache.flush();f.r.render();expect(f.scopes[0].current()).toBe(false);f.scopes[0].finished();f.r.render();expect(f.row('Orchard').props.disabled).toBe(false);
 const old=f.row('Mesa').props.onClick;f.setTasks([owner]);old();expect(f.opened).toHaveLength(1);
});
test('a retained handler cannot open after storage freezes before the disabled state renders',async()=>{
 const f=await fixture(),click=f.row('Orchard').props.onClick;f.cache.setFrozen(true);click();expect(f.opened).toEqual([]);f.r.render();expect(f.row('Orchard').props.disabled).toBe(true);expect(f.r.nodes().some(node=>node.props.role==='status'&&text(node).includes('editing is paused'))).toBe(true);
});
test('loading and unreadable storage do not claim that no drafts exist or reveal transport diagnostics',async()=>{
 const cache=createLearningDrafts({read:async()=>({kind:'unavailable',message:'PRIVATE_STORAGE_DIAGNOSTIC'}),save:async()=>{throw Error('No write expected.');}}),r=createControlledRenderer(()=>createElement(UnfinishedDocuments,{tasks:[],cache,onOpen:()=>{throw Error('No open expected.');}}));r.render();expect(r.nodes().some(node=>node.props.role==='status'&&text(node).includes('Loading'))).toBe(true);expect(r.nodes().some(node=>text(node).includes('No known unfinished'))).toBe(false);await cache.load();r.render();expect(r.nodes().some(node=>node.props.role==='alert'&&text(node).includes('could not be read'))).toBe(true);expect(r.nodes().some(node=>text(node).includes('PRIVATE_STORAGE_DIAGNOSTIC'))).toBe(false);expect(r.nodes().some(node=>text(node).includes('No known unfinished'))).toBe(false);
});
