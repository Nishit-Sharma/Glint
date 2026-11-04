import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {DEFAULT_CHARACTER} from '../../src/shared/character-catalog';
import {isCode} from '../../src/core/store';
/** Returning-user native regression profile. Fresh onboarding has its own native journey. No capture or transmission approval is seeded. */
export async function seedReturningProfile(directory:string){
 await mkdir(directory,{recursive:true});
 try{await writeFile(join(directory,'character-preferences.json'),JSON.stringify({schemaVersion:1,revision:0,profile:DEFAULT_CHARACTER}),{flag:'wx',mode:0o600});}
 catch(error){if(!isCode(error,'EEXIST'))throw error;}
}
