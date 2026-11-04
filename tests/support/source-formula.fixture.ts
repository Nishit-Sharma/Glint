import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCompanion} from '../../src/core/companion';
import {sourceFormulaLines,sourceFormulaPreview,type SourceFormulaInput} from '../../src/learning/source-formula';
export const formulaSource='🧪 Cost lesson\r\nA constant rate is charged for time, plus one fee.\r\ncost = rate * time - fee\r\n';
export async function sourceFormulaFixture(){
 const directory=await mkdtemp(join(tmpdir(),'source-formula-')),core=await createCompanion({dataDir:directory}),created=await core.createTask({title:'Owned source formula'}),task=await core.putSource(created.id,{kind:'text',role:'fact',label:'Cost lesson',content:formulaSource}),source=task.sources[0],version=source.versions[0],line=sourceFormulaLines(formulaSource)[2];
 const input:SourceFormulaInput={taskId:task.id,sourceRef:{sourceId:source.id,version:1,digest:version.digest},lineNumber:line.lineNumber,start:line.start,end:line.end,title:'Cost from a reviewed formula',formula:'cost = rate * time + fee',variables:[{name:'rate',unit:'USD/s',min:0,max:100,value:3},{name:'time',unit:'s',min:0,max:100,value:4},{name:'fee',unit:'USD',min:0,max:100,value:2}],assumptions:['  The rate is constant.  ','The fee is charged once.'],correctionReason:'  The preceding source sentence says the fee is added once.  ',confirmed:'reviewed-source-transcription'};
 return {directory,core,task,source,version,input,preview:sourceFormulaPreview(task,input),close:async()=>{await core.close();await rm(directory,{recursive:true,force:true});}};
}
