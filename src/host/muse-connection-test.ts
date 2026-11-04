import type {MetaProvider} from './provider';
import {MUSE_CONNECTION_MESSAGES,MUSE_PROFILES,MUSE_TEST_PROMPT,MUSE_TEST_REPLY,type MuseProfile,type MuseConnectionTestResult} from '../shared/muse-connection';

export class MuseConnectionTest {
  private pending?:{id:string;controller:AbortController};
  constructor(private readonly provider:MetaProvider,private readonly approve:(detail:string)=>Promise<boolean>){}
  cancel(id?:string){if(this.pending&&(!id||this.pending.id===id))this.pending.controller.abort();}
  async run(id:string,profile:MuseProfile,assertCurrent:()=>void):Promise<MuseConnectionTestResult>{
    if(this.pending)throw Error(MUSE_CONNECTION_MESSAGES.pending);
    const controller=new AbortController(),pending={id,controller};this.pending=pending;
    const check=()=>{assertCurrent();if(controller.signal.aborted)throw Error('Muse connection test stopped. Remote completion and charges are unverified.');};
    try{
      check();const connection=await this.provider.status();check();
      if(connection.metaProfile!==profile||!connection.configured)throw Error(MUSE_CONNECTION_MESSAGES.missingKey);
      const account=await this.provider.accountScope(),preview=this.provider.connectionTestPreview();check();
      const approved=await this.approve(`Destination: ${MUSE_PROFILES[profile].destination}\nPOST ${preview.url}\nModel: ${connection.model}\n\nOne synthetic request, with the complete JSON body below. No task, source, image, history, project, memory, or account instructions are included. The Authorization header uses only the key already configured for this profile. No retries or redirects. This may use account allowance or incur provider charges. It does not authorize payment setup or a paid-plan change.\n\n${JSON.stringify(preview.body,null,2)}\n\nStopping aborts local transport; remote completion and charges may remain unverified.`);
      check();if(!approved)return {kind:'cancelled',detail:'Connection test was not approved. Nothing was sent.'};
      if(await this.provider.accountScope()!==account)throw Error('Connection changed before transmission. Nothing was sent.');check();
      const text=await this.provider.run({prompt:MUSE_TEST_PROMPT,sources:[],signal:controller.signal,expectedAccountScope:account,captureFence:{check:async()=>check(),assertCurrent:check}});check();
      if(text.trim()!==MUSE_TEST_REPLY){this.provider.reset();throw Error(MUSE_CONNECTION_MESSAGES.mismatch);}
      return {kind:'passed',detail:'The selected service returned the expected synthetic reply. This verifies this connection only; SAM and computer access remain unverified.'};
    }finally{if(this.pending===pending)this.pending=undefined;}
  }
}
