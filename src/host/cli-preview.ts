import {execFile,type ChildProcess} from 'node:child_process';
import {Schema} from 'effect';
import {CLI_OUTPUT_LIMIT} from '../cli/cli';
import {readCliPreferencesUpdate,type CliPreferencesUpdate,type CliPreview} from '../shared/cli-preferences';

type CliCommand={type:'cli.preferences.get'}|({type:'cli.preferences.update'}&CliPreferencesUpdate)|{type:'cli.preview';taskId:string};
const previewCommand=Schema.decodeUnknownSync(Schema.Struct({type:Schema.Literal('cli.preview'),taskId:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200),Schema.pattern(/^[^\u0000-\u001f\u007f-\u009f]+$/))}),{onExcessProperty:'error'});
export function readCliCommand(value:Record<string,unknown>):CliCommand{
 const {type,...input}=value;
 if(type==='cli.preview')return previewCommand(value);
 if(type==='cli.preferences.get'&&Object.keys(input).length===0)return {type};
 if(type==='cli.preferences.update')return {type,...readCliPreferencesUpdate(input)};
 throw Error('Unknown CLI preference command.');
}
export class CliPreviewHost{
 private readonly children=new Set<ChildProcess>();
 private epoch=0;
 constructor(private readonly paths:{executable:string;script:string;launcher:string}){}
 preview(taskId:string,dataDir:string):Promise<CliPreview>{
  if(this.children.size)return Promise.resolve({kind:'unavailable',message:'A CLI preview is already running. Try again when it finishes.'});
  const epoch=this.epoch;
  return new Promise(resolve=>{
   const child=execFile(this.paths.executable,[this.paths.script,'task',taskId,'--data-dir',dataDir],{env:{ELECTRON_RUN_AS_NODE:'1',LANG:'en_US.UTF-8'},encoding:'utf8',timeout:5000,maxBuffer:CLI_OUTPUT_LIMIT,windowsHide:true},(error,stdout)=>{
    this.children.delete(child);
    resolve(error||epoch!==this.epoch?{kind:'unavailable',message:'The bundled CLI preview could not complete. Saved tasks and preferences were preserved.'}:{kind:'ready',output:stdout,launcher:this.paths.launcher});
   });
   this.children.add(child);
  });
 }
 close(){this.epoch++;for(const child of this.children)child.kill();this.children.clear();}
}
