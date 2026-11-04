import {expect,test} from 'vitest';
import {createWindowWorkflowCaptureFence} from '../../src/host/window-workflow-capture';
import {syntheticCandidate} from '../support/window-learning.fixture';
test.each(['expiry','future-clock','identity','hash','capture-id','privacy'])('a %s change is refused again after async target inspection',async kind=>{
 const context=syntheticCandidate().provenance;let now=Date.parse(context.source.capture.capturedAt)+1,privacy=true;
 let capture={sourceVersion:context.source.capture.captureId,imageSha256:context.source.capture.imageSha256,capturedAt:context.source.capture.capturedAt};
 const fence=createWindowWorkflowCaptureFence(context,{now:()=>now,readCapture:()=>capture,assertScope:()=>{if(!privacy)throw Error('Privacy changed');},checkTarget:async()=>{
  if(kind==='expiry')now=Date.parse(context.source.capture.previewExpiresAt);
  if(kind==='future-clock')now=Date.parse(context.source.capture.capturedAt)-1;
  if(kind==='identity')capture={...capture};
  if(kind==='hash')capture.imageSha256='b'.repeat(64);
  if(kind==='capture-id')capture.sourceVersion='another-capture';
  if(kind==='privacy')privacy=false;
 }});
 await expect(fence.check()).rejects.toThrow();
});
test('unchanged exact capture passes but its later TTL retirement fails the synchronous commit guard',async()=>{
 const context=syntheticCandidate().provenance;let now=Date.parse(context.source.capture.capturedAt)+1;
 const capture={sourceVersion:context.source.capture.captureId,imageSha256:context.source.capture.imageSha256,capturedAt:context.source.capture.capturedAt};
 const fence=createWindowWorkflowCaptureFence(context,{now:()=>now,readCapture:()=>capture,assertScope:()=>{},checkTarget:async()=>{}});
 await fence.check();expect(()=>fence.assertCurrent()).not.toThrow();now=Date.parse(context.source.capture.previewExpiresAt);expect(()=>fence.assertCurrent()).toThrow();
});
