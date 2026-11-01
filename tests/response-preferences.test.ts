import {expect,test} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ResponsePreferences,responsePreferencesContext} from '../src/host/response-preferences';

test('opt-in preferences persist, bind exact enabled text and retire an old dispatch lease after a saved change',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'response-preferences-')),prefs=new ResponsePreferences(directory);try{expect(await prefs.read()).toEqual({kind:'available',current:{revision:0,enabled:false,text:''}});const off=await prefs.lease();expect(off.scope).toBeUndefined();const saved=await prefs.update({expectedRevision:0,enabled:true,text:'Use concise explanations.\nKeep my formatting.'});expect(saved.kind).toBe('saved');const lease=await prefs.lease();expect(lease.consent).toContain('Use concise explanations.\nKeep my formatting.');expect(JSON.parse(responsePreferencesContext('{"title":"Task"}',lease.current)!)).toMatchObject({responsePreferences:{revision:1,text:'Use concise explanations.\nKeep my formatting.'}});await lease.check();await prefs.update({expectedRevision:1,enabled:false,text:'Keep this disabled text local.'});expect(lease.signal.aborted).toBe(true);expect(()=>lease.assertCurrent()).toThrow('preferences changed');await expect(lease.check()).rejects.toThrow();const disabled=await prefs.lease();expect(JSON.stringify({current:disabled.current,scope:disabled.scope,consent:disabled.consent,context:responsePreferencesContext('{"title":"Task"}',disabled.current)})).not.toContain('disabled text local');expect(await new ResponsePreferences(directory).read()).toMatchObject({kind:'available',current:{revision:2,enabled:false,text:'Keep this disabled text local.'}});expect(JSON.parse(await readFile(join(directory,'response-preferences.json'),'utf8')).schemaVersion).toBe(1);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('bounded closed updates preserve unavailable bytes and compare revisions after an unobserved save',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'response-preferences-')),prefs=new ResponsePreferences(directory);
 try{
  for(const invalid of [{expectedRevision:0,enabled:true,text:'x',permissions:['capture']},{expectedRevision:-1,enabled:false,text:''},{expectedRevision:0,enabled:'yes',text:''},{expectedRevision:0,enabled:true,text:'x'.repeat(20001)}])expect(()=>prefs.update(invalid)).toThrow();
  await prefs.update({expectedRevision:0,enabled:true,text:'Exact whitespace  \n α 👋'}); // Caller can lose this acknowledgement.
  expect(await prefs.update({expectedRevision:0,enabled:false,text:'would overwrite'})).toMatchObject({kind:'conflict',current:{revision:1,enabled:true,text:'Exact whitespace  \n α 👋'}});
  const {writeFile}=await import('node:fs/promises'),path=join(directory,'response-preferences.json'),bytes='{"schemaVersion":999,"private":"preserve unfamiliar bytes"}';await writeFile(path,bytes);
  expect(await prefs.read()).toMatchObject({kind:'unavailable'});expect(await prefs.update({expectedRevision:1,enabled:false,text:''})).toMatchObject({kind:'unavailable'});await expect(prefs.lease()).rejects.toThrow('could not be opened');expect(await readFile(path,'utf8')).toBe(bytes);
  await writeFile(path,'x'.repeat(20_001));expect(await prefs.read()).toMatchObject({kind:'unavailable'});expect((await readFile(path)).length).toBe(20_001);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('off context is byte-for-byte unchanged and enabled guidance never silently truncates history',async()=>{
 const disabled={revision:4,enabled:false,text:'local-only'},context=' {"title":"exact prior bytes"} ';
 expect(responsePreferencesContext(context,disabled)).toBe(context);expect(responsePreferencesContext(undefined,disabled)).toBeUndefined();
 expect(()=>responsePreferencesContext(JSON.stringify({history:'a'.repeat(39_900)}),{revision:5,enabled:true,text:'b'.repeat(4000)})).toThrow('safe context limit');
});
test('lease detects unavailable or externally stale configuration without replacing the frozen payload',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'response-preferences-')),prefs=new ResponsePreferences(directory);
 try{await prefs.update({expectedRevision:0,enabled:true,text:'Approved text'});const lease=await prefs.lease(),{writeFile}=await import('node:fs/promises');await writeFile(join(directory,'response-preferences.json'),JSON.stringify({schemaVersion:1,revision:1,enabled:true,text:'Changed externally'}));await expect(lease.check()).rejects.toThrow('preferences changed');expect(lease.current.text).toBe('Approved text');}
 finally{await rm(directory,{recursive:true,force:true});}
});
test('a retired local lifecycle cannot commit a preference replacement or leak its owned temporary',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'response-preferences-')),prefs=new ResponsePreferences(directory);
 try{await expect(prefs.update({expectedRevision:0,enabled:true,text:'Never saved'},()=>{throw Error('Retired lifecycle');})).rejects.toThrow('previous preferences were preserved');expect(await prefs.read()).toMatchObject({kind:'available',current:{revision:0,enabled:false,text:''}});const {readdir}=await import('node:fs/promises');expect(await readdir(directory)).toEqual([]);}
 finally{await rm(directory,{recursive:true,force:true});}
});

test('core recreation advances only its existing recovery revision and preference changes preserve the exact recovered task',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'response-preferences-reopen-')),{createCompanion}=await import('../src/core/companion');let core:Awaited<ReturnType<typeof createCompanion>>|undefined;
 try{
  core=await createCompanion({dataDir:directory});const created=await core.createTask({title:'Exact recovery owner'}),task=await core.putSource(created.id,{kind:'text',role:'fact',label:'Saved source',content:'Keep the source exact.'});await core.saveComposerDraft(task.id,0,{text:'Keep this different unsent question.',kind:'explain'});const original=await core.getTask(task.id),prefs=new ResponsePreferences(directory);await prefs.update({expectedRevision:0,enabled:true,text:'Use short paragraphs.'});expect(await core.getTask(task.id)).toEqual(original);
  await core.close();core=await createCompanion({dataDir:directory});const recovered=await core.getTask(task.id);expect(recovered).toEqual({...original,session:{...original.session!,revision:original.session!.revision+1}});await prefs.update({expectedRevision:1,enabled:false,text:'Use short paragraphs.'});expect(await prefs.read()).toEqual({kind:'available',current:{revision:2,enabled:false,text:'Use short paragraphs.'}});expect(await core.getTask(task.id)).toEqual(recovered);
 }finally{await core?.close();await rm(directory,{recursive:true,force:true});}
});
