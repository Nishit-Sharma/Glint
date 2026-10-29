import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test,vi} from 'vitest';
import {helperStudio,type HelperState} from '../src/learning/reusable-helper';
import {helperExample} from '../src/learning/helper-example';
import {HelperStudio} from '../src/renderer/src/components/HelperStudio';
import {createLearningDrafts} from '../src/renderer/src/learning-drafts';
import {legacyHelperDraftBasis} from '../src/renderer/src/legacy-helper-draft-basis';
import {navigationFormBasis} from '../src/renderer/src/learning-draft-basis';
import {learningDraftKey,type LearningDraftRecord,type LearningDraftOwner} from '../src/shared/learning-drafts';
const mocked=vi.hoisted(()=>({value:undefined as unknown}));
vi.mock('../src/renderer/src/learning-draft-context',()=>({useLearningDraft:(_initial:unknown,slot:string)=>slot==='helper:text:check'?{owner:{},slot,cache:{},form:{value:mocked.value,status:'ready'},feedback:null,maintenance:false,frozen:false}:undefined}));
const owner={taskId:'t',artifactId:'a',artifactRevision:1,artifactDigest:'d',moduleId:'m',moduleVersion:1};
const initial={editingTest:'',testInput:'KEEP:   Dock  ',testOutput:'KEEP:   Dock  ',testKind:'output' as const,testRole:'counterexample' as const};
function setup(){let state=helperStudio.initial(helperExample);const act=(action:Record<string,unknown>)=>{state=helperStudio.update(helperExample,state,{...action,expectedRevision:state.revision});};act({kind:'start-demonstration',input:'  River  '});act({kind:'demonstrate-step',operation:{kind:'trim'}});act({kind:'finish-demonstration'});return {get state(){return state;},act};}
async function draft(state:HelperState,selected:string){let records:LearningDraftRecord[]=[];const cache=createLearningDrafts({read:async()=>({kind:'available',epoch:'initial',records}),save:async(owner,slot,_epoch,revision,value)=>{const record={owner,slot,revision:revision+1,value};records=records.filter(r=>learningDraftKey(r.owner,r.slot)!==learningDraftKey(owner,slot));records.push(record);return {kind:'saved',epoch:'initial',record};}});await cache.load();const basis=navigationFormBasis(initial,{slot:'helper:text:check',basisMode:'explicit',basis:legacyHelperDraftBasis(state,'check')});cache.edit(owner,'helper:text:check',initial,basis,()=>({...initial,editingTest:selected,testInput:'  River  ',testOutput:'River',testRole:'example'}));return {cache,basis};}
function view(state:HelperState,selected:string){mocked.value={...initial,editingTest:selected,testInput:'  River  ',testOutput:'River',testRole:'example'};return renderToStaticMarkup(createElement(HelperStudio,{data:helperExample,state,onAction:()=>{}}));}
test('a recorded check keeps its input bound to the original demonstration while its expectation remains editable',async()=>{
 const h=setup(),recorded=h.state.draft.tests[0],html=view(h.state,recorded.id);
 expect(html).toMatch(/<textarea[^>]*aria-label="Test input"[^>]*readonly/i);expect(html).toContain('Recorded input belongs to the original demonstration');
 expect(()=>h.act({kind:'add-test',test:{...recorded,input:' Changed '}})).toThrow(/trace/);
 h.act({kind:'add-test',test:{...recorded,expected:{kind:'output',text:'Different expectation'}}});expect(h.state.draft.tests[0].demonstration).toEqual(recorded.demonstration);expect(h.state.draft.tests[0].input).toBe(recorded.input);
});
test('exact selected-check acknowledgement preserves a later selected draft generation',async()=>{
 const h=setup(),recorded=h.state.draft.tests[0],{cache,basis}=await draft(h.state,recorded.id);await cache.flushForm(owner,'helper:text:check');const token=cache.capture(owner,'helper:text:check')!;
 h.act({kind:'add-test',test:{...recorded,expected:{kind:'output',text:'Changed expectation'}}});
 cache.edit(owner,'helper:text:check',initial,basis,current=>({...current,editingTest:'another-check',testInput:'newer input'}));expect(cache.acknowledge(token)).toBe(false);await cache.flush();
 expect(cache.readForm(owner,'helper:text:check',initial,basis)).toMatchObject({value:{editingTest:'another-check',testInput:'newer input'}});
});
test('an ordinary selected check remains editable and an exact acknowledgement clears only its own generation',async()=>{
 const h=setup();h.act({kind:'add-test',test:{id:'ordinary',label:'Ordinary',role:'counterexample',input:'  River  ',expected:{kind:'output',text:'River'}}});
 const html=view(h.state,'ordinary');expect(html).not.toMatch(/<textarea[^>]*aria-label="Test input"[^>]*readonly/i);expect(html).not.toContain('Recorded input belongs to the original demonstration');
 const {cache,basis}=await draft(h.state,'ordinary');await cache.flushForm(owner,'helper:text:check');const token=cache.capture(owner,'helper:text:check')!;h.act({kind:'add-test',test:{id:'ordinary',label:'Ordinary',role:'counterexample',input:'  Edited  ',expected:{kind:'output',text:'Edited'}}});expect(cache.acknowledge(token)).toBe(true);await cache.flush();expect(cache.readForm(owner,'helper:text:check',initial,basis)).toMatchObject({value:initial,status:'ready'});
});
test('an earlier raw change to recorded input survives reopening, remains copyable and cannot be sent',async()=>{
 const h=setup(),recorded=h.state.draft.tests[0];let records:LearningDraftRecord[]=[];const transport={read:async()=>({kind:'available' as const,epoch:'initial',records}),save:async(owner:LearningDraftOwner,slot:string,_epoch:string,revision:number,value:LearningDraftRecord['value'])=>{const record={owner,slot,revision:revision+1,value};records=records.filter(r=>learningDraftKey(r.owner,r.slot)!==learningDraftKey(owner,slot));records.push(record);return {kind:'saved' as const,epoch:'initial',record};}};
 const basis=navigationFormBasis(initial,{slot:'helper:text:check',basisMode:'explicit',basis:legacyHelperDraftBasis(h.state,'check')}),cache=createLearningDrafts(transport);await cache.load();cache.edit(owner,'helper:text:check',initial,basis,()=>({...initial,editingTest:recorded.id,testInput:'Earlier different input',testOutput:'River',testRole:'example'}));await cache.flush();
 const reopened=createLearningDrafts(transport);await reopened.load();const saved=reopened.readForm(owner,'helper:text:check',initial,basis);expect(saved.status).toBe('ready');expect(saved.value).toMatchObject({editingTest:recorded.id,testInput:'Earlier different input'});mocked.value=saved.value;
 const html=renderToStaticMarkup(createElement(HelperStudio,{data:helperExample,state:h.state,onAction:()=>{}}));expect(html).toContain('Earlier different input');expect(html).toMatch(/<textarea[^>]*aria-label="Test input"[^>]*readonly/i);expect(html).toContain('This earlier edit changes recorded input.');expect(html).toMatch(/<button disabled="">Save check correction<\/button>/);
});
