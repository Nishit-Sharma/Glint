import {BrowserControl} from '../src/host/browser/control';
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {saveBrowserWorkflow} from '../src/core/browser-workflow-host';
import {browserWorkflowStarter} from '../src/shared/browser-workflow';
import {runAuthoredBrowserWorkflow} from '../src/host/browser/workflow-service';
import {workflowSite} from './browser-workflow-site';
import {installLoopbackTestEngine} from './loopback-browser.fixture';
installLoopbackTestEngine();
const dialogs=vi.hoisted(()=>({show:vi.fn()}));vi.mock('electron',()=>({dialog:{showMessageBox:dialogs.show}}));
afterEach(()=>{vi.restoreAllMocks();dialogs.show.mockReset();});
it.each([false,true])('native approval wrapper %s preserves exact once-only form authority without a model route',async allow=>{
 const site=await workflowSite(),directory=await mkdtemp(join(tmpdir(),'glint-workflow-native-contract-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Native workflow approval contract'}),saved=await saveBrowserWorkflow(core,{taskId:task.id,requestId:'save',definition:{...browserWorkflowStarter,origin:site.origin}}),revision=saved.task.artifacts[0].revisions[0];dialogs.show.mockResolvedValue({response:allow?1:0});
  const result=await runAuthoredBrowserWorkflow(core,{taskId:task.id,requestId:'native-contract',workflow:{artifactId:saved.artifactId,revision:revision.revision,digest:revision.digest},url:site.origin+'/requests/native-contract',inputs:{title:'Exact approved draft',delivery:'courier'}},{control:new BrowserControl(),panel:()=>({}) as never,assertCurrent:()=>{},changed:()=>{},headless:true});
  expect(result.status).toBe(allow?'completed':'failed');expect(dialogs.show).toHaveBeenCalledTimes(allow?4:1);for(const [,dialog] of dialogs.show.mock.calls){expect(dialog.defaultId).toBe(0);expect(dialog.cancelId).toBe(0);expect(dialog.signal).toBeInstanceOf(AbortSignal);}const start=dialogs.show.mock.calls[0][1];expect(start.detail).toContain('No model request is made');expect(start.detail).toContain('Exact approved draft');
  if(allow){const submit=dialogs.show.mock.calls[3][1];expect(submit.message).toBe('Submit this workflow form?');expect(submit.buttons).toEqual(['Cancel','Submit once','Pause and take control']);expect(submit.detail).toContain('title: Exact approved draft');expect(submit.detail).toContain('delivery: courier');expect(site.effects).toHaveLength(1);}else{expect(site.effects).toEqual([]);expect((await core.getTask(task.id)).session?.runs??[]).toEqual([]);}
 }finally{await core.close();await rm(directory,{recursive:true,force:true});await site.close();}
});
