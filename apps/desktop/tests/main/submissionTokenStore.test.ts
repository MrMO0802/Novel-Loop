import { describe, expect, test, vi } from 'vitest';

import {
  SubmissionTokenStore,
  type SubmissionTokenBinding,
  type SubmissionTokenReservation
} from '../../src/main/submission/SubmissionTokenStore';

const binding: SubmissionTokenBinding = {
  projectKey: 'project_submission',
  projectRoot: '/trusted/project',
  chapterNumber: 1,
  previewId: 'preview_v1',
  manifestHash: 'a'.repeat(64)
};

function makeStore() {
  let now = 1_000;
  let sequence = 0;
  const randomBytes = vi.fn((size: number) => {
    const bytes = Buffer.alloc(size);
    bytes.writeUInt32BE(++sequence);
    return bytes;
  });
  const store = new SubmissionTokenStore({ now: () => now, randomBytes });
  return { store, randomBytes, advance: (ms: number) => { now += ms; } };
}

function reserve(store: SubmissionTokenStore, token: string): SubmissionTokenReservation {
  const reservation = store.reserve(token, binding);
  expect(reservation).not.toBeNull();
  if (reservation === null) throw new Error('Expected a reservation.');
  return reservation;
}

describe('SubmissionTokenStore', () => {
  test('issues opaque tokens from exactly 24 random bytes', () => {
    const { store, randomBytes } = makeStore();
    const token = store.issue(binding);
    expect(token).toMatch(/^submission_[a-f0-9]{48}$/u);
    expect(randomBytes).toHaveBeenCalledWith(24);
    expect(reserve(store, token).binding).toEqual(binding);
  });

  test('uses real entropy by default without recovering another instance authorization', () => {
    const first = new SubmissionTokenStore();
    const oldToken = first.issue(binding);
    const restarted = new SubmissionTokenStore();
    expect(restarted.reserve(oldToken, binding)).toBeNull();
    const freshToken = restarted.issue(binding);
    expect(freshToken).toMatch(/^submission_[a-f0-9]{48}$/u);
    expect(freshToken).not.toBe(oldToken);
    expect(restarted.reserve(oldToken, binding)).toBeNull();
    reserve(restarted, freshToken);
  });

  test.each([
    ['projectKey', 'other_project'],
    ['projectRoot', '/trusted/replaced-project'],
    ['chapterNumber', 2],
    ['previewId', 'preview_v2'],
    ['manifestHash', 'b'.repeat(64)]
  ] as const)('rejects a mismatched %s without reserving the token', (field, value) => {
    const { store } = makeStore();
    const token = store.issue(binding);
    expect(store.reserve(token, { ...binding, [field]: value })).toBeNull();
    reserve(store, token);
  });

  test('rejects unknown and malformed tokens', () => {
    const { store } = makeStore();
    for (const token of ['', 'submission_bad', `submission_${'f'.repeat(48)}`]) {
      expect(store.reserve(token, binding)).toBeNull();
    }
  });

  test('copies the binding and prevents reservation callers from changing it', () => {
    const { store } = makeStore();
    const input = { ...binding };
    const token = store.issue(input);
    input.projectRoot = '/changed';
    const reservation = reserve(store, token);
    expect(Reflect.set(reservation.binding, 'projectRoot', '/changed')).toBe(false);
    expect(reservation.binding).toEqual(binding);
    expect(reservation.releaseBeforeMutation()).toBe(true);
    expect(store.reserve(token, input)).toBeNull();
    reserve(store, token);
  });

  test('expires at exactly 30 minutes without extending TTL on reserve or release', () => {
    const { store, advance } = makeStore();
    const token = store.issue(binding);
    advance(30 * 60 * 1_000 - 1);
    expect(reserve(store, token).releaseBeforeMutation()).toBe(true);
    advance(1);
    expect(store.reserve(token, binding)).toBeNull();
  });

  test('an expired reservation cannot authorize the first mutation or be released', () => {
    const { store, advance } = makeStore();
    const token = store.issue(binding);
    const reservation = reserve(store, token);
    advance(30 * 60 * 1_000);
    expect(() => reservation.markMutationStarted()).toThrow();
    expect(reservation.releaseBeforeMutation()).toBe(false);
    expect(reservation.consume()).toBe(false);
    expect(store.reserve(token, binding)).toBeNull();
  });

  test('allows only one of simultaneous confirmation attempts to reserve', async () => {
    const { store } = makeStore();
    const token = store.issue(binding);
    const attempts = await Promise.all(Array.from({ length: 20 }, async () => (
      store.reserve(token, binding)
    )));
    expect(attempts.filter((attempt) => attempt !== null)).toHaveLength(1);
  });

  test('consumes once and rejects repeated consumption and reservation', () => {
    const { store } = makeStore();
    const token = store.issue(binding);
    const reservation = reserve(store, token);
    expect(reservation.consume()).toBe(true);
    expect(reservation.consume()).toBe(false);
    expect(reservation.invalidate()).toBe(false);
    expect(reservation.releaseBeforeMutation()).toBe(false);
    expect(store.reserve(token, binding)).toBeNull();
  });

  test('explicit pre-write release permits retry but an old handle cannot affect it', () => {
    const { store } = makeStore();
    const token = store.issue(binding);
    const old = reserve(store, token);
    expect(old.releaseBeforeMutation()).toBe(true);
    const current = reserve(store, token);
    expect(old.releaseBeforeMutation()).toBe(false);
    expect(old.consume()).toBe(false);
    expect(old.invalidate()).toBe(false);
    expect(() => old.markMutationStarted()).toThrow();
    expect(store.reserve(token, binding)).toBeNull();
    expect(current.consume()).toBe(true);
  });

  test('pre-write invalidation revokes rather than releases the token', () => {
    const { store } = makeStore();
    const token = store.issue(binding);
    const reservation = reserve(store, token);
    expect(reservation.invalidate()).toBe(true);
    expect(reservation.releaseBeforeMutation()).toBe(false);
    expect(store.reserve(token, binding)).toBeNull();
  });

  test('failure after the mutation boundary cannot make the token reusable', async () => {
    const { store } = makeStore();
    const token = store.issue(binding);
    const reservation = reserve(store, token);
    const failure = new Error('simulated write failure');
    await expect((async () => {
      reservation.markMutationStarted();
      throw failure;
    })()).rejects.toBe(failure);
    expect(reservation.releaseBeforeMutation()).toBe(false);
    expect(store.reserve(token, binding)).toBeNull();
    expect(reservation.invalidate()).toBe(true);
    expect(reservation.consume()).toBe(false);
  });

  test('a mutation admitted before expiry can finish after expiry, but never be reused', () => {
    const { store, advance } = makeStore();
    const token = store.issue(binding);
    const reservation = reserve(store, token);
    reservation.markMutationStarted();
    advance(30 * 60 * 1_000);
    expect(store.reserve(token, binding)).toBeNull();
    expect(reservation.consume()).toBe(true);
    expect(reservation.consume()).toBe(false);
  });

  test('rejects the 201st live binding without evicting existing authorizations', () => {
    const { store, randomBytes } = makeStore();
    const tokens = Array.from({ length: 200 }, () => store.issue(binding));
    expect(() => store.issue(binding)).toThrow(/capacity/iu);
    expect(randomBytes).toHaveBeenCalledTimes(200);
    for (const token of tokens) reserve(store, token);
    expect(() => store.issue(binding)).toThrow(/capacity/iu);
  });

  test('reclaims expired bindings including abandoned reservations at capacity', () => {
    const { store, advance } = makeStore();
    const tokens = Array.from({ length: 200 }, () => store.issue(binding));
    const abandoned = reserve(store, tokens[0]!);
    advance(30 * 60 * 1_000);
    const token = store.issue(binding);
    reserve(store, token);
    expect(abandoned.releaseBeforeMutation()).toBe(false);
    for (const old of tokens) expect(store.reserve(old, binding)).toBeNull();
  });

  test('retries random collisions without overwriting a reserved binding', () => {
    const randomBytes = vi.fn()
      .mockReturnValueOnce(Buffer.alloc(24, 1))
      .mockReturnValueOnce(Buffer.alloc(24, 1))
      .mockReturnValueOnce(Buffer.alloc(24, 2));
    const store = new SubmissionTokenStore({ randomBytes });
    const first = store.issue(binding);
    const held = reserve(store, first);
    const secondBinding = { ...binding, previewId: 'preview_v2' };
    const second = store.issue(secondBinding);
    expect(second).not.toBe(first);
    expect(randomBytes).toHaveBeenCalledTimes(3);
    expect(store.reserve(first, secondBinding)).toBeNull();
    expect(held.consume()).toBe(true);
    expect(store.reserve(second, secondBinding)?.binding).toEqual(secondBinding);
  });

  test.each(['consumed', 'invalidated', 'mutating'] as const)(
    'does not resurrect a %s token on a random collision within its TTL',
    (state) => {
      const randomBytes = vi.fn()
        .mockReturnValueOnce(Buffer.alloc(24, 1))
        .mockReturnValueOnce(Buffer.alloc(24, 1))
        .mockReturnValueOnce(Buffer.alloc(24, 2));
      const store = new SubmissionTokenStore({ randomBytes });
      const token = store.issue(binding);
      const held = reserve(store, token);
      if (state === 'consumed') held.consume();
      else if (state === 'invalidated') held.invalidate();
      else held.markMutationStarted();
      expect(store.issue(binding)).not.toBe(token);
      expect(store.reserve(token, binding)).toBeNull();
    }
  );

  test('fails closed after ten collisions, without leaking token or project in errors', () => {
    const randomBytes = vi.fn(() => Buffer.alloc(24, 1));
    const store = new SubmissionTokenStore({ randomBytes });
    const token = store.issue(binding);
    let error: unknown;
    try { store.issue(binding); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toMatch(/unique/iu);
    expect(String(error)).not.toContain(token);
    expect(String(error)).not.toContain(binding.projectRoot);
    expect(randomBytes).toHaveBeenCalledTimes(11);
    reserve(store, token);
  });

  test.each([0, 23, 25])('rejects an entropy source returning %i bytes', (size) => {
    const store = new SubmissionTokenStore({ randomBytes: () => Buffer.alloc(size) });
    expect(() => store.issue(binding)).toThrow(/entropy/iu);
  });
});
