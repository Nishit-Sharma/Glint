import {runCli} from './cli';

try{process.stdout.write(await runCli(process.argv.slice(2)));}
catch(error){process.stderr.write(`Glint CLI: ${error instanceof Error?error.message:'The task snapshot could not be read.'}\n`);process.exitCode=1;}
