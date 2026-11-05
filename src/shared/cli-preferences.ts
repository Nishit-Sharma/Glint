import {Schema} from 'effect';

const revision=Schema.Number.pipe(Schema.int(),Schema.between(0,Number.MAX_SAFE_INTEGER));
const fields={format:Schema.Literal('text','json'),includeSourceLabels:Schema.Boolean,excerptChars:Schema.Number.pipe(Schema.int(),Schema.between(0,256))};
export const CliPreferencesSchema=Schema.Struct({revision,...fields});
export const CliPreferencesUpdateSchema=Schema.Struct({expectedRevision:revision,...fields});
export type CliPreferences=typeof CliPreferencesSchema.Type;
export type CliPreferencesUpdate=typeof CliPreferencesUpdateSchema.Type;
export type CliPreferencesCommit={kind:'saved'|'conflict';current:CliPreferences};
export const defaultCliPreferences=():CliPreferences=>({revision:0,format:'text',includeSourceLabels:true,excerptChars:0});
export const readCliPreferences=Schema.decodeUnknownSync(CliPreferencesSchema,{onExcessProperty:'error'});
export const readCliPreferencesUpdate=Schema.decodeUnknownSync(CliPreferencesUpdateSchema,{onExcessProperty:'error'});
export const readCliPreferencesCommit=Schema.decodeUnknownSync(Schema.Struct({kind:Schema.Literal('saved','conflict'),current:CliPreferencesSchema}),{onExcessProperty:'error'});
export const CLI_SETTINGS=[
 {key:'format',label:'Output format',description:'Default text or JSON output.'},
 {key:'includeSourceLabels',label:'File and window names',description:'Include file and window names when viewing a task.'},
 {key:'excerptChars',label:'Text excerpt length',description:'Characters per shared text, from 0 (off) to 256.'},
] as const;
export const searchCliSettings=(query:string)=>CLI_SETTINGS.filter(item=>`${item.key} ${item.label} ${item.description}`.toLowerCase().includes(query.trim().toLowerCase()));
export const CliPreviewSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('ready'),output:Schema.String.pipe(Schema.maxLength(262144)),launcher:Schema.String.pipe(Schema.maxLength(4096))}),Schema.Struct({kind:Schema.Literal('unavailable'),message:Schema.String.pipe(Schema.maxLength(1000))}));
export type CliPreview=typeof CliPreviewSchema.Type;
export const readCliPreview=Schema.decodeUnknownSync(CliPreviewSchema,{onExcessProperty:'error'});
