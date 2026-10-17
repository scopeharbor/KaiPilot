/**
 * AI 同事跨实体检索意图与参数提取测试（v3-ui-next-batch3-global-convergence W1 · tasks 1.6）。
 *
 * 覆盖：
 * 1. 自然语言「找一下关于登录的设计文档」命中 rule_global_search_entities 并提取 keyword 与 entityTypes；
 * 2. 实体类型过滤识别（任务 / 项目 / 成员 / 文档文件）；
 * 3. 缺失关键词时防猜忌诚实引导（RL-07，confidence: 0，toolName: null，输出引导文案）；
 * 4. executeGlobalSearchEntities 检索端点纯只读调用测试。
 */
import { describe, expect, test, vi, beforeEach } from 'vitest'
import {
  parseColleagueIntent,
  extractSearchEntitiesParams,
  executeGlobalSearchEntities,
  GLOBAL_SEARCH_ENTITIES_TOOL_NAME,
  COLLEAGUE_SEARCH_INCOMPLETE_TEXT,
  type ColleagueContext,
} from '@/lib/next/ai-colleague-intent'
import { searchApi } from '@/lib/api/search'

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

describe('AI 同事全域跨实体检索意图路由 (rule_global_search_entities)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('测试「找一下关于登录的设计文档」命中意图并提取 keyword 与 file 实体类型', () => {
    const intent = parseColleagueIntent('找一下关于登录的设计文档', projectCtx)

    expect(intent.toolName).toBe(GLOBAL_SEARCH_ENTITIES_TOOL_NAME)
    expect(intent.matchedRuleId).toBe('rule_global_search_entities')
    expect(intent.intentSource).toBe('rule_preset')
    expect(intent.confidence).toBe(1)
    expect(intent.parameters.keyword).toBe('登录')
    expect(intent.parameters.entityTypes).toEqual(['file'])
  })

  test('测试实体类型多模式过滤识别（任务/项目/成员/文件）', () => {
    // 任务实体过滤
    const taskIntent = parseColleagueIntent('搜索任务 支付接口联调', homeCtx)
    expect(taskIntent.toolName).toBe(GLOBAL_SEARCH_ENTITIES_TOOL_NAME)
    expect(taskIntent.parameters.keyword).toBe('支付接口联调')
    expect(taskIntent.parameters.entityTypes).toEqual(['task'])

    // 项目实体过滤
    const projectIntent = parseColleagueIntent('搜一下项目 开项核心引擎', homeCtx)
    expect(projectIntent.toolName).toBe(GLOBAL_SEARCH_ENTITIES_TOOL_NAME)
    expect(projectIntent.parameters.keyword).toBe('开项核心引擎')
    expect(projectIntent.parameters.entityTypes).toEqual(['project'])

    // 成员实体过滤
    const memberIntent = parseColleagueIntent('查找成员 张三', homeCtx)
    expect(memberIntent.toolName).toBe(GLOBAL_SEARCH_ENTITIES_TOOL_NAME)
    expect(memberIntent.parameters.keyword).toBe('张三')
    expect(memberIntent.parameters.entityTypes).toEqual(['member'])

    // 全域无限定实体
    const generalIntent = parseColleagueIntent('全域搜索 自动化验收架构', homeCtx)
    expect(generalIntent.toolName).toBe(GLOBAL_SEARCH_ENTITIES_TOOL_NAME)
    expect(generalIntent.parameters.keyword).toBe('自动化验收架构')
    expect(generalIntent.parameters.entityTypes).toBeUndefined()
  })

  test('测试缺失关键词时诚实引导（RL-07 纯诚实，防猜忌）', () => {
    // 仅输入动词和实体，无实际检索关键词
    const incompleteDoc = parseColleagueIntent('找一下文档', homeCtx)
    expect(incompleteDoc.toolName).toBeNull()
    expect(incompleteDoc.confidence).toBe(0)
    expect(incompleteDoc.matchedRuleId).toBe('rule_global_search_entities')
    expect(incompleteDoc.fallbackPrompt).toBe(COLLEAGUE_SEARCH_INCOMPLETE_TEXT)

    const incompleteTask = parseColleagueIntent('搜索任务', projectCtx)
    expect(incompleteTask.toolName).toBeNull()
    expect(incompleteTask.confidence).toBe(0)
    expect(incompleteTask.matchedRuleId).toBe('rule_global_search_entities')
    expect(incompleteTask.fallbackPrompt).toBe(COLLEAGUE_SEARCH_INCOMPLETE_TEXT)
  })

  test('测试参数提取纯函数 extractSearchEntitiesParams 边界', () => {
    expect(extractSearchEntitiesParams('今天天气怎么样')).toBeNull()
    expect(extractSearchEntitiesParams('从回收站恢复任务 12')).toBeNull() // 回收站专用不截胡

    const extracted = extractSearchEntitiesParams('帮我找一下关于认证中心的设计文档')
    expect(extracted).toEqual({
      keyword: '认证中心',
      entityTypes: ['file'],
    })
  })

  test('测试 executeGlobalSearchEntities 调用只读 searchApi.search 端点', async () => {
    const searchSpy = vi.spyOn(searchApi, 'search').mockResolvedValue({
      data: [],
      meta: { total: 0, page: 1, perPage: 10, totalPages: 0 },
    })

    await executeGlobalSearchEntities({ keyword: '登录', entityTypes: ['file'] })

    expect(searchSpy).toHaveBeenCalledWith({
      keyword: '登录',
      entityTypes: ['file'],
      perPage: 10,
    })
  })
})
