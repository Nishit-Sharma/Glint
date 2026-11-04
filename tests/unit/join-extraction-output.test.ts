import {expect,test} from 'vitest';
import {parseJoinExtractionOutput} from '../../src/core/join-extraction-output';
import {extractionFixture} from '../support/grounded-join-fixture';
import {publicErrorMessage} from '../../src/shared/public-messages';
import {joinExtractionPrompt} from '../../src/core/grounded-join-host';
import {createCompanion} from '../../src/core/companion';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('strict provider output accepts only a bounded transcription or explicit plain-prose unsupported result',()=>{
 const f=extractionFixture(true),proposal=JSON.stringify(f.proposal);
 expect(parseJoinExtractionOutput(proposal)).toEqual({kind:'proposal',proposal:f.proposal});
 expect(parseJoinExtractionOutput('{"schemaVersion":1,"kind":"unsupported-source","reason":"The second table has no readable rows."}')).toEqual({schemaVersion:1,kind:'unsupported-source',reason:'The second table has no readable rows.'});
 for(const raw of ['```json\n'+proposal+'\n```',proposal+' trailing',proposal.replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'),proposal.replace('"schemaVersion":1','"schemaVersion":1,"schemaVers\\u0069on":1'),JSON.stringify({...f.proposal,transfer:f.transfer}),JSON.stringify({...f.proposal,kind:'grounded-join'}),JSON.stringify({...f.proposal,extraction:{...f.proposal.extraction,left:{...f.proposal.extraction.left,rows:[]}}})])expect(()=>parseJoinExtractionOutput(raw)).toThrow();
 for(const reason of ['', 'x'.repeat(501),'[Open](https://example.invalid)','<script>run()</script>','```json','{"answer":4}','Bad\u0000text'])expect(()=>parseJoinExtractionOutput(JSON.stringify({schemaVersion:1,kind:'unsupported-source',reason}))).toThrow();
 expect(()=>parseJoinExtractionOutput('{"schemaVersion":1,"kind":"unsupported-source","reason":"No rows.","approval":true}')).toThrow();
 expect(()=>parseJoinExtractionOutput(' '.repeat(128001))).toThrow();
});

test('failure diagnostics identify schema paths without retaining source values or unknown field names',()=>{
 const fixture=extractionFixture();
 for(const [value,path] of [
  [{...fixture.proposal,extraction:{...fixture.proposal.extraction,id:'private.table.id'}},'.extraction.id'],
  [{...fixture.proposal,extraction:{...fixture.proposal.extraction,title:'PRIVATE'.repeat(27)}},'.extraction.title'],
  [{...fixture.proposal,extraction:{...fixture.proposal.extraction,left:{...fixture.proposal.extraction.left,columns:fixture.proposal.extraction.left.columns.map((c,i)=>i?c:{...c,id:'private.column.id'})}}},'.extraction.left.columns[0].id'],
  [{...fixture.proposal,'private-extra-field':'private-value'},'.[unknown-field]'],
 ] as const){
  let error:unknown;try{parseJoinExtractionOutput(JSON.stringify(value));}catch(cause){error=cause;}
  expect(error).toBeInstanceOf(Error);expect(String(error)).toContain('Diagnostic: schema at '+path);
  expect(String(error)).not.toMatch(/private|PRIVATE/);expect(publicErrorMessage(error)).toBe('The response could not be turned into a usable draft. Change your request and try again.');
 }
 for(const [raw,code] of [['```json\nPRIVATE\n```','json'],['{"secret":1,"secret":2}','duplicate-key'],['['.repeat(13),'depth'],[' '.repeat(128001),'size'],['{"schemaVersion":1,"kind":"unsupported-source","reason":"<PRIVATE>"}','unsupported-shape']] as const){
  expect(()=>parseJoinExtractionOutput(raw)).toThrow('Diagnostic: '+code+' at $');
 }
 const empty={...fixture.proposal,extraction:{...fixture.proposal.extraction,right:{...fixture.proposal.extraction.right,rows:[]}}};
 expect(()=>parseJoinExtractionOutput(JSON.stringify(empty))).toThrow('Diagnostic: empty-table at .extraction.right.rows');
});

test('the generic prompt states exact required structure and bounded identifiers without demo facts',()=>{
 const prompt=joinExtractionPrompt({taskId:'owned-fixture',sourceRefs:[],sources:[],artifact:{artifactId:'not-used',revision:1,digest:'not-used'}});
 expect(prompt).toContain('"schemaVersion":1');expect(prompt).toContain('^[A-Za-z0-9_-]{1,80}$');
 expect(prompt).toContain('Each row is exactly {id,cells:[...]}');expect(prompt).toContain('1–160');expect(prompt).toContain('1–500');expect(prompt).toContain('at most160');expect(prompt).toContain('at most500');
 expect(prompt).toContain('present as null');expect(prompt).toContain('rows (1–12)');expect(prompt).not.toMatch(/Ada|Ben|customers|orders|Book|Cable/);
});

test('the existing request ledger keeps only safe failure diagnostics and publishes no invalid artifact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'join-output-diagnostic-')),core=await createCompanion({dataDir:root});
 try{
  const task=await core.createTask({title:'Owned diagnostic fixture'}),fixture=extractionFixture();
  const raw=JSON.stringify({...fixture.proposal,extraction:{...fixture.proposal.extraction,id:'PRIVATE.INVALID.ID'}});
  const result=await core.runRequest({taskId:task.id,requestId:'diagnostic',kind:'experiment',prompt:'Owned synthetic extraction',sourceIds:[]},async()=>{parseJoinExtractionOutput(raw);throw Error('Must reject before publication.');});
  expect(result.status).toBe('failed');expect(result.error).toContain('Diagnostic: schema at .extraction.id');
  const after=await core.getTask(task.id);expect(after.artifacts).toEqual([]);expect(JSON.stringify(after)).not.toContain('PRIVATE.INVALID.ID');
 }finally{await core.close();await rm(root,{recursive:true,force:true});}
});
