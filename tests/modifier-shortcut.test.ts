import {EventEmitter} from 'node:events';
import {describe, expect, it, vi} from 'vitest';
import {createModifierShortcut, modifierKeymap, type ModifierHook} from '../src/host/modifier-shortcut';

class FakeHook extends EventEmitter implements ModifierHook {
  start = vi.fn(() => {});
  stop = vi.fn(() => {});
  down(keycode: number) { this.emit('keydown', {keycode}); }
  up(keycode: number) { this.emit('keyup', {keycode}); }
}
function fixture(platform = 'darwin') {
  const hook = new FakeHook(), activate = vi.fn(), permission = vi.fn(() => true), load = vi.fn(async () => hook);
  const controller = createModifierShortcut({platform, onActivate: activate, hasAccessibilityPermission: permission, loadHook: load});
  return {hook, activate, permission, load, controller};
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

describe('physical modifier shortcut', () => {
  it('rearms after the pinned Darwin library reports the first Option release as another keydown', async () => {
    const f=fixture();await f.controller.start();
    // libuiohook's Darwin process_modifier_changed checks the aggregate Alternate
    // flag. Releasing L while R is held is therefore emitted as L-down; the
    // final R release is R-up. The first release must not strand our L state.
    f.hook.down(56);f.hook.down(3640);expect(f.activate).toHaveBeenCalledTimes(1);
    f.hook.down(56);f.hook.up(3640);
    f.hook.down(3640);f.hook.down(56);expect(f.activate).toHaveBeenCalledTimes(2);
    f.hook.down(3640);f.hook.up(56);
    f.hook.down(56);f.hook.down(3640);expect(f.activate).toHaveBeenCalledTimes(3);
    f.controller.stop();
  });
  it.each([
    ['darwin', 56, 3640, 'Both Option keys'],
    ['win32', 29, 3613, 'Both Ctrl keys'],
  ] as const)('recognizes distinct physical keys on %s in either order', async (platform, left, right, label) => {
    const f = fixture(platform);
    expect(modifierKeymap(platform)).toEqual({left, right, label});
    expect(await f.controller.start()).toEqual({state: 'ready'});
    f.hook.down(left); f.hook.down(left); expect(f.activate).not.toHaveBeenCalled();
    f.hook.down(right); expect(f.activate).toHaveBeenCalledTimes(1);
    f.hook.up(left); f.hook.up(right);
    f.hook.down(right); f.hook.down(left); expect(f.activate).toHaveBeenCalledTimes(2);
    f.controller.stop();
  });

  it('latches through Windows repeats and per-key partial releases until both keys are up', async () => {
    const f = fixture('win32'); await f.controller.start();
    f.hook.down(29); f.hook.down(3613);
    for (let i = 0; i < 10; i++) { f.hook.down(29); f.hook.down(3613); }
    f.hook.up(29); f.hook.down(29); f.hook.up(3613); f.hook.down(3613);
    expect(f.activate).toHaveBeenCalledTimes(1);
    f.hook.up(29); f.hook.up(3613); f.hook.down(29); f.hook.down(3613);
    expect(f.activate).toHaveBeenCalledTimes(2); f.controller.stop();
  });

  it('ignores non-target codes and subscribes only to keyboard down/up', async () => {
    const f = fixture(); await f.controller.start();
    expect(f.hook.eventNames().sort()).toEqual(['keydown', 'keyup']);
    for (const keycode of [29, 3613, 30, 31, 32, 42, 54, 3675, 3676]) { f.hook.down(keycode); f.hook.up(keycode); }
    f.hook.down(56); f.hook.down(30); f.hook.up(30);
    expect(f.activate).not.toHaveBeenCalled();
    f.hook.down(3640); expect(f.activate).toHaveBeenCalledWith();
    // No event object, code, text or coordinate is forwarded to the action.
    expect(f.controller.status()).toEqual({state: 'ready'}); f.controller.stop();
  });

  it('does not load the addon without an existing macOS Accessibility grant', async () => {
    const f = fixture(); f.permission.mockReturnValue(false);
    expect(await f.controller.start()).toEqual({state: 'permission-required'});
    expect(f.load).not.toHaveBeenCalled(); expect(f.hook.start).not.toHaveBeenCalled();
  });

  it('rechecks macOS grant after loading, before native start', async () => {
    const f = fixture(); f.permission.mockReturnValueOnce(true).mockReturnValue(false);
    expect(await f.controller.start()).toEqual({state: 'permission-required'});
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.hook.start).not.toHaveBeenCalled();
    expect(f.hook.eventNames()).toEqual([]);
  });

  it('does not query macOS permissions on Windows and rejects unsupported platforms', async () => {
    const f = fixture('win32'); f.permission.mockImplementation(() => { throw Error('Must not query AX'); });
    expect(await f.controller.start()).toEqual({state: 'ready'}); expect(f.permission).not.toHaveBeenCalled(); f.controller.stop();
    const unsupported = fixture('linux'); expect(await unsupported.controller.start()).toEqual({state: 'unsupported'});
    expect(unsupported.permission).not.toHaveBeenCalled(); expect(unsupported.load).not.toHaveBeenCalled();
  });

  it('reports permission read failures without loading or retaining raw errors', async () => {
    const f = fixture(); f.permission.mockImplementation(() => { throw Error('private-path'); });
    expect(await f.controller.start()).toEqual({state: 'unavailable', reason: 'permission-check-failed'});
    expect(f.load).not.toHaveBeenCalled();
  });

  it('shares simultaneous starts, and start is idempotent while ready', async () => {
    const f = fixture(), one = f.controller.start(), two = f.controller.start();
    expect(one).toBe(two); await Promise.all([one, two]); await f.controller.start();
    expect(f.load).toHaveBeenCalledTimes(1); expect(f.hook.start).toHaveBeenCalledTimes(1);
    expect(f.hook.listenerCount('keydown')).toBe(1); f.controller.stop();
  });

  it('stops only owned listeners and suppresses a captured late callback', async () => {
    const f = fixture(), external = vi.fn(); f.hook.on('keydown', external); await f.controller.start();
    const down = f.hook.listeners('keydown')[1] as (e: {keycode: number}) => void;
    f.hook.down(56); expect(f.controller.stop()).toEqual({state: 'stopped'});
    down({keycode: 3640}); f.hook.down(3640); expect(f.activate).not.toHaveBeenCalled();
    expect(f.hook.listeners('keydown')).toEqual([external]); expect(f.hook.listenerCount('keyup')).toBe(0);
    f.controller.stop(); expect(f.hook.stop).toHaveBeenCalledTimes(1);
    await f.controller.start(); f.hook.down(3640); expect(f.activate).not.toHaveBeenCalled();
    f.hook.down(56); expect(f.activate).toHaveBeenCalledTimes(1); f.controller.stop();
  });

  it('stop before loading begins avoids loading, and stop during loading avoids native startup', async () => {
    const f = fixture(), before = f.controller.start(); f.controller.stop(); await before; expect(f.load).not.toHaveBeenCalled();
    const waiting = deferred<ModifierHook>(); f.load.mockImplementation(() => waiting.promise as Promise<FakeHook>);
    const during = f.controller.start(); await Promise.resolve(); f.controller.stop(); waiting.resolve(f.hook);
    expect(await during).toEqual({state: 'stopped'}); expect(f.hook.eventNames()).toEqual([]); expect(f.hook.start).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('stale loader %s cannot replace or stop a newer start', async outcome => {
    const old = deferred<ModifierHook>(), hook = new FakeHook(), action = vi.fn();
    let count = 0;
    const controller = createModifierShortcut({platform: 'win32', hasAccessibilityPermission: () => false, onActivate: action, loadHook: () => ++count === 1 ? old.promise : Promise.resolve(hook)});
    const first = controller.start(); await Promise.resolve(); controller.stop(); await controller.start();
    if (outcome === 'resolve') old.resolve(hook); else old.reject(Error('old loader failed'));
    await first; expect(controller.status()).toEqual({state: 'ready'}); expect(hook.start).toHaveBeenCalledTimes(1); expect(hook.stop).not.toHaveBeenCalled();
    hook.down(29); hook.down(3613); expect(action).toHaveBeenCalledTimes(1); controller.stop();
  });

  it('catches loading/start failures, removes listeners, and allows explicit retry', async () => {
    const f = fixture(); f.load.mockRejectedValueOnce(Error('raw native error'));
    expect(await f.controller.start()).toEqual({state: 'unavailable', reason: 'load-failed'});
    f.hook.start.mockImplementationOnce(() => { throw Error('raw native error'); });
    expect(await f.controller.start()).toEqual({state: 'unavailable', reason: 'start-failed'});
    expect(f.hook.eventNames()).toEqual([]); expect(f.hook.stop).toHaveBeenCalledTimes(1);
    expect(await f.controller.start()).toEqual({state: 'ready'}); f.controller.stop();
  });

  it('suppresses dispatch after stop failure and requires cleanup before restarting', async () => {
    const f = fixture(); await f.controller.start();
    f.hook.stop.mockImplementationOnce(() => { throw Error('native stop failed'); });
    expect(f.controller.stop()).toEqual({state: 'unavailable', reason: 'stop-failed'});
    f.hook.down(56); f.hook.down(3640); expect(f.activate).not.toHaveBeenCalled(); expect(f.hook.eventNames()).toEqual([]);
    expect(await f.controller.start()).toEqual({state: 'unavailable', reason: 'stop-failed'}); expect(f.hook.start).toHaveBeenCalledTimes(1);
    expect(f.controller.stop()).toEqual({state: 'stopped'}); expect(await f.controller.start()).toEqual({state: 'ready'}); f.controller.stop();
  });

  it('activation failure does not escape dispatch or rearm the held chord', async () => {
    const f = fixture(); f.activate.mockImplementationOnce(() => { throw Error('action failed'); }); await f.controller.start();
    expect(() => { f.hook.down(56); f.hook.down(3640); f.hook.down(3640); }).not.toThrow(); expect(f.activate).toHaveBeenCalledTimes(1);
    f.hook.up(56); f.hook.up(3640); f.activate.mockImplementationOnce(() => Promise.reject(Error('async action failed')));
    f.hook.down(56); f.hook.down(3640); await Promise.resolve(); expect(f.activate).toHaveBeenCalledTimes(2); f.controller.stop();
  });
});
