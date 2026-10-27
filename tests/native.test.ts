import { describe, expect, it, vi } from 'vitest';
import { createCaptureTransform, imagePointToDesktopDip, NativeSourceAdapter, normalizedPointToImagePixels, placeCompanion, pngPixelSize, type NativeDependencies, type Rect } from '../src/host/native';

// Header fixtures exercise transport and coordinate policy; they do not prove native capture or PNG decoding.
function headerFixture(width: number, height: number): Buffer {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

function fixture() {
  const bounds = { x: -1200, y: 40, width: 800, height: 600 };
  const metadata = { id: 42, title: '', owner: { name: 'Synthetic Source', processId: 1234 }, bounds };
  const state = { screen: 'granted', title: 'Synthetic worksheet', metadata, scaleFactor: 2 };
  const deps: NativeDependencies = {
    platform: 'darwin',
    permissionStatus: () => ({ screen: state.screen, accessibility: 'not-granted', captureSupported: true }),
    openWindows: vi.fn(async () => [state.metadata]),
    getSources: vi.fn(async () => [{ id: 'window:42:0', name: state.title }]),
    getDisplayMatching: () => ({ id: 9, bounds: { x: -1440, y: 0, width: 1440, height: 900 }, scaleFactor: state.scaleFactor }),
    captureWindow: vi.fn(async () => headerFixture(1600, 1200)),
    resizePng: vi.fn((_png, size) => headerFixture(size.width, size.height)),
  };
  return { adapter: new NativeSourceAdapter(deps), deps, state, bounds };
}

describe('native adapter policy — injected OS fixtures', () => {
  it('enumerates only metadata, disables permission prompts and never requests display thumbnails', async () => {
    const { adapter, deps } = fixture();
    const windows = await adapter.listWindows();
    expect(deps.openWindows).toHaveBeenCalledWith({ accessibilityPermission: false, screenRecordingPermission: false });
    expect(deps.getSources).toHaveBeenCalledWith({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
    expect(deps.captureWindow).not.toHaveBeenCalled();
    expect(windows[0]).toMatchObject({ id: 'window:42', osId: 42, title: 'Synthetic worksheet', requiresExplicitCapture: true });
  });

  it.each(['not-determined', 'denied', 'restricted', 'unknown'])('does not call capture or Electron source enumeration with screen permission %s', async screen => {
    const { adapter, deps, state } = fixture();
    state.screen = screen;
    expect((await adapter.listWindows())[0]?.title).toBe('');
    await expect(adapter.capture('window:42')).rejects.toMatchObject({ code: 'PERMISSION_REQUIRED' });
    expect(deps.getSources).not.toHaveBeenCalled();
    expect(deps.captureWindow).not.toHaveBeenCalled();
  });

  it('captures exactly the selected OS ID and records actual PNG dimensions', async () => {
    const { adapter, deps, bounds } = fixture();
    const source = await adapter.inspect('window:42');
    const capture = await adapter.capture(source.id, { expectedDocumentToken: source.documentToken });
    expect(deps.captureWindow).toHaveBeenCalledExactlyOnceWith(42);
    expect(capture.transform).toMatchObject({ version: 1, windowBoundsDip: bounds, nativePixelSize: { width: 1600, height: 1200 }, capturePixelSize: { width: 1600, height: 1200 }, pixelsPerDip: { x: 2, y: 2 } });
    expect(capture.freshness).toBe('frozen-explicit-capture');
    expect(capture.imageSha256).toHaveLength(64);
  });

  it('gives each explicit capture a distinct source version even with the same title and pixels', async () => {
    const { adapter } = fixture();
    const a = await adapter.capture('window:42');
    const b = await adapter.capture('window:42');
    expect(a.source.documentToken).toBe(b.source.documentToken);
    expect(a.sourceVersion).not.toBe(b.sourceVersion);
    expect(a.freshness).toBe('frozen-explicit-capture');
  });

  it('keeps identity stable when the native bridge changes rectangle property order', async () => {
    const {adapter,state}=fixture();
    const before=await adapter.inspect('window:42');
    const b=state.metadata.bounds;
    state.metadata={...state.metadata,bounds:{height:b.height,y:b.y,width:b.width,x:b.x}};
    const after=await adapter.inspect('window:42');
    expect(after.documentToken).toBe(before.documentToken);
  });

  it.each(['title', 'bounds', 'owner', 'display'])('invalidates metadata token after %s change before capture', async change => {
    const { adapter, deps, state } = fixture();
    const source = await adapter.inspect('window:42');
    if (change === 'title') state.title = 'Different synthetic document';
    if (change === 'bounds') state.metadata = { ...state.metadata, bounds: { ...state.metadata.bounds, x: 10 } };
    if (change === 'owner') state.metadata = { ...state.metadata, owner: { ...state.metadata.owner, processId: 5678 } };
    if (change === 'display') state.scaleFactor = 1;
    await expect(adapter.capture(source.id, { expectedDocumentToken: source.documentToken })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(deps.captureWindow).not.toHaveBeenCalled();
  });

  it('discards pixels if the source changes during capture', async () => {
    const { adapter, deps, state } = fixture();
    deps.captureWindow = vi.fn(async () => { state.title = 'New synthetic document'; return headerFixture(1600, 1200); });
    await expect(adapter.capture('window:42')).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  });

  it('does not fall back to a display or other window when the selected window vanishes', async () => {
    const { adapter, deps } = fixture();
    deps.openWindows = vi.fn(async () => []);
    await expect(adapter.capture('window:42')).rejects.toMatchObject({ code: 'WINDOW_UNAVAILABLE' });
    expect(deps.captureWindow).not.toHaveBeenCalled();
  });

  it('resizes only the selected capture and measures the returned bytes', async () => {
    const { adapter, deps } = fixture();
    const capture = await adapter.capture('window:42', { maxPixels: 800 });
    expect(deps.resizePng).toHaveBeenCalledWith(expect.any(Buffer), { width: 800, height: 600 });
    expect(capture.transform).toMatchObject({ nativePixelSize: { width: 1600, height: 1200 }, capturePixelSize: { width: 800, height: 600 }, resizeScale: { x: 0.5, y: 0.5 }, pixelsPerDip: { x: 1, y: 1 } });
  });

  it('rejects display IDs, malformed IDs and unverified capture platforms', async () => {
    const { adapter, deps } = fixture();
    for (const id of ['screen:1:0', 'window:42:0', 'window:-1', 'window:9007199254740993', 'window:1;rm']) {
      await expect(adapter.capture(id)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    deps.platform = 'linux';
    await expect(adapter.capture('window:42')).rejects.toMatchObject({ code: 'CAPTURE_UNSUPPORTED' });
    expect(deps.captureWindow).not.toHaveBeenCalled();
  });
});

describe('capture transforms — deterministic fixtures', () => {
  it('maps the exact resized bitmap through negative DIP origins and differing x/y scale', () => {
    const transform = createCaptureTransform({ x: -1200, y: 40, width: 800, height: 600 }, { id: 9, bounds: { x: -1440, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }, { width: 1600, height: 1200 }, { width: 800, height: 500 });
    expect(normalizedPointToImagePixels(transform, { x: 500, y: 500 })).toEqual({ x: 400, y: 250 });
    expect(imagePointToDesktopDip(transform, { x: 400, y: 250 })).toEqual({ x: -800, y: 340 });
    expect(imagePointToDesktopDip(transform, { x: 800, y: 500 })).toEqual({ x: -400, y: 640 });
    expect(() => normalizedPointToImagePixels(transform, { x: 1001, y: 0 })).toThrow();
    expect(() => imagePointToDesktopDip(transform, { x: NaN, y: 0 })).toThrow();
  });

  it('rejects non-PNG, empty and unreasonable dimensions', () => {
    for (const bytes of [Buffer.from('not an image'), headerFixture(0, 1), headerFixture(32769, 1), headerFixture(20000, 20000)]) expect(() => pngPixelSize(bytes)).toThrow();
  });
});

describe('companion placement — pure geometry, no window movement', () => {
  const workArea = { x: 0, y: 24, width: 1440, height: 850 };
  const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

  it.each([
    { x: 20, y: 80, width: 850, height: 700 },
    { x: 550, y: 80, width: 850, height: 700 },
    { x: 0, y: 24, width: 1440, height: 450 },
    { x: 0, y: 450, width: 1440, height: 424 },
  ])('attaches entirely outside source when space exists: %j', source => {
    const placement = placeCompanion(source, workArea, { width: 360, height: 300 });
    expect(placement.mode).toBe('attached');
    if (placement.mode !== 'attached') return;
    expect(intersects(placement.panelBounds, source)).toBe(false);
    expect(placement.panelBounds.x).toBeGreaterThanOrEqual(workArea.x);
    expect(placement.panelBounds.y).toBeGreaterThanOrEqual(workArea.y);
    expect(placement.panelBounds.x + placement.panelBounds.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(placement.panelBounds.y + placement.panelBounds.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  });

  it('returns only a small edge anchor and no automatic panel placement for a full source', () => {
    const placement = placeCompanion(workArea, workArea, { width: 420, height: 650 });
    expect(placement).toMatchObject({ mode: 'edge-anchor', panelBounds: null, detached: true, reason: 'no-room' });
    if (placement.mode !== 'edge-anchor') return;
    expect(placement.anchorBounds.width).toBeLessThanOrEqual(28);
    expect(intersects(placement.anchorBounds, { x: 500, y: 300, width: 400, height: 300 })).toBe(false);
  });

  it('supports negative monitor coordinates and refuses malformed geometry', () => {
    const placement = placeCompanion({ x: -1440, y: 0, width: 900, height: 900 }, { x: -1440, y: 0, width: 1440, height: 900 }, { width: 400, height: 600 });
    expect(placement.mode).toBe('attached');
    expect(() => placeCompanion(workArea, workArea, { width: -1, height: 4 })).toThrow();
  });
});
