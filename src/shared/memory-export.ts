import {Schema} from 'effect';
import {readUserMemory,MEMORY_FACT_COUNT,type UserMemory} from './user-memory';
const revision=Schema.Int.pipe(Schema.between(0,Number.MAX_SAFE_INTEGER));
const fact=Schema.Struct({id:Schema.String.pipe(Schema.minLength(1),Schema.maxLength(200)),revision});
const fields={expectedRevision:revision,facts:Schema.Array(fact).pipe(Schema.minItems(1),Schema.maxItems(MEMORY_FACT_COUNT),Schema.filter(facts=>new Set(facts.map(fact=>fact.id)).size===facts.length))};
export const MemoryExportCommandSchema=Schema.Struct({type:Schema.Literal('memory.export'),...fields});
export type MemoryExportCommand=typeof MemoryExportCommandSchema.Type;
export const readMemoryExportCommand=Schema.decodeUnknownSync(MemoryExportCommandSchema,{onExcessProperty:'error'});
export const MEMORY_EXPORT_CHANGED='Saved memory changed. Load saved memory and select the current facts before exporting.';
export const MEMORY_EXPORT_MESSAGES=[MEMORY_EXPORT_CHANGED,'Finish the current memory export before starting another.','Choose an exact memory export destination.','The memory export destination changed. Choose it again.','A file already exists at this destination. Choose a new filename.','The memory file may have been saved. Check the destination before exporting again.','The memory export could not be saved. No destination file was created.'] as const;
/** Only current personal facts are projected. No store, task, project or provider object is serialized. */
export function memoryExportSnapshot(memory:UserMemory,command:MemoryExportCommand,exportedAt:string){
 const current=readUserMemory(memory),selection=readMemoryExportCommand(command);
 if(current.revision!==selection.expectedRevision)throw Error(MEMORY_EXPORT_CHANGED);
 const facts=selection.facts.map(reference=>{const saved=current.facts.find(fact=>fact.id===reference.id&&fact.revision===reference.revision);if(!saved)throw Error(MEMORY_EXPORT_CHANGED);return {id:saved.id,revision:saved.revision,text:saved.text,topics:[...saved.topics]};});
 return {kind:'glint-personal-memory-export' as const,schemaVersion:1 as const,application:'Glint',exportedAt,scope:'Selected current personal saved facts. Project memory, conversations, provider records and unsaved edits are excluded.',format:'Glint UTF-8 JSON for backup or migration; no other app importer compatibility is implied.',memoryRevision:current.revision,memoryEnabledAtExport:current.enabled,facts};
}
export type MemoryExportSnapshot=ReturnType<typeof memoryExportSnapshot>;
const result=Schema.Union(Schema.Struct({kind:Schema.Literal('cancelled')}),Schema.Struct({kind:Schema.Literal('saved'),path:Schema.String,count:Schema.Int.pipe(Schema.positive()),byteLength:Schema.Int.pipe(Schema.positive()),memoryRevision:revision}));
export type MemoryExportResult=typeof result.Type;
export const readMemoryExportResult=Schema.decodeUnknownSync(result,{onExcessProperty:'error'});
