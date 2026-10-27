// v3-llm-wiki-query-navigation —— AI 同事规划器的维基动作：只在可用时提供、查看类、全局可用、参数校验。
import { test } from '@japa/runner'
import {
  GLOBAL_PLANNER_TOOL_NAMES,
  WIKI_PLANNER_TOOLS,
  buildNativePlannerSystemPrompt,
  buildPlannerSystemPrompt,
  nativeToolCallsToRawPlan,
  normalizePlannedActions,
  type PlannerProjectRow,
} from '#services/ai_colleague/action_planner_service'

const PROJECTS: PlannerProjectRow[] = [{ id: 9, code: 'PROJ-9', name: '乙项目', status: 'active' }]

const plan = (
  actions: Record<string, unknown>[],
  wikiAvailable: boolean,
  projectId: number | null = 42,
) =>
  normalizePlannedActions(
    { isAction: true, actions, continue: true },
    { projectId, tasks: [], projects: PROJECTS, wikiAvailable },
  )

test.group('AI 同事规划器 · 记忆维基动作', () => {
  test('提示词：只在可用时出现维基动作与「实时数据优先」规则', ({ assert }) => {
    assert.notInclude(buildPlannerSystemPrompt(), 'wiki_index')
    assert.notInclude(buildNativePlannerSystemPrompt(), 'read_wiki_index')
    const json = buildPlannerSystemPrompt({ wiki: true })
    for (const name of ['wiki_index', 'wiki_read', 'wiki_search']) assert.include(json, name)
    assert.include(json, '以实时数据为准')
    assert.include(buildNativePlannerSystemPrompt({ wiki: true }), '以实时数据为准')
  })

  test('不可用时丢弃维基动作并说明', ({ assert }) => {
    const r = plan([{ action: 'wiki_index' }, { action: 'wiki_read', pageId: 3 }], false)
    assert.lengthOf(r.actions, 0)
    assert.lengthOf(r.rejected, 2)
    assert.match(r.rejected[0]!, /没有开启记忆维基/)
  })

  test('可用时映射为只读工具；项目取当前或点名项目；参数校验', ({ assert }) => {
    const r = plan(
      [
        { action: 'wiki_index' },
        { action: 'wiki_search', keyword: '证书', projectId: 9 },
        { action: 'wiki_read', pageId: 3, section: '应对' },
        { action: 'wiki_read', pageId: 'x' },
        { action: 'wiki_search', keyword: '' },
        { action: 'wiki_search', keyword: '长'.repeat(80) },
      ],
      true,
    )
    assert.deepEqual(
      r.actions.map((a) => [a.toolName, a.parameters]),
      [
        ['wiki_index', { projectId: 42 }],
        ['wiki_search', { keyword: '证书', projectId: 9 }],
        ['wiki_read', { pageId: 3, section: '应对' }],
      ],
    )
    assert.lengthOf(r.rejected, 3)
    assert.isTrue(r.continue)

    const global = plan([{ action: 'wiki_index' }], true, null)
    assert.deepEqual(global.actions[0]!.parameters, {})
  })

  test('原生工具：维基工具是查看类且全局可用，调用后继续下一轮', ({ assert }) => {
    for (const tool of WIKI_PLANNER_TOOLS) assert.isTrue(GLOBAL_PLANNER_TOOL_NAMES.has(tool.name))
    const { raw, unknownCalls } = nativeToolCallsToRawPlan({
      text: '',
      toolCalls: [{ name: 'read_wiki_page', arguments: { pageId: 5, section: '背景' } }],
    })
    assert.lengthOf(unknownCalls, 0)
    assert.isTrue(raw.continue)
    assert.deepEqual(raw.actions, [{ action: 'wiki_read', pageId: 5, section: '背景' }])
  })
})
