import { Command } from 'commander';

import { registerArtifactsCommand } from './commands/artifacts.js';
import { registerAuditCommand } from './commands/audit.js';
import { registerBuildBibleCommand } from './commands/buildBible.js';
import { registerChapterCommand } from './commands/chapter.js';
import { registerCommitChapterCommand } from './commands/commitChapter.js';
import { registerCompactProvenanceCommand } from './commands/compactProvenance.js';
import { registerCodexCommand } from './commands/codex.js';
import { registerDiffStateCommand } from './commands/diffState.js';
import { registerEvaluateChapterCommand } from './commands/evaluateChapter.js';
import { registerInitCommand } from './commands/init.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerPlanGlobalCommand } from './commands/planGlobal.js';
import { registerProvidersCommand } from './commands/providers.js';
import { registerRecommitCommand } from './commands/recommit.js';
import { registerRegenerationPlanCommand } from './commands/regenerationPlan.js';
import { registerRetentionCommand } from './commands/retention.js';
import { registerReviewCommand } from './commands/review.js';
import { registerRollbackCommand } from './commands/rollback.js';
import { registerRunCommand } from './commands/run.js';
import { registerRunsCommand } from './commands/runs.js';
import { registerSnapshotCommand } from './commands/snapshot.js';
import { registerSnapshotsCommand } from './commands/snapshots.js';
import { registerStaleCommand } from './commands/stale.js';
import { registerStressFixtureCommand } from './commands/stressFixture.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerVerifySnapshotsCommand } from './commands/verifySnapshots.js';

export function createProgram(): Command {
  const program = new Command()
    .name('novel-loop')
    .description('Novel Loop Engine local-first CLI')
    .version('0.1.0')
    .showHelpAfterError();

  registerInitCommand(program);
  registerValidateCommand(program);
  registerBuildBibleCommand(program);
  registerPlanGlobalCommand(program);
  registerProvidersCommand(program);
  registerChapterCommand(program);
  registerInspectCommand(program);
  registerRollbackCommand(program);
  registerCommitChapterCommand(program);
  registerReviewCommand(program);
  registerDiffStateCommand(program);
  registerEvaluateChapterCommand(program);
  registerRecommitCommand(program);
  registerStaleCommand(program);
  registerRegenerationPlanCommand(program);
  registerArtifactsCommand(program);
  registerRunsCommand(program);
  registerRunCommand(program);
  registerSnapshotsCommand(program);
  registerSnapshotCommand(program);
  registerVerifySnapshotsCommand(program);
  registerAuditCommand(program);
  registerStressFixtureCommand(program);
  registerRetentionCommand(program);
  registerCompactProvenanceCommand(program);
  registerCodexCommand(program);

  return program;
}
