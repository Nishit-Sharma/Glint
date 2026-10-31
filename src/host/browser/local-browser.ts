import { createHash, randomUUID } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type ElementHandle, type Page } from 'playwright-core';
import { Schema } from 'effect';
import { BROWSER_LAUNCH_UNAVAILABLE,BROWSER_PAGE_OPEN_FAILED,BROWSER_CLEANUP_UNCONFIRMED } from '../../shared/public-messages';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const Intent = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('click'), snapshotId: Schema.String, targetId: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('fill'), snapshotId: Schema.String, targetId: Schema.String, value: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('select'), snapshotId: Schema.String, targetId: Schema.String, value: Schema.String.pipe(Schema.maxLength(10_000)) }),
);
export type BrowserIntent = typeof Intent.Type;
export type BrowserSnapshot = { id: string; taskId: string; browserId: string; documentId: string; url: string; title: string; text: string; digest: string; targets: { id: string; role: string; label: string; href?: string; value?: string; options?: {value:string;label:string;disabled:boolean}[] }[] };
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
/** Trusted current-observation check only; never classify from website/model text. */
export class BrowserObservationChangedError extends Error {
  constructor(part:'page'|'target') { super(part==='page'?'The page changed. Observe it again before proposing an action.':'The target changed. Observe it again before proposing an action.');this.name='BrowserObservationChangedError'; }
}
type Target = { handle: ElementHandle<HTMLElement | SVGElement>; fingerprint: string; label:string };
type Grant = { token: string; write?: { method: string; url: string; digest: string }; used: boolean; receipt?: { status: number; url: string; body: string } };

/** Serialized into the page; read only, with no DOM clones or mutations. */
export function browserPageState(target?:Element|void){
  const roots:Array<Document|ShadowRoot>=[document];
  for(const root of roots){
    if(root!==document&&root.querySelector('select'))throw Error('Choice lists in open shadow roots cannot be observed safely yet. Choose another page.');
    for(const element of Array.from(root.querySelectorAll('*')))if(element.shadowRoot)roots.push(element.shadowRoot);
  }
  const rendered=(element:Element)=>{
    if(!element.isConnected)return false;
    for(let parent:Element|null=element;parent;parent=parent.parentElement??((parent.getRootNode() as ShadowRoot).host??null)){
      const style=getComputedStyle(parent);
      if(style.contentVisibility==='auto')throw Error('This page uses deferred rendering that cannot be observed safely. Choose a narrower page.');
      if(['SCRIPT','STYLE','TEMPLATE','NOSCRIPT'].includes(parent.tagName.toUpperCase())||parent.hasAttribute('hidden')||style.display==='none'||style.contentVisibility==='hidden'||['hidden','collapse'].includes(style.visibility))return false;
    }
    return true;
  };
  const optionVisible=(option:HTMLOptionElement)=>rendered(option);
  const sensitive=/password|passcode|one[-_ ]?time|\botp\b|cc-|credit[-_ ]?card|card[-_ ]?number|security[-_ ]?code|\bcvv\b|\bcvc\b|secret|token|api[-_ ]?key|verification[-_ ]?code|auth[-_ ]?code|\bpin\b/i;
  const sensitiveEditor=(element:Element)=>{
    if(!element.hasAttribute('contenteditable'))return false;
    for(let parent:Element|null=element;parent;parent=parent.parentElement??((parent.getRootNode() as ShadowRoot).host??null)){
      const masking=getComputedStyle(parent).getPropertyValue('-webkit-text-security');
      if(masking&&masking!=='none')return true;
      if(sensitive.test(['autocomplete','name','id','type','inputmode','aria-label'].map(attribute=>parent!.getAttribute(attribute)??'').join(' ')))return true;
    }
    const root=element.getRootNode() as Document|ShadowRoot,references=(element.getAttribute('aria-labelledby')??'').trim().split(/\s+/,101).filter(Boolean);
    return references.length>100||references.some(id=>sensitive.test(root.getElementById(id)?.textContent??''));
  };
  const sensitiveContext=(element:Element)=>{
    for(let parent:Element|null=element;parent;parent=parent.parentElement??((parent.getRootNode() as ShadowRoot).host??null))if(sensitiveEditor(parent))return true;
    return false;
  };
  const text=(element:Element,omitSelects=false):string=>{
    if(!rendered(element)||sensitiveContext(element))return '';
    if(element instanceof HTMLSelectElement){
      if(omitSelects)return '';
      const parts:string[]=[];let group:HTMLOptGroupElement|undefined;
      for(const option of Array.from(element.options).filter(optionVisible)){
        const parent=option.parentElement instanceof HTMLOptGroupElement?option.parentElement:undefined;
        if(parent&&parent!==group&&parent.label)parts.push(parent.label);
        group=parent;parts.push(option.label);
      }
      return parts.join('\n');
    }
    const display=getComputedStyle(element).display;
    if(element instanceof HTMLElement&&display!=='contents'&&!element.querySelector('select')&&!element.querySelector('[contenteditable]'))return element.innerText;
    return Array.from(element.childNodes).map(node=>{
      if(node.nodeType===Node.TEXT_NODE)return node.textContent??'';
      if(!(node instanceof Element)||!rendered(node))return '';
      if(node.tagName==='BR')return '\n';
      const value=text(node,omitSelects),childDisplay=getComputedStyle(node).display;
      return value&&/^(block|flex|grid|table|list-item|flow-root)/.test(childDisplay)?'\n'+value+'\n':value;
    }).join('');
  };
  const name=(element:Element)=>{
    if(!rendered(element)||sensitiveContext(element))return '';
    const root=element.getRootNode() as Document|ShadowRoot;
    const references=(element.getAttribute('aria-labelledby')??'').trim().split(/\s+/,101).filter(Boolean);
    if(references.length>100)throw Error('This page exceeds the observation limit; choose a narrower page.');
    // Use visible labels in this tree only; hidden references are outside the observation scope.
    const referenced=references.map(id=>root.getElementById(id)).filter(label=>label!==null).map(label=>text(label,true)).join(' ').trim();
    const associated=element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement||element instanceof HTMLSelectElement?Array.from(element.labels??[]).map(label=>text(label,true)).join(' '):'';
    return (referenced||(element.getAttribute('aria-label')??(associated||text(element,!(element instanceof HTMLSelectElement))))).trim().slice(0,500);
  };
  const blockedEditor=Boolean(target&&((target as HTMLElement).isContentEditable||sensitiveContext(target)));
  return target?{text:'',title:'',url:'',label:blockedEditor?'':name(target),blockedEditor}:{text:document.body?text(document.body):'',title:document.title,url:location.href,label:'',blockedEditor:undefined};
}

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
  private userControl = false;
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
    let browser: Browser;
    try { browser = await chromium.launch({ headless: options.headless ?? true, chromiumSandbox:true }); }
    catch (error) {
      if (options.signal?.aborted) throw Error('Browser request was stopped before launch.', { cause: error });
      throw Error(BROWSER_LAUNCH_UNAVAILABLE, { cause: error });
    }
    let releaseOwner=()=>{};
    let releaseStop=()=>{};
    let opened:LocalBrowser|undefined;
    try {
      if (options.signal?.aborted) throw Error('Browser request was stopped before opening a page.');
      const stop = () => { void browser.close().catch(()=>{}); };
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
      try { await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 10_000 }); }
      catch { throw Error(BROWSER_PAGE_OPEN_FAILED); }
      return owner;
    } catch (error) {
      releaseStop();
      try { await browser.close(); } catch { throw Error(BROWSER_CLEANUP_UNCONFIRMED); }
      releaseOwner();
      if(opened?.blockedRedirects)throw new BrowserRedirectError();
      const safe=['Browser request was stopped before opening a page.','Browser request was stopped before navigation.','The owned browser process identity could not be established. No page was opened.',BROWSER_PAGE_OPEN_FAILED];
      throw Error(error instanceof Error&&safe.includes(error.message)?error.message:BROWSER_PAGE_OPEN_FAILED);
    }
  }
  get diagnostics() { return { browserId: this.id, taskId: this.taskId, closed: this.closed, blockedRequests: this.blocked, blockedRedirects:this.blockedRedirects, profile: 'fresh-ephemeral' as const }; }
  proposal(id: string) { const value = this.proposals.get(id); return value ? structuredClone(value) : undefined; }
  async review(proposalId: string): Promise<BrowserReview> {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'proposed') throw Error('Observe and propose a current target before reviewing it.');
    const target = await this.validateTarget(proposal.intent), descriptor = this.snapshot?.targets.find(target => target.id === proposal.intent.targetId);
    if (!descriptor) throw Error('Target is no longer available.');
    if (proposal.intent.kind === 'fill' || proposal.intent.kind === 'select') return { target: structuredClone(descriptor) };
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
    this.assertAgentControl();
    if (!form) return { target: structuredClone(descriptor) };
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(form.method)) throw Error('This form method is not supported.');
    const method = Schema.decodeUnknownSync(Schema.Literal('POST', 'PUT', 'PATCH', 'DELETE'))(form.method);
    if (new URL(form.url).origin !== this.origin) throw Error('The form targets another website. Authorize that site separately.');
    const {formFields,...write}=form;
    return { target: structuredClone(descriptor), write: { ...write, method }, formFields };
  }
  private assertOpen() { if (this.closed || this.page.isClosed()) throw Error('This browser binding is closed. Open and approve a fresh binding.'); }
  private assertAgentControl(){if(this.userControl)throw Error('Browser agent work is paused. Return control before another agent operation.');}
  private async read() {
    this.assertOpen();this.assertAgentControl();
    const documentId = this.documentId;
    const {label:_label,blockedEditor:_blockedEditor,...state} = await this.page.evaluate(browserPageState);
    this.assertAgentControl();
    if (documentId !== this.documentId) throw Error('The document changed during observation. Observe it again.');
    if (new URL(state.url).origin !== this.origin) throw Error('Browser left its authorized origin.');
    if (state.text.length > 100_000) throw Error('This page exceeds the observation limit; choose a narrower page.');
    return { ...state, digest: digest(JSON.stringify({ ...state, documentId })) };
  }
  private fingerprint(handle: ElementHandle<HTMLElement | SVGElement>) {
    return handle.evaluate(element => {
      const control = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      const visible=(option:HTMLOptionElement)=>[option,...(option.parentElement instanceof HTMLOptGroupElement?[option.parentElement]:[])].every(item=>{const style=getComputedStyle(item);return !item.hidden&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);});
      const choices = element instanceof HTMLSelectElement ? { multiple:element.multiple, options:Array.from(element.options).filter(visible).map(option=>({value:option.value,label:option.label,disabled:option.disabled||option.parentElement instanceof HTMLOptGroupElement&&option.parentElement.disabled})) } : undefined;
      return JSON.stringify({ tag: element.tagName, name: element.getAttribute('name'), type: element.getAttribute('type'), role: element.getAttribute('role'), label: element.getAttribute('aria-label'), text: element.textContent, href: element.getAttribute('href'), value: control ? element.value : null, disabled: element.getAttribute('disabled'), connected: element.isConnected, choices });
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
        const role = element.getAttribute('role') ?? (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' ? 'button' : input ? element.type : element.tagName.toLowerCase());
        const control = input || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
        const sensitive = input && (['password', 'file', 'hidden'].includes(element.type) || /password|one-time-code|cc-/.test(element.autocomplete));
        const visible=(option:HTMLOptionElement)=>[option,...(option.parentElement instanceof HTMLOptGroupElement?[option.parentElement]:[])].every(item=>{const style=getComputedStyle(item);return !item.hidden&&style.display!=='none'&&!['hidden','collapse'].includes(style.visibility);});
        const choices = element instanceof HTMLSelectElement ? { multiple:element.multiple, options:Array.from(element.options).filter(visible).map(option=>({value:option.value,label:option.label,disabled:option.disabled||option.parentElement instanceof HTMLOptGroupElement&&option.parentElement.disabled})) } : undefined;
        const selectedVisible=!(element instanceof HTMLSelectElement)||Array.from(element.selectedOptions).every(visible);
        if(choices&&!choices.multiple&&(choices.options.length>100||choices.options.some(option=>option.value.length>10_000||option.label.length>500)))throw Error('This choice list exceeds the observation limit; choose a narrower page.');
        return { sensitive, info: { role, label:'', href: element instanceof HTMLAnchorElement ? element.href : undefined, value: control && !sensitive && selectedVisible ? element.value.slice(0, 10_000) : undefined, ...(choices&&!choices.multiple?{options:choices.options}:{}) }, fingerprint: JSON.stringify({ tag: element.tagName, name: element.getAttribute('name'), type: element.getAttribute('type'), role: element.getAttribute('role'), label: element.getAttribute('aria-label'), text: element.textContent, href: element.getAttribute('href'), value: control && !sensitive ? element.value : null, disabled: element.getAttribute('disabled'), connected: element.isConnected, choices }) };
      });
      const info = captured.info;
      // Password/file/hidden controls are never exposed as tools or observations.
      if (captured.sensitive || ['password', 'file', 'hidden'].includes(info.role)) { await handle.dispose(); continue; }
      const id = randomUUID();
      const current=await handle.evaluate(browserPageState);
      if(current.blockedEditor){await handle.dispose();continue;}
      const label=current.label;
      if(typeof label!=='string')throw Error('The current control name could not be observed.');
      this.targets.set(id, { handle, fingerprint: captured.fingerprint, label });
      snapshot.targets.push({ id, ...info, label });
      if(JSON.stringify(snapshot).length>120_000)throw Error('This page exceeds the combined observation limit; choose a narrower page.');
    }
    if ((await this.read()).digest !== state.digest) throw Error('The page changed while its controls were measured. Observe it again.');
    if(JSON.stringify(snapshot).length>120_000)throw Error('This page exceeds the combined observation limit; choose a narrower page.');
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
    this.assertOpen();this.assertAgentControl();
    if (this.busy || !this.snapshot || this.snapshot.id !== intent.snapshotId || this.snapshot.browserId !== this.id) throw Error('The page changed. Observe it again before proposing an action.');
    // read() rejects a closed or cross-origin page before granting stale recovery.
    if ((await this.read()).digest !== this.snapshot.digest || this.snapshot.documentId !== this.documentId) throw new BrowserObservationChangedError('page');
    const target = this.targets.get(intent.targetId);
    if (!target) throw Error('The target changed. Observe it again before proposing an action.');
    const fingerprint=await this.fingerprint(target.handle),visible=await target.handle.isVisible(),current=await target.handle.evaluate(browserPageState);
    if (fingerprint!==target.fingerprint || !visible || current.blockedEditor || current.label!==target.label) throw new BrowserObservationChangedError('target');
    if(intent.kind==='select'){
      const descriptor=this.snapshot.targets.find(target=>target.id===intent.targetId),options=descriptor?.options?.filter(option=>option.value===intent.value);
      if(options?.length!==1||options[0].disabled)throw Error('Choose one enabled, unambiguous value from the observed choice list.');
      if(descriptor?.value===intent.value)throw Error('This option is already selected. Observe its result instead of selecting it again.');
      await target.handle.evaluate((element,value)=>{
        if(!(element instanceof HTMLSelectElement)||element.multiple||element.matches(':disabled'))throw Error('Only an enabled single-choice list can be selected.');
        const options=Array.from(element.options).filter(option=>option.value===value);
        if(options.length!==1||[options[0],...(options[0].parentElement instanceof HTMLOptGroupElement?[options[0].parentElement]:[])].some(item=>{const style=getComputedStyle(item);return item.hidden||style.display==='none'||['hidden','collapse'].includes(style.visibility);}))throw Error('Choose one visible, unambiguous option from the current list.');
      },intent.value);
    }
    this.assertAgentControl();
    return target;
  }
  /** Trusted host only: never wire this method to a model-generated approval. */
  approve(proposalId: string, write?: WriteScope): string {
    this.assertAgentControl();
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'proposed') throw Error('Proposal is missing or already executed.');
    if(proposal.intent.kind==='select'&&write)throw Error('Selecting a choice cannot authorize a POST, PUT, PATCH or DELETE request. Review a form submission separately.');
    if (write && (new URL(write.url).origin !== this.origin || new URL(write.url).username || new URL(write.url).password || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(write.method) || write.body.length > 100_000)) throw Error('Write scope is outside this browser authority.');
    const token = randomUUID(); this.grants.set(proposalId, { token, used: false, ...(write ? { write: { method: write.method, url: write.url, digest: digest(write.body) } } : {}) }); return token;
  }
  async execute(proposalId: string, token: string,signal?:AbortSignal): Promise<{ proposal: BrowserProposal; receipt?: Grant['receipt'] }> {
    this.assertAgentControl();
    const proposal = this.proposals.get(proposalId), grant = this.grants.get(proposalId);
    if (!proposal || proposal.status !== 'proposed') throw Error('Proposal is missing or already executed.');
    if (!grant || grant.token !== token) throw Error('Approval is required for this exact proposal.');
    this.grants.delete(proposalId);
    const target = await this.validateTarget(proposal.intent);
    this.assertAgentControl();
    if(signal?.aborted)throw Error('Stopped before browser execution.');
    proposal.status = 'executing'; this.busy = true; this.active = grant;
    const redirectsBefore=this.blockedRedirects;let attempted=false;
    try {
      if (proposal.intent.kind === 'fill') {attempted=true;await target.handle.fill(proposal.intent.value, { timeout: 5_000 });}
      else if(proposal.intent.kind==='select'){
        const intent=proposal.intent,option=this.snapshot!.targets.find(target=>target.id===intent.targetId)!.options!.find(option=>option.value===intent.value)!;
        attempted=true;await target.handle.selectOption({value:option.value,label:option.label},{timeout:5_000});
      }
      else {attempted=true;await target.handle.click({ timeout: 5_000 });}
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
      // Any attempted interaction can trigger same-site effects before its result is lost.
      proposal.status = grant.used || attempted ? 'uncertain' : 'failed'; proposal.error = proposal.status==='uncertain'?'The website action may have completed. Inspect its outcome before another attempt.':failure instanceof Error ? failure.message : 'Browser operation failed.';
      throw failure;
    } finally { this.busy = false; this.active = undefined; }
    return { proposal: structuredClone(proposal), ...(grant.receipt ? { receipt: structuredClone(grant.receipt) } : {}) };
  }
  yieldToUser(){this.assertOpen();if(this.busy)throw Error('Wait for the current browser operation.');this.userControl=true;this.snapshot=undefined;this.grants.clear();}
  resumeAgent(){this.assertOpen();this.userControl=false;}
  async bringToFront(){this.assertOpen();await this.page.bringToFront();}
  close() {
    if(this.closing)return this.closing;
    this.closed=true;this.releaseStop();this.grants.clear();
    this.closing=(async()=>{await this.context.close().catch(()=>{});await this.browser.close();this.releaseWindowOwner();})();
    return this.closing;
  }
}
