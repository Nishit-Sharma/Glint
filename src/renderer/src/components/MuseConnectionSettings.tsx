import {useEffect,useRef,useState} from 'react';
import type {ConnectionStatus} from '../../../shared/bridge';
import {MUSE_PROFILES,readMuseProfile,type MuseProfile,type MuseConnectionTestResult} from '../../../shared/muse-connection';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field,type Run} from '../ui';

export function MuseConnectionSettings({connection,busy,run,onRefresh}:{connection:ConnectionStatus;busy:boolean;run:Run;onRefresh:()=>Promise<void>}){
  const [pending,setPending]=useState(false),[message,setMessage]=useState(''),testId=useRef<string|undefined>(undefined);
  useEffect(()=>{setMessage('');setPending(false);return()=>{const id=testId.current;testId.current=undefined;if(id)void window.companion.invoke({type:'muse.test.cancel',id}).catch(()=>{});};},[connection.metaProfile]);
  async function select(profile:MuseProfile){setMessage('');await run({type:'muse.profile',profile});await onRefresh();}
  async function test(){
    if(testId.current||!connection.metaProfile)return;
    const id=crypto.randomUUID();testId.current=id;setPending(true);setMessage('Check the test message in the window that opens.');
    try{const result=await window.companion.invoke<MuseConnectionTestResult>({type:'muse.test',id,profile:connection.metaProfile});if(testId.current===id)setMessage(result.detail);}
    catch(error){if(testId.current===id)setMessage(publicErrorMessage(error));}
    finally{if(testId.current===id){testId.current=undefined;setPending(false);}await onRefresh();}
  }
  async function stop(){const id=testId.current;if(!id)return;try{await window.companion.invoke({type:'muse.test.cancel',id});setMessage('Stopping the test. The AI service may still finish it and charge for it.');}catch(error){setMessage(publicErrorMessage(error));}}
  return <section aria-label="Muse connection profile">
    <Field label="Muse service"><select value={connection.metaProfile??''} disabled={busy||pending} onChange={event=>void select(readMuseProfile(event.target.value))}>
      {!connection.metaProfile&&<option value="">Choose a service</option>}
      {(Object.keys(MUSE_PROFILES) as MuseProfile[]).map(profile=><option value={profile} key={profile}>{MUSE_PROFILES[profile].label}</option>)}
    </select></Field>
    <p className="preference-explanation">{connection.endpoint} · {connection.model}</p>
    <p className="preference-explanation">{connection.detail}</p>
    <p className="preference-explanation">Each service uses its own API key. Test connection asks first, then sends a short test message with none of your tasks or files. It may count toward your plan or cost money with the AI service.</p>
    <div className="preference-row"><Button disabled={busy||pending||!connection.configured} onClick={()=>void test()}>Test connection</Button>{pending&&<Button onClick={()=>void stop()}>Stop test</Button>}</div>
    <p role="status" className="preference-explanation">{message}</p>
  </section>;
}
