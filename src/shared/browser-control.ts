export type BrowserControlStatus={id:string;mode:'opening'|'agent'|'pausing'|'user'|'ended'};
export type BrowserControlReply=BrowserControlStatus|{mode:'unavailable'};

export const BROWSER_MANUAL_CONTROL_LIMITS=[
 'The page may keep running or loading. Same-site GET/HEAD traffic can continue, including requests started or scheduled earlier. Pause cannot undo requests already sent.',
 'Manual same-site navigation and GET forms can change the website without another Glint approval. Unapproved POST/PUT/PATCH/DELETE, other sites, uploads and downloads remain blocked.',
 'Manual actions are not approvals or verified outcomes. Keep passwords and private data out. An AI request already sent may still finish or use allowance; its late result is discarded.',
 'Return reads the page again. Every new agent interaction still needs its own exact approval.',
] as const;
