// AI 同事自然语言操作 —— 计划校验（反幻觉）、JSON 提取、状态路径、页面项目概况。
import { test } from '@japa/runner'
import {
  COLLEAGUE_PLANNER_LENSES,
  extractJsonObject,
  nativeToolCallsToRawPlan,
  buildPlannerUserPrompt,
  normalizePlannedActions,
  type PlannerProjectRow,
  type PlannerTaskRow,
} from '#services/ai_colleague/action_planner_service'
import { matchCurrentPage } from '#controllers/copilot_turn_controller'
import {
  normalizeSuggestions,
  normalizeTheaterChoice,
  type TheaterQuestion,
} from '#services/ai_colleague/assist_service'
import { findStatusPath } from '#services/task_status_machine'
import { sanitizeColleagueAppMap } from '@aiproj/types'
import {
  CopilotPageContextResolver,
  toPageProjectProfile,
} from '#services/copilot/copilot_page_context_resolver'

const TASKS: PlannerTaskRow[] = [
  {
    id: 7,
    name: '登录页开发',
    status: 'not_started',
    startDate: '2026-10-08',
    endDate: '2026-10-10',
    projectId: 42,
    code: 'PROJ-42#7',
  },
  {
    id: 8,
    name: '注册页开发',
    status: 'in_progress',
    startDate: '2026-10-09',
    endDate: '2026-10-12',
    projectId: 42,
    code: 'PROJ-42#8',
  },
]
const ctx = { projectId: 42, tasks: TASKS }

test.group('AI 同事操作计划：校验与规范化', () => {
  test('多步：改状态 + 平移日期 + 打开甘特图，按顺序产出工具调用', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        reply: '好的',
        actions: [
          { action: 'set_status', taskId: 7, status: 'completed' },
          { action: 'reschedule', taskId: 8, startDate: '2026-10-12', endDate: '2026-10-15' },
          { action: 'navigate', lens: 'gantt' },
        ],
      },
      ctx,
    )
    assert.isTrue(plan.isAction)
    assert.deepEqual(
      plan.actions.map((a) => a.toolName),
      ['update_task_status', 'update_task_schedule', 'navigate_to_space'],
    )
    assert.deepEqual(plan.actions[0]!.parameters, { projectId: 42, taskId: 7, status: 'completed' })
    // 工期不变（3 天）→ 整体平移 move
    assert.deepEqual(plan.actions[1]!.parameters, {
      projectId: 42,
      taskId: 8,
      operation: 'move',
      startDate: '2026-10-12',
      autoSchedule: true,
    })
    assert.deepEqual(plan.actions[2]!.parameters, {
      lens: 'gantt',
      depth: 'workbench',
      projectId: 42,
    })
    assert.equal(plan.actions[0]!.summary, '把 PROJ-42#7「登录页开发」改为「已完成」')
  })

  test('只改截止日 → resize，保留原开始日', ({ assert }) => {
    const plan = normalizePlannedActions(
      { isAction: true, actions: [{ action: 'reschedule', taskId: 7, endDate: '2026-10-20' }] },
      ctx,
    )
    assert.deepEqual(plan.actions[0]!.parameters, {
      projectId: 42,
      taskId: 7,
      operation: 'resize',
      startDate: '2026-10-08',
      endDate: '2026-10-20',
      autoSchedule: true,
    })
  })

  test('反幻觉：任务不在本项目 / 日期非法 / 状态与镜头越界 → 丢弃并说明', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'set_status', taskId: 999, status: 'completed' },
          { action: 'set_status', taskId: 7, status: 'done' },
          { action: 'reschedule', taskId: 8, startDate: '2026-13-40', endDate: '2026-10-01' },
          { action: 'navigate', lens: 'admin' },
          { action: 'drop_database' },
        ],
      },
      ctx,
    )
    assert.lengthOf(plan.actions, 0)
    assert.lengthOf(plan.rejected, 4)
    assert.include(plan.rejected[0]!, '#999 没有找到或无权操作')
  })

  test('提问（isAction=false、无动作）不当作操作；追问原样透出', ({ assert }) => {
    const question = normalizePlannedActions({ isAction: false, actions: [] }, ctx)
    assert.isFalse(question.isAction)
    const ask = normalizePlannedActions(
      { isAction: true, actions: [], clarification: '有两个「页」任务：#7、#8，指哪一个？' },
      ctx,
    )
    assert.isTrue(ask.isAction)
    assert.equal(ask.clarification, '有两个「页」任务：#7、#8，指哪一个？')
  })

  test('最多 8 步（重复动作先合并）', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [...COLLEAGUE_PLANNER_LENSES].map((lens) => ({ action: 'navigate', lens })),
      },
      ctx,
    )
    assert.lengthOf(plan.actions, 8)
  })

  test('extractJsonObject 兼容 ```json 包裹与前后赘述', ({ assert }) => {
    assert.deepEqual(extractJsonObject('好的\n```json\n{"isAction":true,"actions":[]}\n```'), {
      isAction: true,
      actions: [],
    })
    assert.isNull(extractJsonObject('没有 JSON'))
    assert.isNull(extractJsonObject('{坏的}'))
  })
})

test.group('任务状态路径', () => {
  test('最短合法路径', ({ assert }) => {
    assert.deepEqual(findStatusPath('not_started', 'completed'), ['in_progress', 'completed'])
    assert.deepEqual(findStatusPath('in_progress', 'completed'), ['completed'])
    assert.deepEqual(findStatusPath('completed', 'completed'), [])
    assert.deepEqual(findStatusPath('cancelled', 'in_progress'), ['not_started', 'in_progress'])
    assert.deepEqual(findStatusPath('completed', 'not_started'), ['in_progress', 'not_started'])
  })
})

test.group('页面语境：当前项目概况', () => {
  test('toPageProjectProfile 提取名称等并截断描述', ({ assert }) => {
    const profile = toPageProjectProfile(1, {
      name: '演示专案',
      code: 'PROJ-1',
      status: 'active',
      healthStatus: 'green',
      priority: 'high',
      startDate: { toISODate: () => '2026-09-01' },
      endDate: '2026-12-31T00:00:00.000Z',
      progressPercent: 35,
      description: '长'.repeat(300),
    })
    assert.equal(profile?.name, '演示专案')
    assert.equal(profile?.code, 'PROJ-1')
    assert.equal(profile?.startDate, '2026-09-01')
    assert.equal(profile?.endDate, '2026-12-31')
    assert.equal(profile?.progressPercent, 35)
    assert.lengthOf(profile?.description ?? '', 201)
    assert.isUndefined(toPageProjectProfile(1, { id: 1 }))
  })

  test('resolver 授权就绪时带上项目概况与任务状态分布', async ({ assert }) => {
    class FakeQuery {
      where() {
        return this
      }
      whereIn() {
        return this
      }
      whereNull() {
        return this
      }
      select() {
        return this
      }
      count() {
        return this
      }
      async groupBy() {
        return [
          { status: 'completed', count: 3 },
          { status: 'in_progress', count: 2 },
        ]
      }
    }
    const resolver = new CopilotPageContextResolver({
      findProject: async () => ({ id: 1, name: '演示专案', code: 'PROJ-1', status: 'active' }),
      allowedProjectIds: [1],
      db: { from: () => new FakeQuery() },
    })
    const resolution = await resolver.resolve(
      {
        version: 1,
        routeId: 'project-calendar',
        pathname: '/projects/1/calendar',
        projectId: 1,
        viewId: 'calendar',
        routeRevision: 'r1',
      },
      9,
      5,
    )
    assert.equal(resolution.status, 'ready')
    assert.equal(resolution.projectProfile?.name, '演示专案')
    assert.equal(resolution.projectProfile?.taskTotal, 5)
    assert.deepEqual(resolution.projectProfile?.tasksByStatus, { completed: 3, in_progress: 2 })
  })
})

test.group('AI 同事操作计划：应用地图 / 搜索 / 界面偏好', () => {
  const appDestinations = [
    {
      id: 'settings:ai-connections',
      title: 'AI 连接',
      group: '设置 · AI 与集成',
      path: '/next/settings/ai-connections',
    },
    { id: 'space:risks', title: '风险管理', group: '项目空间', path: '/next/projects/:id/risks' },
  ]

  test('打开页面：只认应用地图里的 id，:id 换成当前项目', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'open_destination', destinationId: 'settings:ai-connections' },
          { action: 'open_destination', destinationId: 'space:risks' },
          { action: 'open_destination', destinationId: 'settings:不存在' },
        ],
      },
      { projectId: 42, tasks: [], appDestinations },
    )
    assert.deepEqual(
      plan.actions.map((action) => action.parameters.path),
      ['/next/settings/ai-connections', '/next/projects/42/risks'],
    )
    assert.equal(plan.actions[0]!.toolName, 'open_app_page')
    assert.equal(plan.actions[0]!.summary, '打开「AI 连接」')
    assert.lengthOf(plan.rejected, 1)
  })

  test('不在项目空间：项目内操作与需要项目的页面被拒绝，全局页面照常', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'set_status', taskId: 7, status: 'completed' },
          { action: 'open_destination', destinationId: 'space:risks' },
          { action: 'open_destination', destinationId: 'settings:ai-connections' },
        ],
      },
      { projectId: null, tasks: [], appDestinations },
    )
    assert.deepEqual(
      plan.actions.map((action) => action.toolName),
      ['open_app_page'],
    )
    assert.lengthOf(plan.rejected, 2)
    assert.include(plan.rejected[0]!, '没有找到或无权操作')
    assert.include(plan.rejected[1]!, '需要先选定项目')
  })

  const projects: PlannerProjectRow[] = [
    { id: 6, code: 'PROJ-6', name: '公司内部食堂订餐 H5', status: 'planning' },
    { id: 7, code: 'PROJ-7', name: '校园演唱会筹办项目', status: 'planning' },
  ]

  test('打开项目：只认已授权项目，可直达视图；越界视图忽略、未知项目拒绝', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'open_project', projectId: 6 },
          { action: 'open_project', projectId: 7, lens: 'gantt' },
          { action: 'open_project', projectId: 7, lens: 'hack' },
          { action: 'open_project', projectId: 999 },
        ],
      },
      { projectId: null, tasks: [], projects },
    )
    assert.deepEqual(
      plan.actions.map((action) => action.parameters.path),
      ['/next/projects/6', '/next/projects/7?lens=gantt', '/next/projects/7'],
    )
    assert.include(plan.actions[0]!.summary, 'PROJ-6')
    assert.lengthOf(plan.rejected, 1)
    assert.include(plan.rejected[0]!, '没有找到或无权查看')
  })

  test('需要项目的页面：不在项目里也可以落到点名的已授权项目（如某项目的 AON 网络图）', ({
    assert,
  }) => {
    const chart = {
      id: 'chart:aon-network',
      title: 'AON 紧前节点网络图',
      group: '图表馆 · 进度网络',
      path: '/next/projects/:id/charts/aon-network',
    }
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'open_destination', destinationId: 'chart:aon-network', projectId: 7 },
          { action: 'open_destination', destinationId: 'chart:aon-network', projectId: 999 },
        ],
      },
      { projectId: null, tasks: [], projects, appDestinations: [...appDestinations, chart] },
    )
    assert.deepEqual(
      plan.actions.map((action) => action.parameters.path),
      ['/next/projects/7/charts/aon-network'],
    )
    assert.include(plan.actions[0]!.summary, 'PROJ-7')
    assert.include(plan.rejected[0]!, '需要先选定项目')
  })

  test('一键生成项目与退出登录：生成交给生成剧场（草案仍需审查），缺需求则拒绝', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'create_project', idea: '筹办一场校园演唱会，预计 2000 名观众' },
          { action: 'create_project', idea: '   ' },
          { action: 'sign_out' },
        ],
      },
      { projectId: null, tasks: [] },
    )
    assert.deepEqual(
      plan.actions.map((action) => [action.toolName, action.parameters]),
      [
        ['start_project_generation', { idea: '筹办一场校园演唱会，预计 2000 名观众' }],
        ['sign_out', {}],
      ],
    )
    assert.lengthOf(plan.rejected, 1)
  })

  test('原生方式：open_project / create_project / sign_out 映射回统一动作', ({ assert }) => {
    const { raw, unknownCalls } = nativeToolCallsToRawPlan({
      text: '',
      toolCalls: [
        { name: 'open_project', arguments: { projectId: 6, lens: 'kanban' } },
        { name: 'create_project', arguments: { idea: '办一场校园演唱会' } },
        { name: 'sign_out', arguments: {} },
      ],
    })
    assert.deepEqual(unknownCalls, [])
    const plan = normalizePlannedActions(raw, { projectId: null, tasks: [], projects })
    assert.deepEqual(
      plan.actions.map((action) => action.toolName),
      ['open_app_page', 'start_project_generation', 'sign_out'],
    )
  })

  test('多步任务：continue 只在本轮有动作时成立；answer 透出（Markdown）', ({ assert }) => {
    const looking = normalizePlannedActions(
      {
        isAction: true,
        continue: true,
        actions: [
          { action: 'list_risks' },
          { action: 'project_summary', projectId: 6 },
          { action: 'look_at_page' },
        ],
      },
      { projectId: 7, tasks: [], projects },
    )
    assert.isTrue(looking.continue)
    assert.deepEqual(
      looking.actions.map((action) => [action.toolName, action.parameters]),
      [
        ['list_project_risks', { projectId: 7 }],
        ['get_project_summary', { projectId: 6 }],
        ['capture_page', {}],
      ],
    )
    const done = normalizePlannedActions(
      { isAction: false, continue: true, actions: [], answer: '## 结论\n有 2 个高风险。' },
      { projectId: 7, tasks: [] },
    )
    assert.isFalse(done.continue)
    assert.equal(done.answer, '## 结论\n有 2 个高风险。')
    const noProject = normalizePlannedActions(
      { isAction: true, actions: [{ action: 'list_risks' }] },
      { projectId: null, tasks: [], projects },
    )
    assert.lengthOf(noProject.actions, 0)
    assert.include(noProject.rejected[0]!, '哪个项目')
  })

  test('原生方式：调用查看类工具 = 继续；不调用工具的文字 = 结论', ({ assert }) => {
    const looked = nativeToolCallsToRawPlan({
      text: '',
      toolCalls: [{ name: 'list_risks', arguments: {} }],
    })
    assert.isTrue(looked.raw.continue)
    const opened = nativeToolCallsToRawPlan({
      text: '',
      toolCalls: [{ name: 'search_entities', arguments: { keyword: '登录', open: true } }],
    })
    assert.isFalse(opened.raw.continue)
    const answered = nativeToolCallsToRawPlan({ text: '都处理好了。', toolCalls: [] })
    assert.equal(answered.raw.answer, '都处理好了。')
    assert.isFalse(answered.raw.isAction)
  })

  test('用户消息带上页面语境与多步观察结果（含轮次与上限）', ({ assert }) => {
    const prompt = JSON.parse(
      buildPlannerUserPrompt({
        text: '这页哪里有问题',
        today: '2026-10-04',
        project: { id: 7, name: '演唱会' },
        tasks: [],
        selectedTaskId: null,
        page: { route: '/next/projects/7', visibleText: '# 项目看板', visualDescription: null },
        observations: [
          { step: '看一眼当前页面', tool: 'capture_page', status: 'success', result: '看板' },
        ],
        iteration: 2,
      }),
    ) as Record<string, unknown>
    assert.deepInclude(prompt.page as object, { visibleText: '# 项目看板' })
    assert.equal(prompt.iteration, 2)
    assert.equal(prompt.maxIterations, 30)
    assert.lengthOf(prompt.observations as unknown[], 1)
  })

  test('输入建议：去重限长、补全必须以已输入开头、最多 3 条', ({ assert }) => {
    assert.deepEqual(
      normalizeSuggestions(['好的', ' 好的 ', '', 3, '先不改', '再看看', '第四条'], null),
      ['好的', '先不改', '再看看'],
    )
    assert.deepEqual(normalizeSuggestions(['把它延到明天', '标为完成', '把它'], '把它'), [
      '把它延到明天',
    ])
    assert.deepEqual(normalizeSuggestions('not-array', null), [])
  })

  test('全自动代答：选项只认题目里真有的、题型校验、不许越权跳过 / 用默认值', ({ assert }) => {
    const single: TheaterQuestion = {
      title: '团队规模',
      questionType: 'single_choice',
      options: [
        { label: '1–3 人', value: 'small' },
        { label: '4–10 人', value: 'medium', recommended: true },
      ],
      allowSkip: false,
    }
    // 模型可以不选推荐项
    assert.deepEqual(
      normalizeTheaterChoice(
        { action: 'answer', value: 'small', reason: '原话说一个人做' },
        single,
      ),
      { action: 'answer', value: 'small', reason: '原话说一个人做' },
    )
    // 用 label 作答也能对上选项；选项外的自填文字按自填收
    assert.equal(normalizeTheaterChoice({ value: '4–10 人' }, single)?.value, 'medium')
    assert.equal(normalizeTheaterChoice({ value: '大约 20 人' }, single)?.value, '大约 20 人')
    assert.isNull(normalizeTheaterChoice({ value: 'x' }, { ...single, customInput: false }))
    // 不能跳过的题不许跳过；没有默认值不许用默认值
    assert.isNull(normalizeTheaterChoice({ action: 'skip' }, single))
    assert.isNull(normalizeTheaterChoice({ action: 'default' }, single))
    assert.deepEqual(
      normalizeTheaterChoice({ action: 'default' }, { ...single, defaultValue: 'medium' }),
      { action: 'default', value: 'medium', reason: '' },
    )

    const multi: TheaterQuestion = {
      title: '集成',
      questionType: 'multi_choice',
      options: [
        { label: '微信', value: 'wechat' },
        { label: '支付宝', value: 'alipay' },
      ],
    }
    assert.deepEqual(
      normalizeTheaterChoice({ value: ['wechat', '支付宝', 'wechat'] }, multi)?.value,
      ['wechat', 'alipay'],
    )
    const date: TheaterQuestion = { title: '开始', questionType: 'date', options: [] }
    assert.equal(normalizeTheaterChoice({ value: '2026-11-02' }, date)?.value, '2026-11-02')
    assert.isNull(normalizeTheaterChoice({ value: '下周一' }, date))
    const number: TheaterQuestion = { title: '人数', questionType: 'number', options: [] }
    assert.equal(normalizeTheaterChoice({ value: '5' }, number)?.value, 5)
    assert.isNull(normalizeTheaterChoice({ value: '' }, number))
    assert.isNull(normalizeTheaterChoice(null, number))
  })

  test('当前页面匹配：:id 匹配任意一段、lens 区分项目视图、取最长匹配', ({ assert }) => {
    const map = [
      { id: 'settings:ai', title: 'AI 连接', group: '设置', path: '/next/settings/ai-connections' },
      {
        id: 'lens:gantt',
        title: '甘特图',
        group: '项目视图',
        path: '/next/projects/:id?lens=gantt',
      },
      { id: 'space:risks', title: '风险管理', group: '项目空间', path: '/next/projects/:id/risks' },
    ]
    assert.equal(matchCurrentPage('/next/settings/ai-connections', map)?.title, 'AI 连接')
    assert.equal(matchCurrentPage('/next/projects/7?lens=gantt', map)?.title, '甘特图')
    assert.equal(matchCurrentPage('/next/projects/7/risks', map)?.title, '风险管理')
    assert.isNull(matchCurrentPage('/next/projects/7?lens=wbs', map))
    assert.isNull(matchCurrentPage(undefined, map))
  })

  test('搜索与界面偏好：枚举校验，未知值丢弃', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'search', keyword: '登录', entityType: 'risk', open: true },
          { action: 'search', keyword: '支付', entityType: 'unknown' },
          { action: 'set_preference', theme: 'dark', density: 'compact', textVariant: 'tw' },
          { action: 'set_preference', theme: 'purple' },
          { action: 'search', keyword: '' },
        ],
      },
      { projectId: null, tasks: [] },
    )
    assert.deepEqual(plan.actions[0]!.parameters, {
      keyword: '登录',
      entityTypes: ['risk'],
      open: true,
    })
    assert.deepEqual(plan.actions[1]!.parameters, { keyword: '支付' })
    assert.deepEqual(plan.actions[2]!.parameters, {
      theme: 'dark',
      density: 'compact',
      textVariant: 'tw',
    })
    assert.equal(plan.actions[2]!.summary, '切换为「深色」、「紧凑」、「繁體中文（台灣）」')
    assert.lengthOf(plan.rejected, 2)
  })

  test('sanitizeColleagueAppMap：只留 /next 路径、去重限量', ({ assert }) => {
    const cleaned = sanitizeColleagueAppMap([
      { id: 'a', title: '甲', group: 'g', path: '/next/a' },
      { id: 'a', title: '重复', group: 'g', path: '/next/b' },
      { id: 'x', title: '外链', group: 'g', path: 'https://evil.example' },
      { id: 'y', title: '空格', group: 'g', path: '/next/a b' },
      'bad',
    ])
    assert.deepEqual(cleaned, [{ id: 'a', title: '甲', group: 'g', path: '/next/a' }])
  })
})

test.group('AI 同事操作计划：打开任务', () => {
  test('按任务所属项目打开详情页（跨项目也可以）', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [
          { action: 'open_task', taskId: 8 },
          { action: 'open_task', taskId: 404 },
        ],
      },
      { projectId: null, tasks: TASKS },
    )
    assert.deepEqual(plan.actions[0]!.parameters, {
      destinationId: 'task:8',
      title: 'PROJ-42#8 注册页开发',
      path: '/next/projects/42?focusTask=8',
    })
    assert.equal(plan.actions[0]!.toolName, 'open_app_page')
    assert.lengthOf(plan.rejected, 1)
  })
})

test.group('AI 同事操作计划：追问卡片候选', () => {
  test('clarification 带候选：去空去重、限长、最多 4 个；无追问时不给候选', ({ assert }) => {
    const plan = normalizePlannedActions(
      {
        isAction: true,
        actions: [],
        clarification: '有两个「登录」任务，指哪一个？',
        options: [
          'PROJ-42#7 登录页开发',
          ' ',
          'PROJ-42#7 登录页开发',
          'PROJ-42#9 登录接口',
          'A',
          'B',
          'C',
          42,
        ],
      },
      ctx,
    )
    assert.equal(plan.clarification, '有两个「登录」任务，指哪一个？')
    assert.deepEqual(plan.clarificationOptions, [
      'PROJ-42#7 登录页开发',
      'PROJ-42#9 登录接口',
      'A',
      'B',
    ])
    const noQuestion = normalizePlannedActions({ isAction: true, actions: [], options: ['A'] }, ctx)
    assert.deepEqual(noQuestion.clarificationOptions, [])
  })

  test('原生方式：ask_clarification 的 options 一并带回', ({ assert }) => {
    const { raw } = nativeToolCallsToRawPlan({
      text: '',
      toolCalls: [
        {
          name: 'ask_clarification',
          arguments: { question: '延到哪天？', options: ['明天', '下周一'] },
        },
      ],
    })
    assert.equal(raw.clarification, '延到哪天？')
    assert.deepEqual(raw.options, ['明天', '下周一'])
    const plan = normalizePlannedActions(raw, ctx)
    assert.deepEqual(plan.clarificationOptions, ['明天', '下周一'])
  })
})
