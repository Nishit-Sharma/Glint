import {expect,test} from 'vitest';
import {parseWindowWorkflowProposal,type WindowWorkflowSourceContext} from '../../src/learning/window-workflow-proposal';

function context(){
 return {taskId:'owned-task',basis:{artifactId:'owned-brief',revision:2,digest:'brief-digest'},source:{handle:'S1',kind:'window',role:'fact',ref:{sourceId:'owned-window',version:3,digest:'source-digest'},capture:{captureId:'owned-capture',imageSha256:'a'.repeat(64),capturedAt:'2026-10-27T12:00:00.000Z',previewExpiresAt:'2026-10-27T12:05:00.000Z'}}} satisfies WindowWorkflowSourceContext;
}
function proposal(){
 const citation=(id:string,quote:string,x:number)=>({id,source:'S1',location:{kind:'image-region',x,y:0.1,width:0.1,height:0.1,quote}});
 return {schemaVersion:1,kind:'finite-state-proposal',title:'Owned synthetic state diagram',states:[{id:'idle',name:{kind:'transcribed',label:'Idle',citationId:'c-idle'}},{id:'busy',name:{kind:'transcribed',label:'Busy',citationId:'c-busy'}}],events:[{id:'start',name:{kind:'transcribed',label:'Start',citationId:'c-start'}},{id:'finish',name:{kind:'transcribed',label:'Finish',citationId:'c-finish'}}],transitions:[{id:'t-start',candidate:{kind:'inferred',fromStateId:'idle',eventId:'start',toStateId:'busy',citationIds:['c-start-rule'],reason:'The drawn arrow appears to connect these labels.'}},{id:'t-finish',candidate:{kind:'inferred',fromStateId:'busy',eventId:'finish',toStateId:'idle',citationIds:['c-finish-rule'],reason:'The drawn return arrow appears to connect these labels.'}}],initialState:{kind:'unresolved',citationIds:[],reason:'No reset arrow is visible.'},assumptions:[],issues:[],citations:[citation('c-idle','Idle',0.1),citation('c-busy','Busy',0.3),citation('c-start','Start',0.5),citation('c-finish','Finish',0.7),citation('c-start-rule','Idle + Start -> Busy',0.2),citation('c-finish-rule','Busy + Finish -> Idle',0.4)]};
}

test('a finite synthetic diagram produces only a review candidate bound to the separately supplied exact source',()=>{
 const trusted=context(),input=proposal(),result=parseWindowWorkflowProposal(JSON.stringify(input),trusted);
 expect(result.kind).toBe('window-workflow-review-candidate');
 if(result.kind!=='window-workflow-review-candidate')throw Error('Expected a review candidate.');
 expect(result.status).toBe('review-required');expect(result.provenance).toEqual(trusted);
 expect(result.proposal).toEqual(input);
 expect(result.issues).toContainEqual({code:'initial-state-required',path:'initialState'});
 expect(Object.keys(result).sort()).toEqual(['issues','kind','proposal','provenance','schemaVersion','status']);
 expect(JSON.stringify(result)).not.toMatch(/workflow-lab|transfer|prediction|computed|approved|dataUrl|base64|png/);
 trusted.source.ref.digest='mutated-by-caller';input.states[0].name.label='Mutated';
 expect(result.provenance.source.ref.digest).toBe('source-digest');expect(result.proposal.states[0].name).toMatchObject({label:'Idle'});
});

test('duplicate identities and finite references cannot change or escape the proposed diagram',()=>{
 const p=proposal(),first=p.transitions[0];
 for(const value of [
  {...p,states:[p.states[0],p.states[0]]},
  {...p,events:[{...p.events[0],id:p.states[0].id}]},
  {...p,citations:[...p.citations,p.citations[0]]},
  {...p,transitions:[first,{...first,id:'another-id'}]},
  {...p,transitions:[{...first,candidate:{...first.candidate,toStateId:'unseen-state'}}]},
  {...p,transitions:[{...first,candidate:{...first.candidate,eventId:'unseen-event'}}]},
  {...p,transitions:[{...first,candidate:{...first.candidate,citationIds:['missing-citation']}}]},
  {...p,transitions:[{...first,candidate:{...first.candidate,citationIds:['c-start-rule','c-start-rule']}}]},
  {...p,states:[{...p.states[0],name:{...p.states[0].name,label:'Invented'}}]},
  {...p,initialState:{kind:'inferred',stateId:'missing',citationIds:['c-idle'],reason:'A proposed start.'}},
 ])expect(()=>parseWindowWorkflowProposal(JSON.stringify(value),context())).toThrow();
});

test('image citations require positive normalized regions fully inside the exact supplied window',()=>{
 const p=proposal(),first=p.citations[0];
 for(const location of [
  {...first.location,width:0},{...first.location,height:0},{...first.location,x:-0.01},
  {...first.location,y:1.01},{...first.location,width:1.01},{...first.location,x:0.95},
  {...first.location,y:0.95},{...first.location,x:Number.NaN},{...first.location,height:Number.POSITIVE_INFINITY},
  {kind:'text-range',start:0,end:4,quote:'Idle'},
 ])expect(()=>parseWindowWorkflowProposal(JSON.stringify({...p,citations:[{...first,location},...p.citations.slice(1)]}),context())).toThrow();
 const edge={...p,citations:p.citations.map(c=>({...c,location:{...c.location,x:0,y:0,width:1,height:1}}))};
 expect(parseWindowWorkflowProposal(JSON.stringify(edge),context()).kind).toBe('window-workflow-review-candidate');
});

test.each([{axis:'right',coordinates:{x:1,width:Number.MIN_VALUE}},{axis:'bottom',coordinates:{y:1,height:Number.MIN_VALUE}}])('tiny positive dimensions cannot escape the $axis edge through floating-point rounding',({coordinates})=>{
 const p=proposal(),first=p.citations[0];
 const raw=JSON.stringify({...p,citations:[{...first,location:{...first.location,...coordinates}},...p.citations.slice(1)]});
 expect(raw).toContain('5e-324');
 expect(()=>parseWindowWorkflowProposal(raw,context())).toThrow('Diagnostic: region');
});

test.each([{axis:'right',coordinates:{x:Number.MIN_VALUE,width:1}},{axis:'bottom',coordinates:{y:Number.MIN_VALUE,height:1}}])('tiny positive offsets cannot escape the $axis edge with a full-size dimension',({coordinates})=>{
 const p=proposal(),first=p.citations[0];
 const raw=JSON.stringify({...p,citations:[{...first,location:{...first.location,...coordinates}},...p.citations.slice(1)]});
 expect(raw).toContain('5e-324');
 expect(()=>parseWindowWorkflowProposal(raw,context())).toThrow('Diagnostic: region');
});

test('positive normalized regions may end exactly on the legal right and bottom boundaries',()=>{
 const p=proposal();
 const legal={...p,citations:p.citations.map(c=>({...c,location:{...c.location,x:0.875,y:0.75,width:0.125,height:0.25}}))};
 const result=parseWindowWorkflowProposal(JSON.stringify(legal),context());
 expect(result.kind==='window-workflow-review-candidate'&&result.proposal.citations[0].location).toEqual({kind:'image-region',x:0.875,y:0.75,width:0.125,height:0.25,quote:'Idle'});
});

test('one complete bounded JSON value is required, including unique escaped keys at every level',()=>{
 const raw=JSON.stringify(proposal());
 for(const invalid of [
  '```json\n'+raw+'\n```',raw+' trailing',raw+raw,'null','[]','{"schemaVersion":1,}',
  raw.replace('"schemaVersion":1','"schemaVersion":1,"schemaVers\\u0069on":1'),
  raw.replace('"label":"Idle"','"label":"Idle","label":"Idle"'),
  raw.replace('"x":0.1','"x":0.1,"\\u0078":0.1'),
  '['.repeat(13)+'0'+']'.repeat(13),' '.repeat(64001),
 ])expect(()=>parseWindowWorkflowProposal(invalid,context())).toThrow();
});

test('missing or ambiguous diagram candidates stay held for review without invented transition fields',()=>{
 const p=proposal(),value={...p,states:[p.states[0],{id:'busy',name:{kind:'unresolved',citationIds:['c-busy'],reason:'The second state label is unclear.'}}],transitions:[{id:'t-unclear',candidate:{kind:'unresolved',citationIds:['c-start-rule'],reason:'The destination cannot be read.'}}],issues:[{id:'issue-arrow',kind:'ambiguity',citationIds:['c-start-rule'],reason:'Two arrowheads overlap.'}]};
 const result=parseWindowWorkflowProposal(JSON.stringify(value),context());
 if(result.kind!=='window-workflow-review-candidate')throw Error('Expected a held review candidate.');
 expect(result.status).toBe('review-required');expect(result.proposal.transitions).toEqual(value.transitions);
 expect(result.issues).toEqual(expect.arrayContaining([{code:'unresolved-name',path:'states.1.name'},{code:'unresolved-transition',path:'transitions.0'},{code:'reported-issue',path:'issues.0'}]));
 expect(result.proposal.transitions[0].candidate).not.toHaveProperty('toStateId');
 const empty=parseWindowWorkflowProposal(JSON.stringify({...p,states:[],events:[],transitions:[]}),context());
 expect(empty.kind==='window-workflow-review-candidate'&&empty.issues).toContainEqual({code:'insufficient-diagram',path:'proposal'});
});

test('timing, concurrency and insufficient evidence have explicit unsupported results with no module or rules',()=>{
 for(const code of ['unsupported-timing','unsupported-concurrency','insufficient-diagram','unreadable']){
  const value={schemaVersion:1,kind:'unsupported-source',code,reason:'The visible source cannot supply this finite sequential model.'};
  expect(parseWindowWorkflowProposal(JSON.stringify(value),context())).toEqual({...value,provenance:context()});
 }
 const p=proposal();
 for(const claimed of [{...p,clockPeriod:10},{...p,parallel:true},{...p,simulation:'VHDL'},{...p,transitions:p.transitions.map(t=>({...t,candidate:{...t.candidate,delay:2}}))}])expect(()=>parseWindowWorkflowProposal(JSON.stringify(claimed),context())).toThrow();
 const result=parseWindowWorkflowProposal(JSON.stringify({...p,issues:[{id:'clock',kind:'unsupported-timing',citationIds:['c-start-rule'],reason:'The clock edge is not interpreted by this proposal.'}]}),context());
 expect(result.kind==='window-workflow-review-candidate'&&result.issues).toContainEqual({code:'unsupported-model-feature',path:'issues.0'});
});

test('provider authority, full modules, targets and forged source identities are rejected with value-free diagnostics',()=>{
 const p=proposal();
 const bad:unknown[]=[...['approved','confirmed','permission','taskId','basis','sourceRefs','target','transfer','practice','module','executable','PRIVATE_FIELD'].map(key=>({...p,[key]:'PRIVATE_VALUE'})),{...p,citations:p.citations.map((c,i)=>i?c:{...c,source:'S2'})},{...p,citations:p.citations.map((c,i)=>i?c:{...c,source:{sourceId:'PRIVATE_VALUE',version:3,digest:'PRIVATE_VALUE'}})},{...p,states:p.states.map((s,i)=>i?s:{...s,name:{...s.name,confirmed:true}})}];
 for(const value of bad){
  let caught:unknown;try{parseWindowWorkflowProposal(JSON.stringify(value),context());}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Error);expect(String(caught)).toContain('Diagnostic: schema');expect(String(caught)).not.toMatch(/PRIVATE|ParseError|Struct|owned-window|brief-digest/);
 }
});

test('own prototype-named unknown keys are rejected at root and nested locations without prototype changes',()=>{
 const raw=JSON.stringify(proposal()),before=Object.getOwnPropertyDescriptors(Object.prototype);
 for(const key of ['__proto__','constructor','prototype'])for(const replacement of [
  raw.replace('"schemaVersion":1',`"schemaVersion":1,"${key}":{"PRIVATE_SENTINEL":true}`),
  raw.replace('"label":"Idle"',`"label":"Idle","${key}":{"PRIVATE_SENTINEL":true}`),
  raw.replace('"x":0.1',`"x":0.1,"${key}":{"PRIVATE_SENTINEL":true}`),
 ]){
  let caught:unknown;try{parseWindowWorkflowProposal(replacement,context());}catch(error){caught=error;}
  expect(caught).toBeInstanceOf(Error);expect(String(caught)).toBe('Error: Invalid window workflow proposal. Diagnostic: schema. No workflow was admitted.');
  expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before);
  expect(Object.getPrototypeOf({})).toBe(Object.prototype);
 }
});

test('field and collection bounds reject whole proposals instead of truncating a partial diagram',()=>{
 const p=proposal(),missing={kind:'unresolved',citationIds:[],reason:'The source is unclear.'};
 const invalid=[
  {...p,title:'x'.repeat(161)},
  {...p,states:p.states.map((s,i)=>i?s:{...s,id:'x'.repeat(81)})},
  {...p,assumptions:['x'.repeat(501)]},
  {...p,initialState:{...missing,reason:'x'.repeat(501)}},
  {...p,citations:[...p.citations,{...p.citations[0],id:'extra',location:{...p.citations[0].location,quote:'x'.repeat(501)}}]},
  {...p,states:Array.from({length:9},(_,i)=>({id:'s'+i,name:missing}))},
  {...p,events:Array.from({length:9},(_,i)=>({id:'e'+i,name:missing}))},
  {...p,transitions:Array.from({length:25},(_,i)=>({id:'t'+i,candidate:missing}))},
  {...p,citations:Array.from({length:49},(_,i)=>({...p.citations[0],id:'citation'+i}))},
  {...p,issues:Array.from({length:13},(_,i)=>({id:'issue'+i,kind:'ambiguity',citationIds:[],reason:'Unclear.'}))},
  {...p,assumptions:Array.from({length:13},()=> 'A proposed assumption.')},
  {...p,initialState:{kind:'inferred',stateId:'idle',citationIds:p.citations.slice(0,5).map(c=>c.id),reason:'Proposed.'}},
 ];
 for(const value of invalid)expect(()=>parseWindowWorkflowProposal(JSON.stringify(value),context())).toThrow('Diagnostic: schema');
 const boundary={...p,title:'x'.repeat(160),assumptions:Array.from({length:12},()=> 'x'.repeat(500)),citations:[...p.citations,{...p.citations[0],id:'extra',location:{...p.citations[0].location,quote:'x'.repeat(500)}}]};
 const result=parseWindowWorkflowProposal(JSON.stringify(boundary),context());
 expect(result.kind==='window-workflow-review-candidate'&&result.proposal.title.length).toBe(160);
});

test('unsafe control content and executable display markup are rejected while quoted HDL remains inert transcription',()=>{
 const p=proposal();
 for(const unsafe of ['\u0000','\u202e','\ud800','<script>run()</script>','[Run](file:/tmp/private)','javascript:run()','```vhdl\nrun\n```']){
  for(const value of [{...p,title:unsafe},{...p,initialState:{...p.initialState,reason:unsafe}},{...p,citations:[...p.citations,{...p.citations[0],id:'extra',location:{...p.citations[0].location,quote:unsafe}}]}])expect(()=>parseWindowWorkflowProposal(JSON.stringify(value),context())).toThrow('Diagnostic: schema');
 }
 const hdl={...p,citations:[...p.citations,{...p.citations[0],id:'hdl',location:{...p.citations[0].location,quote:"when Idle =>\n  if count < limit and limit > 0 then next_state <= Busy; end if;"}}]};
 const result=parseWindowWorkflowProposal(JSON.stringify(hdl),context());
 expect(result.kind==='window-workflow-review-candidate'&&result.status).toBe('review-required');
 expect(result.kind==='window-workflow-review-candidate'&&result.proposal.citations.at(-1)?.location.quote).toContain('next_state <= Busy');
});

test('host provenance copies exact capture metadata without pixels or an invented retention guarantee',()=>{
 const raw=JSON.stringify(proposal()),trusted=context();
 for(const changed of [
  {...trusted,pixels:'PRIVATE_PIXELS'},
  {...trusted,source:{...trusted.source,dataUrl:'PRIVATE_PIXELS'}},
  {...trusted,source:{...trusted.source,capture:{...trusted.source.capture,approved:true}}},
  {...trusted,source:{...trusted.source,capture:{...trusted.source.capture,previewExpiresAt:'2026-10-27T11:59:59.000Z'}}},
  {...trusted,source:{...trusted.source,capture:{...trusted.source.capture,previewExpiresAt:trusted.source.capture.capturedAt}}},
  {...trusted,source:{...trusted.source,capture:{...trusted.source.capture,previewExpiresAt:'2026-10-27T12:05:00.001Z'}}},
  {...trusted,source:{...trusted.source,capture:{...trusted.source.capture,imageSha256:'forged-shape'}}},
 ])expect(()=>parseWindowWorkflowProposal(raw,changed)).toThrow('Diagnostic: context');
 const historical=context();historical.source.capture.capturedAt='2020-01-01T00:00:00.000Z';historical.source.capture.previewExpiresAt='2020-01-01T00:05:00.000Z';
 const result=parseWindowWorkflowProposal(raw,historical);
 expect(result.provenance.source.capture).toEqual(historical.source.capture);
 expect(result).not.toHaveProperty('previewAvailable');expect(result).not.toHaveProperty('current');
});

test('inferred labels and starting choices retain their classification without acquiring confirmation',()=>{
 const p=proposal(),value={...p,states:[p.states[0],{id:'busy',name:{kind:'inferred',label:'Working',citationIds:['c-busy'],reason:'A readable alias proposed for the unclear label.'}}],initialState:{kind:'inferred',stateId:'idle',citationIds:['c-idle'],reason:'A starting choice to review.'}};
 const result=parseWindowWorkflowProposal(JSON.stringify(value),context());
 if(result.kind!=='window-workflow-review-candidate')throw Error('Expected a review candidate.');
 expect(result.proposal.states[1].name).toEqual(value.states[1].name);expect(result.proposal.initialState).toEqual(value.initialState);
 expect(result.status).toBe('review-required');expect(result.issues).toEqual([]);
 expect(result).not.toHaveProperty('confirmedFacts');expect(result).not.toHaveProperty('rules');
 const duplicateLabel={...p,states:p.states.map(s=>({...s,name:{kind:'inferred',label:'Same',citationIds:['c-idle'],reason:'Proposed.'}}))};
 expect(()=>parseWindowWorkflowProposal(JSON.stringify(duplicateLabel),context())).toThrow('duplicate-identity');
 const unsupported={schemaVersion:1,kind:'unsupported-source',code:'insufficient-diagram',reason:'No complete diagram is visible.'};
 expect(()=>parseWindowWorkflowProposal(JSON.stringify({...unsupported,approved:true}),context())).toThrow('Diagnostic: schema');
 expect(()=>parseWindowWorkflowProposal(JSON.stringify({...unsupported,code:'simulate-anyway'}),context())).toThrow('Diagnostic: schema');
});
