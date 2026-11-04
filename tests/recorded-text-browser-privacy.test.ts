import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import type {MetaRunInput} from '../src/host/provider';
import {BrowserService} from '../src/host/browser/service';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {choiceBrowser,choiceOrigin,stubChoiceDom} from './browser-select.fixture';
import {privateRecordedHelpers,privateText} from './recorded-text-privacy.fixture';
const external=vi.hoisted(()=>({dialog:vi.fn(),launch:vi.fn()}));
vi.mock('electron',()=>({dialog:{showMessageBox:external.dialog}}));
vi.mock('playwright-core',()=>({chromium:{launch:external.launch}}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

test.each([true,false])('production browser consent decision %s protects helper text before actual planner/provider boundary without launching a browser',async approved=>{
 stubChoiceDom();const directory=await mkdtemp(join(tmpdir(),'recorded-browser-privacy-')),core=await createCompanion({dataDir:directory});let service:BrowserService|undefined;
 try{
  const f=await privateRecordedHelpers(core),owned=choiceBrowser(f.taskId),open=vi.spyOn(LocalBrowser,'open').mockResolvedValue(owned.browser),provider=vi.fn(async(_input:MetaRunInput)=>JSON.stringify({kind:'answer',markdown:'Public page summary'}));
  external.dialog.mockReset().mockResolvedValue({response:approved?1:0});external.launch.mockReset();
  service=new BrowserService(core,{panel:()=>({}) as never,route:()=>({key:'privacy-fixture',provider:{accountScope:async()=> 'synthetic-account',status:async()=>({configured:true,provider:'Codex (temporary)' as const,endpoint:'inert',model:'inert',state:'ready' as const,detail:'Inert provider',specialized:{sam:'off',computer:'off'}}),run:provider}}),changed:()=>{},progress:()=>{}});
  const running=service.run({taskId:f.taskId,requestId:'browser-privacy',prompt:'Read the public page',url:choiceOrigin+'/form'});
  if(approved){await running;expect(provider).toHaveBeenCalledOnce();expect(open).toHaveBeenCalledOnce();const sent=provider.mock.calls[0][0] as {sources:{content:string}[]};const content=sent.sources[0].content;for(const sentinel of Object.values(privateText))expect(content).not.toContain(sentinel);expect(content).toContain('PUBLIC_PLAN_ITEM');expect(content).toContain('PUBLIC_DOCUMENT_BODY');expect(content).toContain('Local helper metadata');expect(content).toContain('Delivery choices');}
  else {await expect(running).rejects.toThrow('not authorized');expect(provider).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();}
  expect(external.dialog).toHaveBeenCalledOnce();const consent=external.dialog.mock.calls[0][1];expect(consent.detail).toContain('Local helper names, operations, inputs, results, checks and reasons are excluded');expect(consent.detail).toContain('selected sources or saved notes can still be shared');for(const sentinel of Object.values(privateText))expect(consent.detail).not.toContain(sentinel);expect(external.launch).not.toHaveBeenCalled();expect(owned.selections).toBe(0);
 }finally{service?.close();await core.close();await rm(directory,{recursive:true,force:true});}
});
