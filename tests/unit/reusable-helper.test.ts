import {expect,test} from 'vitest';
import {helperStudio,runHelper,checkHelper,discoverHelper,type HelperState} from '../../src/learning/reusable-helper';
import {helperExample} from '../../src/learning/helper-example';
import {parseModule,initialModuleState,updateModuleState,moduleText} from '../../src/core/interactive-modules';

test('app-owned demonstration becomes an executable, tested helper with exception and explicit activation',()=>{
 let state=helperStudio.initial(helperExample);
 const act=(action:Record<string,unknown>)=>{state=helperStudio.update(helperExample,state,{...action,expectedRevision:state.revision});};
 act({kind:'start-demonstration',input:'  River   Dock  '});
 act({kind:'demonstrate-step',operation:{kind:'trim'}});
 act({kind:'demonstrate-step',operation:{kind:'collapse-spaces'}});
 act({kind:'finish-demonstration'});
 expect(state.draft.tests[0].expected).toEqual({kind:'output',text:'River Dock'});
 act({kind:'add-test',test:{id:'protected',label:'Preserve protected labels',role:'counterexample',input:'KEEP:   Dock  ',expected:{kind:'output',text:'KEEP:   Dock  '}}});
 expect(checkHelper(state.draft).passed).toBe(false);
 expect(()=>helperStudio.update(helperExample,state,{kind:'save-version',changeNote:'First version',expectedRevision:state.revision})).toThrow(/tests/);
 act({kind:'add-exception',exception:{id:'protected-labels',contains:'KEEP:',behavior:'preserve',reason:'Keep spacing for protected identifiers'}});
 expect(checkHelper(state.draft).passed).toBe(true);
 act({kind:'save-version',changeNote:'Preserve protected labels'});
 expect(state.activeVersion).toBeNull();
 expect(()=>runHelper(state,'  New   Dock ',{capability:'local-text'})).toThrow(/Activate/);
 act({kind:'activate-version',version:1});
 expect(runHelper(state,'  New   Dock ',{capability:'local-text'})).toMatchObject({kind:'output',text:'New Dock',version:1});
 expect(runHelper(state,'KEEP:   Dock  ',{capability:'local-text'})).toMatchObject({kind:'output',text:'KEEP:   Dock  ',exceptionId:'protected-labels'});
});

function savedHelper(){
 let state=helperStudio.initial(helperExample);
 const act=(action:Record<string,unknown>)=>{state=helperStudio.update(helperExample,state,{...action,expectedRevision:state.revision});};
 act({kind:'append-operation',operation:{kind:'trim'}});
 act({kind:'add-test',test:{id:'plain',label:'Trim a label',role:'example',input:' River ',expected:{kind:'output',text:'River'}}});
 act({kind:'add-test',test:{id:'empty',label:'Empty stays empty',role:'counterexample',input:'',expected:{kind:'output',text:''}}});
 act({kind:'save-version',changeNote:'Trim only'});act({kind:'activate-version',version:1});
 return {get state(){return state;},act};
}

test('correction requires new passing tests, saving does not switch active version, and rollback restores behavior',()=>{
 const h=savedHelper(),original=JSON.stringify(h.state.versions[0]);
 h.act({kind:'append-operation',operation:{kind:'uppercase'}});
 expect(checkHelper(h.state.draft).passed).toBe(false);
 expect(runHelper(h.state,' Dock ',{capability:'local-text'})).toMatchObject({text:'Dock',version:1});
 h.act({kind:'add-test',test:{id:'plain',label:'Trim and uppercase',role:'example',input:' River ',expected:{kind:'output',text:'RIVER'}}});
 h.act({kind:'save-version',changeNote:'User correction: uppercase labels'});
 expect(h.state.activeVersion).toBe(1);
 expect(JSON.stringify(h.state.versions[0])).toBe(original);
 h.act({kind:'activate-version',version:2});
 expect(runHelper(h.state,' Dock ',{capability:'local-text'})).toMatchObject({text:'DOCK',version:2});
 h.act({kind:'activate-version',version:1});
 expect(runHelper(h.state,' Dock ',{capability:'local-text'})).toMatchObject({text:'Dock',version:1});
 expect(discoverHelper(helperExample,h.state,'pasted label')).toMatchObject({version:1,invocation:'Clean this pasted label'});
 expect(discoverHelper(helperExample,h.state,'unrelated')).toBeNull();
 const restored=helperStudio.parseState(helperExample,JSON.parse(JSON.stringify(h.state)));
 expect(runHelper(restored,' Dock ',{capability:'local-text'})).toMatchObject({text:'Dock'});
});

test('typed local actions run on host-owned module state and reject stale runs and forged outcomes',()=>{
 const h=savedHelper(),data=parseModule(helperExample);
 expect(initialModuleState(data).kind).toBe('helper-studio');
 const next=updateModuleState(data,h.state,{kind:'run-active',input:' Fresh ',expectedRevision:h.state.revision});
 const parsed=helperStudio.parseState(data,next);
 expect(parsed.lastRun).toMatchObject({version:1,input:' Fresh ',result:{kind:'output',text:'Fresh'}});
 expect(moduleText(data,parsed)).toContain('Active version: 1');
 expect(()=>updateModuleState(data,next,{kind:'run-active',input:' Again ',expectedRevision:h.state.revision})).toThrow(/changed/);
 expect(()=>helperStudio.parseState(data,{...parsed,lastRun:{...parsed.lastRun,result:{kind:'output',text:'forged',exceptionId:null,trace:[]}}})).toThrow(/exact input/);
});

test('declared abstention wins before any operation and is independently checkable',()=>{
 const h=savedHelper();
 h.act({kind:'add-exception',exception:{id:'private',contains:'PRIVATE:',behavior:'abstain',reason:'Ask before transforming protected text'}});
 h.act({kind:'add-test',test:{id:'private-case',label:'Protected text',role:'counterexample',input:'PRIVATE: A',expected:{kind:'abstain'}}});
 h.act({kind:'save-version',changeNote:'Abstain on protected input'});h.act({kind:'activate-version',version:2});
 expect(runHelper(h.state,'PRIVATE: A',{capability:'local-text'})).toMatchObject({kind:'abstain',exceptionId:'private',trace:[]});
});

test('executable capability cannot be broadened, code and regex operations are rejected, and literal replacement stays literal',()=>{
 const h=savedHelper();
 expect(()=>runHelper(h.state,'text',{capability:'shell'})).toThrow();
 expect(()=>runHelper(h.state,'text',{capability:'local-text',permission:'network'})).toThrow();
 expect(()=>h.act({kind:'append-operation',operation:{kind:'javascript',code:'globalThis.fetch("https://example.com")'}})).toThrow();
 expect(()=>h.act({kind:'append-operation',operation:{kind:'replace-literal',find:'',replacement:'x'}})).toThrow();
 h.act({kind:'append-operation',operation:{kind:'replace-literal',find:'.*',replacement:'safe'}});
 h.act({kind:'add-test',test:{id:'literal',label:'No regex interpretation',role:'counterexample',input:'x.*y',expected:{kind:'output',text:'xsafey'}}});
 expect(checkHelper(h.state.draft).passed).toBe(true);
});

test('demonstration alignment, source identity and bounded output are validated',()=>{
 const h=savedHelper();
 expect(()=>helperStudio.parseState(helperExample,{...h.state,helperId:'another'})).toThrow(/different/);
 expect(()=>helperStudio.parseState(helperExample,{...h.state,recording:{input:' A ',current:'wrong',steps:[{operation:{kind:'trim'},before:' A ',after:'A'}]}})).toThrow(/Recording output/);
 expect(()=>h.act({kind:'add-test',test:{id:'fake-demo',label:'Fake',role:'example',input:' A ',expected:{kind:'output',text:'A'},demonstration:[{operation:{kind:'trim'},before:' A ',after:'invented'}]}})).toThrow(/trace/);
 h.act({kind:'start-demonstration',input:'x'.repeat(4000)});
 expect(()=>h.act({kind:'demonstrate-step',operation:{kind:'replace-literal',find:'x',replacement:'y'.repeat(80)}})).toThrow(/limit/);
 expect(h.state.recording?.current.length).toBe(4000);
});

test('saving requires a distinct-input counterexample and an exercised test for each declared exception',()=>{
 const h=savedHelper();
 h.act({kind:'remove-test',id:'empty'});
 h.act({kind:'add-test',test:{id:'duplicate',label:'Renamed example',role:'counterexample',input:' River ',expected:{kind:'output',text:'River'}}});
 expect(checkHelper(h.state.draft).coverageIssues).toContain('Add a counterexample with different input.');
 h.act({kind:'add-exception',exception:{id:'untested',contains:'PROTECTED:',behavior:'preserve',reason:'Keep protected spacing'}});
 expect(checkHelper(h.state.draft).coverageIssues).toContain('Exercise exception untested in a check.');
 expect(()=>h.act({kind:'save-version',changeNote:'Uncovered rule'})).toThrow(/tests/);
});
