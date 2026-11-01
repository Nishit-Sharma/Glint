import {createHash} from 'node:crypto';
import type {SourceRef,Task} from './types';
import {readDocumentCsv} from '../shared/document-import';
import type {CsvChartData} from '../shared/csv-chart';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
/** Existing imported CSV snapshots keep original and optionally reviewed text.
 * The original hash disambiguates delimiter-like text inside CSV cells. */
export function csvChartSource(task:Task,reference:SourceRef,current=false):CsvChartData{
 const sources=task.sources.filter(source=>source.id===reference.sourceId),source=sources.length===1?sources[0]:undefined,versions=source?.versions.filter(version=>version.version===reference.version&&version.digest===reference.digest),version=versions?.length===1?versions[0]:undefined;
 if(!source||!version||version.kind!=='text'||current&&(source.freshness!=='fresh'||source.currentVersion!==reference.version))throw Error('This exact CSV source is unavailable or changed. Choose its current saved version.');
 if(version.content.length>220000)throw Error('Choose a CSV source within the existing 100,000-character import limit.');
 let csv=version.content,originalFile:CsvChartData['originalFile'];
 if(csv.startsWith('# Imported document snapshot\n\n')){
  if(!/\nFormat: CSV\n/.test(csv))throw Error('This imported source is not CSV. Choose an imported CSV source.');
  const original=/\n\nOriginal decoded CSV SHA-256: ([a-f0-9]{64})\n\n## Original decoded CSV\n\n/.exec(csv),file=/^# Imported document snapshot\n\nFile: (.+)\nFormat: CSV\nFile SHA-256: ([a-f0-9]{64})\n/.exec(csv);
  if(!original||!file)throw Error('This CSV snapshot has no exact original data basis. Import the CSV again.');
  const tail=csv.slice(original.index+original[0].length),marker='\n\n## Reviewed CSV text\n\n',review=/\nReviewed text: (unchanged|corrected by user before adding)(?:\n\n|$)/.exec(csv.slice(0,original.index));
  if(!review)throw Error('The CSV review provenance is unavailable.');
  if(review[1]==='unchanged'){if(hash(tail)!==original[1])throw Error('The imported CSV original hash does not match its saved data.');csv=tail;}
  else{const candidates:string[]=[];let at=tail.indexOf(marker);while(at>=0){if(hash(tail.slice(0,at))===original[1])candidates.push(tail.slice(at+marker.length));at=tail.indexOf(marker,at+marker.length);}if(candidates.length!==1)throw Error('The reviewed CSV data basis is ambiguous or does not match its original hash.');csv=candidates[0];}
  let name:unknown;try{name=JSON.parse(file[1]);}catch{throw Error('The imported CSV file name is unavailable.');}if(typeof name!=='string')throw Error('The imported CSV file name is unavailable.');originalFile={name,digest:file[2]};
 }
 readDocumentCsv(csv);return {taskId:task.id,source:{...reference},label:version.label,csv,dataDigest:hash(csv),...(originalFile?{originalFile}:{})};
}
