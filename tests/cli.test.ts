import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,readdir,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion,type Companion} from '../src/core/companion';
import {defaultCliDataDir,parseCliArguments,runCli,terminalText,CLI_FILE_LIMIT} from '../src/cli/cli';

const directories:string[]=[],owners:Companion[]=[];
afterEach(async()=>{for(const core of owners.splice(0))await core.close();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'glint-cli-test-'));directories.push(directory);const core=await createCompanion({dataDir:directory,now:()=>new Date('2026-10-31T01:00:00.000Z')});owners.push(core);const task=await core.createTask({title:'CLI check',goal:'Private goal MUST_NOT_OUTPUT'});return {directory,core,task};}
test('CLI reads the authoritative snapshot without recovery or authority changes, and returns closed task DTOs',async()=>{
 const {directory,core,task}=await fixture();await core.putSource(task.id,{kind:'text',label:'Notes',content:'SOURCE_PRIVATE_BODY',role:'fact'});
 await core.changeLocalContacts({expectedRevision:0,change:{kind:'save',details:{name:'CONTACT_PRIVATE',email:'private@example.com',phone:'',address:'',notes:''}}});
 const before=await readFile(join(directory,'tasks.json')),lock=await readFile(join(directory,'store.lock')),names=await readdir(directory);
 expect(await runCli(['tasks','--format','json'],directory)).toBe(JSON.stringify({tasks:[{id:task.id,title:'CLI check',status:'active',archived:false,updatedAt:'2026-10-31T01:00:00.000Z',sourceCount:1}],total:1},null,2)+'\n');
 const output=await runCli(['task',task.id,'--format','json'],directory),result=JSON.parse(output);expect(Object.keys(result.task).sort()).toEqual(['archived','id','sourceCount','sources','sourcesTruncated','status','title','updatedAt']);expect(result.task.sources[0]).toMatchObject({kind:'text',freshness:'fresh',label:'Notes'});expect(output).not.toMatch(/PRIVATE|private@example|goal|requests|session|digest|usedRequestIds/);
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);expect(await readFile(join(directory,'store.lock'))).toEqual(lock);expect(await readdir(directory)).toEqual(names);
});
test('saved CLI preferences use serialized compare-and-swap, persist on reopen, and overrides never write them',async()=>{
 const {directory,core,task}=await fixture();await core.putSource(task.id,{kind:'text',label:'Visible label',content:'Excerpt sample more text',role:'fact'});
 const changes=await Promise.all([core.changeCliPreferences({expectedRevision:0,format:'json',includeSourceLabels:false,excerptChars:7}),core.changeCliPreferences({expectedRevision:0,format:'text',includeSourceLabels:true,excerptChars:0})]);expect(changes.map(item=>item.kind)).toEqual(['saved','conflict']);
 const settings=JSON.parse(await runCli(['settings','--search','excerpt'],directory));expect(settings).toEqual({revision:1,settings:[{key:'excerptChars',label:'Text excerpt length',value:7}],applies:'next-invocation',restartRequired:false});
 const detail=JSON.parse(await runCli(['task',task.id],directory));expect(detail.task.sources[0]).not.toHaveProperty('label');expect(detail.task.sources[0].excerpt).toBe('Excerpt');
 expect(await runCli(['task',task.id,'--format','text','--source-labels','true','--excerpt-chars','0'],directory)).toContain('Visible label');expect(await core.getCliPreferences()).toEqual({revision:1,format:'json',includeSourceLabels:false,excerptChars:7});
 await core.close();owners.splice(owners.indexOf(core),1);const reopened=await createCompanion({dataDir:directory});owners.push(reopened);expect(await reopened.getCliPreferences()).toEqual({revision:1,format:'json',includeSourceLabels:false,excerptChars:7});
 const bytes=await readFile(join(directory,'tasks.json'));expect(()=>reopened.changeCliPreferences({expectedRevision:1,format:'json',includeSourceLabels:true,excerptChars:257})).toThrow();expect(()=>reopened.changeCliPreferences({expectedRevision:1,format:'json',includeSourceLabels:true,excerptChars:0,executable:'evil'})).toThrow();expect(await readFile(join(directory,'tasks.json'))).toEqual(bytes);
});
test('CLI text removes terminal control injection and JSON escapes control characters, with excerpts off by default',async()=>{
 const {directory,core,task}=await fixture();await core.updateTask(task.id,{title:'Title\u001b[31mRED\u001b[0m\nForged\u009b31m\u202e'});await core.putSource(task.id,{kind:'text',label:'Label\u001b]52;c;Y29weQ==\u0007safe',content:'secret\u001b[2J\u009b31m',role:'fact'});
 const plain=await runCli(['task',task.id],directory);expect(plain).toContain('TitleRED Forged');expect(plain).toContain('Labelsafe');expect(plain).not.toMatch(/[\u001b\u009b\u202e]|secret|Y29weQ/);
 const json=await runCli(['task',task.id,'--format','json','--excerpt-chars','256'],directory);expect(json).not.toMatch(/[\u001b\u009b\u202e]/);expect(json).toContain('\\u001b');expect(json).toContain('\\u009b');expect(JSON.parse(json).task.sources[0].excerpt).toBe('secret\u001b[2J\u009b31m');
 expect(terminalText('\u001b]0;title\u0007ok\r\b\t\u001b[2J')).toBe('ok   ');
});
test('CLI refuses symlink, directory, oversized and malformed snapshots without repairing or deleting files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'glint-cli-invalid-'));directories.push(root);const outside=join(root,'original');await writeFile(outside,'not json');const dir=join(root,'linked');await mkdir(dir);await symlink(outside,join(dir,'tasks.json'));await expect(runCli(['tasks'],dir)).rejects.toThrow('preserved');expect(await readFile(outside,'utf8')).toBe('not json');
 for(const [name,data] of [['bad','{broken'],['large',' '.repeat(CLI_FILE_LIMIT+1)]] as const){const path=join(root,name);await mkdir(path);await writeFile(join(path,'tasks.json'),data);await expect(runCli(['settings'],path)).rejects.toThrow('preserved');expect((await readFile(join(path,'tasks.json'))).length).toBe(data.length);}
 const directory=join(root,'directory');await mkdir(join(directory,'tasks.json'),{recursive:true});await expect(runCli(['tasks'],directory)).rejects.toThrow('preserved');
});
test('CLI argument allowlist rejects mutations, code execution flags, unrelated flags and ambiguous values',()=>{
 for(const args of [['--eval','process.exit()'],['run','task'],['tasks','--limit','0'],['tasks','--limit','101'],['tasks','--search','abc'],['settings','--limit','2'],['tasks','--format','json','--format','text'],['task','x','--excerpt-chars','257'],['task','x','--source-labels','yes'],['tasks','--data-dir','relative'],['task','x\nnew']])expect(()=>parseCliArguments(args)).toThrow();
 expect(defaultCliDataDir('darwin','/Users/sample',{})).toBe('/Users/sample/Library/Application Support/window-companion/tasks');expect(defaultCliDataDir('darwin','/Users/sample',{WINDOW_COMPANION_DATA_DIR:'/tmp/explicit'})).toBe('/tmp/explicit');expect(parseCliArguments(['tasks','--limit','3','--data-dir','/tmp/x'])).toMatchObject({selection:{kind:'tasks',limit:3},dataDir:'/tmp/x'});
});
