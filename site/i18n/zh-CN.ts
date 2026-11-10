import type { Messages } from './index';

/**
 * Simplified Chinese: every key of `en`, with the same `{placeholders}` (test/site-i18n.test.ts).
 * GitHub's button names are slots, so they stay English: 点击 **Run workflow**.
 */
export const zhCN: Messages = {
  'lang.aria': '语言',

  lede: '为你的 GitHub 个人主页 README 生成统计卡片。卡片由主页仓库（与用户名同名的仓库）中的工作流每天重新生成，并以 SVG 文件提交到仓库，无需任何托管服务。先填写你的 GitHub 用户名，选好样式，再按下面四个步骤操作。',

  // Username box
  'start.here': '从这里开始',
  'start.done': '已完成',
  'username.label': '你的 GitHub 用户名',
  'signIn.button': '使用 GitHub 登录',
  'signIn.or': '或直接输入',
  'auth.cancelled': '已取消登录。请直接输入用户名。',
  'auth.failed': '登录没有成功。请直接输入用户名，或重新登录。',
  'auth.unavailable': '登录功能暂不可用。请直接输入用户名。',
  'user.noUser': '输入用户名后即可使用直达链接',
  'user.empty': '输入用户名后即可使用直达链接。',
  'user.noRepo': '找到你的主页仓库后即可使用',
  'user.waiting': '停止输入后将自动查找…',
  'user.invalid': '这不是有效的 GitHub 用户名。输入用户名后即可使用直达链接。',
  'user.lookingUp': '正在查找 {repo}…',
  'user.found': '已找到 {repo}（分支 {branch}）。下面的链接会直接打开这个仓库。',
  'user.missing': '还没有名为 {repo} 的仓库。请先{create}（设为公开，名称与用户名完全相同），然后{retry}。',
  'user.trouble': '无法查找 {repo}：{trouble}链接暂时按分支 {main} 生成。{retry}',
  'repo.create': '创建该仓库',
  'repo.yours': '你的主页仓库',
  'retry.inline': '重新查找',
  'retry.button': '重新查找',
  'trouble.rateLimited': '已达到 GitHub 每小时的请求上限，请稍后再试。',
  'trouble.network': '无法连接 GitHub。请检查网络连接后重试。',
  'trouble.http': 'GitHub 返回了 HTTP {status}，请稍后再试。',

  // Controls
  'controls.theme': '主题',
  'controls.cards': '卡片',
  'controls.lastCard': '至少需要保留一张卡片',
  'controls.data': '数据',
  'controls.includePrivate': '包含私有仓库',
  'controls.includeForks': '包含复刻仓库',
  'controls.excludeRepos': '排除仓库',
  'controls.excludeLangs': '排除语言',
  'controls.listNote': '用逗号分隔。预览使用固定的示例数据，因此排除项只会影响工作流。',
  'controls.ping': '使用统计',
  'controls.pingNote': '每次运行发送一次：仓库 ID 的哈希值（假名化，并非匿名）、版本号和主题。关闭后不发送任何数据。',

  // Preview
  'preview.title': '预览',
  'preview.modeAria': '预览模式',
  'preview.light': '浅色',
  'preview.dark': '深色',

  'linksHint.text': '请先填写{link}：这些步骤中的链接会直接打开你的主页仓库，找到仓库后即可使用。',
  'linksHint.link': '你的 GitHub 用户名',

  // Buttons shared by the steps
  'copy.button': '复制',
  'copy.copied': '已复制',
  'copy.selected': '已选中',
  'copy.failed': '复制失败',

  // Step 1
  'step1.title': '创建令牌并保存为密钥',
  'step1.help':
    '创建一个带 read:user 作用域的经典个人访问令牌（如需包含私有仓库，再加上 repo 作用域），并在主页仓库中将其保存为名为 STATS_TOKEN 的 Actions 密钥。',
  'step1a.text': '{title}{link}，所需的作用域已经勾选好：{readUser}{repoScope}。点击 {generate}，然后复制令牌。',
  'step1a.title': '创建令牌。',
  'step1a.link': '打开 GitHub 的新建令牌页面',
  'step1a.repoScope': '、{repo}',
  'step1a.tip': '提示：将 {expiration} 设为 {noExpiration}。令牌过期后，卡片会保留，但会被标记为过时，直到你添加新的令牌。',
  'step1b.optional': '可选',
  'step1b.text':
    '{optional}{only}，例如你的雇主。在 {tokens} 页面上，点击该令牌旁边的 {configureSso}，再为该组织点击 {authorize}。否则，该组织中的私有贡献不会计入你的名下。',
  'step1b.only': '仅当你所属的组织使用 SAML SSO 时需要',
  'step1b.docs': 'GitHub 文档：{link}',
  'step1b.docsLink': '授权个人访问令牌以与单点登录一起使用',
  'step1b.docsHref':
    'https://docs.github.com/zh/enterprise-cloud@latest/authentication/authenticating-with-single-sign-on/authorizing-a-personal-access-token-for-use-with-single-sign-on',
  'step1c.text': '{title}在主页仓库中{link}，然后填写：',
  'step1c.title': '添加密钥。',
  'step1c.link': '打开 New repository secret 页面',
  'step1c.name': '名称',
  'step1c.value': '值',
  'step1c.copyName': '复制名称',
  'step1c.copyNameAria': '复制密钥名称 STATS_TOKEN',
  'step1c.valueText': '第 {step} 步创建的令牌',

  // Step 2
  'step2.title': '添加工作流',
  'step2.add': '将工作流添加到 {repo}',
  'step2.update': '更新工作流',
  'step2.copyAria': '复制工作流',
  'step2.checking': '正在检查 {repo} 中是否已有该工作流…',
  'step2.checkingTitle': '正在检查工作流是否已存在',
  'step2.missing': '按钮会打开 GitHub 的新建文件页面，并已填好工作流：点击 {commit} 即可。也可以自行保存为 {path}。',
  'step2.different':
    '{repo} 中已有一个不同的工作流。GitHub 无法预先填好编辑内容：请先复制新的工作流（{copy}），打开{update}，在编辑器中全选并粘贴，然后点击 {commit}。',
  'step2.same': '✓ 你的工作流已是最新版本。',
  'step2.view': '查看',
  'step2.trouble': '无法检查工作流是否已存在：{trouble}如果已存在，请改为{update}（复制，在编辑器中全选，粘贴，提交）。{retry}',
  'step2.updateIt': '更新现有工作流',
  'step2.oldCards': '工作流下次运行时，会从 {dir} 中删除之前主题生成的卡片。',

  // Step 3
  'step3.title': '运行并检查',
  'step3.text': '{link}：在该页面点击 {run}，等待大约一分钟，然后检查设置。',
  'step3.link': '运行工作流',
  'step3.note': '密钥本身无法检查：GitHub 只向已登录的管理员显示密钥，因此这里改为检查工作流的运行结果。',
  'check.button': '检查设置',
  'check.busy': '正在检查…',
  'check.at': '检查于 {time}',
  'check.step': '第 {step} 步',
  'check.openRun': '查看本次运行',
  'check.repoMissing': '还没有名为 {repo} 的仓库。请先{create}。',
  'check.noWorkflow': '未找到工作流文件。请完成第 2 步。',
  'check.notRun': '尚未运行：请点击 {run}。',
  'check.running': '正在运行…请一分钟后再检查。{run}',
  'check.secretMissing': '运行失败：缺少令牌密钥。请添加 {secret} 密钥（{step}），然后重新运行。',
  'check.tokenRejected':
    '运行失败：GitHub 拒绝了该令牌。令牌无效、已过期或缺少作用域。请创建新的令牌（{step1a}），将其保存为 {secret}（{step1c}），然后重新运行。',
  'check.failed': '运行失败。',
  'check.failedWhy': '运行失败：',
  'check.ended': '本次运行的结果为“{conclusion}”。',
  'check.noSnapshot': '运行成功，但仓库中没有 {file}。',
  'check.noSnapshotRun': '打开本次运行，看看它做了什么：{run}',
  'check.ready': '卡片已就绪。请粘贴 README 代码（第 4 步）。',
  'check.readyStale': '卡片已就绪，但被标记为过时：上次运行未能获取最新数据。',
  'check.previewAlt': '你已提交的卡片',

  // Step 4
  'step4.title': '粘贴到 {file}',
  'step4.formatAria': 'README 格式',
  'step4.copyAria': '复制 README 代码',
  'step4.text':
    '等检查结果显示卡片已就绪（图片已生成）后：{link}，粘贴代码并提交。GitHub 无法预先填好编辑内容，所以请先复制代码。',
  'step4.link': '编辑 {file}',
  'step4.replace': '更换主题或卡片也会改变文件名：README 中的代码也需要一并替换。',
  'step4.deprecated': 'GitHub 已弃用 {light} / {dark} 片段，推荐改用 {picture}。它们目前仍然有效，但以后可能失效。',

  footer: '预览使用一份固定的示例快照，渲染代码与 Action 运行的完全相同。',
};
