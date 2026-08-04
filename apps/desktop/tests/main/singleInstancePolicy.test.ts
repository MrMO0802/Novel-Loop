import { describe, expect, test, vi } from 'vitest';

import { installSingleInstancePolicy } from '../../src/main/singleInstancePolicy';

describe('single-instance policy', () => {
  test('quits before startup when another desktop instance owns the lock', () => {
    const quit = vi.fn();
    const onSecondInstance = vi.fn();

    const primary = installSingleInstancePolicy({
      requestLock: () => false,
      quit,
      onSecondInstance,
      getWindows: () => []
    });

    expect(primary).toBe(false);
    expect(quit).toHaveBeenCalledOnce();
    expect(onSecondInstance).not.toHaveBeenCalled();
  });

  test('restores, shows, and focuses the primary window for a second launch', () => {
    const secondInstanceListeners: Array<() => void> = [];
    const restore = vi.fn();
    const show = vi.fn();
    const focus = vi.fn();

    const primary = installSingleInstancePolicy({
      requestLock: () => true,
      quit: vi.fn(),
      onSecondInstance: (listener) => {
        secondInstanceListeners.push(listener);
      },
      getWindows: () => [{
        isMinimized: () => true,
        restore,
        show,
        focus
      }]
    });

    expect(primary).toBe(true);
    const secondInstanceListener = secondInstanceListeners[0];
    if (secondInstanceListener === undefined) {
      throw new Error('Expected a second-instance listener.');
    }
    secondInstanceListener();
    expect(restore).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
