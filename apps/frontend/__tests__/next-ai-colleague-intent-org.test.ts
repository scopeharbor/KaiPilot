/**
 * v3-ui-next-org-portfolio-domains W10 · tasks 10.4 —— AI 同事组织/全局 17 条全域
 * 导航规则测试（spec「组织级空间坐标与 AI 同事全域导航闭环」要求 2）。
 *
 * 覆盖：
 * - 17 条规则（rule_nav_org_* / rule_nav_global_*）代表句全部命中正确 lens；
 * - 全域导航分支：单项目上下文与全域（角色首页）视图分发一致——参数仅含
 *   `{ lens: 'org_*' }`，零 projectId 注入、零 ContextMissingError（RL-07）；
 * - 歧义句矩阵：「组织资源池/组织 OKR/技能矩阵/插件目录/容量环/组织风险热力」精确
 *   归组织规则；「查看项目资源/查看资源」仍归项目级规则（全域视图缺上下文时
 *   维持 ContextMissingError 诚实引导，既有语义零回归）；
 * - 既有确定性规则共存回归：项目风险/变更/资源/成员/文件/帮助/知识/首页等零漂移。
 */
import { describe, expect, test } from 'vitest'
import {
  COLLEAGUE_CONTEXT_MISSING_TEXT,
  ContextMissingError,
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

/** 17 条规则代表句 → 期望 lens（与 tasks 10.3 规则 id 一一对应）。 */
const ORG_RULE_CASES: ReadonlyArray<[string, string, string]> = [
  ['rule_nav_org_overview', '打开组织概览', 'org_overview'],
  ['rule_nav_org_bi_dashboards', '打开组织 BI 仪表盘', 'org_bi_dashboards'],
  ['rule_nav_org_bi_risk_heatmap', '查看组织风险热力图', 'org_bi_risk_heatmap'],
  ['rule_nav_org_bi_trends', '查看组织趋势分析', 'org_bi_trends'],
  ['rule_nav_org_okr_dashboard', '打开组织 OKR 仪表盘', 'org_okr_dashboard'],
  ['rule_nav_org_okrs', '查看组织 OKR 层级', 'org_okrs'],
  ['rule_nav_org_resource_pool', '打开组织资源池', 'org_resource_pool'],
  ['rule_nav_org_resource_gaps', '查看组织资源缺口', 'org_resource_gaps'],
  ['rule_nav_org_resource_contentions', '打开资源争用检测', 'org_resource_contentions'],
  ['rule_nav_org_resource_demand', '查看资源需求预测', 'org_resource_demand'],
  ['rule_nav_org_capacity_loops', '去容量环', 'org_capacity_loops'],
  ['rule_nav_org_cross_project_allocation', '打开跨项目调配', 'org_cross_project_allocation'],
  ['rule_nav_org_plugin_directory', '去插件目录', 'org_plugin_directory'],
  ['rule_nav_org_plugin_policies', '打开插件策略', 'org_plugin_policies'],
  ['rule_nav_global_resources', '查看全局资源', 'global_resources'],
  ['rule_nav_global_skill_matrix', '去技能矩阵', 'global_skill_matrix'],
  ['rule_nav_global_risks', '打开问题与风险入口', 'global_risks'],
]

describe('AI 同事组织/全局 17 条全域规则（tasks 10.3）', () => {
  test.each(ORG_RULE_CASES)(
    '%s：代表句 → navigate_to_space + lens=%s（零 projectId）',
    (_id, prompt, lens) => {
      const intent = parseColleagueIntent(prompt, projectCtx)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe(_id)
      expect(intent.intentSource).toBe('rule_preset')
      expect(intent.confidence).toBe(1)
      expect(intent.parameters).toEqual({ lens })
      expect(intent.parameters.projectId).toBeUndefined()
      expect(intent.fallbackPrompt).toBeUndefined()
    },
  )

  test('全域视图（角色首页，无项目上下文）分发与项目空间完全一致：不抛 ContextMissingError', () => {
    for (const [_id, prompt, lens] of ORG_RULE_CASES) {
      const intent = parseColleagueIntent(prompt, homeCtx)
      expect(intent.toolName).toBe('navigate_to_space')
      expect(intent.matchedRuleId).toBe(_id)
      expect(intent.parameters).toEqual({ lens })
    }
  })

  test('spec 场景变体：组织 OKR / OKR 仪表盘 / 技能矩阵 / 容量环规则互不误吞', () => {
    expect(parseColleagueIntent('查看组织 OKR', projectCtx).matchedRuleId).toBe('rule_nav_org_okrs')
    expect(parseColleagueIntent('组织 OKR 进度', projectCtx).matchedRuleId).toBe(
      'rule_nav_org_okrs',
    )
    expect(parseColleagueIntent('打开组织 OKR 仪表盘', projectCtx).matchedRuleId).toBe(
      'rule_nav_org_okr_dashboard',
    )
    expect(parseColleagueIntent('看 OKR 仪表盘', projectCtx).matchedRuleId).toBe(
      'rule_nav_org_okr_dashboard',
    )
    expect(parseColleagueIntent('去技能矩阵', projectCtx).matchedRuleId).toBe(
      'rule_nav_global_skill_matrix',
    )
    expect(parseColleagueIntent('查看容量闭环计划', projectCtx).matchedRuleId).toBe(
      'rule_nav_org_capacity_loops',
    )
  })
})

describe('歧义句矩阵（复合词精确抢占，项目级规则零回归）', () => {
  test('「组织资源池」归组织池规则；「查看项目资源」仍归项目资源规则并注入 projectId', () => {
    const orgPool = parseColleagueIntent('组织资源池', projectCtx)
    expect(orgPool.matchedRuleId).toBe('rule_nav_org_resource_pool')
    expect(orgPool.parameters).toEqual({ lens: 'org_resource_pool' })

    const projectResources = parseColleagueIntent('查看项目资源', projectCtx)
    expect(projectResources.matchedRuleId).toBe('rule_nav_resources')
    expect(projectResources.parameters).toEqual({
      lens: 'resources',
      depth: 'workbench',
      projectId: 42,
    })

    // 资源库/资源工作台等项目级专属词仍归项目规则（组织池规则不吞）
    expect(parseColleagueIntent('前往资源库', projectCtx).matchedRuleId).toBe('rule_nav_resources')
    expect(parseColleagueIntent('打开资源工作台', projectCtx).matchedRuleId).toBe(
      'rule_nav_resources',
    )
  })

  test('「查看项目风险工作台」仍归项目风险规则（组织风险热力不吞项目风险）', () => {
    expect(parseColleagueIntent('打开项目风险工作台', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_risks',
    )
    expect(parseColleagueIntent('查看项目风险工作台', projectCtx).parameters.lens).toBe('risks')
    // 风险热力为组织 BI 镜头专属
    expect(parseColleagueIntent('查看组织风险热力图', projectCtx).parameters.lens).toBe(
      'org_bi_risk_heatmap',
    )
  })

  test('「查看项目图表/打开风险矩阵/查看资源负荷」等图表馆专属语义不被组织规则抢占', () => {
    expect(parseColleagueIntent('查看项目图表', projectCtx).matchedRuleId).toBe('rule_nav_charts')
    expect(parseColleagueIntent('打开风险矩阵', projectCtx).matchedRuleId).toBe(
      'rule_nav_chart_risk_register',
    )
    expect(parseColleagueIntent('查看资源负荷', projectCtx).matchedRuleId).toBe(
      'rule_nav_chart_resource_load',
    )
    expect(parseColleagueIntent('去图表馆', projectCtx).matchedRuleId).toBe('rule_nav_charts')
  })

  test('非项目上下文歧义句诚实引导不回归：「查看资源/查看项目资源/查看项目风险」仍抛 ContextMissingError', () => {
    for (const prompt of ['查看资源', '查看项目资源', '查看项目风险', '打开项目风险工作台']) {
      expect(() => parseColleagueIntent(prompt, homeCtx)).toThrow(ContextMissingError)
      try {
        parseColleagueIntent(prompt, homeCtx)
      } catch (error) {
        expect((error as ContextMissingError).message).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
      }
    }
  })
})

describe('与既有确定性规则共存回归（新规则不吞旧语义）', () => {
  test('项目治理/协同域导航语义不变', () => {
    expect(parseColleagueIntent('查看项目资源', projectCtx).matchedRuleId).toBe(
      'rule_nav_resources',
    )
    expect(parseColleagueIntent('管理项目成员', projectCtx).matchedRuleId).toBe('rule_nav_members')
    expect(parseColleagueIntent('打开项目文件', projectCtx).matchedRuleId).toBe('rule_nav_files')
    expect(parseColleagueIntent('去处理当前项目的变更请求', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_change_requests',
    )
    expect(parseColleagueIntent('打开帮助中心', projectCtx).matchedRuleId).toBe('rule_nav_help')
    expect(parseColleagueIntent('去知识库', projectCtx).matchedRuleId).toBe('rule_nav_knowledge')
  })

  test('home / 查询语义不变', () => {
    expect(parseColleagueIntent('返回首页', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('去工作台', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('项目概况', projectCtx).toolName).toBe('get_project_summary')
    expect(parseColleagueIntent('列出进行中的任务', projectCtx).toolName).toBe('list_project_tasks')
    expect(parseColleagueIntent('去甘特图', projectCtx).matchedRuleId).toBe('rule_nav_gantt')
  })
})
