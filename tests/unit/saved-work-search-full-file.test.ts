import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {decodeHTMLAttribute} from 'entities';
import type {Task} from '../../src/core/types';
import {searchSavedWork} from '../../src/shared/saved-work-search';
import {ReadableText} from '../../src/renderer/src/components/ReadableText';
import {readFile} from 'node:fs/promises';
const fixture=(content:string):Task=>({id:'owner',title:'Orchard',goal:'',status:'active',createdAt:'time',updatedAt:'time',sources:[],artifacts:[{id:'notes',revisions:[{revision:1,digest:'saved-digest',title:'Notes',content,mimeType:'text/markdown',sourceRefs:[],createdAt:'time'}]}],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
test.each(['`Formatted` diagram','**Formatted** diagram','*Formatted* diagram'])('formatted label %s cannot expose a destination through a bounded prefix',label=>{
 const content=`![${label}](data:image/svg+xml,%3Csvg%3E`+'('.repeat(20)+'formatted-image-payload'+'x'.repeat(120_000)+')'.repeat(20)+'%3C/svg%3E)',html=renderToStaticMarkup(createElement(ReadableText,{text:content}));expect(html).not.toContain('formatted-image-payload');const result=searchSavedWork([fixture(content)],'formatted-image-payload','files');expect(result.matches).toEqual([]);expect(result).toMatchObject({searched:0,partial:0,unsearchedFiles:1});
});
test.each([',','&#44;','&comma;'])('HTML srcset separator %s uses the complete attribute entity parser',separator=>{
 const value=`https://owned.example/a.png 1x${separator} data:image/png;base64,list-image-payload 2x`;expect(decodeHTMLAttribute(value)).toContain('1x, data:image/');const task=fixture(`<img alt="Orchard diagram" srcset="${value}">`),result=searchSavedWork([task],'list-image-payload','files');expect(result.matches).toEqual([]);expect(searchSavedWork([task],'Orchard diagram','files').matchCount).toBe(1);
});
test('files are searched whole or explicitly unsearched, including code and plain-text files',()=>{
 for(const [content,mimeType] of [['needle '+'x'.repeat(100_000),'text/plain'],['~~~\nneedle\n'+'x'.repeat(100_000)+'\n~~~','text/markdown']] as const){const task=fixture(content);task.artifacts[0].revisions[0].mimeType=mimeType;expect(searchSavedWork([task],'needle','files')).toMatchObject({matchCount:0,searched:0,partial:0,unsearchedFiles:1});}
 const task=fixture('~~~\n<img srcset="data:image/png;base64,visible-literal-code">\n~~~\nOrdinary prose.');expect(searchSavedWork([task],'visible-literal-code','files').matchCount).toBe(1);expect(searchSavedWork([task],'Ordinary prose','files').matchCount).toBe(1);
});
test('a file that does not fit the remaining budget is skipped whole while a later small file can still fit',()=>{
 const tasks=Array.from({length:22},(_,index)=>{const task=fixture(index===21?'small-file-needle':'x'.repeat(99_950));task.id=String(index).padStart(2,'0');task.title='Task '+task.id;return task;});
 const result=searchSavedWork(tasks,'small-file-needle','files');expect(result.matches.map(match=>match.taskId)).toEqual(['21']);expect(result).toMatchObject({searched:21,partial:0,unsearchedFiles:1});
});
test('complete formatted image labels preserve authored text while their destination is omitted',()=>{
 for(const label of ['`Formatted` diagram','**Formatted** diagram','Literal `]` diagram']){
  const content=`Before ![${label}](data:image/svg+xml,%3Csvg%3Ecomplete-formatted-payload%3C/svg%3E) after.`,task=fixture(content);expect(renderToStaticMarkup(createElement(ReadableText,{text:content}))).not.toContain('complete-formatted-payload');expect(searchSavedWork([task],'complete-formatted-payload','files').matches).toEqual([]);expect(searchSavedWork([task],'diagram','files')).toMatchObject({matchCount:1,searched:1,unsearchedFiles:0});
 }
});
test('the existing entity parser is pinned directly and its required BSD notice is distributed',async()=>{
 const app=JSON.parse(await readFile('package.json','utf8')),lock=JSON.parse(await readFile('package-lock.json','utf8')),installed=JSON.parse(await readFile('node_modules/entities/package.json','utf8'));expect(app.dependencies.entities).toBe('6.0.1');expect(lock.packages[''].dependencies.entities).toBe('6.0.1');expect(lock.packages['node_modules/entities'].version).toBe('6.0.1');expect(installed.version).toBe('6.0.1');expect(installed.license).toBe('BSD-2-Clause');expect(await readFile('src/renderer/public/licenses/ENTITIES-BSD-2-CLAUSE.txt','utf8')).toBe(await readFile('node_modules/entities/LICENSE','utf8'));
});
test('the complete-file bound includes the name and admits the exact boundary only',()=>{
 const task=fixture('needle'+'x'.repeat(99_989));expect(task.artifacts[0].revisions[0].title.length+task.artifacts[0].revisions[0].content.length).toBe(100_000);expect(searchSavedWork([task],'needle','files')).toMatchObject({matchCount:1,searched:1,partial:0,unsearchedFiles:0});task.artifacts[0].revisions[0].content+='x';expect(searchSavedWork([task],'needle','files')).toMatchObject({matchCount:0,searched:0,partial:0,unsearchedFiles:1});
});
