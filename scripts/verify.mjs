import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: npm run verify -- [--scope all|unit|browser|native] [--dry-run]\nRuns build and selected checks serially, writes JSON/log evidence, never grants permissions or enables live model probes. --dry-run prints the exact plan without running it.');process.exit(0)}
const scope=args.includes('--scope')?args[args.indexOf('--scope')+1]:'all';
if(!['all','unit','browser','native'].includes(scope)||args.some((a,i)=>!['--scope','--dry-run',scope].includes(a))){console.error('Invalid arguments. Run npm run verify -- --help.');process.exit(2)}
const plan=[['npm',['run','build']]];
if(scope==='all'||scope==='unit')plan.push(['npm',['test']]);
if(scope==='all')plan.push(['npm',['run','test:e2e']]);
const nativeSpecs=['electron.e2e.ts','native-content-fit.e2e.ts','native-privacy.e2e.ts','native-drafts.e2e.ts'];
if(scope==='browser')plan.push(['npm',['run','test:e2e','--',...(await readdir('tests')).filter(name=>name.endsWith('.e2e.ts')&&!nativeSpecs.includes(name)).sort().map(name=>join('tests',name))]]);
if(scope==='native')plan.push(['npm',['run','test:e2e','--',...nativeSpecs.map(name=>join('tests',name))]]);
if(args.includes('--dry-run')){console.log(JSON.stringify({scope,plan,liveProviders:false,native:scope==='all'||scope==='native'},null,2));process.exit(0)}
const paths=[];
async function collect(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await collect(p);else if(e.isFile())paths.push(p)}}
for(const dir of ['src','tests','scripts','build'])await collect(dir);
paths.push('package.json','package-lock.json','tsconfig.json','electron.vite.config.ts','vitest.config.ts','playwright.config.ts');paths.sort();
const hash=createHash('sha256');const files=[];
for(const path of paths){const bytes=await readFile(path);const digest=createHash('sha256').update(bytes).digest('hex');hash.update(path+'\0'+digest+'\n');files.push({path,digest})}
const evidence={utc:new Date().toISOString(),root:resolve('.'),scope,sourceDigest:hash.digest('hex'),files,liveProviders:false,checks:[],status:'running'};
await mkdir('evidence',{recursive:true});
await writeFile('evidence/verification.json',JSON.stringify(evidence,null,2));
for(const [command,argv] of plan){
 const started=performance.now(),log=`evidence/verify-${scope}-${evidence.checks.length+1}.log`,sink=createWriteStream(log);
 const result=await new Promise(resolve=>{
  const child=spawn(command,argv,{env:process.env,stdio:['ignore','pipe','pipe']});
  const interrupt=()=>child.kill('SIGINT');process.once('SIGINT',interrupt);
  child.stdout.on('data',chunk=>{sink.write(chunk);process.stdout.write(chunk);});child.stderr.on('data',chunk=>{sink.write(chunk);process.stderr.write(chunk);});
  child.on('error',error=>{sink.write(String(error));process.stderr.write(String(error));});
  child.on('close',(status,signal)=>{process.removeListener('SIGINT',interrupt);sink.end(()=>resolve({status,signal}));});
 });
 evidence.checks.push({command:[command,...argv],exit:result.status,signal:result.signal,elapsedMs:Math.round(performance.now()-started),log});
 if(result.status!==0){evidence.status=result.status===130||result.signal==='SIGINT'?'interrupted':'failed';await writeFile('evidence/verification.json',JSON.stringify(evidence,null,2));process.exit(result.status||1)}
 await writeFile('evidence/verification.json',JSON.stringify(evidence,null,2));
}
const before=new Map(files.map(file=>[file.path,file.digest]));paths.length=0;
for(const dir of ['src','tests','scripts','build'])await collect(dir);
paths.push('package.json','package-lock.json','tsconfig.json','electron.vite.config.ts','vitest.config.ts','playwright.config.ts');paths.sort();
const changed=[];for(const path of paths){const digest=createHash('sha256').update(await readFile(path)).digest('hex');if(before.get(path)!==digest)changed.push(path);before.delete(path);}changed.push(...before.keys());
if(changed.length){evidence.status='source-changed';evidence.changedDuringVerification=changed;await writeFile('evidence/verification.json',JSON.stringify(evidence,null,2));console.error('Source changed during verification; run the affected checks again.');process.exit(1);}
evidence.status='passed';await writeFile('evidence/verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:evidence.status,sourceDigest:evidence.sourceDigest,evidence:'evidence/verification.json',liveProviders:false}));
