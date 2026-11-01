import {defaultCliDataDir,runCli,terminalText} from './cli';
import {isPresetCliCommand,parsePresetCliArguments} from './presets';
import {runPromptWorkbench} from './preset-workbench';

try{const args=process.argv.slice(2),parsed=isPresetCliCommand(args)?parsePresetCliArguments(args):undefined;if(parsed?.command.kind==='prompt')await runPromptWorkbench(parsed.dataDir??defaultCliDataDir(),parsed.command.menu);else process.stdout.write(await runCli(args));}
catch(error){process.stderr.write(`Glint CLI: ${terminalText(error instanceof Error?error.message:'The task snapshot could not be read.')}\n`);process.exitCode=1;}
