/** Only raw fields owned by an installed helper form may use these slots. */
const textSlots=new Set(['details','demonstration','operation','exception','check','version','run','examples','versiontrial']);
const recordSlots=new Set(['steps','record','checks','correction','run','typedsteps','stagedsteps','typedrecord','typedcase','typedreason','typedversion','typedrun','typedexpectation','typedbatch']);
const tableSlots=new Set(['candidate','context','recording','cases','correction','run']);
export function helperDraftMode(slot:string):'text'|'semantic'|'table'|undefined{
 const match=/^helper:(text|semantic|table):([a-z]+)$/.exec(slot);if(!match)return undefined;
 if(match[1]==='text'&&textSlots.has(match[2]))return 'text';
 if(match[1]==='semantic'&&recordSlots.has(match[2]))return 'semantic';
 if(match[1]==='table'&&tableSlots.has(match[2]))return 'table';
 return undefined;
}
export const isHelperDraftSlot=(slot:string)=>slot.startsWith('helper:');
