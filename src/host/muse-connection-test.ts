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
      const approved=await this.approve(`Destination: ${MUSE_PROFILES[profile].destination}\nPOST ${preview.url}\nModel: ${connection.model}\n\nOne short test message, shown in full below. None of your tasks, files, images, history, projects, memory or account instructions are included. It uses only the API key saved for this service. Glint will not retry or follow redirects. This may count toward your plan or cost money with the AI service. It does not set up payment or change your plan.\n\n${JSON.stringify(preview.body,null,2)}\n\nStopping the test here may not stop the AI service. It may still finish and charge for it.`);
      check();if(!approved)return {kind:'cancelled',detail:'Connection test was not approved. Nothing was sent.'};
      if(await this.provider.accountScope()!==account)throw Error('Connection changed before transmission. Nothing was sent.');check();
      const text=await this.provider.run({prompt:MUSE_TEST_PROMPT,sources:[],signal:controller.signal,expectedAccountScope:account,captureFence:{check:async()=>check(),assertCurrent:check}});check();
      if(text.trim()!==MUSE_TEST_REPLY){this.provider.reset();throw Error(MUSE_CONNECTION_MESSAGES.mismatch);}
      return {kind:'passed',detail:'The AI service replied as expected. This checks this connection only. SAM and computer access are not checked.'};
    }finally{if(this.pending===pending)this.pending=undefined;}
  }
}
