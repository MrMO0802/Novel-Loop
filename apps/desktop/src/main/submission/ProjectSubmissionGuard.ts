export interface ProjectSubmissionGuardContract {
  runExclusive<T>(projectKey: string, operation: () => Promise<T>): Promise<T>;
}

/** Share one instance across main services. Not reentrant and not a cross-process lock. */
export class ProjectSubmissionGuard implements ProjectSubmissionGuardContract {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(projectKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(projectKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(projectKey, current);

    // Queue completion is independent of the operation's result, so errors cannot poison it.
    await previous;
    try {
      return await operation();
    } finally {
      if (this.tails.get(projectKey) === current) this.tails.delete(projectKey);
      release();
    }
  }
}
