import {expect,test} from 'vitest';
import {checkWindowWorkflowReview,windowWorkflowReviewSnapshot} from '../src/learning/window-workflow-review';
import {parseWindowWorkflowProposal,type WindowWorkflowReviewCandidate} from '../src/learning/window-workflow-proposal';

function candidate():WindowWorkflowReviewCandidate{
 const citation=(id:string,quote:string)=>({id,source:'S1',location:{kind:'image-region',x:0.1,y:0.1,width:0.2,height:0.2,quote}});
 const result=parseWindowWorkflowProposal(JSON.stringify({schemaVersion:1,kind:'finite-state-proposal',title:'Owned synthetic FSM',states:[{id:'idle',name:{kind:'transcribed',label:'Idle',citationId:'c-idle'}},{id:'busy',name:{kind:'transcribed',label:'Busy',citationId:'c-busy'}}],events:[{id:'start',name:{kind:'transcribed',label:'Start',citationId:'c-start'}},{id:'finish',name:{kind:'transcribed',label:'Finish',citationId:'c-finish'}}],transitions:[{id:'t-start',candidate:{kind:'inferred',fromStateId:'idle',eventId:'start',toStateId:'busy',citationIds:['c-go'],reason:'Proposed arrow reading.'}},{id:'t-finish',candidate:{kind:'inferred',fromStateId:'busy',eventId:'finish',toStateId:'idle',citationIds:['c-back'],reason:'Proposed return reading.'}}],initialState:{kind:'unresolved',citationIds:[],reason:'Choose the local starting state.'},assumptions:[],issues:[],citations:[citation('c-idle','Idle'),citation('c-busy','Busy'),citation('c-start','Start'),citation('c-finish','Finish'),citation('c-go','Idle + Start -> Busy'),citation('c-back','Busy + Finish -> Idle')]}),{taskId:'owned-task',basis:{artifactId:'owned-brief',revision:1,digest:'brief-digest'},source:{handle:'S1',kind:'window',role:'fact',ref:{sourceId:'owned-source',version:1,digest:'source-digest'},capture:{captureId:'owned-capture',imageSha256:'a'.repeat(64),capturedAt:'2026-10-27T12:00:00.000Z',previewExpiresAt:'2026-10-27T12:05:00.000Z'}}});
 if(result.kind!=='window-workflow-review-candidate')throw Error('Expected a synthetic candidate.');return result;
}
function draft(){
 const named=(id:string,label:string,citationId:string)=>({id,selected:true,value:{kind:'reviewed-name',label,citationId,interpretation:'reviewed-transcription',reason:'I reviewed this quoted label.'}});
 const rule=(id:string,fromStateId:string,eventId:string,toStateId:string,citationId:string)=>({id,selected:true,value:{kind:'reviewed-image-interpretation',fromStateId,eventId,toStateId,citationIds:[citationId],reason:'My explicit finite interpretation of this arrow.'}});
 return {title:'Reviewed owned FSM',states:[named('idle','Idle','c-idle'),named('busy','Busy','c-busy')],events:[named('start','Start','c-start'),named('finish','Finish','c-finish')],transitions:[rule('t-start','idle','start','busy','c-go'),rule('t-finish','busy','finish','idle','c-back')],evidence:['c-idle','c-busy','c-start','c-finish','c-go','c-back'].map(citationId=>({citationId,kind:'confirmed-transcription',reason:'I reviewed this region and transcription.'})),initialStateId:'idle',eventIds:['start','finish','start'],assumptions:['Events are explicit sequential modeling choices.'],issueResolutions:[]};
}
function confirmed(c:WindowWorkflowReviewCandidate,value:unknown){return {draft:value,confirmation:{kind:'reviewed-window-transcription',snapshot:windowWorkflowReviewSnapshot(c,value)}};}
function reparse(c:WindowWorkflowReviewCandidate,patch:Record<string,unknown>){const result=parseWindowWorkflowProposal(JSON.stringify({...c.proposal,...patch}),c.provenance);if(result.kind!=='window-workflow-review-candidate')throw Error('Expected a candidate.');return result;}

test('explicit review normalizes one finite case and keeps image evidence and provenance without admission',()=>{
 const c=candidate(),input=draft(),result=checkWindowWorkflowReview(c,confirmed(c,input));
 expect(result.kind).toBe('valid');if(result.kind!=='valid')throw Error('Expected valid reviewed input.');
 expect(result.value.practice).toEqual({id:'reviewed-window-practice',title:'Reviewed owned FSM',states:[{id:'idle',label:'Idle'},{id:'busy',label:'Busy'}],events:[{id:'start',label:'Start'},{id:'finish',label:'Finish'}],rules:[{id:'t-start',fromStateId:'idle',eventId:'start',toStateId:'busy',enabled:true},{id:'t-finish',fromStateId:'busy',eventId:'finish',toStateId:'idle',enabled:true}],initialStateId:'idle',eventIds:['start','finish','start']});
 expect(result.value.scope).toBe('reviewed-frozen-transcription');expect(result.value.provenance).toEqual(c.provenance);
 expect(result.value.evidence[0]).toMatchObject({citationId:'c-idle',classification:'confirmed-transcription',original:{quote:'Idle'},reviewed:{quote:'Idle'}});
 expect(result.value.ruleInterpretations.every(rule=>rule.classification==='reviewed-image-interpretation')).toBe(true);
 expect(Object.keys(result.value).sort()).toEqual(['assumptions','evidence','kind','nameInterpretations','practice','provenance','reviewSnapshot','ruleInterpretations','schemaVersion','scope']);
 expect(JSON.stringify(result.value)).not.toMatch(/workflow-lab|transfer|approved|permission|dataUrl|base64|source-stated/);
});

test('selected unresolved names and transitions remain refused instead of silently disappearing from a case',()=>{
 const c=candidate(),d=draft();
 for(const value of [
  {...d,states:[...d.states,{id:'unknown',selected:true,value:{kind:'unresolved',reason:'Unreadable state.'}}]},
  {...d,events:[...d.events,{id:'unknown',selected:true,value:{kind:'unresolved',reason:'Unreadable event.'}}]},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{kind:'unresolved',reason:'Unreadable arrow.'}})},
 ])expect(checkWindowWorkflowReview(c,confirmed(c,value)).kind).toBe('invalid');
});

test.each(['states','events'] satisfies readonly ('states'|'events')[])('an unresolved selected existing %s identity fails specifically at the unresolved-selection check',category=>{
 const c=candidate(),d=draft(),value={...d,[category]:d[category].map((entry,index)=>index?entry:{...entry,value:{kind:'unresolved',reason:'This existing candidate label remains unreadable.'}})};
 expect(checkWindowWorkflowReview(c,confirmed(c,value))).toEqual({kind:'invalid',issues:[{code:'unresolved-selection',path:category}]});
});

test('review cannot forge candidate identities, omit explicit selections or use unreviewed evidence',()=>{
 const c=candidate(),d=draft();
 for(const value of [
  {...d,states:d.states.map((s,i)=>i?s:{...s,id:'invented'})},
  {...d,events:[...d.events,d.events[0]]},
  {...d,transitions:d.transitions.slice(0,1)},
  {...d,states:d.states.map((s,i)=>i?s:{...s,value:{...s.value,citationId:'not-supplied'}})},
  {...d,states:d.states.map((s,i)=>i?s:{...s,value:{...s.value,label:'A guessed transcription'}})},
  {...d,evidence:d.evidence.filter(e=>e.citationId!=='c-go')},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{...t.value,citationIds:['not-supplied']}})},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{...t.value,citationIds:['c-go','c-go']}})},
 ])expect(checkWindowWorkflowReview(c,confirmed(c,value)).kind).toBe('invalid');
});

test('corrected evidence preserves the original region and quote and binds the reviewed name to the correction',()=>{
 const c=candidate(),d=draft(),location={kind:'image-region',x:0.5,y:0.25,width:0.25,height:0.25,quote:'Waiting'};
 const value={...d,states:d.states.map((s,i)=>i?s:{...s,value:{...s.value,label:'Waiting'}}),evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location,reason:'I corrected the visible label and selected its complete region.'})};
 const result=checkWindowWorkflowReview(c,confirmed(c,value));
 expect(result.kind).toBe('valid');if(result.kind!=='valid')throw Error('Expected corrected finite review.');
 expect(result.value.evidence[0]).toMatchObject({classification:'corrected-transcription',original:{x:0.1,y:0.1,width:0.2,height:0.2,quote:'Idle'},reviewed:location});
 expect(result.value.practice.states[0]).toEqual({id:'idle',label:'Waiting'});
 expect(result.value.nameInterpretations[0].classification).toBe('reviewed-transcription');
});

test('every changed review field and candidate binding invalidates its prior confirmation',()=>{
 const c=candidate(),d=draft(),original=confirmed(c,d);
 const changed=[
  {...d,title:'Changed title'},
  {...d,states:d.states.map((s,i)=>i?s:{...s,value:{...s.value,interpretation:'user-interpreted',label:'Waiting'}})},
  {...d,events:d.events.map((s,i)=>i?s:{...s,value:{...s.value,reason:'Changed label reason.'}})},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{...t.value,toStateId:'idle'}})},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,selected:false})},
  {...d,evidence:d.evidence.map((e,i)=>i?e:{...e,reason:'Changed evidence reason.'})},
  {...d,evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location:{...c.proposal.citations[0].location,x:0.25},reason:'Changed region.'})},
  {...d,evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location:{...c.proposal.citations[0].location,quote:'Idle?'},reason:'Changed transcription.'})},
  {...d,initialStateId:'busy'},{...d,eventIds:['finish','start']},{...d,assumptions:['A changed assumption.']},
 ];
 for(const value of changed)expect(checkWindowWorkflowReview(c,{...original,draft:value})).toEqual({kind:'invalid',issues:[{code:'confirmation-stale',path:'confirmation'}]});
 const another={...c,provenance:{...c.provenance,basis:{...c.provenance.basis,digest:'another-basis'}}};
 expect(checkWindowWorkflowReview(another,original)).toEqual({kind:'invalid',issues:[{code:'confirmation-stale',path:'confirmation'}]});
 expect(checkWindowWorkflowReview(c,{draft:d,confirmation:null})).toEqual({kind:'invalid',issues:[{code:'confirmation-required',path:'confirmation'}]});
});

test.each([
 {x:1,width:Number.MIN_VALUE},{y:1,height:Number.MIN_VALUE},{x:Number.MIN_VALUE,width:1},{y:Number.MIN_VALUE,height:1},
 {x:-0.01},{y:1.01},{width:0},{height:0},{x:0.9,width:0.2},{y:0.9,height:0.2},
])('corrected image evidence uses the sealed region guard for %j',change=>{
 const c=candidate(),d=draft(),location={...c.proposal.citations[0].location,...change};
 const value={...d,evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location,reason:'I changed this region.'})};
 expect(checkWindowWorkflowReview(c,confirmed(c,value)).kind).toBe('invalid');
});

test('nonfinite corrected evidence is refused before it can become a confirmation snapshot',()=>{
 const c=candidate(),d=draft();
 for(const change of [{width:Number.NaN},{height:Number.POSITIVE_INFINITY}]){
  const value={...d,evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location:{...c.proposal.citations[0].location,...change},reason:'Invalid numeric input.'})};
  expect(()=>windowWorkflowReviewSnapshot(c,value)).toThrow('snapshot is invalid');
  expect(checkWindowWorkflowReview(c,{draft:value,confirmation:{kind:'reviewed-window-transcription',snapshot:'unusable'}}).kind).toBe('invalid');
 }
});

test('corrected evidence may reach exact legal edges without mutating either original or reviewed input',()=>{
 const c=candidate(),d=draft(),value={...d,evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location:{...c.proposal.citations[0].location,x:0.875,y:0.75,width:0.125,height:0.25},reason:'Corrected the complete label region.'})},before=JSON.stringify({c,value});
 const result=checkWindowWorkflowReview(c,confirmed(c,value));expect(result.kind).toBe('valid');
 expect(JSON.stringify({c,value})).toBe(before);
 if(result.kind!=='valid')throw Error('Expected edge-bounded review.');
 value.evidence[0].reason='A later caller edit.';
 expect(result.value.evidence[0].reason).toBe('Corrected the complete label region.');
});

test('timing and concurrency issues cannot be confirmed into a supported finite interpretation',()=>{
 for(const kind of ['unsupported-timing','unsupported-concurrency','insufficient-diagram']){
  const c=reparse(candidate(),{issues:[{id:'issue-1',kind,citationIds:['c-go'],reason:'The supplied source needs unsupported semantics.'}]}),d={...draft(),issueResolutions:[{issueId:'issue-1',kind:'resolved',reason:'I claim this is resolved.'}]};
  expect(checkWindowWorkflowReview(c,confirmed(c,d))).toEqual({kind:'invalid',issues:[{code:'unsupported-source',path:'issues'}]});
 }
});

test('ambiguities require explicit resolution and excluded evidence cannot still support selected rules',()=>{
 const c=reparse(candidate(),{issues:[{id:'issue-1',kind:'ambiguity',citationIds:['c-go'],reason:'The arrow direction is ambiguous.'}]}),d=draft();
 expect(checkWindowWorkflowReview(c,confirmed(c,d)).kind).toBe('invalid');
 const resolved={...d,issueResolutions:[{issueId:'issue-1',kind:'resolved',reason:'I reviewed the arrowhead and chose this finite interpretation.'}]};
 expect(checkWindowWorkflowReview(c,confirmed(c,resolved)).kind).toBe('valid');
 for(const issueResolutions of [[{...resolved.issueResolutions[0],kind:'excluded'}],[...resolved.issueResolutions,resolved.issueResolutions[0]],[{...resolved.issueResolutions[0],issueId:'not-supplied'}]])expect(checkWindowWorkflowReview(c,confirmed(c,{...d,issueResolutions})).kind).toBe('invalid');
});

test('an explicitly unselected unresolved arrow is retained in the review snapshot without inventing a rule',()=>{
 const initial=candidate(),c=reparse(initial,{transitions:[initial.proposal.transitions[0],{id:'t-finish',candidate:{kind:'unresolved',citationIds:['c-back'],reason:'The return arrow is unclear.'}}],issues:[{id:'issue-back',kind:'unreadable',citationIds:['c-back'],reason:'Unreadable return arrow.'}]}),d=draft();
 const value={...d,transitions:[d.transitions[0],{id:'t-finish',selected:false,value:{kind:'unresolved',reason:'I leave this unclear arrow out.'}}],evidence:d.evidence.filter(e=>e.citationId!=='c-back'),eventIds:['start'],issueResolutions:[{issueId:'issue-back',kind:'excluded',reason:'No selected rule uses this unreadable arrow.'}]};
 const result=checkWindowWorkflowReview(c,confirmed(c,value));expect(result.kind).toBe('valid');
 if(result.kind!=='valid')throw Error('Expected a bounded partial interpretation.');
 expect(result.value.practice.rules).toHaveLength(1);expect(result.value.ruleInterpretations[0].ruleId).toBe('t-start');expect(result.value.reviewSnapshot).toContain('I leave this unclear arrow out.');
});

test('finite case references, duplicate pairs and input limits are checked before any normalized result',()=>{
 const c=candidate(),d=draft();
 for(const value of [
  {...d,initialStateId:null},{...d,initialStateId:'not-declared'},{...d,eventIds:[]},{...d,eventIds:['not-declared']},
  {...d,transitions:d.transitions.map((t,i)=>i?{...t,value:{...t.value,fromStateId:'idle',eventId:'start'}}:t)},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{...t.value,toStateId:'not-declared'}})},
  {...d,transitions:d.transitions.map((t,i)=>i?t:{...t,selected:false,value:{...t.value,toStateId:'not-declared'}})},
  {...d,evidence:[]},{...d,evidence:[...d.evidence,d.evidence[0]]},
 ])expect(checkWindowWorkflowReview(c,confirmed(c,value)).kind).toBe('invalid');
 for(const value of [{...d,title:'x'.repeat(161)},{...d,eventIds:Array(13).fill('start')},{...d,assumptions:Array(13).fill('A')},{...d,states:d.states.map((s,i)=>i?s:{...s,value:{...s.value,reason:'x'.repeat(501)}})}])expect(checkWindowWorkflowReview(c,{draft:value,confirmation:null}).kind).toBe('invalid');
});

test('review fields reject authority, text-source classification and unknown nested fields with static diagnostics',()=>{
 const c=candidate(),d=draft();
 for(const input of [
  {...confirmed(c,d),approved:true},
  {draft:{...d,transfer:'PRIVATE_VALUE'},confirmation:null},
  {draft:{...d,clockPeriod:10},confirmation:null},
  {draft:{...d,concurrent:true},confirmation:null},
  {draft:{...d,states:d.states.map((s,i)=>i?s:{...s,value:{...s.value,interpretation:'source-stated'}})},confirmation:null},
  {draft:{...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{...t.value,target:'PRIVATE_VALUE'}})},confirmation:null},
  {draft:{...d,evidence:[{citationId:'c-idle',kind:'confirmed-transcription',reason:'Reviewed.',location:c.proposal.citations[0].location}]},confirmation:null},
  JSON.parse('{"draft":{},"confirmation":null,"__proto__":{"PRIVATE_VALUE":true}}'),
 ]){
  const result=checkWindowWorkflowReview(c,input);expect(result.kind).toBe('invalid');expect(JSON.stringify(result)).not.toMatch(/PRIVATE|ParseError|Struct|owned-source|source-digest/);
 }
 const forged={...c,approved:true};expect(checkWindowWorkflowReview(forged,confirmed(c,d))).toEqual({kind:'invalid',issues:[{code:'candidate',path:'candidate'}]});
});

test('unsafe review prose and falsely classified unchanged corrections remain refused',()=>{
 const c=candidate(),d=draft(),confirmation=confirmed(c,d).confirmation;
 for(const unsafe of ['<script>run()</script>','javascript:run()','[Run](file:/tmp/private)','\u0000','\u202e'])for(const value of [{...d,title:unsafe},{...d,assumptions:[unsafe]},{...d,transitions:d.transitions.map((t,i)=>i?t:{...t,value:{...t.value,reason:unsafe}})}])expect(checkWindowWorkflowReview(c,{draft:value,confirmation})).toEqual({kind:'invalid',issues:[{code:'schema',path:'review'}]});
 const unchanged={...d,evidence:d.evidence.map((e,i)=>i?e:{citationId:e.citationId,kind:'corrected-transcription',location:c.proposal.citations[0].location,reason:'I claim this unchanged evidence was corrected.'})};
 expect(checkWindowWorkflowReview(c,confirmed(c,unchanged)).kind).toBe('invalid');
});

test('historical capture metadata stays historical and the content binding does not certify a human or live pixels',()=>{
 const c=candidate(),historical={...c,provenance:{...c.provenance,source:{...c.provenance.source,capture:{...c.provenance.source.capture,capturedAt:'2020-01-01T00:00:00.000Z',previewExpiresAt:'2020-01-01T00:05:00.000Z'}}}},d=draft();
 const result=checkWindowWorkflowReview(historical,confirmed(historical,d));expect(result.kind).toBe('valid');
 if(result.kind!=='valid')throw Error('Expected only a structural historical review check.');
 expect(result.value.scope).toBe('reviewed-frozen-transcription');expect(result.value.provenance.source.capture.capturedAt).toBe('2020-01-01T00:00:00.000Z');
 for(const field of ['current','previewAvailable','humanVerified','admitted','approved','executionAuthorized'])expect(result.value).not.toHaveProperty(field);
});

test('a bounded review snapshot may exceed an individual raw-form string without truncating its content binding',()=>{
 const initial=candidate(),c=reparse(initial,{citations:[...initial.proposal.citations,...Array.from({length:42},(_,index)=>({...initial.proposal.citations[0],id:'extra-'+index,location:{...initial.proposal.citations[0].location,quote:'Q'.repeat(500)}}))]}),d=draft();
 const value={...d,states:d.states.map(s=>({...s,value:{...s.value,reason:'R'.repeat(500)}})),events:d.events.map(s=>({...s,value:{...s.value,reason:'R'.repeat(500)}})),transitions:d.transitions.map(t=>({...t,value:{...t.value,reason:'R'.repeat(500)}})),evidence:d.evidence.map(e=>({...e,reason:'R'.repeat(500)})),assumptions:Array.from({length:12},()=> 'A'.repeat(500))};
 const input=confirmed(c,value);expect(input.confirmation.snapshot.length).toBeGreaterThan(32768);
 const result=checkWindowWorkflowReview(c,input);expect(result.kind).toBe('valid');
 if(result.kind!=='valid')throw Error('Expected the complete bounded content binding.');
 expect(result.value.reviewSnapshot).toBe(input.confirmation.snapshot);
});
