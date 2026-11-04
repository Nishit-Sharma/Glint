/** Lowest Chromium build with the fixes missing from Playwright's bundled 156.0.8078.4. */
export const MINIMUM_PATCHED_CHROMIUM='156.0.8078.73';
export type BrowserEngine={name:string;chromiumVersion:string;contentBlocker?:boolean};
export type BrowserControlStatus={id:string;mode:'opening'|'agent'|'pausing'|'user'|'ended';browser?:BrowserEngine};
export type BrowserControlReply=BrowserControlStatus|{mode:'unavailable'};

export const BROWSER_MANUAL_CONTROL_LIMITS=[
 'The page may keep running or loading. Same-site GET/HEAD traffic can continue, including requests started or scheduled earlier. Pause cannot undo requests already sent.',
 'Manual same-site navigation and GET forms can change the website without another Glint approval. Unapproved POST/PUT/PATCH/DELETE, other sites, uploads and downloads remain blocked.',
 'Manual actions are not approvals or verified outcomes. Keep passwords and private data out. An AI request already sent may still finish or use allowance; its late result is discarded.',
 'Return reads the page again. Every new agent interaction still needs its own exact approval.',
] as const;
export type BrowserFound={name:string;version:string};
const qualifyingNames=['Google Chrome','Chrome for Testing','Chromium','Helium'];
/** Refusal when no installed browser qualifies. Names only a known product and a strictly formatted version. */
export function browserPatchedUnavailableMessage(found?:BrowserFound):string{
 const seen=found&&qualifyingNames.includes(found.name)&&/^\d{1,6}(?:\.\d{1,6}){3}$/.test(found.version)?`It found ${found.name} ${found.version}, which is too old.`:'It found none of them.';
 return `Glint opens websites only in Google Chrome, Chrome for Testing, Chromium or Helium built on Chromium ${MINIMUM_PATCHED_CHROMIUM} or later. ${seen} It looked in /Applications and ~/Applications. Install or update one of these browsers, then try again. Your task is kept.`;
}
export function isBrowserPatchedUnavailable(text:string):boolean{
 const found=/ It found (Google Chrome|Chrome for Testing|Chromium|Helium) (\d{1,6}(?:\.\d{1,6}){3}), which is too old\. /.exec(text);
 return text===browserPatchedUnavailableMessage(found?{name:found[1],version:found[2]}:undefined);
}
export const browserEngineLabel=(browser:BrowserEngine)=>`${browser.name} · Chromium ${browser.chromiumVersion}`+(browser.contentBlocker?`. ${browser.name}’s built-in content blocker is on and may hide or block parts of pages.`:'');
