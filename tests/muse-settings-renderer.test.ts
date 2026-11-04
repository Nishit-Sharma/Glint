import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {MuseConnectionSettings} from '../src/renderer/src/components/MuseConnectionSettings';
import {MUSE_PROFILES,MUSE_CONNECTION_MESSAGES} from '../src/shared/muse-connection';
import {publicErrorMessage} from '../src/shared/public-messages';
import type {Command,ConnectionStatus} from '../src/shared/bridge';
import type {Run} from '../src/renderer/src/ui';

afterEach(()=>vi.unstubAllGlobals());
function connection(profile:'meta-direct'|'baseten-hackathon'):ConnectionStatus{return {provider:'Meta',metaProfile:profile,configured:true,verified:false,state:'ready',...MUSE_PROFILES[profile],detail:'Configured; live access unverified.',specialized:{sam:'Not connected.',computer:'Not enabled.'}};}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

it('recovers profile changes during a pending test, cancels its exact identity and ignores the stale result',async()=>{
 const calls:Command[]=[],refresh=vi.fn(async()=>{});let resolve!:(value:unknown)=>void;
 vi.stubGlobal('window',{companion:{invoke:async(command:Command)=>{calls.push(command);if(command.type==='muse.test')return new Promise(done=>resolve=done);return null;}}});
 let selected=connection('meta-direct');const run:Run=async()=>undefined;
 const r=createControlledRenderer(()=>createElement(MuseConnectionSettings,{connection:selected,busy:false,run,onRefresh:refresh}));
 const text=(node:ReturnType<typeof r.find>):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
 const button=(label:string)=>r.find(node=>node.type==='button'&&text(node)===label);
 r.render();button('Test connection').props.onClick();r.render();expect(button('Test connection').props.disabled).toBe(true);expect(button('Stop test')).toBeDefined();
 const original=calls[0];expect(original).toMatchObject({type:'muse.test',profile:'meta-direct'});
 selected=connection('baseten-hackathon');r.render();await settle();r.render();expect(button('Test connection').props.disabled).toBe(false);expect(calls[1]).toEqual({type:'muse.test.cancel',id:(original as {id:string}).id});expect(r.nodes().some(node=>node.type==='button'&&text(node)==='Stop test')).toBe(false);
 resolve({kind:'passed',detail:'STALE_SUCCESS'});await settle();r.render();expect(r.nodes().map(text).join(' ')).not.toContain('STALE_SUCCESS');expect(refresh).toHaveBeenCalledOnce();expect(r.find(node=>node.props.role==='status')).toBeDefined();
});

it('surfaces safe recovery messages through repeated IPC formatting without disclosing arbitrary appended detail',()=>{
 for(const message of Object.values(MUSE_CONNECTION_MESSAGES)){
  expect(publicErrorMessage(message)).toBe(message);
  expect(publicErrorMessage(`Error invoking remote method 'companion:command': Error: ${message}`)).toBe(message);
  expect(publicErrorMessage(message+' PRIVATE_SECRET')).not.toContain('PRIVATE_SECRET');
 }
});
