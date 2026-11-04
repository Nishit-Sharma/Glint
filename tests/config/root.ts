import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PlaywrightTestConfig} from '@playwright/test';

/** The repository root. These configs live in tests/config but were written for the root. */
export const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const abs=(p:unknown)=>typeof p==='string'&&!isAbsolute(p)?resolve(ROOT,p):p;

/** Playwright resolves paths from the config file's folder; resolve them from the repo root instead. */
export function rooted<T extends PlaywrightTestConfig>(config:T):T{
  const c:any={...config};
  c.testDir=abs(c.testDir??'.');
  c.outputDir=abs(c.outputDir??'test-results');
  if(c.snapshotDir)c.snapshotDir=abs(c.snapshotDir);
  if(Array.isArray(c.reporter))c.reporter=c.reporter.map((r:any)=>Array.isArray(r)&&r[1]?.outputFile?[r[0],{...r[1],outputFile:abs(r[1].outputFile)}]:r);
  const server=(w:any)=>({...w,cwd:abs(w.cwd??'.')});
  if(c.webServer)c.webServer=Array.isArray(c.webServer)?c.webServer.map(server):server(c.webServer);
  return c;
}
