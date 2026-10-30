type Job={start:()=>void;cancelled:boolean};
const jobs:Job[]=[];
let frame:number|undefined,watching=false;
function unwatch(){if(watching){document.removeEventListener('visibilitychange',visibility);watching=false;}}
function schedule(){if(frame===undefined&&jobs.length&&!document.hidden)frame=requestAnimationFrame(run);}
function visibility(){if(document.hidden){if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;}else schedule();}
function run(){
 frame=undefined;if(document.hidden)return;
 let job=jobs.shift();while(job?.cancelled)job=jobs.shift();
 try{job?.start();}finally{if(jobs.length)schedule();else unwatch();}
}
/** Yield between original WebGL setups; pending hidden/unmounted work never starts. */
export function queueActorMount(start:()=>void){
 const job:Job={start,cancelled:false};jobs.push(job);
 if(!watching){document.addEventListener('visibilitychange',visibility);watching=true;}schedule();
 return()=>{job.cancelled=true;if(!jobs.some(pending=>!pending.cancelled)){if(frame!==undefined)cancelAnimationFrame(frame);frame=undefined;jobs.length=0;unwatch();}};
}
