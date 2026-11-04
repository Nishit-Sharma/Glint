import {expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
const exec=promisify(execFile),helper=resolve('out/native/pdf-text'),fixture=resolve('tests/fixtures/visual-qa731.pdf');
it.runIf(process.platform==='darwin')('renders a chosen image-only PDF page as bounded PNG while preserving the existing empty text-layer result',async()=>{
 const text=JSON.parse((await exec(helper,[fixture])).stdout);expect(text).toMatchObject({kind:'text',text:'',pageCount:1,emptyPages:[1]});
 const page=JSON.parse((await exec(helper,['--page',fixture,'1'],{maxBuffer:12*1024*1024})).stdout);expect(page.kind).toBe('page');expect(page).toMatchObject({page:1,pageCount:1});expect(Math.max(page.width,page.height)).toBeLessThanOrEqual(1600);const png=Buffer.from(page.png,'base64');expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));expect(png.readUInt32BE(16)).toBe(page.width);expect(png.readUInt32BE(20)).toBe(page.height);
});
