/**
 * v3-copilot-authoritative-page-context —— 页面语境 resolver 单元测试（任务 1.3）。
 *
 * 覆盖：跨组织/无权限/过期项目/非法 descriptor/项目 API 不可用全部不泄露、
 * ready 路径、global 路由、筛选→SQL allowlist 映射与分号转义、
 * 页面筛选任务事实（exact totals 先于明细、truncated 标记、组织过滤）。
 *
 * 纯 vitest：resolver 依赖全部注入，零真实数据库（fake query executor）。
 */
import { describe, it, expect, vi } from 'vitest'
import type { CopilotPageContextDescriptorV1 } from '@aiproj/types'
import {
  CopilotPageContextResolver,
  buildFilteredTaskQueryClauses,
  escapeLike,
  queryFilteredTaskFacts,
} from '../../app/services/copilot/copilot_page_context_resolver.js'

const ORG = 1
const ACTOR = 5
const PROJECT_ID = 100

function makeDescriptor(
  overrides: Partial<CopilotPageContextDescriptorV1> = {},
): CopilotPageContextDescriptorV1 {
  return {
    version: 1,
    routeId: 'project-kanban',
    pathname: '/projects/100/(views)/kanban',
    projectId: PROJECT_ID,
    viewId: 'kanban',
    filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
    routeRevision: 'rev-1',
    ...overrides,
  }
}

function makeResolver(
  overrides: {
    allowedProjectIds?: readonly number[]
    findProject?: (projectId: number, organizationId: number) => Promise<unknown | null>
    db?: any
  } = {},
) {
  const findProject = overrides.findProject ?? (async () => ({ id: PROJECT_ID, name: '项目A' }))
  return new CopilotPageContextResolver({
    findProject,
    allowedProjectIds: overrides.allowedProjectIds ?? [PROJECT_ID],
    db: overrides.db,
  })
}

// ---------------------------------------------------------------------------
// 授权矩阵：全部不泄露
// ---------------------------------------------------------------------------

describe('resolver：跨组织/无权限/过期项目/API 不可用全部不泄露', () => {
  it('ready：已授权项目 + 存在 → projectId 授权、filters 应用、状态 ready', async () => {
    const resolver = makeResolver()
    const result = await resolver.resolve(makeDescriptor(), ORG, ACTOR)
    expect(result.ok).toBe(true)
    expect(result.projectId).toBe(PROJECT_ID)
    expect(result.status).toBe('ready')
    expect(result.filters).toEqual([{ key: 'status', op: 'eq', value: 'blocked' }])
    expect(result.selectionCount).toBe(0)
    expect(result.privacyNote).toContain('不读取屏幕像素')
  })

  it('跨组织（不在 allowedProjectIds）→ projectId null + context_unavailable，零泄露', async () => {
    const resolver = makeResolver({ allowedProjectIds: [] })
    const foreign = makeDescriptor({ projectId: 999 })
    const result = await resolver.resolve(foreign, ORG, ACTOR)
    expect(result.ok).toBe(true)
    expect(result.projectId).toBeNull()
    expect(result.status).toBe('context_unavailable')
    expect(result.filters).toEqual([])
    // 客户端提交的 999 不得出现在任何输出字段
    expect(JSON.stringify(result)).not.toContain('999')
  })

  it('过期/不存在项目（findProject 返回 null）→ context_unavailable 且不带项目', async () => {
    const resolver = makeResolver({ findProject: async () => null })
    const result = await resolver.resolve(makeDescriptor(), ORG, ACTOR)
    expect(result.projectId).toBeNull()
    expect(result.status).toBe('context_unavailable')
    expect(result.reason).toBe('project-not-found')
  })

  it('项目 API 不可用（findProject 抛错）→ context_unavailable，不编造项目事实', async () => {
    const resolver = makeResolver({
      findProject: async () => {
        throw new Error('db down')
      },
    })
    const result = await resolver.resolve(makeDescriptor(), ORG, ACTOR)
    expect(result.projectId).toBeNull()
    expect(result.status).toBe('context_unavailable')
    expect(result.reason).toBe('project-api-unavailable')
  })

  it('非法 descriptor（未知字段/版本 2）→ ok=false，不产出任何披露', async () => {
    const resolver = makeResolver()
    const bad = makeDescriptor() as unknown as Record<string, unknown>
    bad.innerHTML = '<div>evil</div>'
    const result = await resolver.resolve(
      bad as unknown as CopilotPageContextDescriptorV1,
      ORG,
      ACTOR,
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid-descriptor')
    expect(result.projectId).toBeNull()
    expect(JSON.stringify(result)).not.toContain('evil')

    const v2 = await resolver.resolve(makeDescriptor({ version: 2 as 1 }), ORG, ACTOR)
    expect(v2.ok).toBe(false)
    expect(v2.reason).toBe('invalid-descriptor')
  })

  it('项目路由却无 projectId → context_unavailable', async () => {
    const resolver = makeResolver()
    const raw = makeDescriptor() as unknown as Record<string, unknown>
    delete raw.projectId
    const result = await resolver.resolve(
      raw as unknown as CopilotPageContextDescriptorV1,
      ORG,
      ACTOR,
    )
    expect(result.ok).toBe(true)
    expect(result.projectId).toBeNull()
    expect(result.status).toBe('context_unavailable')
  })

  it('global 路由 → ready 且无项目事实', async () => {
    const resolver = makeResolver()
    const descriptor = makeDescriptor({
      routeId: 'global',
      pathname: '/',
      projectId: undefined,
      filters: [],
    })
    const result = await resolver.resolve(descriptor, ORG, ACTOR)
    expect(result.ok).toBe(true)
    expect(result.projectId).toBeNull()
    expect(result.status).toBe('ready')
  })

  it('无 pageContext → noop：ok、无 descriptor、无披露内容', async () => {
    const resolver = makeResolver()
    const result = await resolver.resolve(undefined, ORG, ACTOR)
    expect(result.ok).toBe(true)
    expect(result.descriptor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 筛选 → SQL allowlist 映射
// ---------------------------------------------------------------------------

describe('buildFilteredTaskQueryClauses：闭合映射与转义', () => {
  it('status/priority/assignee/milestone/parent/criticalPath 映射结构列', () => {
    const clauses = buildFilteredTaskQueryClauses([
      { key: 'status', op: 'eq', value: 'blocked' },
      { key: 'assignee', op: 'eq', value: '7' },
      { key: 'milestone', op: 'eq', value: '3' },
      { key: 'parent', op: 'eq', value: '2' },
      { key: 'criticalPath', op: 'eq', value: 'true' },
      { key: 'priority', op: 'eq', value: 'high' },
    ])
    expect(clauses).toEqual([
      { column: 'status', op: '=', value: 'blocked' },
      { column: 'assignee_id', op: '=', value: 7 },
      { column: 'milestone_id', op: '=', value: 3 },
      { column: 'parent_task_id', op: '=', value: 2 },
      { column: 'is_critical_path', op: '=', value: 1 },
      { column: 'priority', op: '=', value: 'high' },
    ])
  })

  it('keyword 走 name LIKE 且转义通配符', () => {
    const clauses = buildFilteredTaskQueryClauses([{ key: 'keyword', op: 'eq', value: '50%_off' }])
    expect(clauses).toEqual([{ column: 'name', op: 'LIKE', value: '%50\\%\\_off%' }])
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d')
  })

  it('非法 ID（0/负数/非数字）与 label（无可信列）不产生 SQL 子句', () => {
    const clauses = buildFilteredTaskQueryClauses([
      { key: 'assignee', op: 'eq', value: '0' },
      { key: 'milestone', op: 'eq', value: '-3' },
      { key: 'assignee', op: 'eq', value: 'abc' },
      { key: 'label', op: 'eq', value: 'urgent' },
    ])
    expect(clauses).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 页面筛选任务事实：exact totals 先于明细
// ---------------------------------------------------------------------------

describe('queryFilteredTaskFacts：exact totals、行预算、组织过滤', () => {
  /** 链式 fake query：记录每个调用并支持 count/select(岗位)/limit 终态。 */
  class FakeQuery {
    readonly calls: Array<{ op: string; args: unknown[] }> = []
    constructor(readonly rows: Array<Record<string, unknown>>) {}

    from(_table: string) {
      this.calls.push({ op: 'from', args: [] })
      return this
    }
    where(...args: unknown[]) {
      this.calls.push({ op: 'where', args })
      return this
    }
    whereNull(...args: unknown[]) {
      this.calls.push({ op: 'whereNull', args })
      return this
    }
    whereIn(...args: unknown[]) {
      this.calls.push({ op: 'whereIn', args })
      return this
    }
    count(...args: unknown[]) {
      this.calls.push({ op: 'count', args })
      return {
        first: async () => ({ count: this.rows.length }),
        groupBy: () => {
          const tally: Record<string, number> = {}
          for (const row of this.rows) {
            const status = String(row.status ?? 'unknown')
            tally[status] = (tally[status] ?? 0) + 1
          }
          return Object.entries(tally).map(([status, count]) => ({ status, count }))
        },
      }
    }
    select(cols: readonly string[]) {
      this.calls.push({ op: 'select', args: [cols] })
      return this
    }
    orderBy(...args: unknown[]) {
      this.calls.push({ op: 'orderBy', args })
      return this
    }
    limit(n: number) {
      this.calls.push({ op: 'limit', args: [n] })
      return this.rows.slice(0, n)
    }
  }

  it('1000 任务：exact total=1000、分布正确、行级截断标记 truncated=true', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: i + 1,
      name: `任务${i + 1}`,
      status: i < 700 ? 'done' : 'in_progress',
      priority: 'medium',
    }))
    const db = { from: () => new FakeQuery(rows) }
    const facts = await queryFilteredTaskFacts({
      db,
      projectId: PROJECT_ID,
      organizationId: ORG,
      filters: [],
      observedAt: '2026-09-01T06:32:00.000Z',
    })
    const byKey = new Map(facts.map((f) => [f.factKey, f]))
    expect(byKey.get('tasks.filteredTotal')?.value).toBe(1000)
    expect(byKey.get('tasks.filteredByStatus')?.value).toEqual({ done: 700, in_progress: 300 })
    const rowsFact = byKey.get('tasks.filteredRows')
    expect(rowsFact?.value).toHaveLength(8)
    expect(rowsFact?.truncated).toBe(true)
  })

  it('零任务零筛选：total=0、行级为空且 truncated=false（不生成伪计数）', async () => {
    const db = { from: () => new FakeQuery([]) }
    const facts = await queryFilteredTaskFacts({
      db,
      projectId: PROJECT_ID,
      organizationId: ORG,
      filters: [],
      observedAt: '2026-09-01T06:32:00.000Z',
    })
    const byKey = new Map(facts.map((f) => [f.factKey, f]))
    expect(byKey.get('tasks.filteredTotal')?.value).toBe(0)
    expect(byKey.get('tasks.filteredRows')?.truncated).toBe(false)
  })

  it('每个查询都强制 organization_id + project_id 过滤且应用筛选子句', async () => {
    const query = new FakeQuery([])
    // tasks 表没有 organization_id 列：组织过滤经 projects 子查询收口
    const db = { from: (table: string) => (table === 'tasks' ? query : new FakeQuery([])) }
    await queryFilteredTaskFacts({
      db,
      projectId: 100,
      organizationId: 1,
      filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
      observedAt: '2026-09-01T06:32:00.000Z',
    })
    const serialized = JSON.stringify(query.calls)
    expect(serialized).toContain('project_id')
    expect(serialized).toContain('100')
    expect(serialized).toContain('organization_id')
    expect(serialized).toContain('status')
    expect(serialized).toContain('blocked')

    // 三条查询（count/select groupBy/select rows）都带组织与项目过滤
    const whereCalls = query.calls.filter((c) => c.op === 'where')
    expect(whereCalls.filter((c) => JSON.stringify(c.args).includes('project_id')).length).toBe(3)
    // tasks 本身不按 organization_id 过滤（该列不存在，按列过滤会让查询恒失败）
    expect(
      whereCalls.filter((c) => JSON.stringify(c.args).includes('organization_id')).length,
    ).toBe(0)
    const orgScoped = query.calls.filter(
      (c) =>
        c.op === 'whereIn' &&
        c.args[0] === 'project_id' &&
        JSON.stringify(c.args[1]).includes('organization_id'),
    )
    expect(orgScoped.length).toBe(3)
  })

  it('resolver.collectPageTaskFacts 在 db 缺席时返回空数组', async () => {
    const resolver = makeResolver()
    const facts = await resolver.collectPageTaskFacts({
      projectId: PROJECT_ID,
      organizationId: ORG,
      filters: [],
      observedAt: '2026-09-01T06:32:00.000Z',
    })
    expect(facts).toEqual([])
  })

  it('collectPageTaskFacts 透传注入的查询替身', async () => {
    const spy = vi.fn(async (_params: { filters: readonly { key: string }[] }) => [])
    const resolver = new CopilotPageContextResolver({
      findProject: async () => ({ id: PROJECT_ID }),
      allowedProjectIds: [PROJECT_ID],
      db: { from: () => ({}) },
      queryFilteredTaskFacts: spy,
    })
    await resolver.collectPageTaskFacts({
      projectId: PROJECT_ID,
      organizationId: ORG,
      filters: [{ key: 'status', op: 'eq', value: 'blocked' }],
      observedAt: '2026-09-01T06:32:00.000Z',
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const arg = (spy.mock.calls[0] ?? [])[0] as { filters: readonly { key: string }[] }
    expect(arg.filters[0]?.key).toBe('status')
  })
})
