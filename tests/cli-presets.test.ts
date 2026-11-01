import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,rm,writeFile,readdir,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CliPresetStore,parsePresetCliArguments} from '../src/cli/presets';
import {runCli} from '../src/cli/cli';
import {presetMenuKey} from '../src/cli/preset-workbench';
import {expandCliPrompt,parsePromptArguments,parsePromptWords,promptTerminalText} from '../src/shared/cli-presets';
const folders:string[]=[];
afterEach(async()=>{for(const folder of folders.splice(0))await rm(folder,{recursive:true,force:true});});
test('ten numbered presets persist, edits use exact revision, and Markdown parameters remain inert',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-presets-'));folders.push(directory);await writeFile(join(directory,'tasks.json'),'UNCHANGED TASK AUTHORITY');
 const store=new CliPresetStore(directory);expect((await store.read()).presets).toEqual([]);
 await store.save(10,'review','# Review $1\nProject: $PROJECT\n$ARGUMENTS\n/delete\n$(touch never)');
 const reopened=new CliPresetStore(directory),saved=await reopened.read();expect(saved.revision).toBe(1);expect(saved.presets[0]).toMatchObject({slot:10,name:'review',revision:1});
 const expanded=expandCliPrompt(saved.presets[0].body,parsePromptArguments(['Résumé 東京','PROJECT=Glint\n/quit\u001b[2J']));expect(expanded).toBe('# Review Résumé 東京\nProject: Glint\n/quit\u001b[2J\nRésumé 東京\n/delete\n$(touch never)');
 await expect(reopened.edit(10,'review','Changed $1',0)).rejects.toThrow('changed');expect((await reopened.read()).revision).toBe(1);
 await reopened.edit(10,'review','Changed $1',1);expect((await reopened.read()).presets[0].body).toBe('Changed $1');await reopened.delete(10,2);expect((await reopened.read()).presets).toEqual([]);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe('UNCHANGED TASK AUTHORITY');
});
test('the actual CLI saves an explicitly chosen UTF-8 Markdown file, recalls by name/slot, and edits/deletes only exact catalogs',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-preset-cli-'));folders.push(directory);const file=join(directory,'owned.md');await writeFile(file,'\uFEFF# Notes\nExplain $1 for $PROJECT.\n/quit\n$(echo NEVER)');await writeFile(join(directory,'tasks.json'),'PRIVATE UNTOUCHED');
 expect(await runCli(['presets','save','10','notes','--file',file],directory)).toContain('revision 1');
 const shown=JSON.parse(await runCli(['presets','show','10','--format','json'],directory));expect(shown.prompt).toBe('# Notes\nExplain $1 for $PROJECT.\n/quit\n$(echo NEVER)');
 const args=['Résumé 東京731','PROJECT=literal\n/delete\u001b]52;c;not-run\u0007'];const byName=JSON.parse(await runCli(['/prompts:notes','--format','json','--',...args],directory)),bySlot=JSON.parse(await runCli(['presets','recall','10','--format','json','--',...args],directory));expect(byName).toEqual(bySlot);expect(byName.prompt).toContain('literal\n/delete\u001b]52;c;not-run\u0007');
 const text=await runCli(['presets','recall','10','--',...args],directory);expect(text).toContain('\\u001b]52;');expect(text).not.toContain('\u001b');
 expect(JSON.parse(await runCli(['presets','list','--format','json'],directory)).presets).toHaveLength(1);expect(await runCli(['presets','list'],directory)).toContain('1. (empty)');
 await expect(runCli(['presets','save','10','replace','--text','overwrite'],directory)).rejects.toThrow('occupied');
 await runCli(['presets','edit','10','revised','--expect','1','--text','Revised $1'],directory);await expect(runCli(['/prompts:notes','one'],directory)).rejects.toThrow('not saved');await expect(runCli(['presets','delete','10','--expect','1'],directory)).rejects.toThrow('changed');await runCli(['presets','delete','10','--expect','2'],directory);expect(JSON.parse(await runCli(['presets','list','--format','json'],directory)).revision).toBe(3);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe('PRIVATE UNTOUCHED');
 await expect(runCli(['prompt'],directory)).rejects.toThrow('interactive');
});
test('all ten slots are genuine persisted entries; closed options and unavailable arguments fail without falling back',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-preset-ten-'));folders.push(directory);const store=new CliPresetStore(directory);for(let slot=1;slot<=10;slot++)await store.save(slot,'slot-'+slot,'Literal '+slot);expect((await store.read()).presets.map(p=>p.slot)).toEqual([1,2,3,4,5,6,7,8,9,10]);
 for(const args of [['presets','save','0','x','--text','x'],['presets','save','11','x','--text','x'],['presets','edit','1','x','--text','x'],['presets','delete','1'],['presets','list','--text','unexpected'],['presets','save','1','x','--file','relative.md'],['presets','list','--data-dir','relative'],['presets','show','1','extra'],['prompt','--format','json']])expect(()=>parsePresetCliArguments(args)).toThrow();
 expect(()=>expandCliPrompt('$1 $PROJECT',parsePromptArguments(['one']))).toThrow('PROJECT');expect(()=>expandCliPrompt('$2',parsePromptArguments(['one']))).toThrow('$2');expect(()=>expandCliPrompt('plain',parsePromptArguments(['one']))).toThrow('not used');expect(()=>expandCliPrompt('$NAME',parsePromptArguments(['NAME=']))).toThrow('nonempty');expect(()=>parsePromptWords('"unfinished')).toThrow('quote');
 expect(expandCliPrompt('$$HOME $1 $PROJECT $ARGUMENTS',parsePromptArguments(parsePromptWords('"one two" PROJECT="$1 $(none)"')))).toBe('$HOME one two $1 $(none) one two');
});
test('exclusive mutations preserve the catalog on conflicts, locks, symlinks, malformed JSON and unsupported encoding',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-preset-file-'));folders.push(directory);const store=new CliPresetStore(directory);await store.save(1,'original','Original');const before=await readFile(join(directory,'cli-presets.json'));
 await writeFile(join(directory,'cli-presets.lock'),'OTHER OWNER');await expect(store.save(2,'second','Two')).rejects.toThrow('locked');expect(await readFile(join(directory,'cli-presets.lock'),'utf8')).toBe('OTHER OWNER');expect(await readFile(join(directory,'cli-presets.json'))).toEqual(before);await rm(join(directory,'cli-presets.lock'));
 const results=await Promise.allSettled([store.edit(1,'first','First',1),new CliPresetStore(directory).edit(1,'second','Second',1)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await store.read()).revision).toBe(2);expect((await readdir(directory)).sort()).toEqual(['cli-presets.json']);
 await writeFile(join(directory,'bad.md'),Buffer.from([255,254,65]));await expect(runCli(['presets','save','2','bad','--file',join(directory,'bad.md')],directory)).rejects.toThrow();expect((await store.read()).revision).toBe(2);
 const link=join(directory,'linked');await mkdir(link);await symlink(join(directory,'cli-presets.json'),join(link,'cli-presets.json'));await expect(new CliPresetStore(link).save(2,'outside','No')).rejects.toThrow('preserved');expect((await store.read()).revision).toBe(2);
 const malformed=join(directory,'malformed');await mkdir(malformed);await writeFile(join(malformed,'cli-presets.json'),'{broken');await expect(new CliPresetStore(malformed).save(1,'new','No')).rejects.toThrow('preserved');expect(await readFile(join(malformed,'cli-presets.json'),'utf8')).toBe('{broken');
});
test('the production keyboard reducer selects slot10, arrows wrap, and cancellation never selects a preset',()=>{
 expect(presetMenuKey(0,{name:'down'},'')).toEqual({index:1,action:'continue'});expect(presetMenuKey(0,{name:'up'},'')).toEqual({index:9,action:'continue'});expect(presetMenuKey(3,{},'0')).toEqual({index:9,action:'continue'});expect(presetMenuKey(9,{name:'return'},'\r')).toEqual({index:9,action:'select'});expect(presetMenuKey(9,{name:'escape'},'\u001b')).toEqual({index:9,action:'cancel'});expect(presetMenuKey(0,{ctrl:true,name:'c'},'\u0003').action).toBe('cancel');expect(promptTerminalText('line\n/delete\r\u001b[2J')).toBe('line\n/delete\\u000d\\u001b[2J');
});
test('reserved ARGUMENTS is exact; named identifiers sharing its prefix expand once as complete names',()=>{
 const args=parsePromptArguments(['one two','ARGUMENTS_SUFFIX=literal $1\n/quit','ARGUMENTSfoo=$(nothing)']);
 expect(expandCliPrompt('$ARGUMENTS_SUFFIX | $ARGUMENTSfoo | $ARGUMENTS',args)).toBe('literal $1\n/quit | $(nothing) | one two');
 expect(expandCliPrompt('$ARGUMENTS_SUFFIX',parsePromptArguments(['ARGUMENTS_SUFFIX=only named']))).toBe('only named');
 expect(()=>expandCliPrompt('$ARGUMENTS',parsePromptArguments(['ARGUMENTS_SUFFIX=value']))).toThrow('Missing positional');
});
