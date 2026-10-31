import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {parseCurrentState,type State} from '../core/store';
import {defaultCliPreferences,searchCliSettings,type CliPreferences} from '../shared/cli-preferences';

export const CLI_FILE_LIMIT=32*1024*1024;
export const CLI_OUTPUT_LIMIT=262144;
type Display={-readonly [Key in 'format'|'includeSourceLabels'|'excerptChars']:CliPreferences[Key]};
type Selection={kind:'help'}|{kind:'tasks';limit:number}|{kind:'task';id:string}|{kind:'settings';search:string};
export type CliArguments={selection:Selection;dataDir?:string;overrides:Partial<Display>};
type TaskSummary={id:string;title:string;status:'active'|'paused';archived:boolean;updatedAt:string;sourceCount:number};
type SourceSummary={id:string;kind:'text'|'image'|'window';freshness:'fresh'|'refresh-required';label?:string;excerpt?:string};
type Snapshot={preferences:CliPreferences;tasks:State['tasks']};
export const CLI_HELP='Glint CLI · read saved tasks\n\nUsage: glint tasks [--limit 1..100]\n       glint task <task-id>\n       glint settings [--search <text>]\n       glint help\n\nOptions: --data-dir <absolute-path>  --format text|json\n         --source-labels true|false  --excerpt-chars 0..256\n\nPreferences → CLI saves defaults. Each invocation reads the saved values; no restart is needed.\nThis CLI reads a task snapshot. It cannot change tasks or run requests.\n';
export function parseCliArguments(args:readonly string[]):CliArguments{
 if(args.length>24||args.some(arg=>arg.length>4096||/[\u0000-\u001f\u007f-\u009f]/.test(arg)))throw Error('Invalid CLI arguments. Run glint help.');
 const positionals:string[]=[],flags=new Map<string,string>();
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--help'){if(args.length!==1)throw Error('Use glint help on its own.');return {selection:{kind:'help'},overrides:{}};}
  if(!arg.startsWith('-')){positionals.push(arg);continue;}
  if(!['--data-dir','--format','--source-labels','--excerpt-chars','--limit','--search'].includes(arg)||flags.has(arg))throw Error('Unknown or repeated CLI option. Run glint help.');
  const value=args[++i];if(value===undefined||value.startsWith('--'))throw Error('Missing CLI option value. Run glint help.');flags.set(arg,value);
 }
 const dataDir=flags.get('--data-dir');if(dataDir!==undefined&&!isAbsolute(dataDir))throw Error('--data-dir must be an absolute path.');
 const overrides:Partial<Display>={},format=flags.get('--format'),labels=flags.get('--source-labels'),excerpt=flags.get('--excerpt-chars');
 if(format!==undefined){if(format!=='text'&&format!=='json')throw Error('--format must be text or json.');overrides.format=format;}
 if(labels!==undefined){if(labels!=='true'&&labels!=='false')throw Error('--source-labels must be true or false.');overrides.includeSourceLabels=labels==='true';}
 const number=(value:string,max:number)=>{if(!/^\d{1,3}$/.test(value)||Number(value)>max)throw Error('Numeric CLI option is outside its supported range.');return Number(value);};
 if(excerpt!==undefined)overrides.excerptChars=number(excerpt,256);
 const [command,id]=positionals;
 let selection:Selection;
 if((command===undefined||command==='help')&&positionals.length<=1){if(flags.size)throw Error('Use glint help on its own.');selection={kind:'help'};}
 else if(command==='tasks'&&positionals.length===1){const limit=number(flags.get('--limit')??'50',100);if(limit<1)throw Error('--limit must be from 1 to 100.');selection={kind:'tasks',limit};}
 else if(command==='task'&&positionals.length===2&&id.length>0&&id.length<=200)selection={kind:'task',id};
 else if(command==='settings'&&positionals.length===1){const search=flags.get('--search')??'';if(search.length>200)throw Error('Settings search is too long.');selection={kind:'settings',search};}
 else throw Error('Unknown CLI command. Run glint help.');
 if(flags.has('--limit')&&selection.kind!=='tasks'||flags.has('--search')&&selection.kind!=='settings')throw Error('CLI option does not apply to this command.');
 return {selection,...(dataDir===undefined?{}:{dataDir}),overrides};
}
export function defaultCliDataDir(platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env):string{
 if(env.WINDOW_COMPANION_DATA_DIR){if(!isAbsolute(env.WINDOW_COMPANION_DATA_DIR))throw Error('WINDOW_COMPANION_DATA_DIR must be absolute.');return env.WINDOW_COMPANION_DATA_DIR;}
 const appData=platform==='darwin'?join(home,'Library','Application Support'):platform==='win32'?(env.APPDATA??join(home,'AppData','Roaming')):(env.XDG_CONFIG_HOME??join(home,'.config'));
 return join(appData,'window-companion','tasks');
}
async function readSnapshot(dataDir:string):Promise<Snapshot>{
 let file;
 try{
  file=await open(join(dataDir,'tasks.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const stat=await file.stat();if(!stat.isFile()||stat.size>CLI_FILE_LIMIT)throw Error('Unsupported task snapshot.');
  const bytes=Buffer.alloc(Math.min(stat.size+1,CLI_FILE_LIMIT+1));let length=0;
  while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,null);if(read.bytesRead===0)break;length+=read.bytesRead;}
  if(length!==stat.size)throw Error('Task snapshot changed while reading.');
  const state=parseCurrentState(JSON.parse(bytes.subarray(0,length).toString('utf8')));
  return {preferences:state.cliPreferences??defaultCliPreferences(),tasks:state.tasks};
 }catch{throw Error('The saved task snapshot could not be read. Existing files were preserved. Open Glint to review the store or choose --data-dir.');}
 finally{await file?.close();}
}
const bounded=(value:string,max=300)=>value.slice(0,max);
const summary=(task:State['tasks'][number]):TaskSummary=>({id:bounded(task.id,200),title:bounded(task.title),status:task.status,archived:!!task.archive,updatedAt:bounded(task.updatedAt,100),sourceCount:task.sources.length});
export function terminalText(value:string):string{
 return value.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)/g,'').replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g,'').replace(/\u001b[ -/]*[@-~]/g,'').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,' ');
}
const safeJson=(value:unknown)=>JSON.stringify(value,null,2).replace(/[\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'))+'\n';
function sourceSummaries(task:State['tasks'][number],display:Display):SourceSummary[]{
 return task.sources.slice(0,100).map(source=>{const version=source.versions.find(item=>item.version===source.currentVersion);if(!version)throw Error('The task source snapshot is incomplete.');return {id:bounded(source.id,200),kind:version.kind,freshness:source.freshness,...(display.includeSourceLabels?{label:bounded(version.label)}:{}),...(display.excerptChars>0&&version.kind==='text'?{excerpt:version.content.slice(0,display.excerptChars)}:{})};});
}
export async function runCli(args:readonly string[],defaultDirectory?:string):Promise<string>{
 const parsed=parseCliArguments(args);if(parsed.selection.kind==='help')return CLI_HELP;
 const snapshot=await readSnapshot(parsed.dataDir??defaultDirectory??defaultCliDataDir()),display={...snapshot.preferences,...parsed.overrides};
 let result:unknown,lines:string[];
 if(parsed.selection.kind==='settings'){
  const settings=searchCliSettings(parsed.selection.search).map(item=>({key:item.key,label:item.label,value:snapshot.preferences[item.key]}));
  result={revision:snapshot.preferences.revision,settings,applies:'next-invocation',restartRequired:false};lines=settings.map(item=>`${item.key} = ${String(item.value)} (${item.label})`);lines.push('Saved defaults apply on the next invocation. No restart is needed.');
 }else if(parsed.selection.kind==='tasks'){
  const tasks=snapshot.tasks.slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,parsed.selection.limit).map(summary);result={tasks,total:snapshot.tasks.length};lines=tasks.length?tasks.map(task=>`${terminalText(task.id)}  ${task.status}${task.archived?' · archived':''}  ${terminalText(task.title)}  (${task.sourceCount} sources)`):['No saved tasks.'];
 }else{
  const id=parsed.selection.id,task=snapshot.tasks.find(item=>item.id===id);if(!task)throw Error('This task was not found in the saved snapshot.');
  const item=summary(task),sources=sourceSummaries(task,display);result={task:{...item,sources,sourcesTruncated:task.sources.length>sources.length}};
  lines=[`${terminalText(item.title)} [${terminalText(item.id)}]`,`${item.status}${item.archived?' · archived':''} · ${item.sourceCount} sources · updated ${terminalText(item.updatedAt)}`,...sources.map(source=>`${terminalText(source.id)}  ${source.kind} · ${source.freshness}${source.label===undefined?'':' · '+terminalText(source.label)}${source.excerpt===undefined?'':'\n  '+terminalText(source.excerpt)}`)];if(task.sources.length>sources.length)lines.push('Showing the first 100 sources.');
 }
 const output=display.format==='json'?safeJson(result):lines.join('\n')+'\n';
 if(Buffer.byteLength(output)>CLI_OUTPUT_LIMIT)throw Error('CLI output exceeds the supported limit.');return output;
}
