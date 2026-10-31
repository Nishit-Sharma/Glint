import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
if(process.platform==='darwin'){
 const output=resolve('out/native');mkdirSync(output,{recursive:true});
 const cache=mkdtempSync(join(tmpdir(),'document-source-build-'));
 try{for(const helper of ['document-source','mac-window-at-point','pdf-text'])execFileSync('/usr/bin/xcrun',['swiftc','-O','-module-cache-path',cache,resolve('native/'+helper+'.swift'),'-o',join(output,helper)],{stdio:'inherit',timeout:60000});}
 finally{rmSync(cache,{recursive:true,force:true});}
}
