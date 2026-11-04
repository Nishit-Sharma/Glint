import {expect,test} from 'vitest';
import {readFileSync,statSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileMatcher} from 'app-builder-lib/out/fileMatcher.js';

test('package files retain runtime outputs and exclude unrelated build leftovers',()=>{
 const packagePath=fileURLToPath(new URL('../../package.json',import.meta.url)),root=dirname(packagePath);
 const config=JSON.parse(readFileSync(packagePath,'utf8'));
 const filter=new FileMatcher(root,root,value=>value,config.build.files).createFilter();
 const file=statSync(packagePath),directory=statSync(root);
 const required=['package.json','out/main/index.js','out/main/chunks/worker.js','out/preload/index.cjs','out/preload/credentials.cjs','out/renderer/index.html','out/renderer/assets/app.js','out/renderer/licenses/MIT.txt','out/native/document-source','out/native/mac-window-at-point'];
 for(const path of required){
  expect(filter(resolve(root,path),file),path).toBe(true);
  for(let parent=dirname(path);parent!=='..';parent=dirname(parent))expect(filter(resolve(root,parent),directory),parent).toBe(true);
 }
 for(const path of ['out/fixtures/retired-test-bundle.js','out/unrelated-debug.json','out/native/retired-helper','src/host/index.ts','evidence/frame.png','.runtime/tasks.json'])expect(filter(resolve(root,path),file),path).toBe(false);
});
