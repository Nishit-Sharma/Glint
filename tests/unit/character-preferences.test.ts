import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CharacterPreferences} from '../../src/host/character-preferences';

const failure=vi.hoisted(()=>({rename:false}));
vi.mock('node:fs/promises',async importOriginal=>{const fs=await importOriginal<typeof import('node:fs/promises')>();return {...fs,rename:async(...args:Parameters<typeof fs.rename>)=>{if(failure.rename){failure.rename=false;throw Error('Synthetic filesystem rename failure.');}return fs.rename(...args);}};});
const directories:string[]=[];
afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function directory(){const path=await mkdtemp(join(tmpdir(),'character-prefs-'));directories.push(path);return path;}
it('saves a normalized optional name and original appearance across a fresh host reader',async()=>{
 const dir=await directory(),preferences=await CharacterPreferences.open(dir);
 expect(await preferences.read()).toEqual({kind:'available',current:{revision:0,profile:{personalName:null,look:{shape:'soup',color:'dough',face:'curious',motion:true}}}});
 const result=await preferences.update({expectedRevision:0,profile:{personalName:'  Pebble  ',look:{shape:'bean',color:'sage',face:'mellow',motion:false}}});
 expect(result).toEqual({kind:'saved',current:{revision:1,profile:{personalName:'Pebble',look:{shape:'bean',color:'sage',face:'mellow',motion:false}}}});
 if(result.kind!=='saved')throw Error('Appearance was not saved.');
 expect(await (await CharacterPreferences.open(dir)).read()).toEqual({kind:'available',current:result.current});
});

it('serializes competing saves and returns the current profile instead of overwriting it',async()=>{
 const preferences=await CharacterPreferences.open(await directory());
 const first={personalName:'First',look:{shape:'soup',color:'dough',face:'curious',motion:true}};
 const second={...first,personalName:'Second'};
 const results=await Promise.all([preferences.update({expectedRevision:0,profile:first}),preferences.update({expectedRevision:0,profile:second})]);
 expect(results).toEqual([{kind:'saved',current:{revision:1,profile:first}},{kind:'conflict',current:{revision:1,profile:first}}]);
});
it.each(['{broken',JSON.stringify({schemaVersion:2,revision:9,profile:{}})])('preserves unreadable or future records and blocks saves',async contents=>{
 const dir=await directory();await writeFile(join(dir,'character-preferences.json'),contents);
 const preferences=await CharacterPreferences.open(dir);expect((await preferences.read()).kind).toBe('unavailable');
 expect((await preferences.update({expectedRevision:0,profile:{personalName:null,look:{shape:'soup',color:'dough',face:'curious',motion:true}}})).kind).toBe('unavailable');
 expect(await readFile(join(dir,'character-preferences.json'),'utf8')).toBe(contents);
});
it('rejects invalid catalog values, hidden fields, and control characters without advancing revision',async()=>{
 const preferences=await CharacterPreferences.open(await directory());
 const valid={expectedRevision:0,profile:{personalName:null,look:{shape:'soup',color:'dough',face:'curious',motion:true}}};
 for(const input of [{...valid,taskId:'must-not-enter'}, {...valid,expectedRevision:-1},{...valid,profile:{...valid.profile,personalName:'Line\nBreak'}},{...valid,profile:{...valid.profile,look:{...valid.profile.look,shape:'unknown'}}}])await expect(async()=>preferences.update(input)).rejects.toThrow();
 expect(await preferences.read()).toMatchObject({kind:'available',current:{revision:0,profile:{personalName:null}}});
});

it('a failed atomic replacement leaves the acknowledged profile available after restart and allows a later save',async()=>{
 const dir=await directory(),preferences=await CharacterPreferences.open(dir),profile={personalName:'Kept',look:{shape:'soup',color:'dough',face:'curious',motion:true}};
 await preferences.update({expectedRevision:0,profile});
 failure.rename=true;
 await expect(preferences.update({expectedRevision:1,profile:{...profile,personalName:'Failed'}})).rejects.toThrow('could not be saved');
 expect(await (await CharacterPreferences.open(dir)).read()).toEqual({kind:'available',current:{revision:1,profile}});
 expect(await preferences.update({expectedRevision:1,profile:{...profile,personalName:'Next'}})).toEqual({kind:'saved',current:{revision:2,profile:{...profile,personalName:'Next'}}});
});
