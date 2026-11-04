import {expect,it} from 'vitest';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ResponsePreferences} from '../../src/host/response-preferences';
import {readResponsePreferencesUpdate,RESPONSE_PREFERENCES_LIMIT,RESPONSE_PREFERENCES_FILE_LIMIT,responsePreferencesBytes} from '../../src/shared/response-preferences';

it('saves a UTF-8 instruction body above the former4000-character limit when the existing whole-file cap permits it',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-guidance-bytes-'));try{
  const preferences=new ResponsePreferences(directory),text='A'.repeat(5000),result=await preferences.update({expectedRevision:0,enabled:true,text});
  expect(result).toMatchObject({kind:'saved',current:{revision:1,enabled:true,text}});expect(await new ResponsePreferences(directory).read()).toMatchObject({kind:'available',current:{text}});
 }finally{await rm(directory,{recursive:true,force:true});}
});

it('enforces UTF-8 body bytes and the unchanged exact whole-document cap without replacing prior instructions',async()=>{
 expect(responsePreferencesBytes('😀')).toBe(4);expect(RESPONSE_PREFERENCES_LIMIT).toBe(20000);expect(RESPONSE_PREFERENCES_FILE_LIMIT).toBe(20000);
 expect(readResponsePreferencesUpdate({expectedRevision:0,enabled:true,text:'😀'.repeat(5000)}).text.length).toBe(10000);
 expect(()=>readResponsePreferencesUpdate({expectedRevision:0,enabled:true,text:'😀'.repeat(5000)+'a'})).toThrow();
 const directory=await mkdtemp(join(tmpdir(),'glint-guidance-file-cap-'));try{
  const preferences=new ResponsePreferences(directory),overhead=Buffer.byteLength(JSON.stringify({schemaVersion:1,revision:1,enabled:true,text:''})),text='a'.repeat(20000-overhead);
  expect(await preferences.update({expectedRevision:0,enabled:true,text})).toMatchObject({kind:'saved'});const path=join(directory,'response-preferences.json'),before=await readFile(path);expect(before.length).toBe(20000);expect(await new ResponsePreferences(directory).read()).toMatchObject({kind:'available',current:{text}});
  await expect(preferences.update({expectedRevision:1,enabled:true,text:text+'a'})).rejects.toThrow('complete saved instructions');expect(await readFile(path)).toEqual(before);
  await expect(preferences.update({expectedRevision:1,enabled:true,text:'\n'.repeat(10000)})).rejects.toThrow('complete saved instructions');expect(await readFile(path)).toEqual(before);
  expect(await preferences.update({expectedRevision:1,enabled:true,text:'😀'.repeat(4000)})).toMatchObject({kind:'saved',current:{text:'😀'.repeat(4000)}});
 }finally{await rm(directory,{recursive:true,force:true});}
});
