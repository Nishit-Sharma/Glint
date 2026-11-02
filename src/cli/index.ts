import {defaultCliDataDir,parseCliArguments,runCli,terminalText} from './cli';
import {isPresetCliCommand,parsePresetCliArguments} from './presets';
import {runPromptWorkbench} from './preset-workbench';
import {runTranscriptCopy} from './transcript-copy';
import {writeClipboard,type ClipboardWriter} from './clipboard';

export async function dispatchCli(args:readonly string[],input=process.stdin,output=process.stdout,clipboard:ClipboardWriter=writeClipboard):Promise<void>{
 if(args[0]==='/copy'){const parsed=parseCliArguments(args);await runTranscriptCopy(parsed.dataDir??defaultCliDataDir(),input,output,clipboard);return;}
 const parsed=isPresetCliCommand(args)?parsePresetCliArguments(args):undefined;
 if(parsed?.command.kind==='prompt')await runPromptWorkbench(parsed.dataDir??defaultCliDataDir(),parsed.command.menu,input,output);else output.write(await runCli(args));
}
try{await dispatchCli(process.argv.slice(2));}
catch(error){process.stderr.write(`Glint CLI: ${terminalText(error instanceof Error?error.message:'The task snapshot could not be read.')}\n`);process.exitCode=1;}
