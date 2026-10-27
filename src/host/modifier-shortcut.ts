/** A narrow adapter: no text, timestamps, coordinates or input event retention. */
export interface ModifierHook {
  on(event: 'keydown' | 'keyup', listener: (event: {keycode: number}) => void): unknown;
  off(event: 'keydown' | 'keyup', listener: (event: {keycode: number}) => void): unknown;
  start(): void;
  stop(): void;
}

export type ModifierShortcutStatus = Readonly<{
  state: 'stopped' | 'starting' | 'ready' | 'permission-required' | 'unsupported' | 'unavailable';
  reason?: 'load-failed' | 'permission-check-failed' | 'start-failed' | 'stop-failed';
}>;

/** Physical left/right codes from uiohook-napi 1.5.5's UiohookKey table.
 * Keeping these constants here avoids loading the native addon before consent. */
export function modifierKeymap(platform: string): Readonly<{left: number; right: number; label: string}> | undefined {
  if (platform === 'darwin') return {left: 0x0038, right: 0x0E38, label: 'Both Option keys'};
  if (platform === 'win32') return {left: 0x001D, right: 0x0E1D, label: 'Both Ctrl keys'};
}

export interface ModifierShortcutOptions {
  platform: string;
  /** Must be a synchronous, nonprompting read of the existing macOS grant. */
  hasAccessibilityPermission: () => boolean;
  onActivate: () => void | Promise<void>;
  loadHook?: () => Promise<ModifierHook>;
}

/** Own one controller per native singleton. Fallback accelerators/menu/tray are
 * independent host actions; a missing grant never prompts or starts this hook.
 * The bundled Darwin library has a prompting check internally, so check the
 * existing grant again immediately before calling its synchronous start(). */
export function createModifierShortcut(options: ModifierShortcutOptions) {
  const keys = modifierKeymap(options.platform);
  const load = options.loadHook ?? (async () => (await import('uiohook-napi')).uIOhook);
  let current: ModifierShortcutStatus = {state: 'stopped'};
  let epoch = 0, pending: Promise<ModifierShortcutStatus> | undefined;
  let owned: {hook: ModifierHook; down: (event: {keycode: number}) => void; up: (event: {keycode: number}) => void} | undefined;
  let failedStop: ModifierHook | undefined;
  const status = (): ModifierShortcutStatus => ({...current});
  const permitted = () => {
    if (options.platform !== 'darwin') return true;
    try {
      if (options.hasAccessibilityPermission()) return true;
      current = {state: 'permission-required'};
    } catch { current = {state: 'unavailable', reason: 'permission-check-failed'}; }
    return false;
  };
  const detach = () => {
    const item = owned; owned = undefined;
    if (!item) return;
    // The native EventEmitter's off is synchronous. Never remove other owners'
    // listeners, and make callbacks inert before attempting native shutdown.
    item.hook.off('keydown', item.down);
    item.hook.off('keyup', item.up);
    return item.hook;
  };
  const stop = (): ModifierShortcutStatus => {
    epoch++; pending = undefined; current = {state: 'stopped'};
    const hook = detach() ?? failedStop;
    failedStop = undefined;
    if (hook) {
      try { hook.stop(); }
      catch { failedStop = hook; current = {state: 'unavailable', reason: 'stop-failed'}; }
    }
    return status();
  };
  const start = (): Promise<ModifierShortcutStatus> => {
    if (pending) return pending;
    if (current.state === 'ready' || failedStop) return Promise.resolve(status());
    if (!keys) { current = {state: 'unsupported'}; return Promise.resolve(status()); }
    if (!permitted()) return Promise.resolve(status());
    const generation = ++epoch;
    current = {state: 'starting'};
    // Queue loading so synchronous injected failures follow the same path as
    // rejected native imports, and simultaneous starts share one promise.
    const attempt = Promise.resolve().then(async () => {
      if (generation !== epoch) return status();
      let hook: ModifierHook;
      try { hook = await load(); }
      catch {
        if (generation === epoch) current = {state: 'unavailable', reason: 'load-failed'};
        return status();
      }
      if (generation !== epoch || !permitted()) return status();
      let left = false, right = false, latched = false;
      const live = () => generation === epoch && current.state === 'ready';
      const down = ({keycode}: {keycode: number}) => {
        if (!live()) return;
        if (keycode === keys.left) left = true;
        else if (keycode === keys.right) right = true;
        else return;
        if (left && right && !latched) {
          latched = true;
          // A rejected activation must not escape into the native dispatch loop
          // or rearm a chord whose physical keys are still held.
          try { void Promise.resolve(options.onActivate()).catch(() => {}); } catch {}
        }
      };
      const up = ({keycode}: {keycode: number}) => {
        if (!live()) return;
        if (options.platform === 'darwin') {
          if (keycode !== keys.left && keycode !== keys.right) return;
          // Pinned uiohook-napi 1.5.5/libuiohook Darwin uses the aggregate
          // Alternate flag in process_modifier_changed. Its Option key-up is
          // emitted only when neither Option remains held; the first physical
          // release may instead arrive as a duplicate key-down. Treat this
          // final release as both up so the next deliberate chord can rearm.
          left = false; right = false; latched = false; return;
        }
        if (keycode === keys.left) left = false;
        else if (keycode === keys.right) right = false;
        else return;
        if (!left && !right) latched = false;
      };
      owned = {hook, down, up};
      try {
        hook.on('keydown', down); hook.on('keyup', up); hook.start();
        current = {state: 'ready'};
      } catch {
        current = {state: 'unavailable', reason: 'start-failed'};
        detach();
        try { hook.stop(); } catch { failedStop = hook; current = {state: 'unavailable', reason: 'stop-failed'}; }
      }
      return status();
    });
    pending = attempt;
    void attempt.finally(() => { if (generation === epoch) pending = undefined; });
    return attempt;
  };
  return {start, stop, status};
}
