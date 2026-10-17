/**
 * v2-advanced-search — ActivitySearchAdapter 单元测试。
 *
 * 覆盖（修复回归）：
 * - 非数字关键词不得被映射成 entity_id=0 造成误命中（原 `Number(kw) || 0` 怪癖）
 * - 纯数字关键词才参与 entity_id 匹配，且 matchedFields 如实标注 entity_id
 * - 命中字段标注：文本匹配仍标注 action，数字匹配标注 entity_id
 * - 活动结果 target 仍为旧契约 URL（死链由前端不再跳转解决，后端生成规则不变）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SearchQuery } from '@aiproj/types'

// ── mock AuditLog 模型：捕获 query builder 的 where 子句构造 ──

interface SubBuilder {
  whereILike: ReturnType<typeof vi.fn>
  orWhereILike: ReturnType<typeof vi.fn>
  orWhere: ReturnType<typeof vi.fn>
}

let mockResults: unknown[]
let subBuilder: SubBuilder
let whereCalls: unknown[][]
let whereInCalls: unknown[][]

const builder = {
  where: (arg1: unknown, arg2?: unknown, arg3?: unknown) => {
    if (typeof arg1 === 'function') {
      subBuilder = {
        whereILike: vi.fn().mockReturnThis(),
        orWhereILike: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
      }
      ;(arg1 as (b: SubBuilder) => void)(subBuilder)
    } else {
      whereCalls.push([arg1, arg2, arg3])
    }
    return builder
  },
  whereIn: (...args: unknown[]) => {
    whereInCalls.push(args)
    return builder
  },
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(mockResults).then(onFulfilled),
}

vi.mock('#models/audit_log', () => ({
  default: { query: () => builder },
}))

describe('ActivitySearchAdapter - entity_id 匹配修复', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResults = []
    subBuilder = {
      whereILike: vi.fn().mockReturnThis(),
      orWhereILike: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
    }
    whereCalls = []
    whereInCalls = []
  })

  async function runSearch(keyword: string | undefined) {
    const { default: ActivitySearchAdapter } =
      await import('../../app/services/search/adapters/activity_search_adapter.js')
    const query: SearchQuery = { keyword }
    return new ActivitySearchAdapter().search(query, {
      organizationId: 1,
      userId: 1,
      projectIds: [],
    })
  }

  it('非数字关键词不产生 entity_id 条件（不再误命中 entity_id=0）', async () => {
    await runSearch('任意乱搜词xyz')

    expect(subBuilder.whereILike).toHaveBeenCalledWith('action', '%任意乱搜词xyz%')
    expect(subBuilder.orWhereILike).toHaveBeenCalledWith('entity_type', '%任意乱搜词xyz%')
    expect(subBuilder.orWhere).not.toHaveBeenCalled()
  })

  it('纯数字关键词产生 entity_id=N 条件', async () => {
    await runSearch('42')

    expect(subBuilder.whereILike).toHaveBeenCalledWith('action', '%42%')
    expect(subBuilder.orWhere).toHaveBeenCalledWith('entity_id', '42')
  })

  it('前导零数字关键词按数值匹配（与旧行为一致，「007」→ 7）', async () => {
    await runSearch('007')

    expect(subBuilder.orWhere).toHaveBeenCalledWith('entity_id', '7')
  })

  it('数字文本关键词（非纯数字）不产生 entity_id 条件', async () => {
    await runSearch('v3-42')

    expect(subBuilder.orWhere).not.toHaveBeenCalled()
  })

  it('无关键词时不构造 where 子句（仅组织隔离条件）', async () => {
    await runSearch(undefined)

    expect(whereCalls).toEqual([['organization_id', 1, undefined]])
    expect(whereInCalls).toEqual([])
  })

  it('文本关键词命中时 matchedFields 标注 action', async () => {
    mockResults = [
      {
        id: 123,
        projectId: 5,
        action: 'ai_generate',
        entityType: 'task',
        entityId: 9,
        severity: 'info',
        createdAt: { toISO: () => '2026-07-01T10:00:00.000Z' },
      },
    ]
    const { items } = await runSearch('ai_generate')

    expect(items).toHaveLength(1)
    expect(items[0].matchedFields).toEqual(['action'])
  })

  it('纯数字关键词命中时 matchedFields 标注 entity_id', async () => {
    mockResults = [
      {
        id: 123,
        projectId: 5,
        action: 'update',
        entityType: 'project',
        entityId: 42,
        severity: 'warning',
        createdAt: { toISO: () => '2026-07-01T10:00:00.000Z' },
      },
    ]
    const { items } = await runSearch('42')

    expect(items).toHaveLength(1)
    expect(items[0].matchedFields).toEqual(['entity_id'])
  })

  it('无关键词时 matchedFields 为空数组', async () => {
    mockResults = [
      {
        id: 1,
        projectId: null,
        action: 'create',
        entityType: null,
        entityId: null,
        severity: 'info',
        createdAt: { toISO: () => '2026-07-01T10:00:00.000Z' },
      },
    ]
    const { items } = await runSearch(undefined)

    expect(items).toHaveLength(1)
    expect(items[0].matchedFields).toEqual([])
  })

  it('活动结果 target 维持旧契约 URL（死链由前端不再跳转解决）', async () => {
    mockResults = [
      {
        id: 123,
        projectId: 5,
        action: 'create',
        entityType: 'task',
        entityId: 99,
        severity: 'info',
        createdAt: { toISO: () => '2026-07-01T10:00:00.000Z' },
      },
    ]
    const { items } = await runSearch('create')

    expect(items[0].target).toBe('/projects/5/activity?logId=123')
  })
})
