/**
 * v3-ui-next-risk-change-domains W3 · tasks 3.8 —— AI 同事两域意图导航测试
 * （spec「AI 同事自然语言意图扩展」）。
 *
 * 覆盖：
 * - 「打开项目风险工作台」与「去处理当前项目的变更请求」精准命中
 *   rule_nav_project_risks / rule_nav_project_change_requests，派发 navigate_to_space
 *   并自动注入当前 projectId（RL-07：intentSource=rule_preset + confidence=1 +
 *   matchedRuleId 供 UI 打「⚡ 快捷规则匹配」真实标识）；
 * - 无项目上下文（全局角色首页）唤起两域意图 → 抛 ContextMissingError 标准引导；
 * - 与既有规则的确定性共存回归：风险列表聊天查询（rule_query_risks）、
 *   图表馆风险矩阵专属诉求（rule_nav_chart_risk_register）与 home 概览规则
 *   均不被新规则误吞。
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

describe('AI 同事两域意图导航（rule_nav_project_risks / rule_nav_project_change_requests）', () => {
  test('「打开项目风险工作台」→ rule_nav_project_risks：navigate_to_space + projectId 注入', () => {
    const intent = parseColleagueIntent('打开项目风险工作台', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_project_risks')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual({ lens: 'risks', depth: 'workbench', projectId: 42 })
  })

  test('spec 场景「带我去看看当前项目的风险情况」与「查看项目风险工作台」同样命中风险域', () => {
    const viaSpec = parseColleagueIntent('带我去看看当前项目的风险情况', projectCtx)
    expect(viaSpec.matchedRuleId).toBe('rule_nav_project_risks')
    expect(viaSpec.toolName).toBe('navigate_to_space')
    expect(viaSpec.parameters).toEqual({ lens: 'risks', depth: 'workbench', projectId: 42 })

    const viaView = parseColleagueIntent('查看项目风险工作台', projectCtx)
    expect(viaView.matchedRuleId).toBe('rule_nav_project_risks')
    expect(viaView.parameters.lens).toBe('risks')
  })

  test('「去处理当前项目的变更请求」→ rule_nav_project_change_requests：lens=change_requests + 注入 projectId', () => {
    const intent = parseColleagueIntent('去处理当前项目的变更请求', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_project_change_requests')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual({
      lens: 'change_requests',
      depth: 'workbench',
      projectId: 42,
    })
  })

  test('「打开变更请求」「申请变更审批」等变体均派发变更域导航', () => {
    expect(parseColleagueIntent('打开变更请求', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_change_requests',
    )
    expect(parseColleagueIntent('申请变更审批', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_change_requests',
    )
    expect(parseColleagueIntent('查看项目的审批流', projectCtx).matchedRuleId).toBe(
      'rule_nav_project_change_requests',
    )
  })

  test('全局非项目空间唤起两域导航 → ContextMissingError 诚实引导，绝不拼装假链接', () => {
    for (const prompt of ['打开项目风险工作台', '打开变更请求', '去处理当前项目的变更请求']) {
      expect(() => parseColleagueIntent(prompt, homeCtx)).toThrow(ContextMissingError)
      try {
        parseColleagueIntent(prompt, homeCtx)
      } catch (error) {
        expect((error as ContextMissingError).message).toBe(COLLEAGUE_CONTEXT_MISSING_TEXT)
      }
    }
  })

  test('RL-07 真实规则标识：命中卡片统一携带 matchedRuleId + rule_preset（不冒充模型推理）', () => {
    const intent = parseColleagueIntent('打开项目风险工作台', projectCtx)
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.matchedRuleId).toBeTruthy()
    expect(intent.fallbackPrompt).toBeUndefined()
  })
})

describe('与既有确定性规则的共存回归（新规则不误吞旧语义）', () => {
  test('风险列表聊天查询语义不变：「查看风险列表 / 排查项目风险 / 项目隐患」仍为 list_project_risks', () => {
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('排查项目风险', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('项目隐患', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('项目延期风险排查', projectCtx).matchedRuleId).toBe(
      'rule_query_risks',
    )
  })

  test('图表馆专属诉求不被两域规则抢占：「打开风险矩阵」仍为 chart=risk-register', () => {
    const intent = parseColleagueIntent('打开风险矩阵', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_chart_risk_register')
    expect(intent.parameters.chart).toBe('risk-register')
    expect(parseColleagueIntent('查看风险登记', projectCtx).parameters.chart).toBe('risk-register')
  })

  test('「…风险工作台」不再被 home 规则（overview）吞没，其它 home 语义不受影响', () => {
    expect(parseColleagueIntent('返回首页', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('去工作台', projectCtx).parameters).toEqual({ lens: 'overview' })
    // 「去甘特图」等既有镜头导航不受影响
    expect(parseColleagueIntent('去甘特图', projectCtx).matchedRuleId).toBe('rule_nav_gantt')
  })

  test('全域「风险列表」仍走项目域查询规则并抛上下文缺失引导', () => {
    expect(() => parseColleagueIntent('风险列表', homeCtx)).toThrow(ContextMissingError)
  })
})
