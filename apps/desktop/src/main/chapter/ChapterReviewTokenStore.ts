import { randomBytes as nodeRandomBytes } from 'node:crypto';

const TOKEN_BYTES = 24;
const TOKEN_TTL_MS = 30 * 60 * 1_000;
const MAX_REVIEW_BINDINGS = 200;
const MAX_REVISION_BINDINGS = 500;

export type ChapterReviewOptionPurpose =
  | 'direction'
  | 'objective'
  | 'debt'
  | 'participant';

export type ChapterRevisionPurpose = 'mission' | 'plan';

export interface StoredReviewToken {
  projectKey: string;
  projectRoot: string;
  chapterNumber: number;
  latestCommittedChapter: number;
  reviewHash: string;
  optionBindings: ReadonlyMap<string, string>;
  createdAtMs: number;
  purpose: 'chapter_authoring';
  missionHash: string;
  optionPurposes: ReadonlyMap<string, ChapterReviewOptionPurpose>;
}

export interface StoredRevisionToken {
  projectKey: string;
  projectRoot: string;
  chapterNumber: number;
  latestCommittedChapter: number;
  purpose: ChapterRevisionPurpose;
  sourceHash: string;
  revisionId: string;
  createdAtMs: number;
}

interface TokenStoreDependencies {
  now?: () => number;
  randomBytes?: (size: number) => Uint8Array;
}

interface CreateReviewInput {
  projectKey: string;
  projectRoot: string;
  chapterNumber: number;
  latestCommittedChapter: number;
  reviewHash: string;
  missionHash: string;
  options: ReadonlyArray<{
    purpose: ChapterReviewOptionPurpose;
    trustedId: string;
  }>;
}

interface ResolveReviewInput {
  projectKey: string;
  projectRoot: string;
  reviewToken: string;
  currentLatestCommittedChapter: number;
  currentReviewHash: string;
}

interface ResolveOptionInput extends ResolveReviewInput {
  optionToken: string;
  purpose: ChapterReviewOptionPurpose;
}

interface CreateRevisionInput {
  projectKey: string;
  projectRoot: string;
  chapterNumber: number;
  latestCommittedChapter: number;
  purpose: ChapterRevisionPurpose;
  sourceHash: string;
  revisionId: string;
}

interface ConsumeRevisionInput {
  projectKey: string;
  projectRoot: string;
  revisionToken: string;
  currentLatestCommittedChapter: number;
}

type StaleTokenResult = {
  outcome: 'stale';
  messageKey: 'stale_edit';
};

type TokenResolution<T> =
  | { outcome: 'resolved'; value: T }
  | StaleTokenResult;

export class ChapterReviewTokenStore {
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly reviews = new Map<string, StoredReviewToken>();
  private readonly revisions = new Map<string, StoredRevisionToken>();

  constructor(dependencies: TokenStoreDependencies = {}) {
    this.now = dependencies.now ?? Date.now;
    this.randomBytes = dependencies.randomBytes ?? nodeRandomBytes;
  }

  createReview(input: CreateReviewInput): {
    reviewToken: string;
    options: Array<{
      optionToken: string;
      purpose: ChapterReviewOptionPurpose;
      trustedId: string;
    }>;
  } {
    this.pruneExpired();
    const reviewToken = this.createUniqueToken('chapter_review', this.reviews);
    const optionTokens = new Set<string>();
    const options = input.options.map((option) => {
      const optionToken = this.createUniqueOptionToken(optionTokens);
      optionTokens.add(optionToken);
      return { optionToken, ...option };
    });
    const createdAtMs = this.now();
    this.reviews.set(reviewToken, {
      projectKey: input.projectKey,
      projectRoot: input.projectRoot,
      chapterNumber: input.chapterNumber,
      latestCommittedChapter: input.latestCommittedChapter,
      reviewHash: input.reviewHash,
      optionBindings: new Map(options.map(({ optionToken, trustedId }) => (
        [optionToken, trustedId]
      ))),
      createdAtMs,
      purpose: 'chapter_authoring',
      missionHash: input.missionHash,
      optionPurposes: new Map(options.map(({ optionToken, purpose }) => (
        [optionToken, purpose]
      )))
    });
    this.enforceCapacity(this.reviews, MAX_REVIEW_BINDINGS);
    return { reviewToken, options };
  }

  resolveReview(
    input: ResolveReviewInput
  ): TokenResolution<StoredReviewToken> {
    this.pruneExpired();
    const review = this.reviews.get(input.reviewToken);
    if (
      review === undefined
      || review.projectKey !== input.projectKey
      || review.projectRoot !== input.projectRoot
      || review.latestCommittedChapter
        !== input.currentLatestCommittedChapter
      || review.reviewHash !== input.currentReviewHash
    ) {
      return staleTokenResult();
    }
    return { outcome: 'resolved', value: review };
  }

  resolveOption(input: ResolveOptionInput): TokenResolution<{
    chapterNumber: number;
    latestCommittedChapter: number;
    reviewHash: string;
    missionHash: string;
    trustedId: string;
  }> {
    const resolved = this.resolveReview(input);
    if (resolved.outcome === 'stale') return resolved;
    const trustedId = resolved.value.optionBindings.get(input.optionToken);
    if (
      trustedId === undefined
      || resolved.value.optionPurposes.get(input.optionToken) !== input.purpose
    ) {
      return staleTokenResult();
    }
    return {
      outcome: 'resolved',
      value: {
        chapterNumber: resolved.value.chapterNumber,
        latestCommittedChapter: resolved.value.latestCommittedChapter,
        reviewHash: resolved.value.reviewHash,
        missionHash: resolved.value.missionHash,
        trustedId
      }
    };
  }

  createRevision(input: CreateRevisionInput): string {
    this.pruneExpired();
    const revisionToken = this.createUniqueToken(
      'chapter_revision',
      this.revisions
    );
    this.revisions.set(revisionToken, {
      ...input,
      createdAtMs: this.now()
    });
    this.enforceCapacity(this.revisions, MAX_REVISION_BINDINGS);
    return revisionToken;
  }

  consumeRevision(
    input: ConsumeRevisionInput
  ): TokenResolution<StoredRevisionToken> {
    this.pruneExpired();
    const revision = this.revisions.get(input.revisionToken);
    if (
      revision === undefined
      || revision.projectKey !== input.projectKey
      || revision.projectRoot !== input.projectRoot
      || revision.latestCommittedChapter
        !== input.currentLatestCommittedChapter
    ) {
      return staleTokenResult();
    }
    this.revisions.delete(input.revisionToken);
    return { outcome: 'resolved', value: revision };
  }

  private createUniqueOptionToken(existing: ReadonlySet<string>): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.createToken('chapter_option');
      if (!existing.has(token)) return token;
    }
    throw new Error('Unable to allocate a unique chapter option token.');
  }

  private createUniqueToken<T>(prefix: string, store: ReadonlyMap<string, T>): string {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const token = this.createToken(prefix);
      if (!store.has(token)) return token;
    }
    throw new Error('Unable to allocate a unique chapter token.');
  }

  private createToken(prefix: string): string {
    const bytes = this.randomBytes(TOKEN_BYTES);
    if (bytes.byteLength !== TOKEN_BYTES) {
      throw new Error('Chapter token entropy source returned the wrong size.');
    }
    return `${prefix}_${Buffer.from(bytes).toString('hex')}`;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [token, review] of this.reviews) {
      if (now - review.createdAtMs >= TOKEN_TTL_MS) {
        this.reviews.delete(token);
      }
    }
    for (const [token, revision] of this.revisions) {
      if (now - revision.createdAtMs >= TOKEN_TTL_MS) {
        this.revisions.delete(token);
      }
    }
  }

  private enforceCapacity<T>(store: Map<string, T>, capacity: number): void {
    while (store.size > capacity) {
      const oldestToken = store.keys().next().value as string | undefined;
      if (oldestToken === undefined) return;
      store.delete(oldestToken);
    }
  }
}

function staleTokenResult(): StaleTokenResult {
  return { outcome: 'stale', messageKey: 'stale_edit' };
}
