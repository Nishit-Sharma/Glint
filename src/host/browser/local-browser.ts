import { createHash, randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from 'playwright-core';
import { Schema } from 'effect';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const Intent = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('click'), snapshotId: Schema.String, targetId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('fill'), snapshotId: Schema.String, targetId: Schema.String, value: Schema.String }),
);
export type BrowserIntent = typeof Intent.Type;
export type BrowserSnapshot = { id: string; taskId: string; browserId: string; documentId: string; url: string; title: string; text: string; digest: string; targets: { id: string; role: string; label: string; href?: string; value?: string }[] };
export type BrowserProposal = { id: string; intent: BrowserIntent; digest: string; status: 'proposed' | 'executing' | 'completed' | 'uncertain' | 'failed'; result?: BrowserSnapshot; error?: string };
export type WriteScope = { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; body: string };
export const ExpectedFormFields = Schema.Array(Schema.Struct({ targetId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)), value: Schema.String.pipe(Schema.maxLength(10_000)) })).pipe(Schema.maxItems(100));
export type ExpectedFormField = typeof ExpectedFormFields.Type[number];
export type FormValuesMismatch = { kind: 'form-values-mismatch'; browserId: string; snapshotId: string; expectedFields?: readonly ExpectedFormField[]; actualFields: readonly ExpectedFormField[] };
type BrowserReview = { target: BrowserSnapshot['targets'][number] } & ({ write?: undefined; formFields?: undefined } | { write: WriteScope; formFields: readonly ExpectedFormField[] });
export type BrowserWindowOwner = (processId:number)=>()=>void;
export class BrowserRedirectError extends Error{
  constructor(){super('Automatic page redirects are not supported in this browser yet. Open the final page address and try again.');this.name='BrowserRedirectError';}
}
type Target = { handle: ElementHandle<HTMLElement | SVGElement>; fingerprint: string };
type Grant = { token: string; write?: { method: string; url: string; digest: string }; used: boolean; receipt?: { status: number; url: string; body: string } };

/** Isolated browser only. The caller owns durable operations and trusted approval UI. */
export class LocalBrowser {
  readonly id = randomUUID();
  private documentId = randomUUID();
  private snapshot?: BrowserSnapshot;
  private targets = new Map<string, Target>();
  private proposals = new Map<string, BrowserProposal>();
  private grants = new Map<string, Grant>();
  private active?: Grant;
  private busy = false;
  private closed = false;
  private blocked = 0;
  private blockedRedirects = 0;
  private releaseStop = () => {};
  private releaseWindowOwner = () => {};
  private closing?:Promise<void>;
  private constructor(private readonly browser: Browser, private readonly context: BrowserContext, private readonly page: Page, readonly taskId: string, readonly origin: string) {
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) this.documentId = randomUUID(); });
    page.on('dialog', dialog => { void dialog.dismiss(); });
    page.on('popup', popup => { void popup.close(); });
    context.on('response', response => {
      const grant = this.active;
      if (grant?.used && grant.write && response.url() === grant.write.url && response.request().method() === grant.write.method) {
        // Preserve visible outcome evidence, not raw response HTML/hidden form tokens.
        grant.receipt = { status: response.status(), url: response.url(), body: '' };
      }
    });
  }
  static async open(options: { taskId: string; origin: string; url: string; headless?: boolean; signal?: AbortSignal; onWindowOwner?:BrowserWindowOwner }): Promise<LocalBrowser> {
    if (options.signal?.aborted) throw Error('Browser request was stopped before launch.');
    const origin = new URL(options.origin);
    if (!options.taskId || origin.origin !== options.origin || origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol) || (origin.protocol === 'http:' && origin.hostname !== '127.0.0.1')) throw Error('Use an exact authorized HTTPS origin, or the synthetic loopback site.');
    const initial=new URL(options.url);
    if(initial.username||initial.password)throw Error('The initial page address must not contain sign-in details.');
    if (initial.origin !== origin.origin) throw Error('Initial URL is outside the authorized origin.');
    const browser = await chromium.launch({ headless: options.headless ?? true, chromiumSandbox:true });
    let releaseOwner=()=>{};
    let releaseStop=()=>{};
    let opened:LocalBrowser|undefined;
    try {
      if (options.signal?.aborted) throw Error('Browser request was stopped before opening a page.');
      const stop = () => { void browser.close(); };
      options.signal?.addEventListener('abort', stop, { once: true });
      releaseStop=()=>options.signal?.removeEventListener('abort',stop);
      if(options.onWindowOwner){
        const connection=await browser.newBrowserCDPSession();
        try{
          const {processInfo}=await connection.send('SystemInfo.getProcessInfo');
          const roots=processInfo.filter(process=>process.type==='browser');
          if(roots.length!==1||!Number.isSafeInteger(roots[0].id)||roots[0].id<=0)throw Error('The owned browser process identity could not be established. No page was opened.');
          const release=options.onWindowOwner(roots[0].id);let active=true;
          releaseOwner=()=>{if(active){active=false;release();}};
        }finally{await connection.detach();}
      }
      // Pinned Chromium launch uses --no-startup-window. Register its exact
      // browser PID before newPage can create the first native window.
      if(options.signal?.aborted)throw Error('Browser request was stopped before opening a page.');
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, permissions: [] });
      const page = await context.newPage();
      const owner = new LocalBrowser(browser, context, page, options.taskId, origin.origin);
      opened=owner;
      owner.releaseStop = releaseStop;
      owner.releaseWindowOwner = releaseOwner;
      // This is a fresh non-persistent context. No user's cookies/profile/CDP endpoint is used.
      await context.route('**/*', async route => {
        const request = route.request();
        let allowed = false;
        try {
          const url = new URL(request.url());
          allowed = !owner.closed && !options.signal?.aborted && !url.username && !url.password && url.origin === owner.origin && ['http:', 'https:'].includes(url.protocol);
        } catch { /* rejected below */ }
        if (allowed && !['GET', 'HEAD'].includes(request.method())) {
          const grant = owner.active;
          allowed = Boolean(grant && !grant.used && grant.write && grant.write.method === request.method() && grant.write.url === request.url() && grant.write.digest === digest(request.postData() ?? ''));
          if (allowed && grant) grant.used = true;
        }
        if (!allowed) { owner.blocked++; await route.abort('blockedbyclient');return; }
        // Playwright does not route redirect hops, so Chromium must never receive one.
        try{
          const response=await route.fetch({maxRedirects:0,maxRetries:0,timeout:10_000,signal:options.signal});
          try{
            if([301,302,303,307,308].includes(response.status())){owner.blockedRedirects++;owner.blocked++;await route.abort('blockedbyclient');return;}
            if(owner.closed||options.signal?.aborted){
              owner.blocked++;await route.abort('blockedbyclient');return;
            }
            await route.fulfill({response});
          }finally{await response.dispose();}
        }catch{owner.blocked++;await route.abort('blockedbyclient').catch(()=>{});}
      });
      await context.routeWebSocket('**/*', socket => { owner.blocked++; socket.close(); });
      await context.addInitScript(() => {
        // WebRTC is not an authorized secondary network path in this browser.
        Object.defineProperty(window, 'RTCPeerConnection', { value: undefined, configurable: false });
        Object.defineProperty(window, 'webkitRTCPeerConnection', { value: undefined, configurable: false });
      });
      if (options.signal?.aborted) throw Error('Browser request was stopped before navigation.');
      await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
      return owner;
    } catch (error) { releaseStop();await browser.close();releaseOwner();if(opened?.blockedRedirects)throw new BrowserRedirectError();throw error; }
  }
  get diagnostics() { return { browserId: this.id, taskId: this.taskId, closed: this.closed, blockedRequests: this.blocked, blockedRedirects:this.blockedRedirects, profile: 'fresh-ephemeral' as const }; }
  proposal(id: string) { const value = this.proposals.get(id); return value ? structuredClone(value) : undefined; }
  async review(proposalId: string): Promise<BrowserReview> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'proposed') throw Error('Observe and propose a current target before reviewing it.');
    const target = await this.validateTarget(proposal.intent), descriptor = this.snapshot?.targets.find(target => target.id === proposal.intent.targetId);
    if (!descriptor) throw Error('Target is no longer available.');
    if (proposal.intent.kind === 'fill') return { target: structuredClone(descriptor) };
    const form = await target.handle.evaluate((element, observed) => {
      if (!(element instanceof HTMLButtonElement || element instanceof HTMLInputElement) || !element.form || !['submit', 'image'].includes(element.type)) return undefined;
      const owner = element.form, method = (element.hasAttribute('formmethod') ? element.formMethod : owner.method).toUpperCase();
      if (method === 'GET') return undefined;
      const encoding = element.hasAttribute('formenctype') ? element.formEnctype : owner.enctype;
      if (encoding !== 'application/x-www-form-urlencoded' || element.type === 'image') throw Error('This form type needs a dedicated reviewed adapter.');
      const fields: [string, string][] = [];
      for (const [key, value] of new FormData(owner, element).entries()) { if (typeof value !== 'string') throw Error('File uploads are not enabled.'); fields.push([key, value]); }
      const controls: {targetId:string;name:string}[] = [];
      for (const control of owner.elements) {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) || !control.name || control.matches(':disabled')) continue;
        if (control instanceof HTMLInputElement && (['hidden','submit','button','reset','image'].includes(control.type) || ['checkbox','radio'].includes(control.type) && !control.checked)) continue;
        if (control instanceof HTMLInputElement && (['password','file'].includes(control.type) || /password|one-time-code|cc-/.test(control.autocomplete))) throw Error('This form contains sensitive fields that are not enabled for browser actions.');
        const current = observed.find(item => item.element === control);
        if (!current || control instanceof HTMLSelectElement && control.multiple) throw Error('This form contains fields that need a dedicated reviewed adapter.');
        controls.push({targetId:current.id,name:control.name});
      }
      const formFields=controls.map((control,index)=>{
        const named=controls.filter(field=>field.name===control.name),submitted=fields.filter(([name])=>name===control.name);
        if(named.length!==submitted.length)throw Error('This form changes its submitted fields and needs a dedicated reviewed adapter.');
        const position=controls.slice(0,index).filter(field=>field.name===control.name).length;
        return {targetId:control.targetId,value:submitted[position][1]};
      });
      return { method, url: element.hasAttribute('formaction') ? element.formAction : owner.action, body: new URLSearchParams(fields).toString(), formFields };
    }, [...this.targets].map(([id, target]) => ({id, element:target.handle})));
    if (!form) return { target: structuredClone(descriptor) };
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(form.method)) throw Error('This form method is not supported.');
    const method = Schema.decodeUnknownSync(Schema.Literal('POST', 'PUT', 'PATCH', 'DELETE'))(form.method);
    if (new URL(form.url).origin !== this.origin) throw Error('The form targets another website. Authorize that site separately.');
    const {formFields,...write}=form;
    return { target: structuredClone(descriptor), write: { ...write, method }, formFields };
  }
  private assertOpen() { if (this.closed || this.page.isClosed()) throw Error('This browser binding is closed. Open and approve a fresh binding.'); }
  private async read() {
    this.assertOpen();
    const documentId = this.documentId;
    const state = await this.page.evaluate(() => ({ text: document.body?.innerText ?? '', title: document.title, url: location.href }));
    if (documentId !== this.documentId) throw Error('The document changed during observation. Observe it again.');
    if (new URL(state.url).origin !== this.origin) throw Error('Browser left its authorized origin.');
    if (state.text.length > 100_000) throw Error('This page exceeds the observation limit; choose a narrower page.');
    return { ...state, digest: digest(JSON.stringify({ ...state, documentId })) };
  }
  private fingerprint(handle: ElementHandle<HTMLElement | SVGElement>) {
    return handle.evaluate(element => {
      const control = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      return JSON.stringify({ tag: element.tagName, name: element.getAttribute('name'), type: element.getAttribute('type'), role: element.getAttribute('role'), label: element.getAttribute('aria-label'), text: element.textContent, href: element.getAttribute('href'), value: control ? element.value : null, disabled: element.getAttribute('disabled'), connected: element.isConnected });
    });
  }
  async observe(): Promise<BrowserSnapshot> {
    if (this.busy) throw Error('Wait for the current browser operation.');
    const state = await this.read();
    for (const target of this.targets.values()) await target.handle.dispose();
    this.targets.clear(); this.grants.clear();
    const snapshot: BrowserSnapshot = { ...state, id: randomUUID(), taskId: this.taskId, browserId: this.id, documentId: this.documentId, targets: [] };
    const controls = this.page.locator('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"]');
    const count = await controls.count();
    if (count > 100) throw Error('Too many page controls; choose a narrower page.');
    for (let index = 0; index < count; index++) {
      const locator = controls.nth(index);
      if (!(await locator.isVisible())) continue;
      const handle = await locator.elementHandle();
      if (!handle) continue;
      const captured = await handle.evaluate(element => {
        const input = element instanceof HTMLInputElement;
        const labels = input || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? Array.from(element.labels ?? []).map(label => label.textContent ?? '').join(' ') : '';
        const role = element.getAttribute('role') ?? (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' ? 'button' : input ? element.type : element.tagName.toLowerCase());
        const control = input || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
        const sensitive = input && (['password', 'file', 'hidden'].includes(element.type) || /password|one-time-code|cc-/.test(element.autocomplete));
        return { sensitive, info: { role, label: (element.getAttribute('aria-label') ?? (labels || element.textContent || '')).trim().slice(0, 500), href: element instanceof HTMLAnchorElement ? element.href : undefined, value: control && !sensitive ? element.value.slice(0, 10_000) : undefined }, fingerprint: JSON.stringify({ tag: element.tagName, name: element.getAttribute('name'), type: element.getAttribute('type'), role: element.getAttribute('role'), label: element.getAttribute('aria-label'), text: element.textContent, href: element.getAttribute('href'), value: control && !sensitive ? element.value : null, disabled: element.getAttribute('disabled'), connected: element.isConnected }) };
      });
      const info = captured.info;
      // Password/file/hidden controls are never exposed as tools or observations.
      if (captured.sensitive || ['password', 'file', 'hidden'].includes(info.role)) { await handle.dispose(); continue; }
      const id = randomUUID();
      this.targets.set(id, { handle, fingerprint: captured.fingerprint });
      snapshot.targets.push({ id, ...info });
    }
    if ((await this.read()).digest !== state.digest) throw Error('The page changed while its controls were measured. Observe it again.');
    this.snapshot = snapshot;
    return structuredClone(snapshot);
  }
  async propose(value: unknown): Promise<BrowserProposal> {
    const intent = Schema.decodeUnknownSync(Intent, { onExcessProperty: 'error' })(value);
    if (intent.kind === 'fill' && intent.value.length > 10_000) throw Error('Input exceeds the allowed length.');
    await this.validateTarget(intent);
    const proposal: BrowserProposal = { id: randomUUID(), intent, digest: digest(JSON.stringify({ taskId: this.taskId, browserId: this.id, documentId: this.documentId, intent })), status: 'proposed' };
    this.proposals.set(proposal.id, proposal); return structuredClone(proposal);
  }
  private async validateTarget(intent: BrowserIntent) {
    this.assertOpen();
    if (this.busy || !this.snapshot || this.snapshot.id !== intent.snapshotId || this.snapshot.browserId !== this.id || this.snapshot.documentId !== this.documentId || (await this.read()).digest !== this.snapshot.digest) throw Error('The page changed. Observe it again before proposing an action.');
    const target = this.targets.get(intent.targetId);
    if (!target || await this.fingerprint(target.handle) !== target.fingerprint || !(await target.handle.isVisible())) throw Error('The target changed. Observe it again before proposing an action.');
    return target;
  }
  /** Trusted host only: never wire this method to a model-generated approval. */
  approve(proposalId: string, write?: WriteScope): string {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'proposed') throw Error('Proposal is missing or already executed.');
    if (write && (new URL(write.url).origin !== this.origin || new URL(write.url).username || new URL(write.url).password || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(write.method) || write.body.length > 100_000)) throw Error('Write scope is outside this browser authority.');
    const token = randomUUID(); this.grants.set(proposalId, { token, used: false, ...(write ? { write: { method: write.method, url: write.url, digest: digest(write.body) } } : {}) }); return token;
  }
  async execute(proposalId: string, token: string): Promise<{ proposal: BrowserProposal; receipt?: Grant['receipt'] }> {
    const proposal = this.proposals.get(proposalId), grant = this.grants.get(proposalId);
    if (!proposal || proposal.status !== 'proposed') throw Error('Proposal is missing or already executed.');
    if (!grant || grant.token !== token) throw Error('Approval is required for this exact proposal.');
    this.grants.delete(proposalId);
    const target = await this.validateTarget(proposal.intent);
    proposal.status = 'executing'; this.busy = true; this.active = grant;
    const redirectsBefore=this.blockedRedirects;
    try {
      if (proposal.intent.kind === 'fill') await target.handle.fill(proposal.intent.value, { timeout: 5_000 });
      else await target.handle.click({ timeout: 5_000 });
      if (grant.write) {
        for (let count = 0; count < 100 && !grant.receipt; count++) await new Promise(resolve => setTimeout(resolve, 20));
        if (!grant.receipt || grant.receipt.status >= 400) throw Error('The requested write has no successful receipt. Inspect its outcome before another attempt.');
      }
      this.busy = false;
      proposal.result = await this.observe();
      if (grant.receipt) grant.receipt.body = proposal.result.text.slice(0, 20_000);
      proposal.status = 'completed';
    } catch (error) {
      const failure=this.blockedRedirects>redirectsBefore?new BrowserRedirectError():error;
      proposal.status = grant.used ? 'uncertain' : 'failed'; proposal.error = failure instanceof Error ? failure.message : 'Browser operation failed.';
      throw failure;
    } finally { this.busy = false; this.active = undefined; }
    return { proposal: structuredClone(proposal), ...(grant.receipt ? { receipt: structuredClone(grant.receipt) } : {}) };
  }
  close() {
    if(this.closing)return this.closing;
    this.closed=true;this.releaseStop();this.grants.clear();
    this.closing=(async()=>{await this.context.close().catch(()=>{});await this.browser.close();this.releaseWindowOwner();})();
    return this.closing;
  }
}
