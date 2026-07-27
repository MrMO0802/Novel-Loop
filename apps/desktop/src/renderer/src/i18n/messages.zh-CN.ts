export const zhCN = {
  'app.brand': 'Novel Loop',
  'setup.eyebrow': '首次使用 · 本地环境',
  'setup.loading.title': '正在确认这台电脑是否已经准备好',
  'setup.loading.summary': '正在检查本地创作环境',
  'setup.ready.title': '本地创作环境已准备好',
  'setup.ready.summary': 'Codex 已登录，本地创作辅助能力可以使用。',
  'setup.ready.action': '进入作品库',
  'setup.notInstalled.title': '尚未检测到本地 Codex',
  'setup.notInstalled.summary': '安装完成后，Novel Loop 会再次确认本地环境。',
  'setup.notInstalled.guide':
    '请先按照 Codex 官方说明完成安装。Novel Loop 不会替你安装或更新 Codex。',
  'setup.notInstalled.action': '安装完成后重新检查',
  'setup.notLoggedIn.title': 'Codex 尚未登录',
  'setup.notLoggedIn.summary': '登录完成后即可使用本地创作辅助能力。',
  'setup.notLoggedIn.guide':
    '请在系统终端完成 Codex 登录。Novel Loop 不会读取认证文件，也不会显示登录凭据。',
  'setup.notLoggedIn.action': '登录完成后重新检查',
  'setup.warning.title': 'Codex 可以使用，但有一项提醒',
  'setup.warning.summary': '基础能力已经可用，不会影响你进入作品库。',
  'setup.warning.guide':
    '基础能力可用，可以继续写作。进入设置后仍可重新运行环境检查。',
  'setup.warning.action': '仍然进入作品库',
  'setup.unavailable.title': '暂时无法完成环境检查',
  'setup.unavailable.summary':
    '你的项目和故事档案没有发生变化。可以稍后再次检查。',
  'setup.unavailable.action': '重新检查',
  'setup.timeout.title': '环境检查用时比预期更长',
  'setup.timeout.summary':
    '本次等待已经停止。你的项目和故事档案没有发生变化。',
  'setup.localData.title': '内容保存在本机',
  'setup.localData.body':
    '小说正文、故事档案和安全还原点由你选择的本地项目目录保存。AI 不会在你确认前修改正式故事档案。',
  'setup.safety.title': 'Codex 由你管理',
  'setup.safety.body':
    'Novel Loop 只检查是否可用。安装、更新和登录仍由你在系统中完成。',
  'library.eyebrow': '本地作品',
  'library.title': '作品库',
  'library.emptyTitle': '还没有添加小说项目',
  'library.emptyBody': '下一步可以创建新小说，或选择一个已有的 Novel Loop 项目目录。',
  'library.back': '返回环境检查'
} as const;

export type MessageKey = keyof typeof zhCN;

export function t(key: MessageKey): string {
  return zhCN[key];
}
