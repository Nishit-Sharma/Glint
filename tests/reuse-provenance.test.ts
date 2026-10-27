import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

it('keeps the pinned original T3 utility and redistributable MIT notice intact',async()=>{
 const root='src/renderer/src/vendor/t3code/',provenance=JSON.parse(await readFile(root+'PROVENANCE.json','utf8'));
 expect(provenance.commit).toBe('ea41701979c3cb110addeacd144923abe1ba07b2');
 for(const [name,entry] of Object.entries(provenance.files) as [string,{sha256:string}][]){const bytes=await readFile(root+name);expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sha256);}
 expect(await readFile('src/renderer/public/licenses/T3-CODE-MIT.txt','utf8')).toBe(await readFile(root+'LICENSE','utf8'));
});

it('pins the actual BSD comparison library and ships its required notice',async()=>{
 const pkg=JSON.parse(await readFile('node_modules/diff/package.json','utf8')),app=JSON.parse(await readFile('package.json','utf8'));
 expect(pkg.version).toBe('9.0.0');expect(pkg.license).toBe('BSD-3-Clause');expect(app.dependencies.diff).toBe('9.0.0');
 expect(await readFile('src/renderer/public/licenses/JSDIFF-BSD-3-CLAUSE.txt','utf8')).toBe(await readFile('node_modules/diff/LICENSE','utf8'));
});
