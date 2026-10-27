import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type PermissionStatus = {
  screen: string;
  accessibility: 'granted' | 'not-granted' | 'unsupported';
  captureSupported: boolean;
};
export type NativeWindow = {
  id: string;
  osId: number;
  title: string;
  owner: { name: string; processId: number; path?:string; bundleId?:string };
  bounds: Rect;
  displayId: string;
  scaleFactor: number;
  documentToken: string;
  requiresExplicitCapture: true;
};
export type CaptureTransform = {
  version: 1;
  coordinateSpace: 'captured-image-pixels';
  windowBoundsDip: Rect;
  displayBoundsDip: Rect;
  displayScaleFactor: number;
  nativePixelSize: Size;
  capturePixelSize: Size;
  cropPx: Rect;
  resizeScale: { x: number; y: number };
  pixelsPerDip: { x: number; y: number };
  imageToDesktopDip: [number, number, number, number, number, number];
};
export type NativeCapture = {
  source: NativeWindow;
  sourceVersion: string;
  capturedAt: string;
  png: Buffer;
  dataUrl: string;
  imageSha256: string;
  transform: CaptureTransform;
  freshness: 'frozen-explicit-capture';
};
type WindowMetadata = {
  id: number;
  title: string;
  owner: { name: string; processId: number; path?:string; bundleId?:string };
  bounds: Rect;
};
type DisplayMetadata = { id: number | string; bounds: Rect; scaleFactor: number };
type CaptureSourceMetadata = { id: string; name: string };

// Injectable OS boundaries let tests prove policy without recording the user's desktop.
export type NativeDependencies = {
  platform: string;
  permissionStatus(): PermissionStatus;
  openWindows(options: { accessibilityPermission: false; screenRecordingPermission: false }): Promise<WindowMetadata[]>;
  activeWindow?(options: { accessibilityPermission: false; screenRecordingPermission: false }): Promise<WindowMetadata|undefined>;
  getSources(options: { types: ['window']; thumbnailSize: Size; fetchWindowIcons: false }): Promise<CaptureSourceMetadata[]>;
  getDisplayMatching(bounds: Rect): DisplayMetadata;
  captureWindow(osId: number): Promise<Buffer>;
  resizePng(png: Buffer, size: Size): Buffer;
};

export class NativeSourceError extends Error {
  constructor(public readonly code: 'PERMISSION_REQUIRED' | 'WINDOW_UNAVAILABLE' | 'SOURCE_CHANGED' | 'CAPTURE_UNSUPPORTED' | 'INVALID_IMAGE' | 'INVALID_ARGUMENT', message: string) {
    super(message);
    this.name = 'NativeSourceError';
  }
}

const validRect = (r: Rect) => [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const windowId = (value: string) => {
  const match = /^window:(\d+)$/.exec(value);
  const id = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new NativeSourceError('INVALID_ARGUMENT', 'Select an individual native window.');
  return id;
};

export function pngPixelSize(png: Buffer): Size {
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.toString('ascii', 12, 16) !== 'IHDR') {
    throw new NativeSourceError('INVALID_IMAGE', 'Native capture did not return a PNG image.');
  }
  const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  if (!size.width || !size.height || size.width > 32768 || size.height > 32768 || size.width * size.height > 100_000_000) {
    throw new NativeSourceError('INVALID_IMAGE', 'Native capture dimensions exceed the image limit.');
  }
  return size;
}

export function createCaptureTransform(bounds: Rect, display: DisplayMetadata, nativePixelSize: Size, capturePixelSize: Size): CaptureTransform {
  if (!validRect(bounds) || !validRect(display.bounds) || !Number.isFinite(display.scaleFactor) || display.scaleFactor <= 0 ||
    ![nativePixelSize.width, nativePixelSize.height, capturePixelSize.width, capturePixelSize.height].every(n => Number.isInteger(n) && n > 0)) {
    throw new NativeSourceError('INVALID_ARGUMENT', 'Capture coordinates must have positive finite dimensions.');
  }
  return {
    version: 1,
    coordinateSpace: 'captured-image-pixels',
    windowBoundsDip: { ...bounds },
    displayBoundsDip: { ...display.bounds },
    displayScaleFactor: display.scaleFactor,
    nativePixelSize: { ...nativePixelSize },
    capturePixelSize: { ...capturePixelSize },
    cropPx: { x: 0, y: 0, ...nativePixelSize },
    resizeScale: { x: capturePixelSize.width / nativePixelSize.width, y: capturePixelSize.height / nativePixelSize.height },
    pixelsPerDip: { x: capturePixelSize.width / bounds.width, y: capturePixelSize.height / bounds.height },
    imageToDesktopDip: [bounds.width / capturePixelSize.width, 0, 0, bounds.height / capturePixelSize.height, bounds.x, bounds.y],
  };
}

export function imagePointToDesktopDip(transform: CaptureTransform, point: { x: number; y: number }): { x: number; y: number } {
  if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x > transform.capturePixelSize.width || point.y > transform.capturePixelSize.height) {
    throw new NativeSourceError('INVALID_ARGUMENT', 'Point is outside the captured image.');
  }
  const [a, , , d, e, f] = transform.imageToDesktopDip;
  return { x: a * point.x + e, y: d * point.y + f };
}

export function normalizedPointToImagePixels(transform: CaptureTransform, point: { x: number; y: number }): { x: number; y: number } {
  if (![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x > 1000 || point.y > 1000) {
    throw new NativeSourceError('INVALID_ARGUMENT', 'Grounding point must use the normalized 0–1000 image grid.');
  }
  return { x: Math.round(point.x * transform.capturePixelSize.width / 1000), y: Math.round(point.y * transform.capturePixelSize.height / 1000) };
}

let defaultDependencies: Promise<NativeDependencies> | undefined;
async function loadDefaultDependencies(): Promise<NativeDependencies> {
  defaultDependencies ??= (async () => {
    const electron = await import('electron');
    const windows = await import('get-windows');
    return {
      platform: process.platform,
      permissionStatus: () => ({
        screen: process.platform === 'darwin' ? electron.systemPreferences.getMediaAccessStatus('screen') : 'unsupported',
        accessibility: process.platform === 'darwin' ? (electron.systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-granted') : 'unsupported',
        captureSupported: process.platform === 'darwin',
      }),
      openWindows: options => windows.openWindows(options),
      activeWindow: options => windows.activeWindow(options),
      getSources: options => electron.desktopCapturer.getSources(options),
      getDisplayMatching: bounds => electron.screen.getDisplayMatching(bounds),
      captureWindow: captureMacWindow,
      resizePng: (png, size) => electron.nativeImage.createFromBuffer(png).resize({ ...size, quality: 'best' }).toPNG(),
    };
  })();
  return defaultDependencies;
}

async function captureMacWindow(osId: number): Promise<Buffer> {
  if (!Number.isSafeInteger(osId) || osId <= 0) throw new NativeSourceError('INVALID_ARGUMENT', 'Invalid native window ID.');
  const directory = await mkdtemp(join(tmpdir(), 'window-companion-capture-'));
  const destination = join(directory, 'capture.png');
  try {
    // Fixed binary and arguments: -l selects exactly one window; no interactive/display fallback.
    await promisify(execFile)('/usr/sbin/screencapture', [`-l${osId}`, '-x', '-o', '-a', '-t', 'png', destination], { timeout: 15_000, maxBuffer: 64 * 1024 });
    return await readFile(destination);
  } catch {
    throw new NativeSourceError('WINDOW_UNAVAILABLE', 'Selected window capture failed. Refresh the source and inspect the existing screen recording permission.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export class NativeSourceAdapter {
  constructor(private readonly suppliedDependencies?: NativeDependencies) {}
  private dependencies() { return this.suppliedDependencies ? Promise.resolve(this.suppliedDependencies) : loadDefaultDependencies(); }

  async permissionStatus(): Promise<PermissionStatus> { return (await this.dependencies()).permissionStatus(); }

  async listWindows(): Promise<NativeWindow[]> {
    const deps = await this.dependencies();
    const permission = deps.permissionStatus();
    const windows = await deps.openWindows({ accessibilityPermission: false, screenRecordingPermission: false });
    // 0x0 explicitly suppresses all-window thumbnails; this path reads metadata only.
    const sources = permission.screen === 'granted' ? await deps.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false }) : [];
    return windows.filter(w => Number.isSafeInteger(w.id) && w.id > 0 && validRect(w.bounds)).map(w => {
      const display = deps.getDisplayMatching(w.bounds);
      const title = sources.find(s => /^window:\d+:[01]$/.test(s.id) && Number(s.id.split(':')[1]) === w.id)?.name ?? w.title;
      const identity = { osId: w.id, title, owner: { name: w.owner.name, processId: w.owner.processId,...(w.owner.path?{path:w.owner.path}:{}),...(w.owner.bundleId?{bundleId:w.owner.bundleId}:{}) }, bounds: { x:w.bounds.x, y:w.bounds.y, width:w.bounds.width, height:w.bounds.height }, displayId: String(display.id), scaleFactor: display.scaleFactor };
      return { id: `window:${w.id}`, ...identity, documentToken: sha256(JSON.stringify(identity)), requiresExplicitCapture: true };
    });
  }

  async inspect(id: string): Promise<NativeWindow> {
    windowId(id);
    const window = (await this.listWindows()).find(w => w.id === id);
    if (!window) throw new NativeSourceError('WINDOW_UNAVAILABLE', 'Selected window is no longer available. Select a source again.');
    return window;
  }

  /** Metadata only, with both permission prompts disabled. Never choose the
   * first enumerated background window when foreground identity is unavailable. */
  async foregroundWindow():Promise<NativeWindow|undefined>{
    const deps=await this.dependencies(),active=await deps.activeWindow?.({accessibilityPermission:false,screenRecordingPermission:false});
    if(!active||!Number.isSafeInteger(active.id)||active.id<=0)return;
    return (await this.listWindows()).find(window=>window.osId===active.id&&window.owner.processId===active.owner.processId);
  }

  async capture(id: string, options: { expectedDocumentToken?: string; maxPixels?: number } = {}): Promise<NativeCapture> {
    windowId(id);
    const maxPixels = options.maxPixels ?? 4096;
    if (!Number.isInteger(maxPixels) || maxPixels < 64 || maxPixels > 8192) throw new NativeSourceError('INVALID_ARGUMENT', 'Capture maximum edge must be between 64 and 8192 pixels.');
    const deps = await this.dependencies();
    const permission = deps.permissionStatus();
    if (!permission.captureSupported || deps.platform !== 'darwin') throw new NativeSourceError('CAPTURE_UNSUPPORTED', 'Selected-window native capture is currently verified only on macOS.');
    if (permission.screen !== 'granted') throw new NativeSourceError('PERMISSION_REQUIRED', `Screen recording permission is ${permission.screen}. Enable it explicitly in macOS settings before capture.`);
    const source = await this.inspect(id);
    if (options.expectedDocumentToken && options.expectedDocumentToken !== source.documentToken) throw new NativeSourceError('SOURCE_CHANGED', 'Source title, owner, display, or bounds changed. Refresh and rebind the source.');
    if (deps.permissionStatus().screen !== 'granted') throw new NativeSourceError('PERMISSION_REQUIRED', 'Screen recording permission changed before capture.');
    const original = await deps.captureWindow(source.osId);
    const nativePixelSize = pngPixelSize(original);
    const after = await this.inspect(id);
    if (after.documentToken !== source.documentToken) throw new NativeSourceError('SOURCE_CHANGED', 'Source changed during capture. The captured pixels were discarded.');
    const ratio = Math.min(1, maxPixels / Math.max(nativePixelSize.width, nativePixelSize.height));
    const png = ratio < 1 ? deps.resizePng(original, { width: Math.max(1, Math.round(nativePixelSize.width * ratio)), height: Math.max(1, Math.round(nativePixelSize.height * ratio)) }) : original;
    const capturePixelSize = pngPixelSize(png);
    const display = deps.getDisplayMatching(source.bounds);
    if (String(display.id) !== source.displayId || display.scaleFactor !== source.scaleFactor) throw new NativeSourceError('SOURCE_CHANGED', 'Display changed during capture. Refresh the source.');
    // A stable title/token cannot detect same-title navigation or edits. Every pixel use needs a new explicit capture.
    return { source, sourceVersion: randomUUID(), capturedAt: new Date().toISOString(), png, dataUrl: `data:image/png;base64,${png.toString('base64')}`, imageSha256: sha256(png), transform: createCaptureTransform(source.bounds, display, nativePixelSize, capturePixelSize), freshness: 'frozen-explicit-capture' };
  }
}

const inside = (r: Rect, area: Rect) => r.x >= area.x && r.y >= area.y && r.x + r.width <= area.x + area.width && r.y + r.height <= area.y + area.height;
const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export type CompanionPlacement =
  | { mode: 'attached'; side: 'right' | 'left' | 'bottom' | 'top'; panelBounds: Rect; anchorBounds: null }
  | { mode: 'edge-anchor'; side: 'right' | 'left'; panelBounds: null; anchorBounds: Rect; detached: true; reason: 'no-room' };

export function placeCompanion(source: Rect, workArea: Rect, panelSize: Size, gap = 12): CompanionPlacement {
  if (!validRect(source) || !validRect(workArea) || !validRect({ x: 0, y: 0, ...panelSize }) || !Number.isFinite(gap) || gap < 0) throw new NativeSourceError('INVALID_ARGUMENT', 'Placement needs valid source, work area, and panel dimensions.');
  const { width, height } = panelSize;
  const y = clamp(source.y, workArea.y, workArea.y + workArea.height - height);
  const x = clamp(source.x, workArea.x, workArea.x + workArea.width - width);
  const candidates: { side: 'right' | 'left' | 'bottom' | 'top'; panelBounds: Rect }[] = [
    { side: 'right', panelBounds: { x: source.x + source.width + gap, y, width, height } },
    { side: 'left', panelBounds: { x: source.x - gap - width, y, width, height } },
    { side: 'bottom', panelBounds: { x, y: source.y + source.height + gap, width, height } },
    { side: 'top', panelBounds: { x, y: source.y - gap - height, width, height } },
  ];
  const attached = candidates.find(c => inside(c.panelBounds, workArea) && overlapArea(c.panelBounds, source) === 0);
  if (attached) return { mode: 'attached', ...attached, anchorBounds: null };
  const anchorSize = { width: Math.min(28, workArea.width), height: Math.min(36, workArea.height) };
  const anchors = [
    { side: 'right' as const, x: workArea.x + workArea.width - anchorSize.width, y: workArea.y },
    { side: 'left' as const, x: workArea.x, y: workArea.y },
    { side: 'right' as const, x: workArea.x + workArea.width - anchorSize.width, y: workArea.y + workArea.height - anchorSize.height },
    { side: 'left' as const, x: workArea.x, y: workArea.y + workArea.height - anchorSize.height },
  ].map(a => ({ side: a.side, bounds: { x: a.x, y: a.y, ...anchorSize } }));
  anchors.sort((a, b) => overlapArea(a.bounds, source) - overlapArea(b.bounds, source));
  const anchor = anchors[0]!;
  return { mode: 'edge-anchor', side: anchor.side, panelBounds: null, anchorBounds: anchor.bounds, detached: true, reason: 'no-room' };
}
