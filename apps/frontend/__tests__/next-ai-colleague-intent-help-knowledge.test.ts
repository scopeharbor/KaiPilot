/**
 * v3-ui-next-help-knowledge-domain W3 · tasks 3.4 —— AI 同事帮助/知识两全局意图
 * 规则测试（spec「空间地图坐标点亮与 AI 同事意图直达三通道闭环」要求 2）。
 *
 * 覆盖：
 * - 「打开帮助中心」「去查看使用手册」命中 rule_nav_help，派发 navigate_to_space
 *   参数 `{ lens: 'help' }`；
 * - 「打开知识底座」「去知识库」命中 rule_nav_knowledge，参数 `{ lens: 'knowledge' }`；
 * - 全域导航语义：单项目上下文与全域（角色首页）视图分发一致——不注入 projectId、
 *   不抛 ContextMissingError（RL-07：rule_preset + confidence=1 + matchedRuleId）；
 * - 优先级高于 rule_nav_home（置于其前，避免「…知识库首页」被首页规则误吞）；
 * - 与既有确定性规则共存回归：home 概览、镜头导航、文件/成员域等既有语义零漂移。
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

describe('AI 同事帮助/知识全域导航（rule_nav_help / rule_nav_knowledge）', () => {
  test('「打开帮助中心」→ rule_nav_help：navigate_to_space + lens=help', () => {
    const intent = parseColleagueIntent('打开帮助中心', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_help')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual({ lens: 'help' })
    expect(intent.fallbackPrompt).toBeUndefined()
  })

  test('spec 变体「去查看使用手册」「怎么用帮助」「看看常见问题」均命中 rule_nav_help', () => {
    expect(parseColleagueIntent('去查看使用手册', projectCtx).matchedRuleId).toBe('rule_nav_help')
    expect(parseColleagueIntent('查看操作指南', projectCtx).matchedRuleId).toBe('rule_nav_help')
    expect(parseColleagueIntent('怎么用帮助', projectCtx).matchedRuleId).toBe('rule_nav_help')
    expect(parseColleagueIntent('看看常见问题', projectCtx).matchedRuleId).toBe('rule_nav_help')
    expect(parseColleagueIntent('返回帮助中心首页', projectCtx).matchedRuleId).toBe('rule_nav_help')
  })

  test('「打开知识底座」→ rule_nav_knowledge：navigate_to_space + lens=knowledge', () => {
    const intent = parseColleagueIntent('打开知识底座', projectCtx)
    expect(intent.toolName).toBe('navigate_to_space')
    expect(intent.matchedRuleId).toBe('rule_nav_knowledge')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters).toEqual({ lens: 'knowledge' })
  })

  test('spec 场景「帮我打开四层知识库」与变体「去知识库」「查看业务规范」命中 knowledge', () => {
    expect(parseColleagueIntent('帮我打开四层知识库', projectCtx).matchedRuleId).toBe(
      'rule_nav_knowledge',
    )
    expect(parseColleagueIntent('去知识库', projectCtx).matchedRuleId).toBe('rule_nav_knowledge')
    expect(parseColleagueIntent('查看四层知识', projectCtx).matchedRuleId).toBe(
      'rule_nav_knowledge',
    )
    expect(parseColleagueIntent('去知识底座', projectCtx).matchedRuleId).toBe('rule_nav_knowledge')
  })

  test('单项目上下文与全域视图分发一致：零 projectId 注入、零 ContextMissingError', () => {
    for (const context of [projectCtx, homeCtx]) {
      const helpIntent = parseColleagueIntent('打开帮助中心', context)
      expect(helpIntent.matchedRuleId).toBe('rule_nav_help')
      expect(helpIntent.parameters).toEqual({ lens: 'help' })
      expect(helpIntent.parameters.projectId).toBeUndefined()

      const knowledgeIntent = parseColleagueIntent('打开知识库', context)
      expect(knowledgeIntent.matchedRuleId).toBe('rule_nav_knowledge')
      expect(knowledgeIntent.parameters).toEqual({ lens: 'knowledge' })
      expect(knowledgeIntent.parameters.projectId).toBeUndefined()
    }
  })

  test('优先级高于 rule_nav_home：「去知识库首页」归 knowledge 而非 home 概览', () => {
    const intent = parseColleagueIntent('去知识库首页', projectCtx)
    expect(intent.matchedRuleId).toBe('rule_nav_knowledge')
    expect(intent.parameters).toEqual({ lens: 'knowledge' })
  })
})

describe('与既有确定性规则的共存回归（新规则不吞旧语义）', () => {
  test('home 概览语义不变：返回首页 / 去工作台 仍为 overview', () => {
    expect(parseColleagueIntent('返回首页', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('去工作台', projectCtx).parameters).toEqual({ lens: 'overview' })
    expect(parseColleagueIntent('返回首页', homeCtx).parameters).toEqual({ lens: 'overview' })
  })

  test('既有镜头/功能域导航不受影响：甘特图/看板/图表馆/资源/成员/文件', () => {
    expect(parseColleagueIntent('去甘特图', projectCtx).matchedRuleId).toBe('rule_nav_gantt')
    expect(parseColleagueIntent('打开看板', projectCtx).matchedRuleId).toBe('rule_nav_kanban')
    expect(parseColleagueIntent('去图表馆', projectCtx).matchedRuleId).toBe('rule_nav_charts')
    expect(parseColleagueIntent('查看项目资源', projectCtx).matchedRuleId).toBe(
      'rule_nav_resources',
    )
    expect(parseColleagueIntent('查看项目成员', projectCtx).matchedRuleId).toBe('rule_nav_members')
    expect(parseColleagueIntent('查看项目文件列表', projectCtx).matchedRuleId).toBe(
      'rule_nav_files',
    )
  })

  test('查询语义不被抢占：风险列表 / 项目概况 / 任务列表仍走原工具', () => {
    expect(parseColleagueIntent('查看风险列表', projectCtx).toolName).toBe('list_project_risks')
    expect(parseColleagueIntent('项目概况', projectCtx).toolName).toBe('get_project_summary')
    expect(parseColleagueIntent('列出进行中的任务', projectCtx).toolName).toBe('list_project_tasks')
  })
})
