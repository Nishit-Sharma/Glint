export const MUSE_PROFILES = {
  'meta-direct': {label:'Meta Model API · Muse Spark',endpoint:'https://api.meta.ai/v1',model:'muse-spark-1.3',destination:'Meta (api.meta.ai)'},
  'baseten-hackathon': {label:'Baseten hackathon · Muse Spark Open',endpoint:'https://inference.baseten.co/v1',model:'meta-models/muse-spark-open-1026',destination:'Baseten (inference.baseten.co)'},
} as const;
export type MuseProfile = keyof typeof MUSE_PROFILES;
export const MUSE_TEST_PROMPT='Reply with exactly: GLINT_CONNECTION_OK';
export const MUSE_TEST_REPLY='GLINT_CONNECTION_OK';
export function readMuseProfile(value:unknown):MuseProfile {
  if(value!=='meta-direct'&&value!=='baseten-hackathon')throw Error('Choose a supported Muse connection profile. Nothing was sent.');
  return value;
}
export type MuseConnectionCommand = {type:'muse.profile';profile:MuseProfile}
  | {type:'muse.test';id:string;profile:MuseProfile}
  | {type:'muse.test.cancel';id:string};
export function readMuseConnectionCommand(value:unknown):MuseConnectionCommand {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid Muse connection command.');
  const v=value as Record<string,unknown>,keys=v.type==='muse.profile'?['type','profile']:v.type==='muse.test'?['type','id','profile']:v.type==='muse.test.cancel'?['type','id']:[];
  if(!keys.length||Object.keys(v).some(key=>!keys.includes(key)))throw Error('Invalid Muse connection command.');
  if(v.type!=='muse.test.cancel')readMuseProfile(v.profile);
  if(v.type!=='muse.profile'&&(typeof v.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(v.id)))throw Error('Invalid Muse test identity.');
  return v as MuseConnectionCommand;
}
export type MuseConnectionTestResult = {kind:'passed'|'cancelled';detail:string};

export const MUSE_CONNECTION_MESSAGES={
  profile:'Muse connection settings could not be read. Choose a supported profile in Settings. Nothing was sent.',
  missingKey:'Configure a key for this Muse profile before testing. Nothing was sent.',
  changing:'A connection change is already pending. Wait for it to finish before changing connection settings.',
  pending:'A Muse connection test is already pending. Stop it or wait for completion.',
  mismatch:'The service returned text, but the synthetic connection test reply did not match. Review access before trying again.',
  keychainWaiting:'Waiting for macOS Keychain… Approve the Keychain prompt for Glint, or Stop to cancel. Nothing has been sent.',
  keychainCancelled:'Stopped waiting for macOS Keychain. Nothing was saved or sent.',
  keychainUnavailable:'Glint couldn\'t unlock the saved Muse key. Approve Glint in the macOS Keychain prompt, or reconnect the key in Settings. Nothing was sent.',
} as const;
