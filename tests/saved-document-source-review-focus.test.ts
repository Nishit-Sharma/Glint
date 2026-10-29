import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
const probe=vi.hoisted(()=>({root:undefined as unknown}));
vi.mock('react',async original=>{const react=await original<typeof import('react')>(),{hooks}=await import('./controlled-renderer.fixture');return {...react,...hooks,useRef(initial:unknown){const ref=hooks.useRef(initial) as {current:unknown};if(initial===null&&probe.root)ref.current=probe.root;return ref;}};});
import {createElement} from 'react';
import {createCompanion} from '../src/core/companion';
import {LearningDraftStore} from '../src/host/learning-drafts';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {createSavedDocumentDraftController} from '../src/renderer/src/saved-document-draft-controller';
import {SavedDocumentSourceReview} from '../src/renderer/src/components/SavedDocumentSourceReview';
import {createControlledRenderer} from './controlled-renderer.fixture';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{probe.root=undefined;for(const close of cleanup.splice(0).reverse())await close();});

it.each(['remaining-enabled','remaining-blocked','last-link','retired-scope','detached-region'] as const)('adoption moves focus to a stable enabled target: %s',async outcome=>{
 const directory=await mkdtemp(join(tmpdir(),'document-review-focus-')),core=await createCompanion({dataDir:directory});let task=await core.createTask({title:'Source review focus'}),scope='original';
 for(const name of ['A','B'])task=await core.putSource(task.id,{kind:'text',role:'fact',label:name,content:name+' original.'});
 const [a,b]=task.sources.map(source=>source.id),refs=task.sources.map(source=>({sourceId:source.id,version:1,digest:source.versions[0].digest})),saved=await core.saveArtifact(task.id,{title:'Plan',mimeType:'text/plain',content:'Original plan.',sourceRefs:refs});task=await core.putSource(task.id,{id:a,kind:'text',role:'fact',label:'A',content:'A changed.'});if(outcome==='remaining-enabled'||outcome==='detached-region')task=await core.putSource(task.id,{id:b,kind:'text',role:'fact',label:'B',content:'B changed.'});if(outcome==='remaining-blocked')task=await core.invalidateSource(task.id,b,'B requires refresh.');
 const store=new LearningDraftStore({directory,lookupTask:async id=>(await core.listTasks()).find(item=>item.id===id)}),cache=createLearningDrafts({read:()=>store.read(),save:(...args)=>store.save(...args)});await cache.load();cleanup.push(async()=>{await cache.flush().catch(()=>{});await core.close();await rm(directory,{recursive:true,force:true});});
 const controller=createSavedDocumentDraftController({cache,artifactId:saved.artifactId,task:()=>task,base:()=>saved.revision,isCurrent:()=>true,scope:()=>scope,send:async()=>{throw Error('Focus must not save a revision.');},onSaved:()=>{}});let focused='',disabledAttempts=0;
 const disabledCheckbox={disabled:true,focus(){disabledAttempts++;}},remainingButton={isConnected:outcome!=='detached-region',focus(){focused='B review';}},picker={isConnected:outcome!=='detached-region',tabIndex:undefined as number|undefined,querySelector(){return disabledCheckbox;},focus(){if(this.tabIndex===-1)focused='Linked sources';}},rows=[{dataset:{sourceReviewId:a},querySelector(){return null;}},...(outcome==='last-link'?[]:[{dataset:{sourceReviewId:b},querySelector(){return outcome==='remaining-enabled'||outcome==='detached-region'?remainingButton:null;}}])];
 probe.root={closest:()=>picker,querySelectorAll:()=>rows};
 const r=createControlledRenderer(()=>createElement(SavedDocumentSourceReview,{controller})),text=(node:ReturnType<typeof r.nodes>[number]):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');r.render();if(outcome==='retired-scope')scope='retired';r.find(node=>node.type==='button'&&text(node)==='Use reviewed version 2 · A').props.onClick();r.render();
 expect(focused).toBe(outcome==='remaining-enabled'?'B review':outcome==='retired-scope'||outcome==='detached-region'?'':'Linked sources');expect(disabledAttempts).toBe(0);expect(controller.snapshot().fields.sourceRefs.map(ref=>ref.version)).toEqual(outcome==='retired-scope'?[1,1]:[2,1]);expect(controller.snapshot().canSave).toBe(outcome==='last-link');expect((await core.getTask(task.id)).artifacts[0].revisions).toEqual([saved.revision]);
});
