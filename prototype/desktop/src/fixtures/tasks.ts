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
  inspection?: RecoveryInspection;
  labelKey: PlainMessageKey;
  variant: 'primary' | 'secondary' | 'quiet' | 'danger';
}

export interface RecoveryInspection {
  description: string;
  preserved: readonly string[];
  restorePoint: {
    createdAt: string;
    detail: string;
    label: string;
  };
  title: string;
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
      {
        labelKey: 'recovery.action.taskDetails',
        variant: 'quiet',
        inspection: {
          title: '恢复摘要',
          description: '任务停在第二个场景开始前，可以从已经完成的场景一继续。',
          preserved: ['第三章当前草稿', '场景一生成结果'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:48',
            detail: '场景一完成后、场景二开始前创建。',
            label: '第三章场景一草稿'
          }
        }
      }
    ],
    technical: 'task.chapter-3.timeout'
  },
  'usage-limit': {
    key: 'usage-limit',
    blocking: false,
    actions: [
      { labelKey: 'recovery.action.manualEdit', variant: 'primary' },
      { labelKey: 'recovery.action.tryLater', variant: 'secondary' },
      {
        labelKey: 'recovery.action.viewProtected',
        variant: 'quiet',
        inspection: {
          title: '当前草稿与安全阶段',
          description: '额度不可用前完成的正文和任务阶段都已单独保留。',
          preserved: ['第三章当前草稿', '场景一生成结果', '第二章正式故事档案'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:49',
            detail: '最后一次 Codex 请求开始前创建，未包含任何未完成返回。',
            label: '第三章场景一完成'
          }
        }
      }
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
      {
        labelKey: 'recovery.action.viewEvidence',
        variant: 'primary',
        inspection: {
          title: '第二章检查依据',
          description: '关键问题来自同一次订单交接出现两个时间点，原始段落仍完整保留。',
          preserved: ['第二章原始草稿', '时间线冲突证据', '章节检查结果'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:42',
            detail: '章节检查开始前保存，故事档案尚未写入第二章内容。',
            label: '第二章检查前草稿'
          }
        }
      },
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
      {
        labelKey: 'recovery.action.compareBasis',
        variant: 'secondary',
        inspection: {
          title: '候选生成时的依据',
          description: '旧候选基于较早的第二章草稿，当前手动编辑不会被它覆盖。',
          preserved: ['当前第二章草稿', '过期修订候选', '候选生成时的检查依据'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:39',
            detail: '修订候选开始生成前保存，可用于核对草稿差异。',
            label: '候选生成前草稿'
          }
        }
      }
    ],
    technical: 'revision.chapter-2.source-changed'
  },
  'commit-stale': {
    key: 'commit-stale',
    blocking: true,
    actions: [
      { labelKey: 'recovery.action.refreshPreview', variant: 'primary' },
      {
        labelKey: 'recovery.action.viewRecordChanges',
        variant: 'secondary',
        inspection: {
          title: '恢复摘要',
          description: '故事档案在预览之后变化，旧预览仍保留供比较。',
          preserved: ['第二章已接受草稿', '旧提交预览'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:44',
            detail: '第一章正式内容与第二章草稿均保持不变。',
            label: '故事档案变更前'
          }
        }
      }
    ],
    technical: 'commit-preview.chapter-2.story-record-changed'
  },
  'project-damage': {
    key: 'project-damage',
    blocking: true,
    actions: [
      {
        labelKey: 'recovery.action.inspectProject',
        variant: 'primary',
        inspection: {
          title: '恢复摘要',
          description: '作品已在保护模式中打开，可以先核对最近一次完整结构。',
          preserved: ['当前诊断摘要', '受保护的正式内容'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:31',
            detail: '作品结构检查通过后创建的最近安全副本。',
            label: '雨夜电台完整结构'
          }
        }
      },
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
      {
        labelKey: 'recovery.action.recoverySummary',
        variant: 'primary',
        inspection: {
          title: '恢复摘要',
          description: '上次正式提交停在写入完成前，新的正式提交仍被阻止。',
          preserved: ['第二章已接受草稿', '未完成提交记录', '提交前故事档案'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:56',
            detail: '正式提交开始前创建，可用于撤销未完整结束的结果。',
            label: '第二章提交前'
          }
        }
      },
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
      {
        labelKey: 'recovery.action.viewProtected',
        variant: 'primary',
        inspection: {
          title: '已取消任务的保留内容',
          description: '取消只停止后续生成，已经完成的场景和自动保存草稿仍可继续编辑。',
          preserved: ['第三章当前草稿', '场景一生成结果', '取消前任务阶段'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:50',
            detail: '取消请求发出前创建，未继续执行后续场景。',
            label: '第三章场景一草稿'
          }
        }
      },
      { labelKey: 'recovery.action.resumeTask', variant: 'secondary' },
      { labelKey: 'recovery.action.restart', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.cancelled-by-author'
  },
  crash: {
    key: 'crash',
    blocking: false,
    actions: [
      {
        labelKey: 'recovery.action.recoverySummary',
        variant: 'primary',
        inspection: {
          title: '恢复摘要',
          description: '上次关闭前，第二章草稿已自动保存，写作任务没有自动继续。',
          preserved: ['第二章自动保存草稿', '第三章场景一安全阶段'],
          restorePoint: {
            createdAt: '2026 年 7 月 24 日 23:58',
            detail: '比上次正常关闭更新，内容尚未正式提交。',
            label: '第二章自动保存草稿'
          }
        }
      },
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
