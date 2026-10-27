import {contextBridge,ipcRenderer} from 'electron'
contextBridge.exposeInMainWorld('connectionSetup', { save: (key:string, acknowledged:boolean) => ipcRenderer.invoke('credential:save',{key,acknowledged}).catch(error=>{throw new Error(String(error?.message||'The action could not be completed.').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,''))}) })
