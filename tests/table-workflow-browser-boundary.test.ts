import {expect,test} from 'vitest';
import {build} from 'esbuild';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pickingDigest,pickingCanonical,pickingTextDigest} from '../src/shared/picking-digest';
import {pickingDigest as priorDigest,pickingCanonical as priorCanonical} from './fixtures/contrast-source977/src/shared/picking-digest';
import {namedFixture,queued3} from './table-workflow-inputs.fixture';
import {freshCsv} from './table-workflow.fixture';
import {saveModuleDocument} from '../src/core/module-state';

test('the actual table workflow renderer import graph bundles for browsers without Node shims',async()=>{
 const bundled=await build({entryPoints:[resolve('src/renderer/src/components/TableWorkflowStudio.tsx')],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,metafile:true,loader:{'.css':'empty'},logLevel:'silent'});
 expect(bundled.metafile.inputs).toHaveProperty('src/core/table-workflow-host.ts');
 expect(Object.values(bundled.metafile.outputs).flatMap(output=>output.imports).some(item=>item.external&&/^(node:|crypto$)/.test(item.path))).toBe(false);
 expect(bundled.outputFiles.every(file=>!file.text.includes('browser-external:node:crypto'))).toBe(true);
});

test('synchronous raw UTF-8 receipt hashes match Node including surrogate, Unicode and SHA block-boundary cases',()=>{
 const strings=['','abc','\0\r\n','雪 🧭 é e\u0301','\ud800','\udfff','\ud800x\udfff','x\ud800','\ud800\udc00','\udfff\ud800','```\n# literal\n~~~',...Array.from({length:131},(_,n)=>'a'.repeat(n)),...Array.from({length:68},(_,n)=>'雪'.repeat(n)+'\ud800'),'x'.repeat(100000)];
 for(const text of strings){const result=pickingTextDigest(text);expect(typeof result).toBe('string');expect(result).toBe(createHash('sha256').update(text,'utf8').digest('hex'));expect(pickingTextDigest(text)).toBe(result);}
 expect(pickingTextDigest('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');expect(pickingTextDigest('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 let coerced=false;expect(()=>pickingTextDigest({toString(){coerced=true;return 'bad';}}as unknown as string)).toThrow(/requires a string/);expect(coerced).toBe(false);
});

test('canonical identities remain byte-identical to the pinned pre-refactor implementation',async()=>{
 const prior=await readFile(resolve('tests/fixtures/contrast-source977/src/shared/picking-digest.ts'));expect(createHash('sha256').update(prior).digest('hex')).toBe('6d48b4dca531f1480626f0bbe36d8a1ea107ed954608c708bd302725afa90cf2');
 for(const value of [null,'',19,-0,['雪','\ud800','\udfff','\0'],{z:'雪 🧭\ud800',a:[true,19,null]},{b:2,a:1},'x'.repeat(4000)]){expect(pickingCanonical(value)).toBe(priorCanonical(value));expect(pickingDigest(value)).toBe(priorDigest(value));expect(pickingDigest(value)).toBe(createHash('sha256').update(pickingCanonical(value),'utf8').digest('hex'));}
 const ordered={z:'raw JSON receipt',a:1};expect(pickingTextDigest(JSON.stringify(ordered))).not.toBe(pickingDigest(ordered));
});

test('actual completed host receipt identity matches exact JSON SHA-256 without adding asynchronous digest admission',async()=>{
 const f=await namedFixture();try{
  await f.check();await f.act({kind:'table-workflow-save-version'});await f.act({kind:'table-workflow-activate',version:2});const sourceRef=await f.source(freshCsv,'receipt-source');await f.act({kind:'table-workflow-run',activeVersion:2,sourceRef,inputs:queued3});const state=await f.read(),run=state.lastRun!,before=await f.core.getTask(f.owner.taskId),saved=await saveModuleDocument(f.core,{taskId:before.id,artifactId:f.owner.artifactId,artifactRevision:1,sessionRevision:before.session!.revision}),after=await f.core.getTask(before.id),binding=pickingDigest({format:'local-table-workflow-report-v1',owner:f.owner,run});
  const input={taskId:before.id,requestId:'table-workflow-report-'+binding,kind:'create',prompt:'Save the explicitly reviewed complete local table workflow result as an ordinary document.',executionScope:'local-table-workflow-report:v1',sourceIds:[sourceRef.sourceId],expectedSourceRefs:[sourceRef],expectedArtifacts:[{artifactId:f.owner.artifactId,revision:f.owner.artifactRevision,digest:f.owner.artifactDigest}],expectedModuleStates:[{artifactId:f.owner.artifactId,artifactRevision:f.owner.artifactRevision,moduleId:f.owner.moduleId,stateRevision:state.revision}],sourceRefs:[sourceRef]},text=JSON.stringify(input),request=after.requests.find(item=>item.id===input.requestId)!;
  expect(request.digest).toBe(createHash('sha256').update(text).digest('hex'));expect(pickingTextDigest(text)).toBe(request.digest);expect(request.answer?.artifactId).toBe(saved.artifactId);expect(request.status).toBe('completed');
  const again=await saveModuleDocument(f.core,{taskId:after.id,artifactId:f.owner.artifactId,artifactRevision:1,sessionRevision:after.session!.revision});expect(again.artifactId).toBe(saved.artifactId);expect((await f.core.getTask(after.id)).requests).toHaveLength(after.requests.length);
 }finally{await f.close();}
});
