import {createServer} from 'node:http';
import {expect,it,vi} from 'vitest';
import {chromium,type Browser} from 'playwright-core';
import {LocalBrowser} from '../src/host/browser/local-browser';
import {findPatchedBrowser} from '../src/host/browser/patched-chromium';

const installed=(await findPatchedBrowser()).browser;
// Real installed qualifying browser (Chrome, Chrome for Testing or Chromium), synthetic loopback page only. Skipped where none is installed.
it.runIf(installed)('the detected installed browser reports the same Chromium version it was selected for',async()=>{
 const server=createServer((_request,response)=>{response.setHeader('content-type','text/html');response.end('<h1>Loopback only</h1>');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const address=server.address();if(!address||typeof address==='string')throw Error('Missing port');
 const origin=`http://127.0.0.1:${address.port}`,launch=chromium.launch.bind(chromium);let engine:Browser|undefined;
 vi.spyOn(chromium,'launch').mockImplementation(async options=>{engine=await launch(options);return engine;});
 let browser:LocalBrowser|undefined;
 try{
  browser=await LocalBrowser.open({taskId:'installed',origin,url:origin});
  expect(chromium.launch).toHaveBeenCalledWith({executablePath:installed!.executablePath,headless:true,chromiumSandbox:true});expect(engine!.version()).toBe(browser.engine!.chromiumVersion);
  expect(browser.engine).toEqual({name:installed!.name,chromiumVersion:installed!.chromiumVersion});
  expect((await browser.observe()).title).toBe('');
 }finally{await browser?.close();vi.restoreAllMocks();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
