import type { TaskStatus } from './types';
import type { PlainMessageKey } from '../i18n/t';

export interface RunCenterTask {
  destination: string;
  elapsed: string;
  lastSafeStage: string;
  stage: string;
  status: TaskStatus;
  technicalReference: string;
  title: string;
}

export interface RecentTask {
  elapsed: string;
  status: TaskStatus;
  title: string;
}

export type RecoveryKey =
  | 'codex-missing'
  | 'login-required'
  | 'doctor-warning'
  | 'timeout'
  | 'usage-limit'
  | 'invalid-output'
  | 'diagnostics-hard-failure'
  | 'no-improvement'
  | 'candidate-stale'
  | 'commit-stale'
  | 'project-damage'
  | 'incomplete-journal'
  | 'cancellation'
  | 'crash';

export type RecoveryCopyField = 'happened' | 'protected' | 'short' | 'title';
export type RecoveryCopyKey = `recovery.state.${RecoveryKey}.${RecoveryCopyField}`;

export function getRecoveryCopyKey(
  key: RecoveryKey,
  field: RecoveryCopyField
): RecoveryCopyKey {
  return `recovery.state.${key}.${field}`;
}

export interface RecoveryAction {
  confirmation?: {
    bodyKey: PlainMessageKey;
    confirmLabelKey: PlainMessageKey;
    titleKey: PlainMessageKey;
  };
  destructive?: boolean;
  labelKey: PlainMessageKey;
  variant: 'primary' | 'secondary' | 'quiet' | 'danger';
}

export interface RecoveryFixture {
  actions: readonly RecoveryAction[];
  blocking: boolean;
  key: RecoveryKey;
  technical: string;
}

export const currentTask: RunCenterTask = {
  title: '第三章草稿',
  stage: '已暂停在第 2 个场景，共 3 个',
  elapsed: '已进行 3 分钟',
  lastSafeStage: '上一个安全阶段：场景一草稿已保存',
  destination: '完成后会放入第三章草稿，不会自动正式提交。',
  status: 'recoverable',
  technicalReference: 'task.chapter-3.scene-2'
};

export const recentTasks: readonly RecentTask[] = [
  { title: '第二章检查', status: 'completed', elapsed: '4 分 18 秒' },
  { title: '第二章修订', status: 'completed', elapsed: '6 分 42 秒' },
  { title: '第一章提交预览', status: 'failed', elapsed: '2 分 11 秒' }
];

export const recoveryFixtures: Record<RecoveryKey, RecoveryFixture> = {
  'codex-missing': {
    key: 'codex-missing',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.installGuide', variant: 'primary' },
      { labelKey: 'recovery.action.recheck', variant: 'secondary' },
      { labelKey: 'recovery.action.withoutAi', variant: 'quiet' }
    ],
    technical: 'readiness.codex.not-found'
  },
  'login-required': {
    key: 'login-required',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.loginGuide', variant: 'primary' },
      { labelKey: 'recovery.action.recheck', variant: 'secondary' }
    ],
    technical: 'readiness.codex.login-required'
  },
  'doctor-warning': {
    key: 'doctor-warning',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.continueWriting', variant: 'primary' },
      { labelKey: 'recovery.action.guidance', variant: 'secondary' },
      { labelKey: 'recovery.action.recheck', variant: 'quiet' }
    ],
    technical: 'readiness.doctor.warning'
  },
  timeout: {
    key: 'timeout',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.resumeSafeStage', variant: 'primary' },
      { labelKey: 'recovery.action.retry', variant: 'secondary' },
      { labelKey: 'recovery.action.taskDetails', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.timeout'
  },
  'usage-limit': {
    key: 'usage-limit',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.manualEdit', variant: 'primary' },
      { labelKey: 'recovery.action.tryLater', variant: 'secondary' },
      { labelKey: 'recovery.action.viewProtected', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.usage-unavailable'
  },
  'invalid-output': {
    key: 'invalid-output',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.manualEdit', variant: 'primary' },
      { labelKey: 'recovery.action.regenerate', variant: 'secondary' }
    ],
    technical: 'task.chapter-3.structured-response-invalid'
  },
  'diagnostics-hard-failure': {
    key: 'diagnostics-hard-failure',
    blocking: true,
    actions: [
      { labelKey: 'recovery.action.viewEvidence', variant: 'primary' },
      { labelKey: 'recovery.action.targetedRevision', variant: 'secondary' },
      { labelKey: 'recovery.action.returnManual', variant: 'quiet' }
    ],
    technical: 'review.chapter-2.blocking'
  },
  'no-improvement': {
    key: 'no-improvement',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.returnManual', variant: 'primary' },
      { labelKey: 'recovery.action.keepAlternate', variant: 'secondary' },
      {
        labelKey: 'recovery.action.rejectCandidate',
        variant: 'quiet',
        destructive: true,
        confirmation: {
          titleKey: 'recovery.confirm.reject.title',
          bodyKey: 'recovery.confirm.reject.body',
          confirmLabelKey: 'recovery.confirm.reject.action'
        }
      }
    ],
    technical: 'revision.chapter-2.no-improvement'
  },
  'candidate-stale': {
    key: 'candidate-stale',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.regenerateCandidate', variant: 'primary' },
      { labelKey: 'recovery.action.compareBasis', variant: 'secondary' }
    ],
    technical: 'revision.chapter-2.source-changed'
  },
  'commit-stale': {
    key: 'commit-stale',
    blocking: true,
    actions: [
      { labelKey: 'recovery.action.refreshPreview', variant: 'primary' },
      { labelKey: 'recovery.action.viewRecordChanges', variant: 'secondary' }
    ],
    technical: 'commit-preview.chapter-2.story-record-changed'
  },
  'project-damage': {
    key: 'project-damage',
    blocking: true,
    actions: [
      { labelKey: 'recovery.action.inspectProject', variant: 'primary' },
      {
        labelKey: 'recovery.action.restorePoint',
        variant: 'secondary',
        destructive: true,
        confirmation: {
          titleKey: 'recovery.confirm.restorePoint.title',
          bodyKey: 'recovery.confirm.restorePoint.body',
          confirmLabelKey: 'recovery.confirm.restorePoint.action'
        }
      },
      { labelKey: 'recovery.action.exportDiagnostics', variant: 'quiet' }
    ],
    technical: 'project.rain-radio.structure-mismatch'
  },
  'incomplete-journal': {
    key: 'incomplete-journal',
    blocking: true,
    actions: [
      { labelKey: 'recovery.action.recoverySummary', variant: 'primary' },
      {
        labelKey: 'recovery.action.restoreBeforeCommit',
        variant: 'secondary',
        destructive: true,
        confirmation: {
          titleKey: 'recovery.confirm.restoreBeforeCommit.title',
          bodyKey: 'recovery.confirm.restoreBeforeCommit.body',
          confirmLabelKey: 'recovery.confirm.restoreBeforeCommit.action'
        }
      },
      { labelKey: 'recovery.action.completeRecovery', variant: 'quiet' }
    ],
    technical: 'commit.chapter-2.journal-incomplete'
  },
  cancellation: {
    key: 'cancellation',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.viewProtected', variant: 'primary' },
      { labelKey: 'recovery.action.resumeTask', variant: 'secondary' },
      { labelKey: 'recovery.action.restart', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.cancelled-by-author'
  },
  crash: {
    key: 'crash',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.recoverySummary', variant: 'primary' },
      { labelKey: 'recovery.action.restoreAutosave', variant: 'secondary' },
      {
        labelKey: 'recovery.action.discardTask',
        variant: 'quiet',
        destructive: true,
        confirmation: {
          titleKey: 'recovery.confirm.discardTask.title',
          bodyKey: 'recovery.confirm.discardTask.body',
          confirmLabelKey: 'recovery.confirm.discardTask.action'
        }
      }
    ],
    technical: 'session.previous-close.incomplete'
  }
};

export function getRecoveryFixture(value: string | null): RecoveryFixture | null {
  if (!value || !Object.hasOwn(recoveryFixtures, value)) return null;
  return recoveryFixtures[value as RecoveryKey];
}
