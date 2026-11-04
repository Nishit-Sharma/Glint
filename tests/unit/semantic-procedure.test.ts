import {expect,test} from 'vitest';
import {checkSemanticExamples,parseSemanticProcedure,runSemanticProcedure,semanticProcedureLimits,type SemanticProcedure} from '../../src/learning/semantic-procedure';

function routingPlan():SemanticProcedure {
 return {
  schemaVersion:1,id:'request-routing',version:1,intent:'Route an owned synthetic request for review.',target:'local-record',
  input:{name:'request',fields:[{name:'sensitive',kind:'boolean'},{name:'amount',kind:'number',minimum:0,maximum:10000},{name:'approved',kind:'boolean'}]},
  output:{name:'routing',fields:[{name:'route',kind:'string',minLength:1,maxLength:30}]},
  preconditions:[{id:'approval',reason:'A reviewer must approve this request.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}}}],
  postconditions:[{id:'route-present',reason:'The returned route must be permitted.',predicate:{kind:'any',terms:[{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'standard'}},{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'manual-review'}}]}}],
  root:{kind:'branch',id:'privacy',intent:'Check sensitivity before routing.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'sensitive'},right:{kind:'literal',value:true}},
   then:{kind:'abstain',id:'sensitive-stop',intent:'Leave sensitive requests for a person.',reason:'Sensitive requests require manual handling.'},
   else:{kind:'branch',id:'threshold',intent:'Select review level.',predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:1000}},
    then:{kind:'assign',id:'manual',intent:'Record a review route.',field:'route',value:{kind:'literal',value:'manual-review'},next:{kind:'return',id:'manual-done',intent:'Verify the local result.'}},
    else:{kind:'assign',id:'standard',intent:'Record the standard route.',field:'route',value:{kind:'literal',value:'standard'},next:{kind:'return',id:'standard-done',intent:'Verify the local result.'}}}},
 };
}

test('typed local tree routes fresh inputs on both sides of a reviewed threshold',()=>{
 const plan=routingPlan();
 expect(runSemanticProcedure(plan,{sensitive:false,amount:999,approved:true})).toMatchObject({status:'completed',output:{route:'standard'},effectAuthority:'none',version:1});
 expect(runSemanticProcedure(plan,{sensitive:false,amount:1000,approved:true})).toMatchObject({status:'completed',output:{route:'manual-review'}});
});

test('local evidence requires declared transfer, negative and exception checks without granting activation',()=>{
 const plan=routingPlan(),examples=[
  {id:'ordinary',role:'example',input:{sensitive:false,amount:200,approved:true},expected:{status:'completed',output:{route:'standard'}}},
  {id:'held-out',role:'held-out',input:{sensitive:false,amount:5000,approved:true},expected:{status:'completed',output:{route:'manual-review'}}},
  {id:'unapproved',role:'counterexample',input:{sensitive:false,amount:300,approved:false},expected:{status:'abstained',haltedStepId:'approval',code:'precondition'}},
 ];
 expect(checkSemanticExamples(plan,examples)).toMatchObject({passed:false,activationAuthorized:false,coverageIssues:['Exercise exception sensitive-stop with its expected abstention.']});
 const exception={id:'private',role:'exception',input:{sensitive:true,amount:9000,approved:true},expected:{status:'abstained',haltedStepId:'sensitive-stop',code:'explicit-stop'}};
 expect(checkSemanticExamples(plan,[...examples,exception])).toMatchObject({passed:true,coverageIssues:[],activationAuthorized:false});
 expect(checkSemanticExamples(plan,[...examples,{...exception,expected:{status:'completed',output:{route:'standard'}}}])).toMatchObject({passed:false});
});

function manifestPlan():SemanticProcedure {
 return {
  schemaVersion:1,id:'reviewed-export-manifest',version:2,intent:'Describe a reviewed export as a local value.',target:'local-export-manifest',
  input:{name:'document',fields:[{name:'title',kind:'string',minLength:1,maxLength:80},{name:'body',kind:'string',minLength:1,maxLength:4000},{name:'approved',kind:'boolean'},{name:'sensitive',kind:'boolean'}]},
  output:{name:'manifest',fields:[{name:'title',kind:'string',minLength:1,maxLength:80},{name:'content',kind:'string',minLength:1,maxLength:4000},{name:'format',kind:'string',minLength:1,maxLength:10}]},
  preconditions:[],
  postconditions:[{id:'same-body',reason:'The manifest must preserve the reviewed body.',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'content'},right:{kind:'input',field:'body'}}}],
  root:{kind:'branch',id:'review-policy',intent:'Inspect approval and sensitivity.',predicate:{kind:'all',terms:[{kind:'compare',operator:'eq',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}},{kind:'not',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'sensitive'},right:{kind:'literal',value:true}}}]},
   then:{kind:'assign',id:'copy-title',intent:'Use the reviewed title.',field:'title',value:{kind:'input',field:'title'},next:
    {kind:'assign',id:'copy-content',intent:'Preserve the reviewed document.',field:'content',value:{kind:'input',field:'body'},next:
     {kind:'assign',id:'format',intent:'Describe a plain-text manifest.',field:'format',value:{kind:'literal',value:'txt'},next:
      {kind:'return',id:'manifest-done',intent:'Verify the described export.'}}}},
   else:{kind:'abstain',id:'review-stop',intent:'Leave unapproved or sensitive content for review.',reason:'A non-sensitive reviewed document is required.'}},
 };
}

test('a different tree maps reviewed document fields into a manifest value and adapts by precisely stopping',()=>{
 const plan=manifestPlan(),fresh={title:'Harbor briefing',body:'Owned synthetic document.',approved:true,sensitive:false};
 expect(runSemanticProcedure(plan,fresh)).toMatchObject({status:'completed',target:'local-export-manifest',output:{title:'Harbor briefing',content:'Owned synthetic document.',format:'txt'},effectAuthority:'none'});
 for(const changed of [{...fresh,approved:false},{...fresh,sensitive:true}])expect(runSemanticProcedure(plan,changed)).toMatchObject({status:'abstained',code:'explicit-stop',haltedStepId:'review-stop',output:{}});
});

test('missing, wrong-type, non-finite, out-of-range and undeclared inputs never become substituted values',()=>{
 const plan=routingPlan();
 for(const input of [{sensitive:false,approved:true},{sensitive:false,amount:'5',approved:true},{sensitive:false,amount:-1,approved:true},{sensitive:false,amount:10001,approved:true},{sensitive:false,amount:Infinity,approved:true},{sensitive:false,amount:NaN,approved:true},{sensitive:false,amount:5,approved:true,recipient:'anyone'},null,[]]){
  expect(runSemanticProcedure(plan,input)).toMatchObject({status:'invalid-input',stage:'input',trace:[],effectAuthority:'none'});
 }
 expect(runSemanticProcedure(manifestPlan(),{title:'',body:'Synthetic',approved:true,sensitive:false})).toMatchObject({status:'invalid-input',stage:'input'});
});

test('preconditions stop before any derived assignment and explain the exact changed requirement',()=>{
 const result=runSemanticProcedure(routingPlan(),{sensitive:false,amount:500,approved:false});
 expect(result).toMatchObject({status:'abstained',haltedStepId:'approval',code:'precondition',reason:'A reviewer must approve this request.',output:{}});
 expect(result.trace).toEqual([{stepId:'approval',kind:'precondition',inspected:[{source:'input',field:'approved',value:false},{source:'literal',field:null,value:true}],output:{},decision:false,reason:'A reviewer must approve this request.'}]);
});

test('a false observable postcondition cannot report a completed output',()=>{
 const plan=manifestPlan();
 const changed={...plan,postconditions:[{...plan.postconditions[0],predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'format'},right:{kind:'literal',value:'pdf'}}}]};
 expect(runSemanticProcedure(changed,{title:'Synthetic',body:'Reviewed text',approved:true,sensitive:false})).toMatchObject({status:'abstained',code:'postcondition',haltedStepId:'same-body',output:{format:'txt'}});
});

test('derived field constraints are checked before recording an invalid output assignment',()=>{
 const plan=manifestPlan(),narrow={...plan,output:{...plan.output,fields:plan.output.fields.map(field=>field.name==='content'?{...field,maxLength:5}:field)}};
 const result=runSemanticProcedure(narrow,{title:'Short',body:'Long synthetic body',approved:true,sensitive:false});
 expect(result).toMatchObject({status:'abstained',code:'output-contract',haltedStepId:'copy-content',output:{title:'Short'}});
 expect(result.trace.at(-1)).toMatchObject({stepId:'copy-content',decision:false,inspected:[{source:'input',field:'body',value:'Long synthetic body'}],output:{title:'Short'}});
});

test('unknown authority, unsupported nodes, unknown references and incompatible types refuse the exact supplied definition',()=>{
 const plan=routingPlan();
 const variants:unknown[]=[
  {...plan,target:'browser'}, {...plan,schemaVersion:2}, {...plan,capability:'filesystem'},
  {...plan,root:{kind:'javascript',id:'arbitrary',intent:'Execute',code:'return 1'}},
  {...plan,root:{kind:'assign',id:'field',intent:'Assign',field:'undeclared',value:{kind:'literal',value:'x'},next:{kind:'return',id:'done',intent:'Finish'}}},
  {...plan,root:{kind:'assign',id:'field',intent:'Assign',field:'route',value:{kind:'input',field:'missing'},next:{kind:'return',id:'done',intent:'Finish'}}},
  {...plan,root:{kind:'assign',id:'field',intent:'Assign',field:'route',value:{kind:'input',field:'amount'},next:{kind:'return',id:'done',intent:'Finish'}}},
  {...plan,root:{kind:'return',id:'unfinished',intent:'Return without an output'}},
  {...plan,preconditions:[{id:'bad-reference',reason:'Unavailable output',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'route'},right:{kind:'literal',value:'standard'}}}]},
  {...plan,preconditions:[{id:'bad-comparison',reason:'No coercion',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'amount'},right:{kind:'literal',value:'1000'}}}]},
  {...plan,preconditions:[{id:'bad-order',reason:'No string ordering',predicate:{kind:'compare',operator:'gt',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}}}]},
 ];
 for(const variant of variants)expect(runSemanticProcedure(variant,{sensitive:false,amount:3,approved:true})).toMatchObject({status:'invalid-input',stage:'definition',trace:[]});
 expect(()=>parseSemanticProcedure({...plan,target:'file-write'})).toThrow();
});

test('every run revalidates edited definitions rather than trusting a previous successful parse',()=>{
 const plan=routingPlan(),input={sensitive:false,amount:5,approved:true};
 expect(runSemanticProcedure(plan,input).status).toBe('completed');
 expect(runSemanticProcedure({...plan,root:{...plan.root,unreviewed:'tool'}},input)).toMatchObject({status:'invalid-input',stage:'definition'});
 expect(runSemanticProcedure(plan,input).status).toBe('completed');
});

test('tree identities, bounds, depth, cycles and finite work limits are enforced before interpretation',()=>{
 const plan=routingPlan(),cycle:Record<string,unknown>={kind:'assign',id:'loop',intent:'Cycle',field:'route',value:{kind:'literal',value:'standard'}};
 cycle.next=cycle;
 expect(runSemanticProcedure({...plan,root:cycle},{})).toMatchObject({status:'invalid-input',stage:'definition',reason:'Cyclic data is unsupported.'});
 expect(()=>parseSemanticProcedure({...plan,input:{...plan.input,fields:[...plan.input.fields,plan.input.fields[0]]}})).toThrow(/Duplicate field/);
 expect(()=>parseSemanticProcedure({...plan,output:{...plan.output,fields:[{name:'route',kind:'string',minLength:20,maxLength:10}]}})).toThrow(/bounds/);
 expect(()=>parseSemanticProcedure({...plan,preconditions:[...plan.preconditions,plan.preconditions[0]]})).toThrow(/Duplicate/);
 let deep:unknown={kind:'abstain',id:'deep-stop',intent:'Stop',reason:'Stop here'};
 for(let i=0;i<semanticProcedureLimits.stepDepth+1;i++)deep={kind:'assign',id:'step'+i,intent:'Assign a value',field:'route',value:{kind:'literal',value:'standard'},next:deep};
 expect(runSemanticProcedure({...plan,root:deep},{})).toMatchObject({status:'invalid-input',stage:'definition'});
 expect(runSemanticProcedure({...plan,intent:'x'.repeat(semanticProcedureLimits.characters+1)},{})).toMatchObject({status:'invalid-input',stage:'definition'});
});

test('prototype keys, inherited input, classes, accessors, symbols and sparse arrays are refused without invoking getters',()=>{
 const plan=routingPlan(),base={sensitive:false,amount:2,approved:true};let reads=0;
 const accessor={...base};Object.defineProperty(accessor,'amount',{get(){reads++;return 2;},enumerable:true});
 for(const input of [JSON.parse('{"sensitive":false,"amount":2,"approved":true,"__proto__":{"polluted":true}}'),Object.create(base),new Date(),accessor,{...base,[Symbol('hidden')]:true}])expect(runSemanticProcedure(plan,input)).toMatchObject({status:'invalid-input',stage:'input'});
 expect(reads).toBe(0);expect(Object.hasOwn(Object.prototype,'polluted')).toBe(false);
 const sparse=new Array(2);sparse[1]=plan.input.fields[0];
 expect(runSemanticProcedure({...plan,input:{name:'request',fields:sparse}},base)).toMatchObject({status:'invalid-input',stage:'definition'});
 expect(runSemanticProcedure({...plan,input:{name:'request',fields:[{name:'constructor',kind:'boolean'}]}},base)).toMatchObject({status:'invalid-input',stage:'definition'});
});

test('inspection traces record short-circuited reads and detached derived values without changing inputs or definitions',()=>{
 const plan=manifestPlan(),input={title:'Owned title',body:'Owned text',approved:false,sensitive:true},before=JSON.stringify({plan,input});
 const result=runSemanticProcedure(plan,input);
 expect(result.trace[0].inspected).toEqual([{source:'input',field:'approved',value:false},{source:'literal',field:null,value:true}]);
 expect(JSON.stringify({plan,input})).toBe(before);
 const success=runSemanticProcedure(plan,{...input,approved:true,sensitive:false});
 expect(success.trace.map(step=>step.stepId)).toEqual(['review-policy','copy-title','copy-content','format','manifest-done','same-body']);
 expect(success.trace[1].output).toEqual({title:'Owned title'});
 if(success.status==='completed'){
  Object.defineProperty(success.output,'title',{value:'Changed only in returned result'});
  expect(success.trace[1].output.title).toBe('Owned title');
  expect(runSemanticProcedure(plan,{...input,approved:true,sensitive:false})).toMatchObject({output:{title:'Owned title'}});
 }
 expect(JSON.stringify({plan,input})).toBe(before);
});

test('number and boolean output fields and previously assigned output comparisons are executable typed steps',()=>{
 const plan:SemanticProcedure={schemaVersion:1,id:'typed-record',version:1,intent:'Copy reviewed scalar fields.',target:'local-record',
  input:{name:'values',fields:[{name:'count',kind:'number',minimum:0,maximum:10},{name:'flag',kind:'boolean'}]},
  output:{name:'copy',fields:[{name:'count',kind:'number',minimum:0,maximum:10},{name:'flag',kind:'boolean'}]},preconditions:[],
  postconditions:[{id:'count-matches',reason:'Count must be preserved.',predicate:{kind:'compare',operator:'eq',left:{kind:'output',field:'count'},right:{kind:'input',field:'count'}}}],
  root:{kind:'assign',id:'count',intent:'Copy count.',field:'count',value:{kind:'input',field:'count'},next:{kind:'assign',id:'flag',intent:'Copy flag.',field:'flag',value:{kind:'input',field:'flag'},next:{kind:'branch',id:'inspect-copy',intent:'Inspect the derived record.',predicate:{kind:'compare',operator:'ne',left:{kind:'output',field:'flag'},right:{kind:'literal',value:false}},then:{kind:'return',id:'done',intent:'Return checked values.'},else:{kind:'abstain',id:'flag-stop',intent:'Stop on false.',reason:'A true flag is required.'}}}},
 };
 expect(runSemanticProcedure(plan,{count:7,flag:true})).toMatchObject({status:'completed',output:{count:7,flag:true}});
 expect(runSemanticProcedure(plan,{count:0,flag:false})).toMatchObject({status:'abstained',haltedStepId:'flag-stop',output:{count:0,flag:false}});
});

test.each([
 ['gt',1001,true],['gt',1000,false],['gte',1000,true],['gte',999,false],
 ['lt',999,true],['lt',1000,false],['lte',1000,true],['lte',1001,false],
])('numeric %s comparisons choose the correct branch at %s',(operator,amount,expected)=>{
 const plan=routingPlan();
 if(plan.root.kind!=='branch'||plan.root.else.kind!=='branch')throw Error('Routing fixture must contain the threshold branch.');
 const changed={...plan,root:{...plan.root,else:{...plan.root.else,predicate:{...plan.root.else.predicate,operator}}}};
 expect(runSemanticProcedure(changed,{sensitive:false,amount,approved:true})).toMatchObject({status:'completed',output:{route:expected?'manual-review':'standard'}});
});

test('bounded tree and predicate budgets reject excessive programs while permitting a smaller inspected tree',()=>{
 const plan=routingPlan();let id=0;
 function tree(depth:number):unknown {
  const current='node'+id++;
  return depth===0?{kind:'abstain',id:current,intent:'Stop.',reason:'Synthetic leaf.'}
   :{kind:'branch',id:current,intent:'Inspect a boolean.',predicate:{kind:'compare',operator:'eq',left:{kind:'input',field:'sensitive'},right:{kind:'literal',value:true}},then:tree(depth-1),else:tree(depth-1)};
 }
 expect(runSemanticProcedure({...plan,root:tree(5)},{sensitive:false,amount:2,approved:true}).status).toBe('abstained');
 expect(runSemanticProcedure({...plan,root:tree(6)},{})).toMatchObject({status:'invalid-input',stage:'definition',reason:'The semantic step limit was exceeded.'});
 let predicate:unknown={kind:'compare',operator:'eq',left:{kind:'input',field:'approved'},right:{kind:'literal',value:true}};
 for(let index=0;index<semanticProcedureLimits.predicateDepth;index++)predicate={kind:'not',predicate};
 expect(runSemanticProcedure({...plan,preconditions:[{id:'deep',reason:'Deep predicate',predicate}]},{})).toMatchObject({status:'invalid-input',stage:'definition',reason:'The predicate limit was exceeded.'});
 expect(runSemanticProcedure({...plan,unexpected:Array(semanticProcedureLimits.members+1).fill(true)},{})).toMatchObject({status:'invalid-input',stage:'definition'});
 expect(runSemanticProcedure({...plan,unexpected:Array(17).fill('x'.repeat(4000))},{})).toMatchObject({status:'invalid-input',stage:'definition',reason:'The local data exceeds its character limit.'});
});

test('evidence rejects duplicate identities, relabeled training input and missing negative coverage without mutating examples',()=>{
 const plan=routingPlan(),positive={id:'original',role:'example',input:{sensitive:false,amount:100,approved:true},expected:{status:'completed',output:{route:'standard'}}};
 const relabeled={...positive,id:'relabeled',role:'held-out',input:{approved:true,amount:100,sensitive:false}};
 const examples=[positive,relabeled],before=JSON.stringify(examples);
 const result=checkSemanticExamples(plan,examples);
 expect(result).toMatchObject({passed:false,activationAuthorized:false});
 expect(result.coverageIssues).toContain('Add a passing completed held-out example with different input.');
 expect(result.coverageIssues).toContain('Add a passing negative counterexample with different input.');
 expect(checkSemanticExamples(plan,[positive,positive])).toMatchObject({passed:false,cases:[],coverageIssues:['Example identities must be unique.']});
 expect(checkSemanticExamples({...plan,target:'network'},examples)).toMatchObject({passed:false,cases:[]});
 expect(JSON.stringify(examples)).toBe(before);
});

test('oversized input member names are refused before an unbounded diagnostic can be constructed',()=>{
 const input={sensitive:false,amount:1,approved:true,['x'.repeat(8000)]:false};
 expect(runSemanticProcedure(routingPlan(),input)).toMatchObject({status:'invalid-input',stage:'input',reason:'Member names must be bounded identifiers.'});
});

function routingEvidence(){
 return [
  {id:'ordinary',role:'example',input:{sensitive:false,amount:200,approved:true},expected:{status:'completed',output:{route:'standard'}}},
  {id:'transfer',role:'held-out',input:{sensitive:false,amount:5000,approved:true},expected:{status:'completed',output:{route:'manual-review'}}},
  {id:'unapproved',role:'counterexample',input:{sensitive:false,amount:300,approved:false},expected:{status:'abstained',haltedStepId:'approval',code:'precondition'}},
  {id:'private',role:'exception',input:{sensitive:true,amount:9000,approved:true},expected:{status:'abstained',haltedStepId:'sensitive-stop',code:'explicit-stop'}},
 ];
}

test('a passing completed positive mislabeled as a counterexample cannot satisfy negative coverage',()=>{
 const plan={...routingPlan(),preconditions:[]};
 const examples=routingEvidence().map(example=>example.role==='counterexample'?{id:'another-positive',role:'counterexample',input:{sensitive:false,amount:400,approved:true},expected:{status:'completed',output:{route:'standard'}}}:example);
 const result=checkSemanticExamples(plan,examples);
 expect(result).toMatchObject({passed:false,coverageIssues:['Add a passing negative counterexample with different input.']});
});

test('each declared precondition needs a passing negative or exception that actually halts at its own identity',()=>{
 const base=routingPlan(),plan={...base,preconditions:[...base.preconditions,{id:'minimum',reason:'Amount must reach the review minimum.',predicate:{kind:'compare',operator:'gte',left:{kind:'input',field:'amount'},right:{kind:'literal',value:100}}}]};
 const examples=routingEvidence();
 expect(checkSemanticExamples(plan,examples)).toMatchObject({passed:false,coverageIssues:['Exercise precondition minimum with its expected abstention.']});
 const negative={id:'below-minimum',role:'exception',input:{sensitive:false,amount:50,approved:true},expected:{status:'abstained',haltedStepId:'minimum',code:'precondition'}};
 expect(checkSemanticExamples(plan,[...examples,negative])).toMatchObject({passed:true,coverageIssues:[],activationAuthorized:false});
 expect(checkSemanticExamples(plan,[...examples,{...negative,role:'held-out'}])).toMatchObject({passed:false});
});

test('a safely checked input-invalid expectation supplies negative evidence without requiring a different projection branch',()=>{
 const plan=manifestPlan(),examples=[
  {id:'reviewed',role:'example',input:{title:'Original',body:'Reviewed synthetic text.',approved:true,sensitive:false},expected:{status:'completed',output:{title:'Original',content:'Reviewed synthetic text.',format:'txt'}}},
  {id:'fresh',role:'held-out',input:{title:'Fresh',body:'Different synthetic text.',approved:true,sensitive:false},expected:{status:'completed',output:{title:'Fresh',content:'Different synthetic text.',format:'txt'}}},
  {id:'invalid-title',role:'counterexample',input:{title:42,body:'Reviewed synthetic text.',approved:true,sensitive:false},expected:{status:'invalid-input',stage:'input'}},
  {id:'private',role:'exception',input:{title:'Private',body:'Owned synthetic text.',approved:true,sensitive:true},expected:{status:'abstained',haltedStepId:'review-stop',code:'explicit-stop'}},
 ];
 const before=JSON.stringify({plan,examples}),result=checkSemanticExamples(plan,examples);
 expect(result).toMatchObject({passed:true,activationAuthorized:false,independentHeldOutVerified:false,effectAuthority:'none',coverageIssues:[]});
 expect(result.cases.find(check=>check.id==='invalid-title')).toMatchObject({passed:true,actual:{status:'invalid-input',stage:'input',trace:[],effectAuthority:'none'}});
 expect(checkSemanticExamples(plan,examples.map(example=>example.id==='invalid-title'?{...example,expected:{status:'invalid-input',stage:'definition'}}:example))).toMatchObject({passed:false});
 expect(JSON.stringify({plan,examples})).toBe(before);
});

test('all evidence-check outcomes disclose that declared transfer examples do not verify independence or grant authority',()=>{
 for(const result of [checkSemanticExamples(routingPlan(),routingEvidence()),checkSemanticExamples(routingPlan(),[]),checkSemanticExamples({target:'browser'},[]),checkSemanticExamples(routingPlan(),[{bad:'example'}])]){
  expect(result).toMatchObject({independentHeldOutVerified:false,activationAuthorized:false,effectAuthority:'none'});
 }
});
