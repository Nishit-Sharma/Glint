import {accessSync,constants} from 'node:fs';
import {chromium} from 'playwright-core';
import {LOOPBACK_TEST_ENGINE,LOOPBACK_TEST_LOCK} from '../../src/host/browser/patched-chromium';

export const LOOPBACK_FIXTURE_EXECUTABLE='/fixture/Loopback Chromium.app/Contents/MacOS/Loopback Chromium';
export const LOOPBACK_FIXTURE_ARGS=[...LOOPBACK_TEST_LOCK];
export const HELIUM_EXECUTABLE='/Applications/Helium.app/Contents/MacOS/Helium';

/**
 * Test-only: suites that browse synthetic pages they serve on 127.0.0.1 (or inert mocks) use Playwright's own engine,
 * or Helium when GLINT_LOOPBACK_ENGINE=helium. Either is launched with a dead proxy and host-resolver rules so only
 * loopback is reachable, with a fresh temporary profile. Production cannot select this seam: Electron ignores it
 * (see patched-chromium.test.ts).
 */
export function installLoopbackTestEngine():void{
 let engine:{executablePath:string;name?:string;contentBlocker?:true};
 // A mocked playwright-core has no executablePath(); its launch never starts a process, so the engine choice is moot.
 if(typeof chromium.executablePath!=='function')engine={executablePath:LOOPBACK_FIXTURE_EXECUTABLE};
 else if(process.env.GLINT_LOOPBACK_ENGINE==='helium'){accessSync(HELIUM_EXECUTABLE,constants.X_OK);engine={executablePath:HELIUM_EXECUTABLE,name:'Helium',contentBlocker:true};}
 else engine={executablePath:chromium.executablePath()};
 (globalThis as Record<symbol,unknown>)[LOOPBACK_TEST_ENGINE]=engine;
}
