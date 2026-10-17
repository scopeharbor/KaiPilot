/**
 * 前端轻量意图路由器单元测试（v3-ui-next-ai-colleague W1 · tasks 1.4）。
 *
 * 覆盖设计 Decision 1「意图分发规则表」全部行：导航/摘要/任务/风险/排程，
 * 以及：当前项目 ID 自动注入、缺项目上下文拦截、排程参数提取与不完整防猜忌、
 * 未识别意图诚实回退、快捷入口自洽（每条 fill 均可解析为可用工具）。
 */
import { describe, expect, test } from 'vitest'
import {
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  COLLEAGUE_FALLBACK_TEXT,
  COLLEAGUE_QUICK_ENTRIES,
  COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT,
  ContextMissingError,
  deriveColleagueContext,
  parseColleagueIntent,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'

const projectCtx: ColleagueContext = {
  contextType: 'project_space',
  currentProjectId: 42,
  pathname: '/next/projects/42',
}

const homeCtx: ColleagueContext = {
  contextType: 'role_home',
  currentProjectId: null,
  pathname: '/next',
}

describe('空间导航（navigate_to_space）', () => {
  test('去甘特图 → gantt 镜头 + projectId 自动注入', () => {
    const intent = parseColleagueIntent('去甘特图', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.parameters).toEqual({ lens: 'gantt', depth: 'workbench', projectId: 42 })
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.matchedRuleId).toBe('rule_nav_gantt')
  })

  test('查看甘特图（带前缀动词）同样命中', () => {
    const intent = parseColleagueIntent('查看甘特图', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.parameters.lens).toBe('gantt')
  })

  test('打开看板 → kanban 镜头', () => {
    const intent = parseColleagueIntent('打开看板', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_kanban')
    expect(intent.parameters).toEqual({ lens: 'kanban', depth: 'workbench', projectId: 42 })
  })

  test('WBS 与分解结构两种说法命中 wbs 镜头', () => {
    expect(parseColleagueIntent('查看 WBS', projectCtx).parameters.lens).toBe('wbs')
    expect(parseColleagueIntent('帮我打开项目分解结构', projectCtx).parameters.lens).toBe('wbs')
    expect(parseColleagueIntent('查看 WBS', projectCtx).matchedRuleId).toBe('rule_nav_wbs')
  })

  test('返回首页/去工作台 → overview 镜头且不带 projectId', () => {
    const viaHome = parseColleagueIntent('返回首页', projectCtx)
    expect(viaHome.matchedRuleId).toBe('rule_nav_home')
    expect(viaHome.parameters).toEqual({ lens: 'overview' })

    const viaWorkbench = parseColleagueIntent('去工作台', projectCtx)
    expect(viaWorkbench.parameters).toEqual({ lens: 'overview' })
  })

  test('非项目空间发起导航不抛错且不注入 projectId', () => {
    const intent = parseColleagueIntent('去甘特图', homeCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect('projectId' in intent.parameters).toBe(false)
    expect(intent.confidence).toBe(1)
  })
})

describe('项目概况（get_project_summary）', () => {
  test.each([
    '项目概况',
    '查看项目摘要',
    '项目当前进度',
    '总结一下这个项目',
    '项目基本信息',
    '项目大盘',
  ])('关键词「%s」命中摘要规则并注入 projectId', (input) => {
    const intent = parseColleagueIntent(input, projectCtx)
    expect(intent.toolName).toBe('get_project_summary')
    expect(intent.parameters).toEqual({ projectId: 42 })
    expect(intent.matchedRuleId).toBe('rule_query_summary')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
  })
})

describe('任务列表（list_project_tasks）', () => {
  test('查看任务列表 → 不携带状态过滤', () => {
    const intent = parseColleagueIntent('查看任务列表', projectCtx)
    expect(intent.toolName).toBe('list_project_tasks')
    expect(intent.parameters).toEqual({ projectId: 42 })
  })

  test('列出进行中的任务 → status: in_progress（spec 场景）', () => {
    const intent = parseColleagueIntent('列出进行中的任务', projectCtx)
    expect(intent.toolName).toBe('list_project_tasks')
    expect(intent.parameters).toEqual({ projectId: 42, status: 'in_progress' })
  })

  test('当前有哪些受阻任务 → status: blocked（spec 场景）', () => {
    const intent = parseColleagueIntent('当前有哪些受阻任务', projectCtx)
    expect(intent.toolName).toBe('list_project_tasks')
    expect(intent.parameters.status).toBe('blocked')
  })

  test('已完成 / 未开始 / 暂停任务的状态提取', () => {
    expect(parseColleagueIntent('查看已完成的任务', projectCtx).parameters.status).toBe('completed')
    expect(parseColleagueIntent('列出未开始的任务', projectCtx).parameters.status).toBe(
      'not_started',
    )
    expect(parseColleagueIntent('查看暂停的任务', projectCtx).parameters.status).toBe('on_hold')
    expect(parseColleagueIntent('查看已取消的任务', projectCtx).parameters.status).toBe('cancelled')
  })

  test('「待办」/「工作项」单独命中任务规则', () => {
    expect(parseColleagueIntent('待办', projectCtx).toolName).toBe('list_project_tasks')
    expect(parseColleagueIntent('工作项清单', projectCtx).toolName).toBe('list_project_tasks')
  })
})

describe('风险列表（list_project_risks）', () => {
  test('风险/隐患关键词命中且不带状态参数', () => {
    expect(parseColleagueIntent('排查项目风险', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('项目隐患', projectCtx).toolName).toBe('list_project_risks')
    const intent = parseColleagueIntent('查看风险列表', projectCtx)
    expect(intent.parameters).toEqual({ projectId: 42 })
  })
})

describe('排程调整（update_task_schedule）', () => {
  test('延期任务 12 至 2026-09-15 → 完整参数提取（design D1 §3）', () => {
    const intent = parseColleagueIntent('延期任务 12 至 2026-09-15', projectCtx)
    expect(intent.toolName).toBe('update_task_schedule')
    expect(intent.parameters).toEqual({
      projectId: 42,
      taskId: 12,
      startDate: '2026-09-15',
      operation: 'move',
    })
    expect(intent.matchedRuleId).toBe('rule_write_schedule')
  })

  test('「5 号任务推迟至 2026-09-20」两种编号格式均提取', () => {
    const intent = parseColleagueIntent('把 5 号任务推迟至 2026-09-20', projectCtx)
    expect(intent.toolName).toBe('update_task_schedule')
    expect(intent.parameters.taskId).toBe(5)
    expect(intent.parameters.startDate).toBe('2026-09-20')
  })

  test('任务#3 变体提取', () => {
    const intent = parseColleagueIntent('改期任务#3 至 2026-10-01', projectCtx)
    expect(intent.toolName).toBe('update_task_schedule')
    expect(intent.parameters.taskId).toBe(3)
  })

  test('解析不完整「帮我延期任务」→ 诚实引导且不臆测（防猜忌）', () => {
    const intent = parseColleagueIntent('帮我延期任务', projectCtx)
    expect(intent.toolName).toBeNull()
    expect(intent.confidence).toBe(0)
    expect(intent.matchedRuleId).toBe('rule_write_schedule')
    expect(intent.fallbackPrompt).toBe(COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT)
    expect(intent.parameters).toEqual({})
  })

  test('缺日期「延期任务 12」/“改期任务 3 至下个月”同样不臆测', () => {
    const noDate = parseColleagueIntent('延期任务 12', projectCtx)
    expect(noDate.toolName).toBeNull()
    expect(noDate.fallbackPrompt).toBe(COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT)

    const badDate = parseColleagueIntent('改期任务 3 至下个月', projectCtx)
    expect(badDate.toolName).toBeNull()
    expect(badDate.fallbackPrompt).toBe(COLLEAGUE_SCHEDULE_INCOMPLETE_TEXT)
  })

  test('「延期风险」属风险语境，不被写操作规则误吞', () => {
    const intent = parseColleagueIntent('项目延期风险排查', projectCtx)
    expect(intent.toolName).toBe('list_project_risks')
    expect(intent.matchedRuleId).toBe('rule_query_risks')
  })

  test('写操作意图优先于任务列表规则（防误路由）', () => {
    const intent = parseColleagueIntent('延期任务 12 至 2026-09-15', projectCtx)
    expect(intent.toolName).not.toBe('list_project_tasks')
    expect(intent.toolName).toBe('update_task_schedule')
  })

  test('非项目空间发起完整排程指令 → ContextMissingError 拦截', () => {
    expect(() => parseColleagueIntent('延期任务 12 至 2026-09-15', homeCtx)).toThrow(
      ContextMissingError,
    )
  })
})

describe('项目上下文自动注入与缺省拦截（D-context）', () => {
  test('项目空间内提问自动注入 projectId（spec 场景 88）', () => {
    const ctx: ColleagueContext = {
      contextType: 'project_space',
      currentProjectId: 88,
      pathname: '/next/projects/88',
    }
    const intent = parseColleagueIntent('当前有哪些受阻任务', ctx)
    expect(intent.parameters).toEqual({ projectId: 88, status: 'blocked' })
  })

  test.each(['查看项目摘要', '查看任务列表', '风险列表', '延期任务 12 至 2026-09-15'])(
    '全域首页缺少项目上下文时「%s」抛 ContextMissingError',
    (input) => {
      expect(() => parseColleagueIntent(input, homeCtx)).toThrow(ContextMissingError)
      try {
        parseColleagueIntent(input, homeCtx)
      } catch (error) {
        expect((error as ContextMissingError).message).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
      }
    },
  )
})

describe('未识别意图的诚实回退（RL-07）', () => {
  test('无意义文本 → toolName null + 诚实回退文案', () => {
    const intent = parseColleagueIntent('今天天气不错呢', projectCtx)
    expect(intent.toolName).toBeNull()
    expect(intent.confidence).toBe(0)
    expect(intent.fallbackPrompt).toBe(COLLEAGUE_FALLBACK_TEXT)
    expect(intent.parameters).toEqual({})
  })

  test('空输入与纯空白 → 同样回退', () => {
    expect(parseColleagueIntent('', projectCtx).toolName).toBeNull()
    expect(parseColleagueIntent('   ', projectCtx).toolName).toBeNull()
  })

  test('未识别不做任何网络/工具猜测', () => {
    expect(parseColleagueIntent('午饭吃什么', projectCtx)).toMatchObject({
      toolName: null,
      confidence: 0,
    })
  })
})

describe('快捷入口自洽契约（空态引导与回退平铺共用）', () => {
  test('5 项快捷入口在项目空间内均可解析为可用工具', () => {
    expect(COLLEAGUE_QUICK_ENTRIES).toHaveLength(5)
    for (const entry of COLLEAGUE_QUICK_ENTRIES) {
      const intent = parseColleagueIntent(entry.fill, projectCtx)
      expect(intent.toolName, entry.label).not.toBeNull()
      expect(intent.confidence).toBe(1)
    }
  })

  test('快捷入口文案可读且唯一', () => {
    const labels = COLLEAGUE_QUICK_ENTRIES.map((e) => e.label)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels[0]).toContain('项目摘要')
    expect(labels[1]).toContain('任务')
    expect(labels[2]).toContain('甘特图')
    expect(labels[3]).toContain('延期')
  })
})

describe('图表馆直达（v3-ui-next-chart-gallery design §6.3 / spec「三通道可达」）', () => {
  test('泛化指令「去图表馆 / 查看项目图表」→ lens=charts + projectId 自动注入', () => {
    const viaName = parseColleagueIntent('去图表馆', projectCtx)
    expect(viaName.toolName).toBe('navigate_to_space')
    expect(viaName.parameters).toEqual({ lens: 'charts', depth: 'workbench', projectId: 42 })
    expect(viaName.matchedRuleId).toBe('rule_nav_charts')
    expect(viaName.confidence).toBe(1)

    const viaDesc = parseColleagueIntent('查看项目图表', projectCtx)
    expect(viaDesc.matchedRuleId).toBe('rule_nav_charts')
    expect(viaDesc.parameters.lens).toBe('charts')
  })

  test('看资源负荷 → chart=resource-load（spec 场景）', () => {
    const intent = parseColleagueIntent('看资源负荷', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_chart_resource_load')
    expect(intent.parameters).toEqual({
      lens: 'charts',
      chart: 'resource-load',
      depth: 'workbench',
      projectId: 42,
    })
    expect(parseColleagueIntent('打开资源直方图', projectCtx).parameters.chart).toBe(
      'resource-load',
    )
    expect(parseColleagueIntent('人员负荷分析', projectCtx).parameters.chart).toBe('resource-load')
  })

  test('打开风险矩阵 → chart=risk-register（先于风险列表规则，防误吞）', () => {
    const intent = parseColleagueIntent('打开风险矩阵', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_chart_risk_register')
    expect(intent.parameters.chart).toBe('risk-register')
    expect(parseColleagueIntent('查看风险登记', projectCtx).parameters.chart).toBe('risk-register')
    expect(parseColleagueIntent('看 5x5 风险', projectCtx).matchedRuleId).toBe(
      'rule_nav_chart_risk_register',
    )
    // 未被图表馆规则吞掉的普通风险查询行为不变
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('排查项目风险', projectCtx).toolName).toBe('list_project_risks')
  })

  test('AON 网络图 → chart=aon-network（spec 场景「帮我打开 AON 紧前网络图」）', () => {
    const intent = parseColleagueIntent('帮我打开 AON 紧前网络图', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_chart_aon')
    expect(intent.parameters).toEqual({
      lens: 'charts',
      chart: 'aon-network',
      depth: 'workbench',
      projectId: 42,
    })
    expect(parseColleagueIntent('看单代号网络图', projectCtx).parameters.chart).toBe('aon-network')
  })

  test('查看里程碑 → chart=milestone-timeline', () => {
    const intent = parseColleagueIntent('查看里程碑', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_chart_milestone')
    expect(intent.parameters.chart).toBe('milestone-timeline')
  })

  test('打开鱼骨图 / 石川图 → chart=fishbone', () => {
    expect(parseColleagueIntent('打开鱼骨图', projectCtx).parameters.chart).toBe('fishbone')
    expect(parseColleagueIntent('画个因果图分析延期', projectCtx).parameters.chart).toBe('fishbone')
    expect(parseColleagueIntent('石川图', projectCtx).matchedRuleId).toBe('rule_nav_chart_fishbone')
  })

  test('看资源分解结构 → chart=rbs（先于 WBS 旧规则，避免「分解结构」误吞）', () => {
    const intent = parseColleagueIntent('看资源分解结构', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_chart_rbs')
    expect(intent.parameters.chart).toBe('rbs')
    expect(parseColleagueIntent('看 RBS', projectCtx).parameters.chart).toBe('rbs')
    // WBS 语义（工作分解）行为不变
    expect(parseColleagueIntent('查看 WBS', projectCtx).matchedRuleId).toBe('rule_nav_wbs')
  })

  test('查看工时散布图 / 成本偏差 → chart=scatter-plot', () => {
    expect(parseColleagueIntent('查看工时散布图', projectCtx).parameters.chart).toBe('scatter-plot')
    expect(parseColleagueIntent('散点图', projectCtx).matchedRuleId).toBe('rule_nav_chart_scatter')
    expect(parseColleagueIntent('哪些任务成本偏差大', projectCtx).parameters.chart).toBe(
      'scatter-plot',
    )
  })

  test('具体图表诉求优先于泛化图表馆规则（先具体后泛化）', () => {
    const intent = parseColleagueIntent('去图表馆看看资源负荷', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_chart_resource_load')
    expect(intent.parameters.chart).toBe('resource-load')
  })

  test('非项目空间发起图表导航不抛错且不注入 projectId', () => {
    const intent = parseColleagueIntent('打开鱼骨图', homeCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect('projectId' in intent.parameters).toBe(false)
    expect(intent.parameters).toEqual({ lens: 'charts', chart: 'fishbone', depth: 'workbench' })
  })

  test('里程碑语境不再落入写操作规则（无任务编号/日期关键词）', () => {
    const intent = parseColleagueIntent('帮我推迟里程碑风险排查', projectCtx)
    // 「推迟」为写操作关键词但缺任务语境（任务/排程/工期），不触发写规则；
    // 同时含「里程碑」→ 图表馆里程碑直达（新轨语义）。
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_chart_milestone')
  })
})

describe('deriveColleagueContext — 情境派生（D-context §1）', () => {
  test('项目空间路径提取 projectId（含子路径）', () => {
    const ctx = deriveColleagueContext('/next/projects/88/tasks', null)
    expect(ctx.contextType).toBe('project_space')
    expect(ctx.currentProjectId).toBe(88)
  })

  test('角色首页 / 生成剧场 / 未知路径', () => {
    expect(deriveColleagueContext('/next', null).contextType).toBe('role_home')
    expect(deriveColleagueContext('/next/', null).contextType).toBe('role_home')
    expect(deriveColleagueContext('/next/create', null).contextType).toBe('theater_create')
    expect(deriveColleagueContext('/next/charts', null).contextType).toBe('unknown')
  })

  test('无路径 ID 时回退实体 Store 上报的 projectId', () => {
    const ctx = deriveColleagueContext('/next/unknown', 7)
    expect(ctx.contextType).toBe('project_space')
    expect(ctx.currentProjectId).toBe(7)
  })
})

describe('知识性提问交给模型（不被导航/查询规则截走）', () => {
  const ctx = {
    contextType: 'project_space' as const,
    currentProjectId: 3,
    pathname: '/next/projects/3',
  }
  test.each([
    '一句话解释什么是工作分解结构',
    '甘特图和看板有什么区别',
    'WBS 是什么意思',
    '为什么报表中心的数据会延迟',
  ])('「%s」→ 未命中快捷规则', (text) => {
    expect(parseColleagueIntent(text, ctx).toolName).toBeNull()
  })

  test.each([
    ['去 WBS', 'navigate_to_space'],
    ['打开甘特图', 'navigate_to_space'],
    ['查看看板', 'navigate_to_space'],
  ])('明确指令「%s」仍走快捷规则', (text, tool) => {
    expect(parseColleagueIntent(text, ctx).toolName).toBe(tool)
  })
})

describe('具体的复杂提问交给模型', () => {
  const ctx = {
    contextType: 'project_space' as const,
    currentProjectId: 3,
    pathname: '/next/projects/3',
  }
  test('长问题带问号/哪些 → 模型；短问题与明确指令仍走快捷规则', () => {
    expect(
      parseColleagueIntent('灰度切流和双轨并行相关的任务目前进度怎样？哪些有风险？', ctx).toolName,
    ).toBeNull()
    expect(parseColleagueIntent('当前项目有哪些风险？', ctx).toolName).not.toBeNull()
    expect(parseColleagueIntent('查看当前项目摘要', ctx).toolName).toBe('get_project_summary')
  })
})
