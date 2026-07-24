import type { TaskStatus } from './types';

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

export interface RecoveryAction {
  confirmation?: {
    body: string;
    confirmLabel: string;
    title: string;
  };
  destructive?: boolean;
  label: string;
  variant: 'primary' | 'secondary' | 'quiet' | 'danger';
}

export interface RecoveryFixture {
  actions: readonly RecoveryAction[];
  blocking: boolean;
  happened: string;
  key: RecoveryKey;
  protectedCopy: string;
  shortLabel: string;
  technical: string;
  title: string;
}

export const currentTask: RunCenterTask = {
  title: '第三章草稿',
  stage: '正在写第 2 个场景，共 3 个',
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
    shortLabel: 'Codex 准备',
    title: '这台电脑上还没有找到 Codex',
    happened: 'Novel Loop 没有找到可用的 Codex，因此需要 AI 的任务没有开始。',
    protectedCopy: '作品内容和故事档案都没有改变。',
    blocking: false,
    actions: [
      { label: '查看安装说明', variant: 'primary' },
      { label: '重新检查', variant: 'secondary' },
      { label: '暂时不用 AI', variant: 'quiet' }
    ],
    technical: 'readiness.codex.not-found'
  },
  'login-required': {
    key: 'login-required',
    shortLabel: 'Codex 登录',
    title: 'Codex 需要先完成登录',
    happened: 'Codex 已经可用，但当前还不能开始需要 AI 的任务。',
    protectedCopy: '登录信息不会显示在 Novel Loop 中，作品也没有改变。',
    blocking: false,
    actions: [
      { label: '查看登录说明', variant: 'primary' },
      { label: '重新检查', variant: 'secondary' }
    ],
    technical: 'readiness.codex.login-required'
  },
  'doctor-warning': {
    key: 'doctor-warning',
    shortLabel: '配置提醒',
    title: '写作功能可用，但有一项配置提醒',
    happened: '准备检查发现一项提醒，但文本创作与结构化整理都可以使用。',
    protectedCopy: '当前作品可以继续编辑，已有内容不会受这项提醒影响。',
    blocking: false,
    actions: [
      { label: '继续写作', variant: 'primary' },
      { label: '查看处理建议', variant: 'secondary' },
      { label: '重新检查', variant: 'quiet' }
    ],
    technical: 'readiness.doctor.warning'
  },
  timeout: {
    key: 'timeout',
    shortLabel: '写作任务',
    title: '写作任务用时超过预期',
    happened: '任务已经在安全位置暂停，没有继续等待未完成的内容。',
    protectedCopy: '你的草稿和已经完成的阶段都已保留。',
    blocking: false,
    actions: [
      { label: '从上一个安全阶段继续', variant: 'primary' },
      { label: '重新尝试', variant: 'secondary' },
      { label: '查看任务详情', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.timeout'
  },
  'usage-limit': {
    key: 'usage-limit',
    shortLabel: '写作任务',
    title: '当前暂时无法继续使用 Codex',
    happened: '当前使用额度不可用，Novel Loop 已停止请求新的内容。',
    protectedCopy: '草稿已经保留，故事档案没有任何变化。',
    blocking: false,
    actions: [
      { label: '继续手动编辑', variant: 'primary' },
      { label: '稍后再试', variant: 'secondary' },
      { label: '查看已保留内容', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.usage-unavailable'
  },
  'invalid-output': {
    key: 'invalid-output',
    shortLabel: '生成内容',
    title: '返回的内容无法安全使用',
    happened: 'Novel Loop 无法确认返回内容的结构，因此没有采用它。',
    protectedCopy: '这次返回没有应用到草稿或故事档案。',
    blocking: false,
    actions: [
      { label: '继续手动编辑', variant: 'primary' },
      { label: '重新生成', variant: 'secondary' }
    ],
    technical: 'task.chapter-3.structured-response-invalid'
  },
  'diagnostics-hard-failure': {
    key: 'diagnostics-hard-failure',
    shortLabel: '第二章检查',
    title: '第二章仍有关键一致性问题',
    happened: '章节检查发现必须先处理的矛盾，本章还不能准备正式提交。',
    protectedCopy: '本章保持为草稿，正式提交入口已经暂停。',
    blocking: true,
    actions: [
      { label: '查看正文依据', variant: 'primary' },
      { label: '创建针对性修订', variant: 'secondary' },
      { label: '返回手动修改', variant: 'quiet' }
    ],
    technical: 'review.chapter-2.blocking'
  },
  'no-improvement': {
    key: 'no-improvement',
    shortLabel: '第二章修订',
    title: '这份修订没有解决选中的问题',
    happened: '比较结果显示候选稿没有改善本次要处理的矛盾。',
    protectedCopy: '原稿保持不变，候选稿没有替换任何内容。',
    blocking: false,
    actions: [
      { label: '返回手动修改', variant: 'primary' },
      { label: '保留为备选版本', variant: 'secondary' },
      {
        label: '拒绝这份候选',
        variant: 'quiet',
        destructive: true,
        confirmation: {
          title: '确认拒绝这份候选？',
          body: '候选稿会从当前审阅中移除，原稿和手动编辑仍会保留。',
          confirmLabel: '拒绝候选并保留原稿'
        }
      }
    ],
    technical: 'revision.chapter-2.no-improvement'
  },
  'candidate-stale': {
    key: 'candidate-stale',
    shortLabel: '第二章修订',
    title: '修订候选已经过期',
    happened: '候选生成后，章节草稿或检查依据发生了变化。',
    protectedCopy: '你后来修改的草稿已经保留，旧候选不会覆盖它。',
    blocking: false,
    actions: [
      { label: '重新生成候选', variant: 'primary' },
      { label: '比较生成依据', variant: 'secondary' }
    ],
    technical: 'revision.chapter-2.source-changed'
  },
  'commit-stale': {
    key: 'commit-stale',
    shortLabel: '第二章提交预览',
    title: '提交预览已经过期',
    happened: '故事档案在这份预览生成后发生了变化。',
    protectedCopy: '第二章和故事档案都没有被正式提交。',
    blocking: true,
    actions: [
      { label: '刷新提交预览', variant: 'primary' },
      { label: '查看最近的故事档案变化', variant: 'secondary' }
    ],
    technical: 'commit-preview.chapter-2.story-record-changed'
  },
  'project-damage': {
    key: 'project-damage',
    shortLabel: '作品结构',
    title: '作品结构需要先检查',
    happened: '部分作品内容与预期结构不一致，Novel Loop 无法确认正式内容是否完整。',
    protectedCopy: '作品已用保护模式打开，正式内容写入已暂停。',
    blocking: true,
    actions: [
      { label: '检查作品', variant: 'primary' },
      {
        label: '从安全还原点恢复',
        variant: 'secondary',
        destructive: true,
        confirmation: {
          title: '确认使用安全还原点恢复？',
          body: '恢复会替换当前受损的正式内容；当前诊断信息会另外保留供检查。',
          confirmLabel: '恢复并保留当前诊断副本'
        }
      },
      { label: '导出诊断摘要', variant: 'quiet' }
    ],
    technical: 'project.rain-radio.structure-mismatch'
  },
  'incomplete-journal': {
    key: 'incomplete-journal',
    shortLabel: '正式提交',
    title: '上一次正式提交没有完整结束',
    happened: 'Novel Loop 检测到一次未完成的正式提交，需要先确认恢复结果。',
    protectedCopy: '新的正式提交已被阻止，提交前的内容仍可恢复。',
    blocking: true,
    actions: [
      { label: '查看恢复摘要', variant: 'primary' },
      {
        label: '恢复提交前状态',
        variant: 'secondary',
        destructive: true,
        confirmation: {
          title: '确认恢复提交前状态？',
          body: '恢复会撤销未完整结束的提交结果，并保留恢复摘要。',
          confirmLabel: '恢复提交前状态并保留摘要'
        }
      },
      { label: '完成安全恢复', variant: 'quiet' }
    ],
    technical: 'commit.chapter-2.journal-incomplete'
  },
  cancellation: {
    key: 'cancellation',
    shortLabel: '已取消任务',
    title: '任务已经取消',
    happened: '任务按照你的请求停止，没有继续生成后续内容。',
    protectedCopy: '已完成的内容得到保留，故事档案没有改变。',
    blocking: false,
    actions: [
      { label: '查看已保留内容', variant: 'primary' },
      { label: '继续此任务', variant: 'secondary' },
      { label: '重新开始', variant: 'quiet' }
    ],
    technical: 'task.chapter-3.cancelled-by-author'
  },
  crash: {
    key: 'crash',
    shortLabel: '上次会话',
    title: '上次关闭前有工作尚未结束',
    happened: 'Novel Loop 找到比上次正常关闭更新的草稿，以及一个未完成任务。',
    protectedCopy: '自动保存的草稿和安全阶段都已保留；不会自动继续 AI 写作，也不会自动正式提交。',
    blocking: false,
    actions: [
      { label: '查看恢复摘要', variant: 'primary' },
      { label: '恢复自动保存草稿', variant: 'secondary' },
      {
        label: '放弃未完成任务',
        variant: 'quiet',
        destructive: true,
        confirmation: {
          title: '确认放弃未完成任务？',
          body: '未完成任务不会继续，但自动保存的草稿和已经完成的安全阶段仍会保留。',
          confirmLabel: '放弃任务并保留草稿'
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
