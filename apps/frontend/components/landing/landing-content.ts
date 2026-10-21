/**
 * 开项 KaiPilot 介绍页（/welcome）的文案与示例数据，中英双语。
 *
 * 演示区的草案是写死的示例，不调用任何模型；页面上也明确标注「示例演示」。
 */

export type LandingLang = 'zh' | 'en'

export interface DemoTask {
  code: string
  name: string
  /** 第几个工作日开始（从 0 起算） */
  start: number
  /** 工期（工作日）；里程碑为 0 */
  days: number
  critical: boolean
  milestone?: boolean
  status: 'todo' | 'doing' | 'done'
}

export interface DemoScenario {
  id: string
  chip: string
  prompt: string
  goal: string
  scope: string
  risk: string
  acceptance: string[]
  /** 时间轴总长度（工作日） */
  totalDays: number
  tasks: DemoTask[]
}

export interface Capability {
  id: string
  name: string
  summary: string
  items: string[]
}

export interface LandingCopy {
  nav: {
    capabilities: string
    how: string
    views: string
    deploy: string
    openSource: string
    github: string
    signIn: string
    signInShort: string
    workspace: string
    workspaceShort: string
    langLabel: string
  }
  hero: {
    eyebrow: string
    titleLead: string
    titleRest: string
    lede: string
    primary: string
    primaryAuthed: string
    secondary: string
    footnote: string
  }
  demo: {
    label: string
    badge: string
    promptLabel: string
    regenerate: string
    stages: string[]
    charter: string
    goal: string
    scope: string
    duration: string
    durationValue: (days: number) => string
    risk: string
    wbs: string
    gantt: string
    criticalLegend: string
    milestoneLegend: string
    weekTick: (week: number) => string
    acceptance: string
    checks: string
    rulesPassed: string
    hallucinationPassed: string
    draftStatus: string
    confirm: string
    confirmedStatus: (tasks: number) => string
    undo: string
    daysUnit: (days: number) => string
  }
  how: {
    eyebrow: string
    title: string
    lede: string
    steps: { title: string; detail: string; examples: string[] }[]
  }
  views: {
    eyebrow: string
    title: string
    lede: string
    pro: string
    simple: string
    proHint: string
    simpleHint: string
    columns: { todo: string; doing: string; done: string }
    wbsCode: string
    task: string
    days: string
  }
  capabilities: {
    eyebrow: string
    title: string
    lede: string
    list: Capability[]
  }
  deploy: {
    eyebrow: string
    title: string
    lede: string
    local: string
    compose: string
    localNote: string
    composeNote: string
    copy: string
    copied: string
    copyFailed: string
  }
  openSource: {
    eyebrow: string
    title: string
    points: { title: string; detail: string }[]
    github: string
    signIn: string
  }
  footer: {
    tagline: string
    license: string
    source: string
    repo: string
    signIn: string
    codename: string
  }
}

const LOCAL_COMMANDS = `pnpm install
cp apps/backend/.env.example apps/backend/.env
cd apps/backend && node ace generate:key
pnpm run codegen:indexes && node ace migration:run
node ace admin:create-super --email you@example.com
cd ../.. && pnpm dev`

const COMPOSE_COMMANDS = `cp .env.compose.example .env.compose
docker compose --env-file .env.compose up -d --build`

export const DEPLOY_COMMANDS = { local: LOCAL_COMMANDS, compose: COMPOSE_COMMANDS } as const

const ZH_SCENARIOS: DemoScenario[] = [
  {
    id: 'launch',
    chip: '新品发布会',
    prompt: '下个月 15 号前办一场 200 人的新品发布会',
    goal: '按期发布新品，到场 180 人以上',
    scope: '场地、嘉宾邀约、演讲稿、演示物料、彩排',
    risk: '场地档期紧张，需在第 3 个工作日前锁定',
    acceptance: ['到场人数 ≥ 180', '媒体报道 ≥ 30 篇', '演示零中断'],
    totalDays: 20,
    tasks: [
      { code: '1.1', name: '确定场地与日期', start: 0, days: 3, critical: true, status: 'done' },
      { code: '1.2', name: '嘉宾与媒体邀约', start: 3, days: 8, critical: false, status: 'doing' },
      { code: '2.1', name: '演讲稿与流程脚本', start: 3, days: 5, critical: true, status: 'doing' },
      { code: '2.2', name: '演示物料与展台', start: 8, days: 7, critical: true, status: 'todo' },
      { code: '3.1', name: '全流程彩排', start: 15, days: 4, critical: true, status: 'todo' },
      {
        code: '3.2',
        name: '发布会当天',
        start: 19,
        days: 0,
        critical: true,
        milestone: true,
        status: 'todo',
      },
    ],
  },
  {
    id: 'website',
    chip: '官网改版',
    prompt: '公司官网改版，支持中英双语，8 周内上线',
    goal: '新版官网上线，中英文页面一一对应',
    scope: '需求访谈、视觉设计、前端开发、内容翻译、测试验收',
    risk: '翻译依赖定稿文案，文案延期会顶到上线日',
    acceptance: ['中英文页面一一对应', '首页加载 < 2 秒', '旧链接全部跳转'],
    totalDays: 38,
    tasks: [
      {
        code: '1.1',
        name: '需求访谈与站点地图',
        start: 0,
        days: 5,
        critical: true,
        status: 'done',
      },
      { code: '1.2', name: '视觉设计', start: 5, days: 10, critical: true, status: 'doing' },
      { code: '2.1', name: '前端开发', start: 15, days: 12, critical: true, status: 'todo' },
      { code: '2.2', name: '内容翻译', start: 10, days: 15, critical: false, status: 'todo' },
      { code: '3.1', name: '测试与验收', start: 27, days: 10, critical: true, status: 'todo' },
      {
        code: '3.2',
        name: '正式上线',
        start: 37,
        days: 0,
        critical: true,
        milestone: true,
        status: 'todo',
      },
    ],
  },
  {
    id: 'migration',
    chip: '系统上云',
    prompt: '把仓库管理系统迁移到云上，停机不超过 4 小时',
    goal: '仓库管理系统迁移上云，切换停机 ≤ 4 小时',
    scope: '现状盘点、云环境、接口改造、数据迁移演练、切换',
    risk: '接口改造与数据演练并行，测试环境可能冲突',
    acceptance: ['停机 ≤ 4 小时', '数据核对差异为 0', '回滚方案演练通过'],
    totalDays: 24,
    tasks: [
      {
        code: '1.1',
        name: '现状盘点与风险评估',
        start: 0,
        days: 4,
        critical: true,
        status: 'done',
      },
      { code: '1.2', name: '云环境搭建', start: 4, days: 6, critical: true, status: 'done' },
      { code: '2.1', name: '数据迁移演练', start: 10, days: 8, critical: true, status: 'doing' },
      { code: '2.2', name: '接口改造', start: 6, days: 10, critical: false, status: 'doing' },
      { code: '3.1', name: '切换演练', start: 18, days: 5, critical: true, status: 'todo' },
      {
        code: '3.2',
        name: '正式切换',
        start: 23,
        days: 0,
        critical: true,
        milestone: true,
        status: 'todo',
      },
    ],
  },
]

const EN_TASK_NAMES: Record<string, string[]> = {
  launch: [
    'Book venue and date',
    'Invite guests and press',
    'Talks and run sheet',
    'Demo kit and booth',
    'Full rehearsal',
    'Launch day',
  ],
  website: [
    'Interviews and sitemap',
    'Visual design',
    'Frontend build',
    'Content translation',
    'Testing and sign-off',
    'Go live',
  ],
  migration: [
    'Inventory and risk review',
    'Cloud environment',
    'Data migration dry run',
    'Interface changes',
    'Cutover rehearsal',
    'Cutover',
  ],
}

const EN_SCENARIO_TEXT: Record<
  string,
  Pick<DemoScenario, 'chip' | 'prompt' | 'goal' | 'scope' | 'risk' | 'acceptance'>
> = {
  launch: {
    chip: 'Product launch',
    prompt: 'Run a 200-person product launch before the 15th of next month',
    goal: 'Launch on time with at least 180 attendees',
    scope: 'Venue, invitations, talks, demo kit, rehearsal',
    risk: 'Venues book up fast; lock one by workday 3',
    acceptance: ['Attendance ≥ 180', 'Press coverage ≥ 30 articles', 'Demo runs without a stop'],
  },
  website: {
    chip: 'Website redesign',
    prompt: 'Redesign the company website in Chinese and English, live within 8 weeks',
    goal: 'New site live with matching Chinese and English pages',
    scope: 'Interviews, visual design, frontend, translation, testing',
    risk: 'Translation waits on final copy; late copy pushes the launch date',
    acceptance: [
      'Every page has both languages',
      'Home page loads in < 2 s',
      'All old links redirect',
    ],
  },
  migration: {
    chip: 'Cloud migration',
    prompt: 'Move the warehouse system to the cloud with at most 4 hours of downtime',
    goal: 'Warehouse system in the cloud, cutover downtime ≤ 4 h',
    scope: 'Inventory, cloud setup, interface changes, data dry runs, cutover',
    risk: 'Interface work and data dry runs share the test environment',
    acceptance: [
      'Downtime ≤ 4 h',
      'Zero differences in data reconciliation',
      'Rollback rehearsal passes',
    ],
  },
}

const EN_SCENARIOS: DemoScenario[] = ZH_SCENARIOS.map((s) => ({
  ...s,
  ...EN_SCENARIO_TEXT[s.id],
  tasks: s.tasks.map((t, i) => ({ ...t, name: EN_TASK_NAMES[s.id]?.[i] ?? t.name })),
}))

export const SCENARIOS: Record<LandingLang, DemoScenario[]> = { zh: ZH_SCENARIOS, en: EN_SCENARIOS }

export const COPY: Record<LandingLang, LandingCopy> = {
  zh: {
    nav: {
      capabilities: '产品能力',
      how: '工作方式',
      views: '双入口',
      deploy: '部署',
      openSource: '开源',
      github: 'GitHub',
      signIn: '登录控制台',
      signInShort: '登录',
      workspace: '进入工作台',
      workspaceShort: '工作台',
      langLabel: '界面语言',
    },
    hero: {
      eyebrow: '开源 · 可自托管 · AGPL-3.0',
      titleLead: '一句话，',
      titleRest: '启动整个项目。',
      lede: '描述你要做的事，开项起草章程、WBS、排期与验收标准。你逐项审查确认后，它才成为正式项目。',
      primary: '登录控制台',
      primaryAuthed: '进入工作台',
      secondary: '在 GitHub 查看源码',
      footnote: 'AI 只给建议，不会自动执行任何修改。',
    },
    demo: {
      label: 'AI 立项',
      badge: '示例演示，不调用模型',
      promptLabel: '项目描述',
      regenerate: '重新生成',
      stages: ['理解需求', '起草章程', '拆解 WBS', '排期与关键路径', '规则与反幻觉校验'],
      charter: '项目章程',
      goal: '目标',
      scope: '范围',
      duration: '工期',
      durationValue: (days) => `${days} 个工作日`,
      risk: '首要风险',
      wbs: 'WBS',
      gantt: '甘特图',
      criticalLegend: '关键路径',
      milestoneLegend: '里程碑',
      weekTick: (week) => `第 ${week} 周`,
      acceptance: '验收标准',
      checks: '校验',
      rulesPassed: '规则校验 12/12',
      hallucinationPassed: '反幻觉检查 10/10',
      draftStatus: '草案 · 等你审查',
      confirm: '确认为正式项目',
      confirmedStatus: (tasks) => `已转为正式项目 · 创建 ${tasks} 个任务`,
      undo: '撤回，再看看',
      daysUnit: (days) => `${days} 天`,
    },
    how: {
      eyebrow: '工作方式',
      title: '每一步都停在你手里',
      lede: '从一句话到正式项目共五步。AI 负责起草和自查，落库前必须经过你的确认。',
      steps: [
        {
          title: '一句话描述',
          detail: '用自己的话写下目标、期限和约束，不需要套模板。',
          examples: ['“8 周内上线双语官网”', '“停机不超过 4 小时”'],
        },
        {
          title: '补充问题卡片',
          detail: '信息不够时，AI 用卡片问你几个关键问题，而不是自己猜。',
          examples: ['预算上限？', '必须参加的干系人？'],
        },
        {
          title: 'AI 草案',
          detail: '生成章程、WBS、任务、依赖、排期和验收标准，全部可逐项修改。',
          examples: ['WBS 编码 1.1 / 1.2', '工期按工作日计算'],
        },
        {
          title: '规则与反幻觉校验',
          detail: '12 条规则校验加 10 项反幻觉检查，标出可疑之处并给出置信度。',
          examples: ['日期先后是否合理', '依赖是否成环'],
        },
        {
          title: '你确认后落库',
          detail: '只有你点了确认，草案才变成正式项目。之后的 AI 修改同样先预览、再确认。',
          examples: ['修改前后差异预览', '审计日志可追溯'],
        },
      ],
    },
    views: {
      eyebrow: '双入口，同一份数据',
      title: '专业的人看甘特，新手看看板',
      lede: '专业入口有 WBS、甘特图和关键路径；直觉入口只有看板和简洁界面。两边读写同一套任务，切换不会丢任何信息。',
      pro: '专业入口',
      simple: '直觉入口',
      proHint: 'WBS 编码、工期、关键路径',
      simpleHint: '待办、进行中、已完成',
      columns: { todo: '待办', doing: '进行中', done: '已完成' },
      wbsCode: '编码',
      task: '任务',
      days: '工期',
    },
    capabilities: {
      eyebrow: '产品能力',
      title: '一个项目从立项到复盘需要的都在这里',
      lede: '九类能力全部开源，可以在自己的服务器上运行。',
      list: [
        {
          id: 'ai',
          name: 'AI 立项',
          summary: '一句话生成项目草案，人工审查后转为正式项目。',
          items: ['补充问题卡片', '12 条规则校验', '10 项反幻觉检查', '置信度评分'],
        },
        {
          id: 'plan',
          name: '计划与执行',
          summary: '六种视图共享同一套任务、里程碑和依赖。',
          items: ['WBS', '甘特图与拖动试算', '看板、列表、日历', '时间线'],
        },
        {
          id: 'manage',
          name: '项目管理',
          summary: '风险、变更、资源和报表放在同一个项目空间里。',
          items: ['风险登记', '变更请求与审批', '资源与负载', '项目健康与报表'],
        },
        {
          id: 'portfolio',
          name: '多项目',
          summary: '从单个项目扩展到项目组合和战略目标。',
          items: ['PMO 决策工作台', '项目组合', 'OKR', '跨项目依赖与资源'],
        },
        {
          id: 'colleague',
          name: 'AI 同事',
          summary: '在任意页面提问，让 AI 预览它建议的修改。',
          items: ['页面内提问', '修改预览与确认', '矛盾求解（TRIZ）', '对话记录'],
        },
        {
          id: 'knowledge',
          name: '知识与文档',
          summary: '项目资料集中保存，可检索、可引用。',
          items: ['知识库', '文件库', 'OCR', '文档智能（自配提供方）'],
        },
        {
          id: 'team',
          name: '团队协作',
          summary: '组织、角色与审计，适合小团队直接上手。',
          items: ['成员邀请', '6 种角色与项目角色', '审计日志', '两步验证与 Google 登录'],
        },
        {
          id: 'integrations',
          name: '集成与扩展',
          summary: '接上你已经在用的工具，用插件补足特殊需求。',
          items: ['GitHub / GitLab', 'Google 日历', 'Webhook 与 Web Push', '插件与 Skill'],
        },
        {
          id: 'admin',
          name: '实例管理',
          summary: '自托管实例的用户、审计与路由由你掌控。',
          items: ['用户管理', '全局审计日志', '编译器路由', '命令行创建管理员'],
        },
      ],
    },
    deploy: {
      eyebrow: '部署',
      title: '在你的电脑或服务器上跑起来',
      lede: '本机默认使用 SQLite，不需要数据库服务。上服务器用 Docker Compose，一个端口对外。',
      local: '本机（Node 26 + pnpm 12）',
      compose: 'Docker Compose',
      localNote: '首次启动后用刚创建的管理员登录，再到「设置 → AI 连接」添加你的模型 Key。',
      composeNote: '默认拉起 edge、前端、后端、PostgreSQL 与 Redis；应用密钥首次启动时自动生成。',
      copy: '复制',
      copied: '已复制',
      copyFailed: '已选中，请手动复制',
    },
    openSource: {
      eyebrow: '开源',
      title: '代码公开，数据和模型 Key 留在你那里',
      points: [
        {
          title: 'AGPL-3.0',
          detail: '完整源码在 GitHub。修改后对外提供服务，同样公开你的修改。',
        },
        {
          title: '自带模型 Key',
          detail: '支持 OpenAI 兼容、Anthropic 等提供方；没有连接时不会调用任何模型。',
        },
        {
          title: '自己的数据库',
          detail: 'SQLite 单文件或 PostgreSQL，数据只存在你自己的服务器上。',
        },
      ],
      github: '前往 GitHub 仓库',
      signIn: '登录控制台',
    },
    footer: {
      tagline: '开源、可自托管的 AI 项目管理平台。',
      license: '许可证 AGPL-3.0',
      source: '本实例源代码',
      repo: 'GitHub 仓库',
      signIn: '登录',
      codename: '代码中的内部代号为 aiproj。',
    },
  },
  en: {
    nav: {
      capabilities: 'Features',
      how: 'How it works',
      views: 'Two views',
      deploy: 'Deploy',
      openSource: 'Open source',
      github: 'GitHub',
      signIn: 'Sign in to console',
      signInShort: 'Sign in',
      workspace: 'Open workspace',
      workspaceShort: 'Workspace',
      langLabel: 'Language',
    },
    hero: {
      eyebrow: 'Open source · Self-hosted · AGPL-3.0',
      titleLead: 'One sentence ',
      titleRest: 'starts the whole project.',
      lede: 'Describe what you want to get done. KaiPilot drafts the charter, WBS, schedule and acceptance criteria. It becomes a project only after you review and confirm it.',
      primary: 'Sign in to console',
      primaryAuthed: 'Open workspace',
      secondary: 'View source on GitHub',
      footnote: 'AI only suggests. It never applies a change on its own.',
    },
    demo: {
      label: 'AI project setup',
      badge: 'Sample demo, no model is called',
      promptLabel: 'Project description',
      regenerate: 'Generate again',
      stages: [
        'Reading the request',
        'Drafting the charter',
        'Breaking down the WBS',
        'Scheduling the critical path',
        'Rule and anti-hallucination checks',
      ],
      charter: 'Project charter',
      goal: 'Goal',
      scope: 'Scope',
      duration: 'Duration',
      durationValue: (days) => `${days} workdays`,
      risk: 'Top risk',
      wbs: 'WBS',
      gantt: 'Gantt',
      criticalLegend: 'Critical path',
      milestoneLegend: 'Milestone',
      weekTick: (week) => `W${week}`,
      acceptance: 'Acceptance criteria',
      checks: 'Checks',
      rulesPassed: 'Rule checks 12/12',
      hallucinationPassed: 'Anti-hallucination 10/10',
      draftStatus: 'Draft · waiting for your review',
      confirm: 'Confirm as project',
      confirmedStatus: (tasks) => `Saved as a project · ${tasks} tasks created`,
      undo: 'Undo and keep reviewing',
      daysUnit: (days) => `${days} d`,
    },
    how: {
      eyebrow: 'How it works',
      title: 'Every step waits for you',
      lede: 'Five steps take one sentence to a real project. AI drafts and checks its own work; nothing is saved until you confirm.',
      steps: [
        {
          title: 'Describe it in one sentence',
          detail: 'Write the goal, deadline and constraints in your own words. No template needed.',
          examples: ['"Bilingual website live in 8 weeks"', '"At most 4 hours of downtime"'],
        },
        {
          title: 'Answer follow-up cards',
          detail:
            'When details are missing, AI asks a few key questions on cards instead of guessing.',
          examples: ['Budget limit?', 'Stakeholders who must attend?'],
        },
        {
          title: 'Review the AI draft',
          detail:
            'Charter, WBS, tasks, dependencies, schedule and acceptance criteria, all editable line by line.',
          examples: ['WBS codes 1.1 / 1.2', 'Durations in workdays'],
        },
        {
          title: 'Rule and anti-hallucination checks',
          detail:
            '12 rule checks and 10 anti-hallucination checks flag anything suspicious and score confidence.',
          examples: ['Are the dates in order?', 'Do dependencies form a loop?'],
        },
        {
          title: 'Save after you confirm',
          detail:
            'The draft becomes a project only when you confirm. Later AI edits are previewed and confirmed the same way.',
          examples: ['Before-and-after diff', 'Traceable audit log'],
        },
      ],
    },
    views: {
      eyebrow: 'Two views, one set of data',
      title: 'Gantt for professionals, Kanban for everyone else',
      lede: 'The professional view has WBS, Gantt and the critical path. The simple view is a Kanban board with a clean interface. Both read and write the same tasks, so switching loses nothing.',
      pro: 'Professional',
      simple: 'Simple',
      proHint: 'WBS codes, durations, critical path',
      simpleHint: 'To do, in progress, done',
      columns: { todo: 'To do', doing: 'In progress', done: 'Done' },
      wbsCode: 'Code',
      task: 'Task',
      days: 'Duration',
    },
    capabilities: {
      eyebrow: 'Features',
      title: 'Everything a project needs, from kickoff to review',
      lede: 'All nine areas are open source and run on your own server.',
      list: [
        {
          id: 'ai',
          name: 'AI project setup',
          summary: 'Draft a project from one sentence and turn it into a real one after review.',
          items: [
            'Follow-up question cards',
            '12 rule checks',
            '10 anti-hallucination checks',
            'Confidence scores',
          ],
        },
        {
          id: 'plan',
          name: 'Planning and execution',
          summary: 'Six views share the same tasks, milestones and dependencies.',
          items: ['WBS', 'Gantt with drag-to-simulate', 'Kanban, list, calendar', 'Timeline'],
        },
        {
          id: 'manage',
          name: 'Project management',
          summary: 'Risks, changes, resources and reports live in one project space.',
          items: [
            'Risk register',
            'Change requests and approval',
            'Resources and workload',
            'Health and reports',
          ],
        },
        {
          id: 'portfolio',
          name: 'Multiple projects',
          summary: 'Grow from a single project to portfolios and strategic goals.',
          items: [
            'PMO decision workbench',
            'Portfolios',
            'OKRs',
            'Cross-project dependencies and resources',
          ],
        },
        {
          id: 'colleague',
          name: 'AI colleague',
          summary: 'Ask questions on any page and preview the changes AI suggests.',
          items: [
            'In-page questions',
            'Change preview and confirmation',
            'Contradiction solving (TRIZ)',
            'Conversation history',
          ],
        },
        {
          id: 'knowledge',
          name: 'Knowledge and documents',
          summary: 'Keep project material in one place, searchable and citable.',
          items: ['Knowledge base', 'File library', 'OCR', 'Document intelligence (your provider)'],
        },
        {
          id: 'team',
          name: 'Collaboration',
          summary: 'Organizations, roles and audit, ready for a small team.',
          items: [
            'Member invitations',
            '6 roles plus project roles',
            'Audit log',
            'Two-factor and Google sign-in',
          ],
        },
        {
          id: 'integrations',
          name: 'Integrations',
          summary: 'Connect the tools you already use and fill gaps with plugins.',
          items: [
            'GitHub / GitLab',
            'Google Calendar',
            'Webhooks and Web Push',
            'Plugins and skills',
          ],
        },
        {
          id: 'admin',
          name: 'Instance administration',
          summary: 'You control users, audit and routing on your own instance.',
          items: [
            'User management',
            'Global audit log',
            'Compiler routing',
            'Create admins from the CLI',
          ],
        },
      ],
    },
    deploy: {
      eyebrow: 'Deploy',
      title: 'Run it on your laptop or your server',
      lede: 'Locally it uses SQLite, so no database server is needed. On a server, Docker Compose exposes a single port.',
      local: 'Local (Node 26 + pnpm 12)',
      compose: 'Docker Compose',
      localNote:
        'After the first start, sign in with the administrator you created, then add your model key under Settings → AI connections.',
      composeNote:
        'Starts edge, frontend, backend, PostgreSQL and Redis. Application secrets are generated on first start.',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Selected, copy it manually',
    },
    openSource: {
      eyebrow: 'Open source',
      title: 'The code is public. Your data and model keys stay with you.',
      points: [
        {
          title: 'AGPL-3.0',
          detail:
            'The full source is on GitHub. If you modify it and offer it as a service, share your changes too.',
        },
        {
          title: 'Bring your own model key',
          detail:
            'OpenAI-compatible, Anthropic and other providers. Without a connection, no model is called.',
        },
        {
          title: 'Your own database',
          detail: 'A single SQLite file or PostgreSQL. Data stays on your own server.',
        },
      ],
      github: 'Go to the GitHub repository',
      signIn: 'Sign in to console',
    },
    footer: {
      tagline: 'Open-source, self-hosted AI project management.',
      license: 'License AGPL-3.0',
      source: 'Source of this instance',
      repo: 'GitHub repository',
      signIn: 'Sign in',
      codename: 'The internal code name in the source is aiproj.',
    },
  },
}
