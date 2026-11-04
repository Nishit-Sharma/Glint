import {expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

/** An old strict reader must refuse new provenance without rewriting the ledger. */
export async function expectPinnedReaderRefusal(directory:string,read:()=>Promise<unknown>){
 const before=await readFile(join(directory,'tasks.json'));
 expect(before.toString()).toContain('"contextSourceRefs"');
 await expect(read()).rejects.toThrow(/unreadable or incompatible/);
 expect(await readFile(join(directory,'tasks.json'))).toEqual(before);
}
