import { describe, expect, test } from 'vitest';

import { ProjectSubmissionGuard } from '../../src/main/submission/ProjectSubmissionGuard';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('ProjectSubmissionGuard', () => {
  test('serializes save, adopt, discard and confirm in FIFO order', async () => {
    const guard = new ProjectSubmissionGuard();
    const entered = deferred();
    const release = deferred();
    const events: string[] = [];
    let active = 0;
    const operations = ['save', 'adopt', 'discard', 'confirm'].map((name) => (
      guard.runExclusive('project_a', async () => {
        active += 1;
        expect(active).toBe(1);
        events.push(`${name}:start`);
        if (name === 'save') {
          entered.resolve();
          await release.promise;
        }
        events.push(`${name}:end`);
        active -= 1;
        return name;
      })
    ));
    await entered.promise;
    expect(events).toEqual(['save:start']);
    release.resolve();
    expect(await Promise.all(operations)).toEqual(['save', 'adopt', 'discard', 'confirm']);
    expect(events).toEqual([
      'save:start', 'save:end', 'adopt:start', 'adopt:end',
      'discard:start', 'discard:end', 'confirm:start', 'confirm:end'
    ]);
  });

  test('returns the generic operation result unchanged', async () => {
    const guard = new ProjectSubmissionGuard();
    const result = { chapterNumber: 1, committed: true };
    expect(await guard.runExclusive('project_a', async () => result)).toBe(result);
  });

  test('propagates rejection without poisoning already queued or future operations', async () => {
    const guard = new ProjectSubmissionGuard();
    const release = deferred();
    const failure = new Error('save failed');
    const first = guard.runExclusive('project_a', async () => {
      await release.promise;
      throw failure;
    });
    const rejected = expect(first).rejects.toBe(failure);
    const queued = guard.runExclusive('project_a', async () => 'queued');
    release.resolve();
    await rejected;
    expect(await queued).toBe('queued');
    expect(await guard.runExclusive('project_a', async () => 'later')).toBe('later');
  });

  test('releases the key when an operation throws synchronously', async () => {
    const guard = new ProjectSubmissionGuard();
    const failure = new Error('synchronous failure');
    await expect(guard.runExclusive('project_a', () => { throw failure; })).rejects.toBe(failure);
    expect(await guard.runExclusive('project_a', async () => 42)).toBe(42);
  });

  test('does not block another project behind a pending operation', async () => {
    const guard = new ProjectSubmissionGuard();
    const entered = deferred();
    const release = deferred();
    const first = guard.runExclusive('project_a', async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    try {
      expect(await guard.runExclusive('project_b', async () => 'independent')).toBe('independent');
    } finally {
      release.resolve();
      await first;
    }
  });

  test('completion of an older operation cannot drop the lock for a pending successor', async () => {
    const guard = new ProjectSubmissionGuard();
    const release = deferred();
    const secondEntered = deferred();
    const events: string[] = [];
    const first = guard.runExclusive('project_a', async () => {});
    const second = guard.runExclusive('project_a', async () => {
      events.push('second:start');
      secondEntered.resolve();
      await release.promise;
      events.push('second:end');
    });
    await first;
    await secondEntered.promise;
    const third = guard.runExclusive('project_a', async () => { events.push('third'); });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['second:start']);
    release.resolve();
    await Promise.all([second, third]);
    expect(events).toEqual(['second:start', 'second:end', 'third']);
  });
});
