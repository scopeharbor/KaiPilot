/**
 * v3-ui-next-pmo-domain W9 · tasks 9.4 —— AI 同事 PMO 组合层 8 条全域（组织级）
 * 导航规则测试（spec「组织级空间坐标与 AI 同事全域导航闭环」要求 2 / scenario）。
 *
 * 覆盖：
 * - 8 条规则（rule_nav_pmo_overview/traffic_light/grouping/priority/decisions/
 *   dependencies/impact/ai_priority）代表句全部命中：参数 = { lens: 'pmo',
 *   target: 'pmo-…' }，零 projectId、零 depth 注入、零 ContextMissingError；
 * - 全域分发一致性：角色首页（无项目上下文）与项目空间（有 currentProjectId）
 *   两情境结果完全一致——PMO 为组织层全域视角，项目空间内发起仍产出组织级目标
 *   （不注入当前项目 ID），镜像旧顶栏入口行为；
 * - 歧义句矩阵：「去 PMO 决策工作台」落 decisions 而非总览（具体页优先于泛化
 *   overview）；「变更…影响分析」仍归项目变更规则（PMO impact 不吞既有语义）；
 * - 既有确定性规则共存回归：项目资源/成员/文件/风险/变更/图表/帮助/知识/首页等
 *   零漂移；「去工作台/返回首页」仍归 home。
 */
import { describe, expect, test } from 'vitest'
import { parseColleagueIntent, type ColleagueContext } from '@/lib/next/ai-colleague-intent'

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

const unknownCtx: ColleagueContext = {
  contextType: 'unknown',
  currentProjectId: null,
  pathname: '/next/pmo',
}

/** 8 条规则代表句 → 期望 target（与 tasks 9.3 规则 id 一一对应）。 */
const PMO_RULE_CASES: ReadonlyArray<[string, string, string]> = [
  ['rule_nav_pmo_overview', '打开组合仪表盘', 'pmo-overview'],
  ['rule_nav_pmo_overview', '查看组合总览', 'pmo-overview'],
  ['rule_nav_pmo_traffic_light', '看看红绿灯', 'pmo-traffic-light'],
  ['rule_nav_pmo_traffic_light', '去交通灯报告', 'pmo-traffic-light'],
  ['rule_nav_pmo_grouping', '打开分组视图', 'pmo-grouping-views'],
  ['rule_nav_pmo_priority', '查看优先级评分', 'pmo-priority-scoring'],
  ['rule_nav_pmo_ai_priority', '去 AI 优先级推荐', 'pmo-ai-priority-recommendations'],
  ['rule_nav_pmo_decisions', '去决策工作台', 'pmo-decisions'],
  ['rule_nav_pmo_dependencies', '打开跨项目依赖', 'pmo-dependencies'],
  ['rule_nav_pmo_impact', '查看多项目影响分析', 'pmo-impact-analysis'],
]

describe('AI 同事 PMO 全域规则（tasks 9.3）', () => {
  test.each(PMO_RULE_CASES)(
    '%s：代表句 → navigate_to_space + lens=pmo + target=%s（零 projectId）',
    (ruleId, prompt, target) => {
      for (const ctx of [projectCtx, homeCtx, unknownCtx]) {
        const intent = parseColleagueIntent(prompt, ctx)
        expect(intent.toolName).toBe('navigate_to_space')
        expect(intent.matchedRuleId).toBe(ruleId)
        expect(intent.intentSource).toBe('rule_preset')
        expect(intent.confidence).toBe(1)
        expect(intent.parameters).toEqual({ lens: 'pmo', target })
        expect(intent.parameters.projectId).toBeUndefined()
        expect(intent.parameters.depth).toBeUndefined()
        expect(intent.fallbackPrompt).toBeUndefined()
      }
    },
  )

  test('spec 场景「看看红绿灯」：角色首页（无项目上下文）命中 traffic 规则且无上下文缺失引导', () => {
    const intent = parseColleagueIntent('看看红绿灯', homeCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_pmo_traffic_light')
    expect(intent.parameters).toEqual({ lens: 'pmo', target: 'pmo-traffic-light' })
    expect(intent.parameters.projectId).toBeUndefined()
  })

  test('项目空间情境下命中 PMO 规则不注入当前项目（全域视角，组织级目标）', () => {
    const intent = parseColleagueIntent('去决策工作台', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_pmo_decisions')
    expect(intent.parameters).toEqual({ lens: 'pmo', target: 'pmo-decisions' })
    expect(intent.parameters.projectId).toBeUndefined()
  })

  test('泛化「pmo/组合」令牌收尾：具体页优先于总览（去 PMO 决策工作台 → decisions）', () => {
    expect(parseColleagueIntent('去 PMO 决策工作台', homeCtx).parameters).toEqual({
      lens: 'pmo',
      target: 'pmo-decisions',
    })
    expect(parseColleagueIntent('打开 PMO 分组视图', homeCtx).parameters).toEqual({
      lens: 'pmo',
      target: 'pmo-grouping-views',
    })
    expect(parseColleagueIntent('查看 PMO 红绿灯', homeCtx).parameters).toEqual({
      lens: 'pmo',
      target: 'pmo-traffic-light',
    })
    // 无具体页令牌的裸 PMO / 组合诉求落总览
    expect(parseColleagueIntent('去 PMO 组合总览', homeCtx).matchedRuleId).toBe(
      'rule_nav_pmo_overview',
    )
    expect(parseColleagueIntent('打开 pmo', homeCtx).matchedRuleId).toBe('rule_nav_pmo_overview')
  })

  test('「变更…影响分析」仍归项目变更规则（PMO impact 规则不吞既有语义）', () => {
    const changeIntent = parseColleagueIntent('去处理当前项目的变更影响分析', projectCtx)
    expect(changeIntent.matchedRuleId).toBe('rule_nav_project_change_requests')
    expect(changeIntent.parameters).toEqual({
      lens: 'change_requests',
      depth: 'workbench',
      projectId: 42,
    })
  })
})

describe('与既有确定性规则共存回归（新规则不吞旧语义）', () => {
  test('项目治理/协同域导航语义不变', () => {
    expect(parseColleagueIntent('查看项目资源', projectCtx).matchedRuleId).toBe(
      'rule_nav_resources',
    )
    expect(parseColleagueIntent('管理项目成员', projectCtx).matchedRuleId).toBe('rule_nav_members')
    expect(parseColleagueIntent('打开项目文件', projectCtx).matchedRuleId).toBe('rule_nav_files')
    expect(parseColleagueIntent('打开项目风险工作台', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_risks',
    )
    expect(parseColleagueIntent('去处理当前项目的变更请求', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_change_requests',
    )
    expect(parseColleagueIntent('打开帮助中心', projectCtx).matchedRuleId).toBe('rule_nav_help')
    expect(parseColleagueIntent('去知识库', projectCtx).matchedRuleId).toBe('rule_nav_knowledge')
  })

  test('组织/全局视窗规则不被 PMO 规则抢占（org 镜头归属不变）', () => {
    expect(parseColleagueIntent('打开组织资源池', projectCtx).parameters).toEqual({
      lens: 'org_resource_pool',
    })
    expect(parseColleagueIntent('查看组织 OKR 仪表盘', homeCtx).parameters).toEqual({
      lens: 'org_okr_dashboard',
    })
    expect(parseColleagueIntent('去跨项目调配', homeCtx).parameters).toEqual({
      lens: 'org_cross_project_allocation',
    })
    expect(parseColleagueIntent('去容量环', homeCtx).parameters).toEqual({
      lens: 'org_capacity_loops',
    })
  })

  test('home / 图表馆 / 查询语义不变', () => {
    expect(parseColleagueIntent('返回首页', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('去工作台', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('去甘特图', projectCtx).matchedRuleId).toBe('rule_nav_gantt')
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('项目概况', projectCtx).toolName).toBe('get_project_summary')
    expect(parseColleagueIntent('列出进行中的任务', projectCtx).toolName).toBe('list_project_tasks')
  })
})
