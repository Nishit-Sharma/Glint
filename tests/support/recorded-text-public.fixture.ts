import type {Page} from '@playwright/test';
import type {Command} from '../../src/shared/bridge';
import {inspectRecordedTextHelper,createRecordedTextHelper} from '../../src/core/recorded-text-helper-host';
import {textHelperEntry} from './text-helper-entry.fixture';

/** Reuse the established public App fixture; these two bridge routes call the actual local host functions. */
export async function recordedTextPublicEntry(page:Page){
 const entry=await textHelperEntry(page),invoke=entry.fixture.invoke.bind(entry.fixture);
 const accepted:Array<Awaited<ReturnType<typeof createRecordedTextHelper>>>=[];
 entry.fixture.invoke=async(command:Command)=>{
  if(command.type==='helper.recorded.inspect'){entry.fixture.commands.push(structuredClone(command));const {type,...input}=command;return inspectRecordedTextHelper(entry.fixture.core,input);}
  if(command.type==='helper.recorded.create'){entry.fixture.commands.push(structuredClone(command));const {type,...input}=command,result=await createRecordedTextHelper(entry.fixture.core,input);accepted.push(result);await entry.fixture.emit({type:'changed',taskId:command.taskId});return result;}
  return invoke(command);
 };
 return {...entry,accepted};
}
