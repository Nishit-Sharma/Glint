import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CaptureSettings,CaptureSettingsSaveError} from '../src/host/capture-settings';
import {evaluateCapturePolicy,type CaptureApplicationIdentity,type CaptureHostFacts} from '../src/shared/capture-policy';

const failure=vi.hoisted(()=>({rename:false,directorySync:false}));
vi.mock('node:fs/promises',async importOriginal=>{
 const fs=await importOriginal<typeof import('node:fs/promises')>();
 return {...fs,
  rename:async(...args:Parameters<typeof fs.rename>)=>{if(failure.rename){failure.rename=false;throw Error('Synthetic filesystem rename failure.');}return fs.rename(...args);},
  open:async(...args:Parameters<typeof fs.open>)=>{
   const file=await fs.open(...args);
   if(args[1]==='r'&&failure.directorySync){failure.directorySync=false;file.sync=async()=>{throw Error('Synthetic directory sync failure.');};}
   return file;
  },
 };
});

const directories:string[]=[];
afterEach(async()=>{failure.rename=false;failure.directorySync=false;for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function directory(){const path=await mkdtemp(join(tmpdir(),'capture-settings-'));directories.push(path);return path;}
const shortcut:CaptureHostFacts={trigger:'shortcut',screenPermission:'granted',target:{application:{kind:'bundle-id',value:'com.example.editor'},self:false,knownProtected:false}};

it('requires explicit setup and preserves that approval across a fresh host owner',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 const initial=await settings.read();
 expect(initial).toEqual({kind:'available',current:{revision:0,policy:{policyVersion:1,setupApproval:'not-approved',privateApps:[]}}});
 expect(evaluateCapturePolicy(initial,shortcut)).toEqual({kind:'blocked',reason:'setup-required'});
 expect(await readdir(dir)).toEqual([]);
 const saved=await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
 expect(saved).toEqual({kind:'saved',current:{revision:1,policy:{policyVersion:1,setupApproval:'approved',privateApps:[]}}});
 const restarted=await (await CaptureSettings.open(dir)).read();
 expect(restarted).toEqual({kind:'available',current:{revision:1,policy:{policyVersion:1,setupApproval:'approved',privateApps:[]}}});
 expect(evaluateCapturePolicy(restarted,shortcut)).toEqual({kind:'eligible',revision:1});
});

it('keeps revocation across restart and rejects a stale approval instead of resurrecting it',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 const privateApps=[{kind:'bundle-id',value:'com.example.vault'}];
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps});
 const results=await Promise.all([
  settings.update({kind:'revoke-setup',expectedRevision:1}),
  settings.update({kind:'approve-setup',expectedRevision:1,policyVersion:1,privateApps:[]}),
 ]);
 const revoked={revision:2,policy:{policyVersion:1,setupApproval:'not-approved',privateApps}};
 expect(results).toEqual([{kind:'saved',current:revoked},{kind:'conflict',current:revoked}]);
 const restarted=await CaptureSettings.open(dir);
 expect(await restarted.read()).toEqual({kind:'available',current:revoked});
 const replacement=await restarted.update({kind:'replace-private-apps',expectedRevision:2,privateApps:[]});
 expect(replacement).toEqual({kind:'saved',current:{revision:3,policy:{policyVersion:1,setupApproval:'not-approved',privateApps:[]}}});
 expect(evaluateCapturePolicy(await restarted.read(),shortcut)).toEqual({kind:'blocked',reason:'setup-required'});
});

const eligibilityCases:[string,CaptureHostFacts,string][]=[
 ['normal launch',{...shortcut,trigger:'launch'},'not-shortcut'],
 ['revoked OS permission',{...shortcut,screenPermission:'not-granted'},'os-permission'],
 ['unsupported OS capture',{...shortcut,screenPermission:'unsupported'},'os-permission'],
 ['no focused target',{...shortcut,target:null},'target-unavailable'],
 ['unidentified application',{...shortcut,target:{...shortcut.target!,application:null}},'application-unidentified'],
 ['self window',{...shortcut,target:{...shortcut.target!,self:true}},'self-window'],
 ['known protected window',{...shortcut,target:{...shortcut.target!,knownProtected:true}},'protected-window'],
 ['private application',{...shortcut,target:{...shortcut.target!,application:{kind:'bundle-id',value:'COM.EXAMPLE.VAULT'}}},'private-application'],
 ['incomparable path fallback',{...shortcut,target:{...shortcut.target!,application:{kind:'executable-path',value:'/Applications/Editor.app/Contents/MacOS/editor'}}},'application-unidentified'],
 ['unsupported identity scheme',{...shortcut,target:{...shortcut.target!,application:{kind:'window-title',value:'Editor'} as unknown as CaptureApplicationIdentity}},'application-unidentified'],
];
it.each(eligibilityCases)('blocks %s despite setup approval',async(_label,facts,reason)=>{
 const settings=await CaptureSettings.open(await directory());
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[{kind:'bundle-id',value:'com.example.vault'}]});
 const state=await settings.read();
 expect(evaluateCapturePolicy(state,shortcut)).toEqual({kind:'eligible',revision:1});
 expect(evaluateCapturePolicy(state,facts)).toEqual({kind:'blocked',reason});
});

it('does not require application identity when there are no private exclusions to compare',async()=>{
 const settings=await CaptureSettings.open(await directory());
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
 expect(evaluateCapturePolicy(await settings.read(),{...shortcut,target:{...shortcut.target!,application:null}})).toEqual({kind:'eligible',revision:1});
});

it('matches private application identity across restart independently of title and PID',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[{kind:'bundle-id',value:'com.example.vault'}]});
 const state=await (await CaptureSettings.open(dir)).read();
 const renamed={...shortcut,target:{application:{kind:'bundle-id' as const,value:'com.example.vault'},self:false,knownProtected:false,title:'Unrelated document',processId:98765}};
 expect(evaluateCapturePolicy(state,renamed)).toEqual({kind:'blocked',reason:'private-application'});
 const sameTitleDifferentApp={...renamed,target:{...renamed.target,application:{kind:'bundle-id' as const,value:'com.example.editor'}}};
 expect(evaluateCapturePolicy(state,sameTitleDifferentApp)).toEqual({kind:'eligible',revision:1});
});

it('matches canonical executable identities exactly and refuses an incomparable bundle identity',async()=>{
 const settings=await CaptureSettings.open(await directory());
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[{kind:'executable-path',value:'/Applications/Vault.app/Contents/MacOS/vault'}]});
 const state=await settings.read();
 expect(evaluateCapturePolicy(state,{...shortcut,target:{...shortcut.target!,application:{kind:'executable-path',value:'/Applications/Vault.app/Contents/MacOS/vault'}}})).toEqual({kind:'blocked',reason:'private-application'});
 expect(evaluateCapturePolicy(state,{...shortcut,target:{...shortcut.target!,application:{kind:'executable-path',value:'/Applications/Editor.app/Contents/MacOS/editor'}}})).toEqual({kind:'eligible',revision:1});
 expect(evaluateCapturePolicy(state,shortcut)).toEqual({kind:'blocked',reason:'application-unidentified'});
});

it('does not infer setup from one-off capture, OS permission or task data and never changes those records',async()=>{
 const dir=await directory();
 const tasks='{"schemaVersion":2,"tasks":[{"id":"kept","sources":[{"kind":"window","approvedOnce":true}]}],"usedRequestIds":["kept-request"]}';
 const oneOff='{"approved":true,"scope":"one-window-once"}';
 await writeFile(join(dir,'tasks.json'),tasks);await writeFile(join(dir,'capture-consent.json'),oneOff);
 const settings=await CaptureSettings.open(dir);
 expect(evaluateCapturePolicy(await settings.read(),shortcut)).toEqual({kind:'blocked',reason:'setup-required'});
 expect((await readdir(dir)).sort()).toEqual(['capture-consent.json','tasks.json']);
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
 await settings.update({kind:'revoke-setup',expectedRevision:1});
 expect(await readFile(join(dir,'tasks.json'),'utf8')).toBe(tasks);
 expect(await readFile(join(dir,'capture-consent.json'),'utf8')).toBe(oneOff);
 expect((await readdir(dir)).sort()).toEqual(['capture-consent.json','capture-settings.json','tasks.json']);
});

const supportedRecord={schemaVersion:1,revision:7,policy:{policyVersion:1,setupApproval:'approved',privateApps:[]}};
it.each([
 ['malformed JSON','{broken'],
 ['future file schema',JSON.stringify({...supportedRecord,schemaVersion:2})],
 ['future policy',JSON.stringify({...supportedRecord,policy:{...supportedRecord.policy,policyVersion:2}})],
 ['unrecognized old policy',JSON.stringify({...supportedRecord,policy:{...supportedRecord.policy,policyVersion:0}})],
 ['hidden file authority',JSON.stringify({...supportedRecord,browserAuthority:true})],
 ['hidden policy authority',JSON.stringify({...supportedRecord,policy:{...supportedRecord.policy,rawPixels:'not-accepted'}})],
 ['unsupported exclusion identity',JSON.stringify({...supportedRecord,policy:{...supportedRecord.policy,privateApps:[{kind:'window-title',value:'Private'}]}})],
])('preserves %s bytes and denies reads, grants and revokes',async(_label,contents)=>{
 const dir=await directory();await writeFile(join(dir,'capture-settings.json'),contents);
 const settings=await CaptureSettings.open(dir),state=await settings.read();
 expect(state).toMatchObject({kind:'unavailable',message:expect.any(String)});
 expect(evaluateCapturePolicy(state,shortcut)).toEqual({kind:'blocked',reason:'settings-unavailable'});
 expect((await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]})).kind).toBe('unavailable');
 expect((await settings.update({kind:'revoke-setup',expectedRevision:0})).kind).toBe('unavailable');
 expect(await readFile(join(dir,'capture-settings.json'),'utf8')).toBe(contents);
 expect((await (await CaptureSettings.open(dir)).read()).kind).toBe('unavailable');
 expect(await readdir(dir)).toEqual(['capture-settings.json']);
});

it('fails closed when the settings path is unreadable and leaves it untouched',async()=>{
 const dir=await directory();await mkdir(join(dir,'capture-settings.json'));
 const settings=await CaptureSettings.open(dir);
 expect((await settings.read()).kind).toBe('unavailable');
 expect((await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]})).kind).toBe('unavailable');
 expect((await stat(join(dir,'capture-settings.json'))).isDirectory()).toBe(true);
});

it('reloads settings instead of reusing a formerly approved grant after corruption',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
 await writeFile(join(dir,'capture-settings.json'),'{broken-after-approval');
 expect(evaluateCapturePolicy(await settings.read(),shortcut)).toEqual({kind:'blocked',reason:'settings-unavailable'});
 expect((await settings.update({kind:'replace-private-apps',expectedRevision:1,privateApps:[]})).kind).toBe('unavailable');
 expect(await readFile(join(dir,'capture-settings.json'),'utf8')).toBe('{broken-after-approval');
});

it('rejects invalid caller input without creating or granting setup',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 const valid={kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]};
 for(const input of [
  {...valid,expectedRevision:-1},{...valid,expectedRevision:0.5},{...valid,policyVersion:2},
  {...valid,browserAccount:'not-a-grant'}, {...valid,privateApps:[{kind:'bundle-id',value:'com.example.vault',processId:1}]},
  {...valid,privateApps:[{kind:'window-title',value:'Private'}]}, {...valid,privateApps:[{kind:'bundle-id',value:''}]},
  {...valid,privateApps:[{kind:'executable-path',value:'relative/path'}]}, {...valid,privateApps:[{kind:'executable-path',value:'/Applications/../vault'}]},
 ])await expect(async()=>settings.update(input)).rejects.toThrow();
 expect(evaluateCapturePolicy(await settings.read(),shortcut)).toEqual({kind:'blocked',reason:'setup-required'});
 expect(await readdir(dir)).toEqual([]);
});

it('refuses an exhausted revision without changing saved bytes',async()=>{
 const dir=await directory(),contents=JSON.stringify({...supportedRecord,revision:Number.MAX_SAFE_INTEGER});
 await writeFile(join(dir,'capture-settings.json'),contents);
 const settings=await CaptureSettings.open(dir);
 await expect(settings.update({kind:'revoke-setup',expectedRevision:Number.MAX_SAFE_INTEGER})).rejects.toThrow('revision limit');
 expect(await readFile(join(dir,'capture-settings.json'),'utf8')).toBe(contents);
});

it('preserves the acknowledged grant after a failed atomic replacement and permits a later revocation',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
 failure.rename=true;
 await expect(settings.update({kind:'revoke-setup',expectedRevision:1})).rejects.toMatchObject({name:'CaptureSettingsSaveError',outcome:'not-saved'});
 expect(evaluateCapturePolicy(await (await CaptureSettings.open(dir)).read(),shortcut)).toEqual({kind:'eligible',revision:1});
 expect((await settings.update({kind:'revoke-setup',expectedRevision:1})).kind).toBe('saved');
 expect(evaluateCapturePolicy(await settings.read(),shortcut)).toEqual({kind:'blocked',reason:'setup-required'});
 expect(await readdir(dir)).toEqual(['capture-settings.json']);
 expect((await stat(join(dir,'capture-settings.json'))).mode&0o777).toBe(0o600);
});

it('reports a post-rename save as uncertain and exposes the observed revision before another decision',async()=>{
 const dir=await directory(),settings=await CaptureSettings.open(dir);
 await settings.update({kind:'approve-setup',expectedRevision:0,policyVersion:1,privateApps:[]});
 failure.directorySync=true;
 const failureResult=await settings.update({kind:'revoke-setup',expectedRevision:1}).catch(error=>error);
 expect(failureResult).toBeInstanceOf(CaptureSettingsSaveError);
 expect(failureResult).toMatchObject({outcome:'uncertain'});
 const state=await (await CaptureSettings.open(dir)).read();
 expect(state).toEqual({kind:'available',current:{revision:2,policy:{policyVersion:1,setupApproval:'not-approved',privateApps:[]}}});
 expect(evaluateCapturePolicy(state,shortcut)).toEqual({kind:'blocked',reason:'setup-required'});
 expect((await settings.update({kind:'approve-setup',expectedRevision:1,policyVersion:1,privateApps:[]})).kind).toBe('conflict');
});
