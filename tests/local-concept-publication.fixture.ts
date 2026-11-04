import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion,type Companion} from '../src/core/companion';
import {createPackingConcept} from '../src/core/packing-concept-host';
import {createPackingPractice} from '../src/core/packing-practice-host';
import {createSignalConcept} from '../src/core/signal-concept-host';
import {createSignalPractice} from '../src/core/signal-sequential-practice-host';
import {createSignalOverwrite} from '../src/core/signal-overwrite-host';
import {createTruthTable} from '../src/core/truth-table-host';
export const conceptText='4 items per box\nq <= d;\nq <= a;\nq <= b;\nr <= a;\nr <= b;\ny <= a and b;\nz <= a or b;';
export const conceptFamilies=['packing','packing-practice','signal','signal-practice','signal-overwrite-lesson','signal-overwrite-practice','truth-table','truth-prediction'] as const;
export type ConceptFamily=typeof conceptFamilies[number];
export const publishers:Record<ConceptFamily,(core:Companion,input:any,guard?:()=>void)=>Promise<{task:any;artifactId:string;revision:number;digest?:string}>>={packing:createPackingConcept,'packing-practice':createPackingPractice,signal:createSignalConcept,'signal-practice':createSignalPractice,'signal-overwrite-lesson':createSignalOverwrite,'signal-overwrite-practice':createSignalOverwrite,'truth-table':createTruthTable,'truth-prediction':createTruthTable};
export async function conceptFixture(family:ConceptFamily,provided?:{core:Companion;taskId:string}){
 const directory=provided?undefined:await mkdtemp(join(tmpdir(),'local-concepts-'));let core=provided?.core??await createCompanion({dataDir:directory!}),task=provided?await core.getTask(provided.taskId):await core.createTask({title:'Closed local '+family});task=await core.putSource(task.id,{kind:'text',role:'fact',label:'Reviewed source',content:conceptText});const source=task.sources.at(-1)!,version=source.versions[0],refs=[{sourceId:source.id,version:version.version,digest:version.digest}],doc=await core.saveArtifact(task.id,{title:'Exact local basis',content:'Reviewed source notes.',mimeType:'text/markdown',sourceRefs:refs}),basis={artifactId:doc.artifactId,revision:doc.revision.revision,digest:doc.revision.digest};
 const base=(quote:string)=>({taskId:task.id,basis,expectedSourceRefs:refs,sourceId:source.id,start:conceptText.indexOf(quote),end:conceptText.indexOf(quote)+quote.length,quote,confirmed:true as const});let included:any,excluded:any;
 if(family==='packing'){included={...base('4 items per box'),count:9};excluded={...included,count:10};}
 else if(family==='packing-practice'){const demo=await createPackingConcept(core,{...base('4 items per box'),count:4}),previewArtifact=(await core.getTask(task.id)).artifacts.find(a=>a.id===demo.artifactId)!.revisions.at(-1)!;included={...base('4 items per box'),previewCount:4,preview:{artifactId:demo.artifactId,revision:previewArtifact.revision,digest:previewArtifact.digest},count:5,prediction:1};excluded={...included,count:6};}
 else if(family==='signal'){included=base('q <= d;');excluded=base('q <= a;');}
 else if(family==='signal-practice'){included={...base('q <= d;'),answer:0,reasoning:'First answer'};excluded={...base('q <= a;'),answer:1,reasoning:'Separate answer'};}
 else if(family.startsWith('signal-overwrite')){if(family.endsWith('lesson')){included={...base('q <= a;\nq <= b;'),mode:'lesson',secondEnabled:true};excluded={...included,secondEnabled:false};}else{included={...base('q <= a;\nq <= b;'),mode:'practice',answer:'10'};excluded={...base('r <= a;\nr <= b;'),mode:'practice',answer:'01'};}}
 else {const mode=family==='truth-table'?'table':'prediction';included={...base('y <= a and b;'),mode};excluded={...base('z <= a or b;'),mode};}
 return {directory,get core(){return core;},taskId:task.id,source,refs,basis,included,excluded,publish:(input:any,guard?:()=>void)=>publishers[family](core,input,guard),async exclude(){const before=await core.getTask(task.id);return core.setSourceSelection({type:'source-selection.set',taskId:task.id,expectedRevision:before.session?.sourceSelection?.revision??0,sourceIds:[]});},async restart(){if(!directory)throw Error('Owned fixture required.');await core.close();core=await createCompanion({dataDir:directory});},async close(){if(directory){await core.close();await rm(directory,{recursive:true,force:true});}}};
}
