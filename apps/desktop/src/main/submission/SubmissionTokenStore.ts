import { randomBytes as nodeRandomBytes } from 'node:crypto';

const TOKEN_BYTES = 24;
const TOKEN_TTL_MS = 30 * 60 * 1_000;
const MAX_BINDINGS = 200;
const MAX_RANDOM_ATTEMPTS = 10;

/** Main-only identity: projectRoot must already be resolved by trusted main code. */
export interface SubmissionTokenBinding {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly chapterNumber: number;
  readonly previewId: string;
  readonly manifestHash: string;
}

export interface SubmissionTokenStoreDependencies {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
}

/** A main-only capability; never return the handle or its binding to renderer. */
export interface SubmissionTokenReservation {
  readonly binding: SubmissionTokenBinding;
  /** Call immediately before the first possible write. Burns the token; throws if expired. */
  markMutationStarted(): void;
  /** Finalize success once, including an admitted write that finished after token expiry. */
  consume(): boolean;
  /** Finalize failure without allowing retry. */
  invalidate(): boolean;
  /** Explicit retry permission, only when no mutation has started and TTL is still valid. */
  releaseBeforeMutation(): boolean;
}

export interface SubmissionTokenStoreContract {
  issue(binding: SubmissionTokenBinding): string;
  reserve(token: string, expected: SubmissionTokenBinding): SubmissionTokenReservation | null;
}

interface TokenEntry {
  readonly binding: SubmissionTokenBinding;
  readonly expiresAtMs: number;
  state: 'available' | 'reserved' | 'burned';
}

/** In-memory only. A new instance never restores authorization from disk. */
export class SubmissionTokenStore implements SubmissionTokenStoreContract {
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly entries = new Map<string, TokenEntry>();

  constructor(dependencies: SubmissionTokenStoreDependencies = {}) {
    this.now = dependencies.now ?? Date.now;
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  }

  issue(binding: SubmissionTokenBinding): string {
    const now = this.now();
    this.pruneExpired(now);
    if (this.entries.size >= MAX_BINDINGS) {
      throw new Error('Submission token capacity is exhausted.');
    }
    for (let attempt = 0; attempt < MAX_RANDOM_ATTEMPTS; attempt += 1) {
      const bytes = this.randomBytes(TOKEN_BYTES);
      if (bytes.byteLength !== TOKEN_BYTES) {
        throw new Error('Submission token entropy source returned the wrong size.');
      }
      const token = `submission_${Buffer.from(bytes).toString('hex')}`;
      if (this.entries.has(token)) continue;
      this.entries.set(token, {
        binding: Object.freeze({
          projectKey: binding.projectKey,
          projectRoot: binding.projectRoot,
          chapterNumber: binding.chapterNumber,
          previewId: binding.previewId,
          manifestHash: binding.manifestHash
        }),
        expiresAtMs: now + TOKEN_TTL_MS,
        state: 'available'
      });
      return token;
    }
    throw new Error('Unable to allocate a unique submission token.');
  }

  reserve(token: string, expected: SubmissionTokenBinding): SubmissionTokenReservation | null {
    this.pruneExpired(this.now());
    const entry = this.entries.get(token);
    if (
      entry === undefined
      || entry.state !== 'available'
      || !sameBinding(entry.binding, expected)
    ) return null;

    entry.state = 'reserved';
    let phase: 'reserved' | 'mutating' | 'closed' = 'reserved';
    const isLive = (): boolean => (
      phase === 'reserved'
      && entry.state === 'reserved'
      && this.entries.get(token) === entry
      && this.now() < entry.expiresAtMs
    );
    const finish = (): boolean => {
      const valid = phase === 'mutating' || isLive();
      if (valid) entry.state = 'burned';
      phase = 'closed';
      return valid;
    };

    return Object.freeze({
      binding: entry.binding,
      markMutationStarted: (): void => {
        if (!isLive()) {
          throw new Error('Submission token reservation is no longer valid.');
        }
        // Revoke before writing: a thrown operation cannot accidentally release authorization.
        entry.state = 'burned';
        phase = 'mutating';
      },
      consume: finish,
      invalidate: finish,
      releaseBeforeMutation: (): boolean => {
        if (!isLive()) return false;
        entry.state = 'available';
        phase = 'closed';
        return true;
      }
    });
  }

  private pruneExpired(now: number): void {
    // Keep burned entries until expiry so random collisions cannot revive spent tokens.
    for (const [token, entry] of this.entries) {
      if (now >= entry.expiresAtMs) this.entries.delete(token);
    }
  }
}

function sameBinding(stored: SubmissionTokenBinding, expected: SubmissionTokenBinding): boolean {
  return stored.projectKey === expected.projectKey
    && stored.projectRoot === expected.projectRoot
    && stored.chapterNumber === expected.chapterNumber
    && stored.previewId === expected.previewId
    && stored.manifestHash === expected.manifestHash;
}
