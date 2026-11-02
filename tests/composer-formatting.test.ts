import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {readComposerDraft} from '../src/core/composer-draft';
import {composerDomText,formatComposerSelection} from '../src/renderer/src/composer-formatting';
test('formats real arbitrary selected composer lines without changing Unicode, CRLF or unrelated text, then persists through the existing draft CAS and restart',async()=>{
 const text='prefix\r\nAlpha 👩🏽‍🚀\r\nBeta 日本語\r\nsuffix',dom=composerDomText(text),start=dom.indexOf('Alpha'),end=dom.indexOf('\nsuffix'),bullets=formatComposerSelection(text,start,end,'bullet');
 expect(bullets.text).toBe('prefix\r\n- Alpha 👩🏽‍🚀\r\n- Beta 日本語\r\nsuffix');expect(composerDomText(bullets.text).slice(bullets.start,bullets.end)).toBe('- Alpha 👩🏽‍🚀\n- Beta 日本語');
 const numbered=formatComposerSelection(bullets.text,bullets.start,bullets.end,'numbered');expect(numbered.text).toBe('prefix\r\n1. Alpha 👩🏽‍🚀\r\n2. Beta 日本語\r\nsuffix');
 const nested=formatComposerSelection(numbered.text,numbered.start,numbered.end,'indent');expect(nested.text).toBe('prefix\r\n  1. Alpha 👩🏽‍🚀\r\n  2. Beta 日本語\r\nsuffix');
 expect(formatComposerSelection(nested.text,nested.start,nested.end,'outdent').text).toBe(numbered.text);
 const quote=formatComposerSelection(text,start,end,'quote');expect(quote.text).toBe('prefix\r\n> Alpha 👩🏽‍🚀\r\n> Beta 日本語\r\nsuffix');expect(formatComposerSelection('before SELECT after',7,13,'quote').text).toBe('before > SELECT after');
 expect(formatComposerSelection('a\nb\n',0,2,'bullet').text).toBe('- a\nb\n');expect(formatComposerSelection('x',0,0,'quote').text).toBe('x');expect(()=>formatComposerSelection('😀',1,2,'quote')).toThrow('complete character');
 const separators='A\u2028B\nC\u2029D';expect(formatComposerSelection(separators,0,separators.length,'bullet').text).toBe('- A\u2028B\n- C\u2029D');expect(formatComposerSelection(separators,0,separators.length,'numbered').text).toBe('1. A\u2028B\n2. C\u2029D');
 const directory=await mkdtemp(join(tmpdir(),'glint-composer-format-'));let core=await createCompanion({dataDir:directory});
 try{const owner=await core.createTask({title:'Owned formatted unsent draft'}),other=await core.createTask({title:'Other owner'});await core.saveComposerDraft(other.id,0,{text:'OTHER untouched',kind:'procedure'});await core.saveComposerDraft(owner.id,0,{text:quote.text,kind:'create'});const before=await core.getTask(owner.id),unrelated=await core.getTask(other.id);await core.close();core=await createCompanion({dataDir:directory});expect(readComposerDraft((await core.getTask(owner.id)).session)).toEqual({text:quote.text,kind:'create',revision:1});expect((await core.getTask(owner.id)).requests).toEqual(before.requests);expect(await core.getTask(other.id)).toMatchObject({id:unrelated.id,title:unrelated.title,artifacts:unrelated.artifacts,sources:unrelated.sources,requests:unrelated.requests});expect(readComposerDraft((await core.getTask(other.id)).session)).toEqual({text:'OTHER untouched',kind:'procedure',revision:1});}finally{await core.close();await rm(directory,{recursive:true,force:true});}
});
