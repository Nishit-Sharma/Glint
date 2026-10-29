import {expect,test} from 'vitest';
import {mkdtemp,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {evictHostFixture} from './host-fixture-module-cache';

test('evicts the real CJS cache entry when the owned fixture path passes through a symlink',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'host-fixture-cache-'));
 try{
  const real=join(directory,'real'),alias=join(directory,'alias');await mkdir(real);await symlink(real,alias,'dir');
  const outfile=join(alias,'fixture.cjs');await writeFile(outfile,'module.exports = 1;\n');
  const loadHost=createRequire(pathToFileURL(outfile)),resolved=loadHost.resolve(outfile);
  expect(resolved).not.toBe(outfile);expect(loadHost(outfile)).toBe(1);expect(loadHost.cache[resolved]).toBeDefined();
  evictHostFixture(loadHost,outfile);expect(loadHost.cache[resolved]).toBeUndefined();
  await writeFile(outfile,'module.exports = 2;\n');expect(loadHost(outfile)).toBe(2);evictHostFixture(loadHost,outfile);
 }finally{await rm(directory,{recursive:true,force:true});}
});
