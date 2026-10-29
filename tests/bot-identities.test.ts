import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import {BotPreferences} from '../src/host/bot-preferences';
import {editModule,saveModuleDocument} from '../src/core/module-state';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
import {assignedBot,pickForMe,type ReadyBots} from '../src/shared/bot-catalog';
const roots:string[]=[],cores:Companion[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const dir=await mkdtemp(join(tmpdir(),'bot-identity-'));roots.push(dir);const core=await createCompanion({dataDir:dir});cores.push(core);return {dir,core,bots:await BotPreferences.open(dir,core)};}
async function ready(bots:BotPreferences):Promise<ReadyBots>{const state=await bots.read();if(state.kind!=='available'||state.current.kind!=='ready')throw Error('Expected saved identities');return state.current;}
it('persists a random preview, commits exactly one identity, and creates one useful local example across restarts',async()=>{
 const {dir,core,bots}=await setup();expect(await bots.read()).toMatchObject({kind:'available',current:{kind:'choose',revision:0}});
 const profile=pickForMe({...DEFAULT_CHARACTER,look:{...DEFAULT_CHARACTER.look,color:'sage'}},()=>.99);
 expect(profile.look).toMatchObject({shape:'sprout',color:'sage'});
 await bots.command({type:'draft',expectedRevision:0,profile});
 const reopened=await BotPreferences.open(dir,core);expect(await reopened.read()).toMatchObject({kind:'available',current:{kind:'choose',draft:profile}});
 await reopened.command({type:'complete',expectedRevision:1,profile});
 await reopened.command({type:'complete',expectedRevision:1,profile});
 const catalog=await ready(reopened);expect(catalog.bots).toHaveLength(1);
 const example=await core.ensureLocalExample(catalog.defaultBotId);expect(await core.ensureLocalExample(catalog.defaultBotId)).toEqual(example);
 expect(example).toMatchObject({title:'Observatory visit',provenance:'local-example',assignedBotId:catalog.defaultBotId,requests:[]});
 expect(example.sources[0].versions[0].label).toBe('Visit guide');expect(example.artifacts[0].revisions[0].content).toContain('Before your visit');
 expect(await core.listTasks()).toHaveLength(1);
});
it('migrates the exact legacy appearance and task drafts idempotently without replacing the old file',async()=>{
 const {dir,core}=await setup();await rm(join(dir,'bot-catalog.json'));
 const task=await core.createTask({title:'Existing task'});await core.saveComposerDraft(task.id,0,{text:'keep my draft',kind:'create'});
 const original=JSON.stringify({schemaVersion:1,revision:6,profile:{personalName:'Old friend',look:{shape:'dumpling',color:'iris',face:'mellow',motion:false}}});
 await writeFile(join(dir,'character-preferences.json'),original);
 const bots=await BotPreferences.open(dir,core),first=await ready(bots);const legacy=first.legacyBotId;
 expect(first.bots[0]).toMatchObject({revision:6,profile:{personalName:'Old friend',look:{shape:'dumpling',color:'iris',face:'mellow',motion:false}}});
 await core.saveComposerDraft(task.id,1,{text:'new draft',kind:'create'});
 await bots.command({type:'add',expectedRevision:first.revision,profile:DEFAULT_CHARACTER});
 const second=await ready(bots);await bots.command({type:'default',expectedRevision:second.revision,botId:second.bots[1].id});
 // Replay the crash boundary after catalog commit but before task materialization.
 const saved=JSON.parse(await readFile(join(dir,'tasks.json'),'utf8'));delete saved.tasks[0].assignedBotId;
 await core.close();cores.splice(cores.indexOf(core),1);await writeFile(join(dir,'tasks.json'),JSON.stringify(saved));
 const restart=await createCompanion({dataDir:dir});cores.push(restart);const resumed=await BotPreferences.open(dir,restart);
 const recovered=await restart.getTask(task.id);expect(recovered.assignedBotId).toBe(legacy);expect(recovered.session?.draft).toBe('new draft');
 await BotPreferences.open(dir,restart);expect((await ready(resumed)).bots).toHaveLength(2);expect(await readFile(join(dir,'character-preferences.json'),'utf8')).toBe(original);
 expect(assignedBot(await ready(resumed),recovered.assignedBotId)?.profile.personalName).toBe('Old friend');
});
it('keeps task data and assignment stable during a request and permits idle explicit reassignment',async()=>{
 const {core,bots}=await setup();await bots.command({type:'complete',expectedRevision:0,profile:DEFAULT_CHARACTER});const a=await ready(bots);
 const task=await core.createTask({title:'A',assignedBotId:a.defaultBotId});await core.saveComposerDraft(task.id,0,{text:'draft A',kind:'explain'});
 let finish!:(value:{title:string;content:string})=>void;const response=core.runRequest({taskId:task.id,requestId:'request-A',kind:'explain',prompt:'test'},async()=>new Promise(resolve=>{finish=resolve;}));
 while(!finish)await new Promise(resolve=>setTimeout(resolve,1));
 await expect(core.assignBot(task.id,'bot-B',a.defaultBotId)).rejects.toThrow('response');
 finish({title:'Answer',content:'done'});await response;const before=await core.getTask(task.id);
 const after=await core.assignBot(task.id,'bot-B',a.defaultBotId);expect(after).toEqual({...before,assignedBotId:'bot-B'});
 await expect(core.assignBot(task.id,'bot-C',a.defaultBotId)).rejects.toThrow('changed');
});
it('preserves malformed catalogs and rejects retired shape creation while allowing legacy name edits',async()=>{
 const {dir,core,bots}=await setup();await expect(bots.command({type:'complete',expectedRevision:0,profile:{...DEFAULT_CHARACTER,look:{...DEFAULT_CHARACTER.look,shape:'dumpling'}}})).rejects.toThrow('available shape');
 await writeFile(join(dir,'bot-catalog.json'),'{broken');expect((await(await BotPreferences.open(dir,core)).read()).kind).toBe('unavailable');
 expect((await bots.command({type:'complete',expectedRevision:0,profile:DEFAULT_CHARACTER})).kind).toBe('unavailable');expect(await readFile(join(dir,'bot-catalog.json'),'utf8')).toBe('{broken');
});
it('initializes approved names once and keeps personal names through appearance changes and restart',async()=>{
 const {dir,core,bots}=await setup();await bots.command({type:'complete',expectedRevision:0,profile:DEFAULT_CHARACTER});let catalog=await ready(bots);
 const first=catalog.bots[0],name=first.profile.personalName;expect(['Bao','Momo']).toContain(name);
 await bots.command({type:'update',expectedRevision:catalog.revision,botId:first.id,profile:{...first.profile,personalName:'Juniper',look:{...first.profile.look,shape:'star',color:'sage'}}});
 catalog=await ready(await BotPreferences.open(dir,core));expect(catalog.bots[0]).toMatchObject({id:first.id,profile:{personalName:'Juniper',look:{shape:'star',color:'sage'}}});
 for(const [shape,expected] of [['onigiri','Nori'],['mushroom','Moss'],['star','Lumi'],['sprout','Miso']] as const){await bots.command({type:'add',expectedRevision:catalog.revision,profile:{...DEFAULT_CHARACTER,look:{...DEFAULT_CHARACTER.look,shape}}});catalog=await ready(bots);expect(catalog.bots.at(-1)?.profile.personalName).toBe(expected);}
 await bots.command({type:'add',expectedRevision:catalog.revision,profile:{...DEFAULT_CHARACTER,personalName:'User chosen'}});expect((await ready(bots)).bots.at(-1)?.profile.personalName).toBe('User chosen');
});
it('keeps malformed startup data recoverable when completing the bundled example is attempted',async()=>{
 const {dir,core,bots}=await setup();await writeFile(join(dir,'bot-catalog.json'),'{broken');const reopened=await BotPreferences.open(dir,core);
 await expect(reopened.finishExample(core)).resolves.toBeUndefined();expect((await reopened.read()).kind).toBe('unavailable');expect(await core.listTasks()).toEqual([]);expect(await readFile(join(dir,'bot-catalog.json'),'utf8')).toBe('{broken');
});
it('carries bundled-example provenance in the actual source text passed to a normal task request',async()=>{
 const {core,bots}=await setup();await bots.command({type:'complete',expectedRevision:0,profile:{...DEFAULT_CHARACTER,personalName:'Custom'}});const catalog=await ready(bots),task=await core.ensureLocalExample(catalog.defaultBotId);
 let content='';await core.runRequest({taskId:task.id,requestId:'sample-followup',kind:'explain',prompt:'What does the guide say?'},async context=>{content=context.task.sources[0].versions[0].content;return {title:'Local test',content:'No provider used.'};});
 expect(content).toMatch(/^Bundled local example\./);expect(content).toContain('not facts about the current window');
});
it('renames a migrated retired shape without changing its geometry, ID or original legacy record',async()=>{
 const {dir,core}=await setup();await rm(join(dir,'bot-catalog.json'));const task=await core.createTask({title:'Legacy Crescent'}),profile={personalName:'Original',look:{shape:'dumpling',color:'sage',face:'mellow',motion:false}};
 const original=JSON.stringify({schemaVersion:1,revision:2,profile});await writeFile(join(dir,'character-preferences.json'),original);const bots=await BotPreferences.open(dir,core),before=await ready(bots),bot=before.bots[0];
 await bots.command({type:'update',expectedRevision:before.revision,botId:bot.id,profile:{...bot.profile,personalName:'Renamed'}});const after=await ready(await BotPreferences.open(dir,core));expect(after.bots[0]).toMatchObject({id:bot.id,profile:{...profile,personalName:'Renamed'}});expect((await core.getTask(task.id)).assignedBotId).toBe(bot.id);expect(await readFile(join(dir,'character-preferences.json'),'utf8')).toBe(original);
});
it('saves the local checklist as an editable document without inventing page observations',async()=>{
 const {core,bots}=await setup();await bots.command({type:'complete',expectedRevision:0,profile:DEFAULT_CHARACTER});const catalog=await ready(bots),task=await core.ensureLocalExample(catalog.defaultBotId),artifact=task.artifacts[0];
 await editModule(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,moduleId:'visit-plan',action:{kind:'check',itemId:'arrival',checked:true,expectedRevision:0}});const current=await core.getTask(task.id);
 const saved=await saveModuleDocument(core,{taskId:task.id,artifactId:artifact.id,artifactRevision:1,sessionRevision:current.session?.revision??0}),document=(await core.getTask(task.id)).artifacts.find(item=>item.id===saved.artifactId)?.revisions[0];
 expect(document?.content).toContain('- [x] Arrive by 17:50');expect(document?.content).not.toContain('Observed pages');expect(document?.sourceRefs).toEqual(artifact.revisions[0].sourceRefs);expect((await core.getTask(task.id)).requests).toEqual([]);
});
