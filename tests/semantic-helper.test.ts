import {expect,test} from 'vitest';
import {semanticHelper} from '../src/learning/semantic-helper';
import type {SemanticProcedure} from '../src/learning/semantic-procedure';

function plan():SemanticProcedure{return {
 schemaVersion:1,id:'routing',version:1,intent:'Route a local request.',target:'local-record',
 input:{name:'request',fields:[{name:'amount',kind:'number',minimum:0,maximum:10000},{name:'approved',kind:'boolean'},{name:'sensitive',kind:'boolean'}]},
 output:{name:'decision',fields:[{name:'route',kind:'string',minLength:1,maxLength:20}]},
 preconditions:[{id:'approval',reason:'Review first.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}}}],
 postconditions:[{id:'valid',reason:'Use a valid route.',predicate:{kind:'any',terms:[{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'standard'}},{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'manual'}}]}}],
 root:{kind:'branch',id:'private',intent:'Check sensitivity.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'sensitive'},right:{kind:'literal',value:true}},then:{kind:'abstain',id:'stop',intent:'Stop for review.',reason:'Sensitive input needs review.'},else:{kind:'branch',id:'threshold',intent:'Check amount.',predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:1000}},then:{kind:'assign',id:'manual',intent:'Use manual route.',field:'route',value:{kind:'literal',value:'manual'},next:{kind:'return',id:'manual-done',intent:'Return.'}},else:{kind:'assign',id:'standard',intent:'Use standard route.',field:'route',value:{kind:'literal',value:'standard'},next:{kind:'return',id:'standard-done',intent:'Return.'}}}},
};}
function evidence(){return {rationales:[{id:'reason',kind:'inferred-rationale',stepId:'threshold',basis:[{recordingId:'recording-2',traceStepId:'threshold'}],reason:'The amount appears to determine the route.'}],corrections:[],examples:[
 {id:'fresh',role:'held-out',input:{amount:2000,approved:true,sensitive:false},expected:{status:'completed',output:{route:'manual'}}},
 {id:'not-approved',role:'counterexample',input:{amount:20,approved:false,sensitive:false},expected:{status:'abstained',haltedStepId:'approval',code:'precondition'}},
 {id:'sensitive',role:'exception',input:{amount:20,approved:true,sensitive:true},expected:{status:'abstained',haltedStepId:'stop',code:'explicit-stop'}},
]};}
function fixture(){
 let state=semanticHelper.initial('owned-helper');
 function act(action:Record<string,unknown>){state=semanticHelper.update('owned-helper',state,{...action,expectedRevision:state.revision});return state;}
 return {get state(){return state;},act};
}
function prepared(){const f=fixture();f.act({kind:'set-semantic-procedure',procedure:plan()});f.act({kind:'record-semantic-input',input:{amount:100,approved:true,sensitive:false}});f.act({kind:'set-semantic-evidence',...evidence()});return f;}

test('host-derived recording and checked save require separate explicit activation and run',()=>{
 const f=prepared();expect(f.state.recordings[0]).toMatchObject({recordingId:'recording-2',helperId:'owned-helper',atRevision:2,externalObservationVerified:false,effectAuthority:'none'});
 expect(()=>f.act({kind:'run-semantic-active',input:{amount:2000,approved:true,sensitive:false}})).toThrow(/activate/i);
 f.act({kind:'save-semantic-version',changeNote:'First reviewed local record.'});expect(f.state.activeVersion).toBeNull();
 expect(f.state.versions[0]).toMatchObject({version:1,procedureVersion:1});
 f.act({kind:'activate-semantic-version',version:1});f.act({kind:'run-semantic-active',input:{amount:2000,approved:true,sensitive:false}});
 expect(f.state.lastRun).toMatchObject({version:1,result:{status:'completed',output:{route:'manual'},effectAuthority:'none'}});
 expect(semanticHelper.parseState('owned-helper',JSON.parse(JSON.stringify(f.state)))).toEqual(f.state);
});

test('corrected definition preserves the old recording while first saved helper version stays contiguous',()=>{
 const f=prepared(),original=JSON.stringify(f.state.recordings[0]),changed=structuredClone(plan());
 if(changed.root.kind!=='branch'||changed.root.else.kind!=='branch'||changed.root.else.then.kind!=='assign')throw Error('Fixture needs a branch.');
 const corrected:SemanticProcedure={...changed,root:{...changed.root,else:{...changed.root.else,then:{...changed.root.else.then,value:{kind:'literal',value:'standard'}}}}};
 f.act({kind:'set-semantic-procedure',procedure:corrected});
 const revised=evidence();revised.examples[0]={id:'fresh',role:'held-out',input:{amount:2000,approved:true,sensitive:false},expected:{status:'completed',output:{route:'standard'}}};
 f.act({kind:'set-semantic-evidence',...revised});f.act({kind:'save-semantic-version',changeNote:'Correct the high amount route.'});
 expect(f.state.versions[0]).toMatchObject({version:1,procedureVersion:2});expect(JSON.stringify(f.state.recordings[0])).toBe(original);
 const tampered=structuredClone(f.state);tampered.definitions[0].procedure=corrected;
 expect(()=>semanticHelper.parseState('owned-helper',tampered)).toThrow();
});

test('negative and exception coverage gate saves and cannot be supplied as forged recordings',()=>{
 const f=fixture();f.act({kind:'set-semantic-procedure',procedure:plan()});
 expect(()=>f.act({kind:'record-semantic-input',input:{amount:100,approved:true,sensitive:false},result:{status:'completed'},recordingId:'forged'})).toThrow();
 f.act({kind:'record-semantic-input',input:{amount:100,approved:true,sensitive:false}});
 f.act({kind:'set-semantic-evidence',...{...evidence(),examples:evidence().examples.filter(example=>example.role!=='exception')}});
 expect(()=>f.act({kind:'save-semantic-version',changeNote:'Missing exception.'})).toThrow(/checks/i);
 expect(f.state.versions).toEqual([]);
});

test('saved versions stay immutable and rollback selects a previous definition',()=>{
 const f=prepared();f.act({kind:'save-semantic-version',changeNote:'First'});f.act({kind:'activate-semantic-version',version:1});
 const first=JSON.stringify(f.state.versions[0]);f.act({kind:'set-semantic-procedure',procedure:{...plan(),intent:'Refined reviewed routing.'}});
 f.act({kind:'save-semantic-version',changeNote:'Second'});expect(f.state.activeVersion).toBe(1);expect(JSON.stringify(f.state.versions[0])).toBe(first);
 f.act({kind:'activate-semantic-version',version:2});f.act({kind:'activate-semantic-version',version:1});f.act({kind:'run-semantic-active',input:{amount:10,approved:true,sensitive:false}});
 expect(f.state.lastRun).toMatchObject({version:1,result:{status:'completed',output:{route:'standard'}}});
 expect(()=>semanticHelper.parseState('foreign-helper',f.state)).toThrow();
});

test('reopening rejects omitted original receipts, forged runs, changed saved snapshots and stale actions',()=>{
 const f=prepared();f.act({kind:'save-semantic-version',changeNote:'First'});f.act({kind:'activate-semantic-version',version:1});
 f.act({kind:'run-semantic-active',input:{amount:2000,approved:true,sensitive:false}});
 const missing=structuredClone(f.state);missing.versions[0].candidate={...missing.versions[0].candidate,recordings:[]};
 expect(()=>semanticHelper.parseState('owned-helper',missing)).toThrow();
 const forged=structuredClone(f.state);forged.lastRun!.result={status:'completed',procedureId:'routing',version:1,target:'local-record',output:{route:'invented'},trace:[],effectAuthority:'none'};
 expect(()=>semanticHelper.parseState('owned-helper',forged)).toThrow(/input and version/);
 const changed=structuredClone(f.state);changed.versions[0].candidate={...changed.versions[0].candidate,procedure:{...plan(),intent:'Changed after save.'}};
 expect(()=>semanticHelper.parseState('owned-helper',changed)).toThrow(/differs/);
 expect(()=>semanticHelper.update('owned-helper',f.state,{kind:'deactivate-semantic',expectedRevision:0})).toThrow(/changed/);
});

test('restoring an older saved definition creates a fresh draft revision without losing newer recordings',()=>{
 const f=prepared();f.act({kind:'save-semantic-version',changeNote:'First'});
 f.act({kind:'set-semantic-procedure',procedure:{...plan(),intent:'Revised routing.'}});
 f.act({kind:'record-semantic-input',input:{amount:200,approved:true,sensitive:false}});
 f.act({kind:'restore-semantic-version',version:1});
 expect(f.state.draftVersion).toBe(3);expect(f.state.recordings).toHaveLength(2);
 expect(f.state.definitions[2].procedure.intent).toBe('Route a local request.');
 expect(semanticHelper.parseState('owned-helper',JSON.parse(JSON.stringify(f.state)))).toEqual(f.state);
});

test('inert action boundaries reject getters and unexpected authority without changing stored state',()=>{
 const f=prepared(),before=JSON.stringify(f.state);let reads=0;
 const action={kind:'set-semantic-procedure',expectedRevision:f.state.revision};
 Object.defineProperty(action,'procedure',{enumerable:true,get(){reads++;return plan();}});
 expect(()=>semanticHelper.update('owned-helper',f.state,action)).toThrow();expect(reads).toBe(0);
 expect(()=>f.act({kind:'run-semantic-active',input:{amount:1,approved:true,sensitive:false},capability:'browser'})).toThrow();
 expect(JSON.stringify(f.state)).toBe(before);
});

test('changing a cited step atomically preserves prior inference and corrections for review',()=>{
 const f=prepared(),prior=evidence();
 f.act({kind:'set-semantic-evidence',...prior,corrections:[{id:'correct',proposalId:'reason',before:prior.rationales[0].reason,after:'The amount routes this local record.',reason:'Clarify the local scope.'}]});
 const originalReceipt=JSON.stringify(f.state.recordings[0]),old=structuredClone(plan());
 if(old.root.kind!=='branch'||old.root.else.kind!=='branch')throw Error('Expected the cited branch.');
 const changed:SemanticProcedure={...old,root:{...old.root,else:{...old.root.else,id:'new-threshold'}}};
 f.act({kind:'replace-semantic-procedure',procedure:changed,rationales:[],corrections:[],examples:[]});
 expect(f.state.draftVersion).toBe(2);expect(JSON.stringify(f.state.recordings[0])).toBe(originalReceipt);
 const priorEvidence=f.state.evidenceHistory.at(-1);expect(priorEvidence?.candidate).toMatchObject({procedure:{version:1},rationales:[{id:'reason',stepId:'threshold'}],corrections:[{id:'correct',after:'The amount routes this local record.'}]});
 f.act({kind:'set-semantic-evidence',rationales:[{...prior.rationales[0],stepId:'new-threshold'}],corrections:[],examples:prior.examples});
 f.act({kind:'save-semantic-version',changeNote:'Rename the semantic branch.'});
 expect(f.state.versions[0]).toMatchObject({version:1,procedureVersion:2});
 expect(semanticHelper.parseState('owned-helper',JSON.parse(JSON.stringify(f.state)))).toEqual(f.state);
 const altered=structuredClone(f.state);altered.evidenceHistory.at(-1)!.candidate={...altered.evidenceHistory.at(-1)!.candidate,procedure:{...plan(),intent:'Invented historical definition.'}};
 expect(()=>semanticHelper.parseState('owned-helper',altered)).toThrow();
});
