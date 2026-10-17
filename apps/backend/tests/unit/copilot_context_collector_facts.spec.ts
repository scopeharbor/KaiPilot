/**
 * v3-copilot-authoritative-page-context —— collector 事实投影单元测试（任务 2.1）。
 *
 * 覆盖：allowlisted 字段投影（闭合白名单）、行级预算、无 DOM/未知字段/敏感
 * 字段不进入事实、零命中/零权限不下发事实、trucated 语义。
 *
 * 纯 vitest：不触数据库与网络。
 */
import { describe, it, expect } from 'vitest'
import {
  CopilotContextCollector,
  COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE,
  COPILOT_FACT_ITEM_ALLOWLIST,
} from '../../app/services/copilot/copilot_context_collector.js'

const OBSERVED_AT = '2026-09-01T06:32:00.000Z'

function makeCollector() {
  const searchService = {
    getAdapters: () => new Map(),
  }
  return new CopilotContextCollector({
    searchService: searchService as never,
    knowledgeService: {} as never,
    permissionChecker: async () => ({ allowed: true }),
    buildSearchContext: () => ({}) as never,
  })
}

describe('projectSearchFactItems：allowlisted 投影', () => {
  it('只投影白名单字段：任务名/状态/优先级/负责人，丢弃描述全文与未知字段', () => {
    const collector = makeCollector()
    const facts = collector.projectSearchFactItems(
      [
        {
          id: 42,
          name: '登录模块',
          status: 'in_progress',
          priority: 'high',
          assigneeId: 7,
          description: '这是很长的描述全文，不应该进入事实',
          secretNote: '机密',
          innerHTML: '<div>dom</div>',
        },
      ],
      'task',
      OBSERVED_AT,
    )
    expect(facts).toHaveLength(1)
    const fact = facts[0]
    expect(fact.factKey).toBe('task.row:42')
    expect(fact.sourceRef).toBe('task:42')
    expect(fact.facet).toBe('taskStatus')
    expect(fact.sensitivity).toBe('low')
    expect(fact.value).toContain('name=登录模块')
    expect(fact.value).toContain('status=in_progress')
    // 负责人只以代号交给模型（推不出用户 ID）
    expect(
      (fact.value as string[]).some((entry) =>
        /^assignee=〔成员·[0-9A-HJKMNP-TV-Z]{8}〕$/.test(entry),
      ),
    ).toBe(true)
    const serialized = JSON.stringify(fact)
    expect(serialized).not.toContain('description')
    expect(serialized).not.toContain('全文')
    expect(serialized).not.toContain('secretNote')
    expect(serialized).not.toContain('机密')
    expect(serialized).not.toContain('innerHTML')
    expect(serialized).not.toContain('<div')
  })

  it('行级预算：超过上限的 item 省略（计数语义由 hitCount 承担）', () => {
    const collector = makeCollector()
    const items = Array.from({ length: COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE + 5 }, (_, i) => ({
      id: i + 1,
      title: `风险 ${i + 1}`,
      severity: 'high',
    }))
    const facts = collector.projectSearchFactItems(items, 'risk', OBSERVED_AT)
    expect(facts).toHaveLength(COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE)
    expect(facts[facts.length - 1].factKey).toBe(
      `risk.row:${COPILOT_FACT_COLLECTOR_ROWS_PER_SOURCE}`,
    )
  })

  it('白名单外字段（score）不进入事实；仅 id 仍产出最小投影', () => {
    const collector = makeCollector()
    const facts = collector.projectSearchFactItems([{ id: 9, score: 0.9 }], 'task', OBSERVED_AT)
    expect(facts).toHaveLength(1)
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain('score')
    expect(facts[0].value).toEqual(['id=9'])
  })

  it('未知来源种类使用其白名单；全部未知来源均闭合（无空降投影）', () => {
    const collector = makeCollector()
    for (const [kind, allowlist] of Object.entries(COPILOT_FACT_ITEM_ALLOWLIST)) {
      const item: Record<string, unknown> = { id: 1 }
      for (const key of allowlist) item[key] = '可见字段'
      item.evilKey = '黑客字段'
      const facts = collector.projectSearchFactItems([item], kind as never, OBSERVED_AT)
      const serialized = JSON.stringify(facts)
      expect(serialized).not.toContain('evilKey')
      expect(serialized).not.toContain('黑客字段')
    }
  })

  it('值超长截断（120 字符）且不读嵌套对象', () => {
    const collector = makeCollector()
    const facts = collector.projectSearchFactItems(
      [{ id: 1, name: '长'.repeat(300), meta: { nested: 'object' } }],
      'task',
      OBSERVED_AT,
    )
    const nameEntry = (facts[0].value as readonly string[]).find((entry) =>
      entry.startsWith('name='),
    )
    expect(nameEntry).toHaveLength('name='.length + 120)
    expect(JSON.stringify(facts)).not.toContain('meta')
  })

  it('行级事实 explicit truncated=false（聚合/明细截断语义由预算层承担）', () => {
    const collector = makeCollector()
    const facts = collector.projectSearchFactItems([{ id: 1, title: 'r' }], 'risk', OBSERVED_AT)
    expect(facts[0].truncated).toBe(false)
  })
})
