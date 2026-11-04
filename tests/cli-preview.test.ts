import {expect,test,vi,afterEach} from 'vitest';
const boundary=vi.hoisted(()=>({exec:vi.fn()}));
vi.mock('node:child_process',()=>({execFile:boundary.exec}));
import {CliPreviewHost,readCliCommand} from '../src/host/cli-preview';
afterEach(()=>boundary.exec.mockReset());
test('GUI preview executes the fixed bundled script with a host-owned directory and a narrow environment',async()=>{
 const kill=vi.fn();let finish:(error:Error|null,stdout:string)=>void=()=>{};boundary.exec.mockImplementation((_exe,_args,_options,callback)=>{finish=callback;return {kill};});
 const host=new CliPreviewHost({executable:'/fixed/Glint',script:'/fixed/cli.js',launcher:'/fixed/glint'}),pending=host.preview('task-id','/host/data');
 expect(boundary.exec.mock.calls[0].slice(0,3)).toEqual(['/fixed/Glint',['/fixed/cli.js','task','task-id','--data-dir','/host/data'],{env:{ELECTRON_RUN_AS_NODE:'1',LANG:'en_US.UTF-8'},encoding:'utf8',timeout:5000,maxBuffer:262144,windowsHide:true}]);
 expect(await host.preview('task-id','/host/data')).toMatchObject({kind:'unavailable'});finish(null,'ACTUAL CHILD OUTPUT\n');expect(await pending).toEqual({kind:'ready',output:'ACTUAL CHILD OUTPUT\n',launcher:'/fixed/glint'});expect(kill).not.toHaveBeenCalled();
});
test('tentative quit retires a child outcome and allows a fresh preview after quit is cancelled',async()=>{
 const kill=vi.fn();const callbacks:((error:Error|null,stdout:string)=>void)[]=[];boundary.exec.mockImplementation((_exe,_args,_options,callback)=>{callbacks.push(callback);return {kill};});const host=new CliPreviewHost({executable:'/fixed/electron',script:'/fixed/cli.js',launcher:'/fixed/glint'}),first=host.preview('task','/host/data');host.close();expect(kill).toHaveBeenCalledOnce();callbacks[0](null,'obsolete');expect(await first).toMatchObject({kind:'unavailable'});const next=host.preview('task','/host/data');callbacks[1](null,'fresh');expect(await next).toMatchObject({kind:'ready',output:'fresh'});
});
test('CLI IPC rejects renderer executable, path, output and extra preference fields',()=>{
 expect(readCliCommand({type:'cli.preview',taskId:'t'})).toEqual({type:'cli.preview',taskId:'t'});
 for(const value of [{type:'cli.preview',taskId:'t',dataDir:'/elsewhere'},{type:'cli.preview',taskId:'t',executable:'/bin/sh'},{type:'cli.preferences.get',extra:1},{type:'cli.preferences.update',expectedRevision:0,format:'text',includeSourceLabels:true,excerptChars:0,argv:['--eval']},{type:'cli.run',command:'ls'}])expect(()=>readCliCommand(value)).toThrow();
});
