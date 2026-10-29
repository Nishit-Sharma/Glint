import {describe,expect,it,vi} from 'vitest';
import {createMacWindowTarget,createMacWindowProtection} from '../src/host/mac-window-target';

describe('static Mac point-target helper protocol, injected executable only',()=>{
 it('passes an exact DIP point and owned ID/PID exclusions to only the configured helper',async()=>{
  const run=vi.fn(async()=>({stdout:'{"osId":42,"processId":123,"knownProtected":false}'}));
  const pointTarget=createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'darwin',run});
  expect(await pointTarget({x:-700,y:100},[{osId:7,processId:777}])).toEqual({osId:42,processId:123,knownProtected:false});
  expect(run).toHaveBeenCalledExactlyOnceWith('/owned/native/mac-window-at-point',['-700','100','7:777'],{timeout:2500,maxBuffer:4096,encoding:'utf8'});
 });
 it('returns no target for an empty desktop without choosing another window',async()=>{
  const run=vi.fn(async()=>({stdout:'null'})),pointTarget=createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'darwin',run});
  expect(await pointTarget({x:10,y:20},[])).toBeUndefined();
 });
 it.each(['','{broken','[]','{}','{"osId":42,"processId":123}','{"osId":42,"processId":123,"knownProtected":0}','{"osId":42,"processId":123,"knownProtected":false,"title":"untrusted"}','{"osId":42,"processId":0,"knownProtected":false}','{"osId":1.5,"processId":123,"knownProtected":false}'])('rejects incomplete or unexpected native output: %s',async stdout=>{
  const run=vi.fn(async()=>({stdout})),pointTarget=createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'darwin',run});
  await expect(pointTarget({x:10,y:20},[])).rejects.toMatchObject({code:'WINDOW_UNAVAILABLE'});
 });
 it('rejects oversized output and exposes no raw helper error',async()=>{
  const run=vi.fn(async()=>({stdout:' '.repeat(4097)})),pointTarget=createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'darwin',run});
  await expect(pointTarget({x:10,y:20},[])).rejects.toMatchObject({code:'WINDOW_UNAVAILABLE'});
  run.mockRejectedValue(Error('private executable path and OS error'));
  await expect(pointTarget({x:10,y:20},[])).rejects.toMatchObject({code:'TARGET_UNSUPPORTED',message:'Native source targeting is unavailable. Choose a source explicitly.'});
 });
 it.each([NaN,Infinity,1_000_001])('rejects invalid points before execution: %s',async x=>{
  const run=vi.fn(async()=>({stdout:'null'})),pointTarget=createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'darwin',run});
  await expect(pointTarget({x,y:20},[])).rejects.toMatchObject({code:'INVALID_ARGUMENT'});expect(run).not.toHaveBeenCalled();
 });
 it('rejects invalid ignored identities and excessive exclusions before execution',async()=>{
  const run=vi.fn(async()=>({stdout:'null'})),pointTarget=createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'darwin',run});
  await expect(pointTarget({x:10,y:20},[{osId:7,processId:0}])).rejects.toMatchObject({code:'INVALID_ARGUMENT'});
  await expect(pointTarget({x:10,y:20},Array.from({length:9},()=>({osId:7,processId:777})))).rejects.toMatchObject({code:'INVALID_ARGUMENT'});expect(run).not.toHaveBeenCalled();
 });
 it('explicitly leaves unsupported platforms unavailable and requires an absolute static path',async()=>{
  const run=vi.fn(async()=>({stdout:'null'}));expect(()=>createMacWindowTarget('native/helper',{platform:'darwin',run})).toThrow('absolute bundle path');
  await expect(createMacWindowTarget('/owned/native/mac-window-at-point',{platform:'win32',run})({x:10,y:20},[])).rejects.toMatchObject({code:'TARGET_UNSUPPORTED'});expect(run).not.toHaveBeenCalled();
 });
});

describe('exact Mac protection helper protocol, injected executable only',()=>{
 it('requests the exact window and owner without point or capture authority',async()=>{
  const run=vi.fn(async()=>({stdout:'{"osId":42,"processId":123,"knownProtected":false}'}));
  expect(await createMacWindowProtection('/owned/native/mac-window-at-point',{platform:'darwin',run})(42,123)).toEqual({osId:42,processId:123,knownProtected:false});
  expect(run).toHaveBeenCalledExactlyOnceWith('/owned/native/mac-window-at-point',['--window','42','123'],{timeout:2500,maxBuffer:4096,encoding:'utf8'});
 });
 it.each(['{}','{"osId":42,"processId":999,"knownProtected":false}','{"osId":42,"processId":123}','{"osId":42,"processId":123,"knownProtected":false,"extra":1}'])('rejects malformed or changed exact identity: %s',async stdout=>{
  const run=vi.fn(async()=>({stdout}));await expect(createMacWindowProtection('/owned/native/mac-window-at-point',{platform:'darwin',run})(42,123)).rejects.toMatchObject({code:'WINDOW_UNAVAILABLE'});
 });
 it('treats an absent exact window as unavailable and exposes no helper failure',async()=>{
  const run=vi.fn(async()=>({stdout:'null'})),check=createMacWindowProtection('/owned/native/mac-window-at-point',{platform:'darwin',run});
  expect(await check(42,123)).toBeUndefined();run.mockRejectedValue(Error('private path'));await expect(check(42,123)).rejects.toMatchObject({code:'TARGET_UNSUPPORTED',message:'Native source targeting is unavailable. Choose a source explicitly.'});
 });
});
