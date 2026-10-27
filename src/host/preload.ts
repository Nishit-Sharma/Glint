import { contextBridge, ipcRenderer } from 'electron'
import type { CompanionBridge, CompanionEvent, Command } from '../shared/bridge'
import {isExportCommand,readExportReply,type ExportCommand,type ExportReply,type OtherCommand} from '../shared/export-contract'
function invoke<C extends ExportCommand>(command:C):Promise<ExportReply<C>>;
function invoke<T=unknown>(command:OtherCommand):Promise<T>;
async function invoke(command:Command):Promise<unknown>{
  const result:unknown=await ipcRenderer.invoke('companion:command',command).catch(error=>{throw new Error(String(error?.message||'The action could not be completed.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,''))});
  return isExportCommand(command)?readExportReply(command,result):result;
}
const bridge:CompanionBridge = {
  invoke,
  subscribe: (listener) => {
    const handler = (_event:Electron.IpcRendererEvent,value:CompanionEvent) => listener(value)
    ipcRenderer.on('companion:event',handler)
    return () => { ipcRenderer.removeListener('companion:event',handler) }
  }
}
contextBridge.exposeInMainWorld('companion',bridge)
