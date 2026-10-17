/**
 * v3-copilot-authoritative-page-context —— 页面语境契约 schema 测试。
 *
 * 覆盖（任务 1.1）：未知字段拒绝、长度上界、非法 ID、敏感字段/禁存内容、
 * 版本兼容、每路由 filter allowlist（未知键软忽略 + disclosure 标记）、
 * 事实预算（exact totals 优先、行级截断标记）。
 *
 * 纯 vitest：零运行时依赖、零网络、零数据库。
 */
import { describe, it, expect } from 'vitest'
import {
  COPILOT_PAGE_CONTEXT_DESCRIPTOR_MAX_BYTES,
  COPILOT_PAGE_CONTEXT_FACTS_MAX_BYTES,
  COPILOT_PAGE_CONTEXT_MAX_FACT_KEY_LENGTH,
  COPILOT_PAGE_CONTEXT_MAX_FILTER_VALUE_LENGTH,
  COPILOT_PAGE_CONTEXT_MAX_SELECTED_ENTITY_REFS,
  COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST,
  COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
  COPILOT_PAGE_CONTEXT_SUPPORTED_VERSIONS,
  budgetContextFacts,
  containsForbiddenContextFactValue,
  deriveCopilotFacetSelection,
  estimateContextFactBytes,
  estimatePageContextDescriptorBytes,
  isCopilotContextFactValue,
  isCopilotPageContextRouteId,
  validateCopilotContextFact,
  validatePageContextDescriptor,
} from './copilot-page-context.js'

function makeValidDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    routeId: 'project-kanban',
    pathname: '/projects/1/(views)/kanban',
    projectId: 1,
    viewId: 'kanban-main',
    filters: [{ key: 'status', op: 'in', value: ['in_progress', 'blocked'] }],
    sort: [{ field: 'rank', direction: 'asc' }],
    timeRange: { from: '2026-09-01', to: '2026-09-30' },
    selectedEntityRefs: [{ kind: 'task', id: 42 }],
    routeRevision: 'rev-abc123',
    ...overrides,
  }
}

function makeValidFact(overrides: Record<string, unknown> = {}) {
  return {
    factKey: 'tasks.total',
    value: 8,
    displayLabel: '任务总数',
    facet: 'taskStatus',
    sourceRef: 'project:1/tasks',
    observedAt: '2026-09-01T06:32:00.000Z',
    sensitivity: 'low',
    ...overrides,
  }
}

describe('PageContextDescriptor 版本兼容', () => {
  it('版本 1 合法', () => {
    const result = validatePageContextDescriptor(makeValidDescriptor())
    expect(result.ok).toBe(true)
    expect(result.descriptor?.version).toBe(1)
  })

  it('版本 2（未来版本）整体拒绝并报版本不兼容', () => {
    const result = validatePageContextDescriptor(makeValidDescriptor({ version: 2 }))
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('版本不兼容'))).toBe(true)
  })

  it('缺失版本拒绝', () => {
    const raw = makeValidDescriptor()
    delete raw.version
    const result = validatePageContextDescriptor(raw)
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('版本缺失'))).toBe(true)
  })

  it('支持版本集合只含 1（版本策略可测试）', () => {
    expect(COPILOT_PAGE_CONTEXT_SUPPORTED_VERSIONS).toEqual([1])
  })
})

describe('PageContextDescriptor 未知字段', () => {
  it('未知顶层键整体拒绝', () => {
    const result = validatePageContextDescriptor(
      makeValidDescriptor({ innerHTML: '<div>dom</div>', pageHtml: '<html>' }),
    )
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('未知字段'))).toBe(true)
    expect(result.violations.some((v) => v.includes('innerHTML'))).toBe(true)
  })

  it('未知 filter 键软忽略进 disclosure，不传给 SQL（kanban 只允许 status/assignee/priority/label/keyword）', () => {
    const raw = makeValidDescriptor({
      filters: [
        { key: 'status', op: 'eq', value: 'blocked' },
        { key: 'dropTable', op: 'eq', value: 'tasks' },
      ],
    })
    const result = validatePageContextDescriptor(raw)
    expect(result.ok).toBe(true)
    expect(result.descriptor?.filters?.map((f) => f.key)).toEqual(['status'])
    expect(result.ignoredFilters.map((f) => f.key)).toEqual(['dropTable'])
  })

  it('未知 sort 字段软忽略进 ignoredSort', () => {
    const raw = makeValidDescriptor({ sort: [{ field: 'secretColumn', direction: 'asc' }] })
    const result = validatePageContextDescriptor(raw)
    expect(result.ok).toBe(true)
    expect(result.descriptor?.sort).toBeUndefined()
    expect(result.ignoredSort.map((s) => s.field)).toEqual(['secretColumn'])
  })

  it('每路由 allowlist 为闭合表（global 只有 keyword；wbs 为 parent/level/selection/keyword）', () => {
    expect(COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST.global).toEqual(['keyword'])
    expect(COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST['project-wbs']).toEqual([
      'parent',
      'level',
      'selection',
      'keyword',
    ])
    expect(COPILOT_PAGE_CONTEXT_ROUTE_FILTER_ALLOWLIST['project-gantt']).toContain('criticalPath')
  })
})

describe('PageContextDescriptor 长度上界', () => {
  it('pathname 超长拒绝', () => {
    const result = validatePageContextDescriptor(
      makeValidDescriptor({ pathname: '/x'.repeat(300) }),
    )
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('pathname 超长'))).toBe(true)
  })

  it('filter value 超长拒绝', () => {
    const result = validatePageContextDescriptor(
      makeValidDescriptor({
        filters: [
          {
            key: 'keyword',
            op: 'eq',
            value: '长'.repeat(COPILOT_PAGE_CONTEXT_MAX_FILTER_VALUE_LENGTH + 1),
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('value 非法或超长'))).toBe(true)
  })

  it('routeRevision 缺失或超长拒绝', () => {
    const missing = makeValidDescriptor()
    delete missing.routeRevision
    expect(validatePageContextDescriptor(missing).ok).toBe(false)

    const tooLong = validatePageContextDescriptor(
      makeValidDescriptor({ routeRevision: 'r'.repeat(65) }),
    )
    expect(tooLong.ok).toBe(false)
    expect(tooLong.violations.some((v) => v.includes('routeRevision 超长'))).toBe(true)
  })

  it('序列化后超字节上界拒绝', () => {
    const raw = makeValidDescriptor({
      pathname: '/projects/1/(views)/kanban',
      filters: Array.from({ length: 12 }, (_, i) => ({
        key: 'keyword',
        op: 'eq',
        value: `kw${i}`.repeat(30),
      })),
    })
    const result = validatePageContextDescriptor(raw)
    if (result.ok) {
      expect(estimatePageContextDescriptorBytes(result.descriptor!)).toBeLessThanOrEqual(
        COPILOT_PAGE_CONTEXT_DESCRIPTOR_MAX_BYTES,
      )
    } else {
      expect(result.violations.some((v) => v.includes('字节上界') || v.includes('上界'))).toBe(true)
    }
  })
})

describe('PageContextDescriptor 非法 ID', () => {
  it('projectId 非正整数拒绝（0 / 负数 / 小数 / 字符串）', () => {
    for (const bad of [0, -1, 1.5, '5', NaN]) {
      const result = validatePageContextDescriptor(makeValidDescriptor({ projectId: bad }))
      expect(result.ok).toBe(false)
      expect(result.violations.some((v) => v.includes('projectId 非法'))).toBe(true)
    }
  })

  it('selectedEntityRefs 非法 kind / 非法 id 拒绝', () => {
    const badKind = validatePageContextDescriptor(
      makeValidDescriptor({ selectedEntityRefs: [{ kind: 'document', id: 1 }] }),
    )
    expect(badKind.ok).toBe(false)
    expect(badKind.violations.some((v) => v.includes('kind 非法'))).toBe(true)

    const badId = validatePageContextDescriptor(
      makeValidDescriptor({ selectedEntityRefs: [{ kind: 'task', id: 0 }] }),
    )
    expect(badId.ok).toBe(false)
    expect(badId.violations.some((v) => v.includes('id 非法'))).toBe(true)
  })

  it('selectedEntityRefs 超出上界拒绝', () => {
    const refs = Array.from(
      { length: COPILOT_PAGE_CONTEXT_MAX_SELECTED_ENTITY_REFS + 1 },
      (_, i) => ({
        kind: 'task',
        id: i + 1,
      }),
    )
    const result = validatePageContextDescriptor(makeValidDescriptor({ selectedEntityRefs: refs }))
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('超出上界'))).toBe(true)
  })

  it('timeRange 非法日期拒绝、合法日期接受', () => {
    const bad = validatePageContextDescriptor(
      makeValidDescriptor({ timeRange: { from: 'not-a-date' } }),
    )
    expect(bad.ok).toBe(false)
    expect(bad.violations.some((v) => v.includes('timeRange.from 非法日期'))).toBe(true)

    const good = validatePageContextDescriptor(
      makeValidDescriptor({ timeRange: { to: '2026-10-01T00:00:00Z' } }),
    )
    expect(good.ok).toBe(true)
  })

  it('routeId 非法拒绝', () => {
    const result = validatePageContextDescriptor(makeValidDescriptor({ routeId: 'project-admin' }))
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('routeId 非法'))).toBe(true)
    expect(isCopilotPageContextRouteId('project-admin')).toBe(false)
  })

  it('filter op 非法拒绝', () => {
    const result = validatePageContextDescriptor(
      makeValidDescriptor({ filters: [{ key: 'status', op: 'like', value: 'x' }] }),
    )
    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('op 非法'))).toBe(true)
  })
})

describe('ContextFact schema 与敏感字段', () => {
  it('合法事实接受', () => {
    const result = validateCopilotContextFact(makeValidFact())
    expect(result.ok).toBe(true)
    expect(result.fact?.factKey).toBe('tasks.total')
    expect(result.fact?.value).toBe(8)
  })

  it('value 支持数字分布与字符串列表', () => {
    expect(isCopilotContextFactValue({ done: 2, blocked: 1 })).toBe(true)
    expect(isCopilotContextFactValue(['a', 'b'])).toBe(true)
    expect(isCopilotContextFactValue({ nested: { x: 1 } })).toBe(false)
    expect(isCopilotContextFactValue([1, 2])).toBe(false)
    expect(isCopilotContextFactValue(null)).toBe(false)
  })

  it('非法 facet / sensitivity 拒绝', () => {
    expect(validateCopilotContextFact(makeValidFact({ facet: 'dom' })).ok).toBe(false)
    expect(validateCopilotContextFact(makeValidFact({ sensitivity: 'secret' })).ok).toBe(false)
    expect(validateCopilotContextFact(makeValidFact({ facet: 'risk' })).ok).toBe(true)
    expect(validateCopilotContextFact(makeValidFact({ sensitivity: 'internal' })).ok).toBe(true)
  })

  it('factKey / sourceRef / displayLabel 超长拒绝', () => {
    const longKey = validateCopilotContextFact(
      makeValidFact({ factKey: 'k'.repeat(COPILOT_PAGE_CONTEXT_MAX_FACT_KEY_LENGTH + 1) }),
    )
    expect(longKey.ok).toBe(false)
    expect(longKey.violations.some((v) => v.includes('factKey 超长'))).toBe(true)

    const longRef = validateCopilotContextFact(makeValidFact({ sourceRef: 'r'.repeat(201) }))
    expect(longRef.ok).toBe(false)
    expect(longRef.violations.some((v) => v.includes('sourceRef 非法或超长'))).toBe(true)
  })

  it('observedAt 非法日期拒绝', () => {
    expect(validateCopilotContextFact(makeValidFact({ observedAt: 'yesterday' })).ok).toBe(false)
  })

  it('value 含禁存内容（token 标签式写法）拒绝', () => {
    const leaky = validateCopilotContextFact(makeValidFact({ value: 'token: sk-abcdef1234567890' }))
    expect(leaky.ok).toBe(false)
    expect(leaky.violations.some((v) => v.includes('禁存'))).toBe(true)
    expect(containsForbiddenContextFactValue({ apiKey: 'sk-secret' })).toBe(true)
    expect(containsForbiddenContextFactValue({ blockedCount: 3 })).toBe(false)
  })

  it('truncated 非布尔拒绝', () => {
    expect(validateCopilotContextFact(makeValidFact({ truncated: 'yes' })).ok).toBe(false)
    expect(validateCopilotContextFact(makeValidFact({ truncated: true })).ok).toBe(true)
  })
})

describe('事实预算（exact totals 优先，行级可截断）', () => {
  it('聚合事实先于行级事实时不破坏精确总数', () => {
    const facts = [
      { ...makeValidFact(), factKey: 'tasks.total', value: 1000 },
      { ...makeValidFact(), factKey: 'tasks.byStatus', value: { done: 300 } },
      { ...makeValidFact(), factKey: 'tasks.rows', value: ['task 1', 'task 2'], truncated: true },
    ]
    const result = budgetContextFacts(facts, {
      maxFacts: 2,
      maxBytes: COPILOT_PAGE_CONTEXT_FACTS_MAX_BYTES,
    })
    expect(result.kept.map((f) => f.factKey)).toEqual(['tasks.total', 'tasks.byStatus'])
    expect(result.omittedCount).toBe(1)
    expect(result.truncatedCount).toBe(0) // 被省略而非截断标记
    expect(result.hitByteLimit).toBe(false)
  })

  it('字节上界触及后停止并标记', () => {
    const facts = Array.from({ length: 5 }, (_, i) => ({
      ...makeValidFact(),
      factKey: `tasks.rows.${i}`,
      value: 'x'.repeat(200),
    }))
    const result = budgetContextFacts(facts, { maxBytes: 1024 })
    expect(result.kept.length).toBeLessThan(5)
    expect(result.hitByteLimit).toBe(true)
    expect(result.omittedCount).toBe(5 - result.kept.length)
  })

  it('字节估算确定性（同输入同值）', () => {
    const fact = makeValidFact()
    expect(estimateContextFactBytes(fact as never)).toBe(estimateContextFactBytes(fact as never))
    const descriptor = makeValidDescriptor()
    expect(estimatePageContextDescriptorBytes(descriptor as never)).toBeGreaterThan(0)
  })
})

describe('披露合同', () => {
  it('隐私说明固定且中文化', () => {
    expect(COPILOT_PAGE_CONTEXT_PRIVACY_NOTE).toContain('不读取屏幕像素或隐藏页面内容')
    expect(COPILOT_PAGE_CONTEXT_PRIVACY_NOTE).toContain('有权限读取的项目数据')
  })
})

describe('facet 选择（design §E / §F-7/F-8）', () => {
  it('F7 自然问法都命中项目事实切面（不要求规范句式）', () => {
    expect(deriveCopilotFacetSelection('这个项目现在卡在哪里')).toContain('risk')
    expect(deriveCopilotFacetSelection('这个项目现在卡在哪里')).toContain('taskStatus')
    expect(deriveCopilotFacetSelection('看一下目前的情况')).toContain('taskStatus')
    expect(deriveCopilotFacetSelection('谁可能忙不过来')).toContain('resource')
    expect(deriveCopilotFacetSelection('完成了多少')).toContain('taskStatus')
    expect(deriveCopilotFacetSelection('最近发生了什么')).toContain('activity')
  })

  it('F8 普通问候/术语解释不选中任何 facet（不强制项目事实）', () => {
    expect(deriveCopilotFacetSelection('你好')).toEqual([])
    expect(deriveCopilotFacetSelection('什么是关键路径')).toEqual([])
    expect(deriveCopilotFacetSelection('谢谢')).toEqual([])
  })

  it('「选中/当前任务」问法附带实体详情相关切面', () => {
    const facets = deriveCopilotFacetSelection('这个任务有什么依赖？')
    expect(facets).toEqual(expect.arrayContaining(['taskStatus', 'dependency', 'risk']))
  })
})
