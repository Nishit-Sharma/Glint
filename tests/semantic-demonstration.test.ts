import {expect,test} from 'vitest';
import {checkSemanticDemonstration,createSemanticRecording,parseSemanticRecording} from '../src/learning/semantic-demonstration';
import {type SemanticProcedure,type SemanticStep} from '../src/learning/semantic-procedure';

const context={helperId:'owned-helper',atRevision:3};
function documentPlan():SemanticProcedure {
 return {schemaVersion:1,id:'document-manifest',version:1,intent:'Describe a reviewed local document.',target:'local-export-manifest',
  input:{name:'document',fields:[{name:'title',kind:'string',minLength:1,maxLength:80},{name:'approved',kind:'boolean'}]},
  output:{name:'manifest',fields:[{name:'title',kind:'string',minLength:1,maxLength:80}]},
  preconditions:[{id:'approval',reason:'Review the document first.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}}}],
  postconditions:[{id:'same-title',reason:'Preserve the reviewed title.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'title'},right:{kind:'output',field:'title'}}}],
  root:{kind:'assign',id:'copy-title',intent:'Copy the reviewed title.',field:'title',value:{kind:'input',field:'title'},next:{kind:'return',id:'done',intent:'Check the manifest value.'}},
 };
}

test('local recording creation generates a replay receipt without taking a supplied observation or result',()=>{
 const request={recordingId:'recording-one',procedure:documentPlan(),input:{title:'Owned synthetic briefing',approved:true}};
 const before=JSON.stringify({context,request}),recording=createSemanticRecording(context,request);
 expect(recording).toMatchObject({schemaVersion:1,kind:'computed-local-replay',helperId:'owned-helper',atRevision:3,recordingId:'recording-one',externalObservationVerified:false,effectAuthority:'none',result:{status:'completed',output:{title:'Owned synthetic briefing'}}});
 expect(recording.result.trace.map(step=>step.stepId)).toEqual(['approval','copy-title','done','same-title']);
 expect(()=>createSemanticRecording(context,{...request,result:{status:'completed',output:{title:'Invented'}}})).toThrow();
 expect(()=>createSemanticRecording(context,{...request,observed:true})).toThrow();
 expect(JSON.stringify({context,request})).toBe(before);
});

test('stored replay receipts require the exact outcome, trace, owner and a nonfuture recording revision',()=>{
 const recording=createSemanticRecording(context,{recordingId:'original',procedure:documentPlan(),input:{title:'Synthetic',approved:true}});
 expect(parseSemanticRecording({...context,atRevision:4},JSON.parse(JSON.stringify(recording)))).toEqual(recording);
 for(const changed of [
  {...recording,result:{...recording.result,output:{title:'Invented'}}},
  {...recording,result:{...recording.result,trace:[]}},
  {...recording,input:{title:'Different',approved:true}},
  {...recording,helperId:'another-helper'},
  {...recording,atRevision:4},
  {...recording,kind:'observed-browser-action'},
  {...recording,externalObservationVerified:true},
  {...recording,effectAuthority:'browser'},
  {...recording,observationId:'renderer-injected'},
 ])expect(()=>parseSemanticRecording(context,changed)).toThrow();
});

function documentCandidate(){
 const procedure=documentPlan(),recording=createSemanticRecording(context,{recordingId:'original',procedure,input:{title:'Original synthetic title',approved:true}});
 return {schemaVersion:1,procedure,recordings:[recording],rationales:[{id:'title-reason',kind:'inferred-rationale',stepId:'copy-title',basis:[{recordingId:'original',traceStepId:'copy-title'}],reason:'The title may name an exported file.'}],corrections:[{id:'correct-title',proposalId:'title-reason',before:'The title may name an exported file.',after:'Preserve the reviewed title in a value.',reason:'This helper describes a manifest and does not write a file.'}],examples:[
  {id:'fresh-title',role:'held-out',input:{title:'Different synthetic title',approved:true},expected:{status:'completed',output:{title:'Different synthetic title'}}},
  {id:'not-reviewed',role:'counterexample',input:{title:'Unreviewed title',approved:false},expected:{status:'abstained',haltedStepId:'approval',code:'precondition'}},
 ]};
}

test('recorded computations, inferred rationales and ordered corrections remain separate through candidate checks',()=>{
 const candidate=documentCandidate(),before=JSON.stringify(candidate),result=checkSemanticDemonstration({...context,atRevision:6},candidate);
 expect(result).toMatchObject({passed:true,issues:[],hostOwnershipVerified:false,independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'});
 expect(result.rationales).toEqual([{proposalId:'title-reason',stepId:'copy-title',basis:[{recordingId:'original',traceStepId:'copy-title'}],proposedReason:'The title may name an exported file.',currentReason:'Preserve the reviewed title in a value.',status:'corrected',correctionIds:['correct-title']}]);
 expect(result.recordings[0]).toEqual(candidate.recordings[0]);
 expect(result.checks?.cases.find(check=>check.id==='recorded-1')).toMatchObject({role:'example',passed:true});
 expect(JSON.stringify(candidate)).toBe(before);
});

function routingPlan():SemanticProcedure {
 return {schemaVersion:1,id:'request-route',version:1,intent:'Route a synthetic local request.',target:'local-record',
  input:{name:'request',fields:[{name:'amount',kind:'number',minimum:0,maximum:10000},{name:'sensitive',kind:'boolean'}]},
  output:{name:'routing',fields:[{name:'route',kind:'string',minLength:1,maxLength:20}]},
  preconditions:[{id:'positive-amount',reason:'A positive amount is required.',predicate:{kind:'compare',operator:'gt',left:{kind:'input',field:'amount'},right:{kind:'literal',value:0}}}],
  postconditions:[{id:'allowed-route',reason:'Use a declared route.',predicate:{kind:'any',terms:[{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'standard'}},{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'manual'}}]}}],
  root:{kind:'branch',id:'privacy',intent:'Inspect sensitivity.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'sensitive'},right:{kind:'literal',value:true}},then:{kind:'abstain',id:'private-stop',intent:'Leave sensitive requests for a person.',reason:'Sensitive input requires manual handling.'},else:
   {kind:'branch',id:'threshold',intent:'Choose the review route.',predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:1000}},then:{kind:'assign',id:'manual',intent:'Record manual review.',field:'route',value:{kind:'literal',value:'manual'},next:{kind:'return',id:'manual-done',intent:'Verify the result.'}},else:{kind:'assign',id:'standard',intent:'Record the standard route.',field:'route',value:{kind:'literal',value:'standard'},next:{kind:'return',id:'standard-done',intent:'Verify the result.'}}}},
 };
}
function routingCandidate(){
 const procedure=routingPlan();
 return {schemaVersion:1,procedure,recordings:[createSemanticRecording(context,{recordingId:'routing-original',procedure,input:{amount:100,sensitive:false}})],
  rationales:[{id:'threshold-reason',kind:'inferred-rationale',stepId:'threshold',basis:[{recordingId:'routing-original',traceStepId:'threshold'}],reason:'The selected amount appears to determine the review route.'}],corrections:[],examples:[
   {id:'large-request',role:'held-out',input:{amount:1200,sensitive:false},expected:{status:'completed',output:{route:'manual'}}},
   {id:'zero-amount',role:'counterexample',input:{amount:0,sensitive:false},expected:{status:'abstained',haltedStepId:'positive-amount',code:'precondition'}},
   {id:'sensitive-case',role:'exception',input:{amount:200,sensitive:true},expected:{status:'abstained',haltedStepId:'private-stop',code:'explicit-stop'}},
  ]};
}

test('a distinct numeric branching procedure checks transfer, changed preconditions and explicit stops without claiming general demonstration learning',()=>{
 const candidate=routingCandidate(),before=JSON.stringify(candidate),result=checkSemanticDemonstration(context,candidate);
 expect(result).toMatchObject({passed:true,hostOwnershipVerified:false,independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'});
 expect(result.rationales[0]).toMatchObject({status:'proposed',proposedReason:'The selected amount appears to determine the review route.',currentReason:'The selected amount appears to determine the review route.',correctionIds:[]});
 expect(result.checks?.cases.map(check=>[check.id,check.passed])).toEqual([['recorded-1',true],['large-request',true],['zero-amount',true],['sensitive-case',true]]);
 const changed={...candidate,procedure:{...candidate.procedure,version:2,preconditions:[{...candidate.procedure.preconditions[0],predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:500}}}]}};
 const changedResult=checkSemanticDemonstration(context,changed);
 expect(changedResult.passed).toBe(false);
 expect(changedResult.checks?.cases.find(check=>check.id==='recorded-1')).toMatchObject({passed:false,actual:{status:'abstained',haltedStepId:'positive-amount'}});
 expect(changedResult.recordings[0]).toEqual(candidate.recordings[0]);
 expect(JSON.stringify(candidate)).toBe(before);
});

test('new candidate outputs cannot rewrite a previously recorded result into a passing example',()=>{
 const candidate=documentCandidate(),changed={...candidate,procedure:{...candidate.procedure,version:2,postconditions:[{id:'constant-title',reason:'Use a different proposed title.',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'title'},right:{kind:'literal',value:'Changed'}}}],root:{kind:'assign',id:'copy-title',intent:'Set a different proposed title.',field:'title',value:{kind:'literal',value:'Changed'},next:{kind:'return',id:'done',intent:'Check the manifest value.'}}}};
 const result=checkSemanticDemonstration(context,changed);
 expect(result.passed).toBe(false);
 expect(result.checks?.cases.find(check=>check.id==='recorded-1')).toMatchObject({passed:false,actual:{status:'completed',output:{title:'Changed'}}});
 expect(result.recordings[0].result).toMatchObject({status:'completed',output:{title:'Original synthetic title'}});
});

test('correction chains preserve the original proposed reason and reject stale, reordered, empty or unreferenced corrections',()=>{
 const candidate=documentCandidate(),first=candidate.corrections[0],second={id:'more-precise',proposalId:first.proposalId,before:first.after,after:'Copy the reviewed title without changing it.',reason:'State the observed mapping precisely.'};
 expect(checkSemanticDemonstration(context,{...candidate,corrections:[first,second]}).rationales[0]).toMatchObject({proposedReason:first.before,currentReason:second.after,correctionIds:['correct-title','more-precise']});
 for(const corrections of [
  [second,first], [first,{...second,before:'Stale reason'}], [first,{...second,proposalId:'missing'}],
  [first,{...second,after:second.before}], [first,{...second,reason:' '}], [first,first],
 ])expect(checkSemanticDemonstration(context,{...candidate,corrections}).passed).toBe(false);
});

test('inference references must identify existing semantic steps and replayed trace entries without becoming observed claims',()=>{
 const candidate=routingCandidate(),proposal=candidate.rationales[0];
 for(const rationales of [
  [{...proposal,stepId:'unknown-step'}],
  [{...proposal,basis:[{recordingId:'missing-recording',traceStepId:'threshold'}]}],
  [{...proposal,basis:[{recordingId:'routing-original',traceStepId:'private-stop'}]}],
  [{...proposal,kind:'observed-rationale'}],
  [{...proposal,externalObservationVerified:true}],
  [{...proposal,basis:[proposal.basis[0],proposal.basis[0]]}],
  [proposal,proposal],
 ])expect(checkSemanticDemonstration(context,{...candidate,rationales})).toMatchObject({passed:false,hostOwnershipVerified:false,activationAuthorized:false});
 const inferredStop={...proposal,id:'stop-reason',stepId:'private-stop'};
 expect(checkSemanticDemonstration(context,{...candidate,rationales:[inferredStop]}).rationales[0]).toMatchObject({stepId:'private-stop',status:'proposed'});
});

test('recordings reject duplicate identities/revisions, foreign procedures and future procedure versions',()=>{
 const candidate=documentCandidate(),original=candidate.recordings[0];
 for(const recordings of [
  [original,original],
  [original,createSemanticRecording(context,{recordingId:'same-revision',procedure:documentPlan(),input:{title:'Other title',approved:true}})],
  [createSemanticRecording(context,{recordingId:'foreign',procedure:routingPlan(),input:{amount:10,sensitive:false}})],
  [createSemanticRecording(context,{recordingId:'future',procedure:{...documentPlan(),version:2},input:{title:'Future title',approved:true}})],
 ])expect(checkSemanticDemonstration(context,{...candidate,recordings}).passed).toBe(false);
});

test('missing negative or exception evidence stays blocked and an abstained recording cannot replace a completed demonstration',()=>{
 const routing=routingCandidate();
 expect(checkSemanticDemonstration(context,{...routing,examples:routing.examples.filter(example=>example.role!=='exception')})).toMatchObject({passed:false});
 const document=documentCandidate();
 expect(checkSemanticDemonstration(context,{...document,examples:document.examples.filter(example=>example.role!=='counterexample')})).toMatchObject({passed:false});
 const stopped=createSemanticRecording(context,{recordingId:'stopped',procedure:documentPlan(),input:{title:'Not reviewed',approved:false}});
 const result=checkSemanticDemonstration(context,{...document,recordings:[stopped],rationales:[{...document.rationales[0],basis:[{recordingId:'stopped',traceStepId:'approval'}]}]});
 expect(result.passed).toBe(false);expect(result.issues).toContain('Record at least one completed local computation.');
});

test('strict inert boundaries reject injected authority, prototype keys, getters, cycles and oversized packets',()=>{
 const candidate=documentCandidate(),request={recordingId:'safe',procedure:documentPlan(),input:{title:'Owned',approved:true}};
 for(const injected of [{...request,receipt:candidate.recordings[0]},{...request,scope:'browser'},{...request,input:{title:'Owned',approved:'true'}},{...request,input:{title:'Owned',approved:true,extra:'unknown'}}])expect(()=>createSemanticRecording(context,injected)).toThrow();
 expect(()=>createSemanticRecording({...context,capability:'browser'},request)).toThrow();
 const accessor={...candidate};let reads=0;Object.defineProperty(accessor,'procedure',{enumerable:true,get(){reads++;return documentPlan();}});
 const cycle:Record<string,unknown>={...candidate};cycle.cycle=cycle;
 for(const value of [accessor,cycle,JSON.parse('{"__proto__":{"owned":true}}'),{...candidate,padding:'x'.repeat(512001)}])expect(checkSemanticDemonstration(context,value)).toMatchObject({passed:false,hostOwnershipVerified:false,independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'});
 expect(reads).toBe(0);expect(Object.hasOwn(Object.prototype,'owned')).toBe(false);
});

test('recording creation refuses an expanded receipt that could not pass its own stored replay limits',()=>{
 let root:SemanticStep={kind:'return',id:'done',intent:'Return the local record.'};
 for(let index=14;index>=0;index--)root={kind:'assign',id:'copy'+index,intent:'Copy the supplied body.',field:'field'+index,value:{kind:'input',field:'body'},next:root};
 const procedure:SemanticProcedure={schemaVersion:1,id:'expanded-record',version:1,intent:'Copy a local value into fifteen bounded fields.',target:'local-record',input:{name:'source',fields:[{name:'body',kind:'string',minLength:1,maxLength:4000}]},output:{name:'result',fields:Array.from({length:15},(_,index)=>({name:'field'+index,kind:'string',minLength:1,maxLength:4000}))},preconditions:[],postconditions:[{id:'check-copy',reason:'Preserve the supplied body.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'body'},right:{kind:'output',field:'field0'}}}],root};
 expect(()=>createSemanticRecording(context,{recordingId:'expanded',procedure,input:{body:'x'.repeat(4000)}})).toThrow('The demonstration exceeds its local character limit.');
});

test('recording metadata accepts the existing digit-leading host UUID identity format',()=>{
 const owner={helperId:'0d0b30ff-01f0-4e74-bfe5-173243c48b4d',atRevision:1};
 const recording=createSemanticRecording(owner,{recordingId:'1a68fbb2-4ffc-4aeb-8824-3138e136b481',procedure:documentPlan(),input:{title:'Owned',approved:true}});
 expect(recording.helperId).toBe(owner.helperId);
 expect(parseSemanticRecording(owner,JSON.parse(JSON.stringify(recording)))).toEqual(recording);
 const candidate=documentCandidate();
 expect(checkSemanticDemonstration(owner,{...candidate,recordings:[recording],rationales:[{...candidate.rationales[0],basis:[{recordingId:recording.recordingId,traceStepId:'copy-title'}]}]})).toMatchObject({passed:true});
});

function changedUnexercisedBranch(){
 const candidate=routingCandidate(),root=candidate.procedure.root;
 if(root.kind!=='branch'||root.else.kind!=='branch'||root.else.then.kind!=='assign')throw Error('The routing fixture needs a manual branch.');
 const procedure={...candidate.procedure,root:{...root,else:{...root.else,then:{...root.else.then,value:{kind:'literal',value:'standard'}}}}};
 const examples=candidate.examples.map(example=>example.role==='held-out'?{id:'different-standard',role:'held-out',input:{amount:200,sensitive:false},expected:{status:'completed',output:{route:'standard'}}}:example);
 return {...candidate,procedure,examples};
}

test('an unchanged recorded version cannot hide a different definition behind an unexercised branch',()=>{
 const candidate=changedUnexercisedBranch(),before=JSON.stringify(candidate);
 expect(checkSemanticDemonstration(context,candidate)).toMatchObject({passed:false,issues:['The same procedure version must retain the exact recorded definition.'],hostOwnershipVerified:false,activationAuthorized:false});
 expect(JSON.stringify(candidate)).toBe(before);
});

test('recordings cannot contradict one historical version even when the candidate declares a higher version',()=>{
 const candidate=changedUnexercisedBranch(),laterContext={...context,atRevision:4};
 const contradictory=createSemanticRecording(laterContext,{recordingId:'contradictory',procedure:candidate.procedure,input:{amount:100,sensitive:false}});
 expect(checkSemanticDemonstration(laterContext,{...candidate,procedure:{...candidate.procedure,version:2},recordings:[...candidate.recordings,contradictory]})).toMatchObject({passed:false,issues:['The same procedure version must retain the exact recorded definition.']});
});

test('consistent higher-version local checks still do not authenticate host history or grant activation',()=>{
 const candidate=changedUnexercisedBranch();
 expect(checkSemanticDemonstration(context,{...candidate,procedure:{...candidate.procedure,version:2}})).toMatchObject({passed:true,hostOwnershipVerified:false,independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'});
});
