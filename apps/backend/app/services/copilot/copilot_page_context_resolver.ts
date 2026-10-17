/**
 * v3-copilot-authoritative-page-context —— 后端页面语境 resolver（任务 1.3 / 2.3）。
 *
 * 职责（design Decision 2 / §C）：
 * - 客户端传入的页面语境描述符只是**候选**，授权由本服务重新解析；
 * - Policy（allowedProjectIds，来自既有 SearchPolicy）与 organization_id
 *   在取数之前生效：跨组织/无权限/过期项目一律不泄露任何事实；
 * - descriptor schema 校验复用 @aiproj/types 的版本化校验器；
 * - 产出响应侧 disclosure 所需数据（已应用/被忽略筛选、快照时间、状态）；
 * - 提供页面筛选下的权威任务事实（exact totals 先于行级明细；2.1/2.3）。
 *
 * 设计 §H 禁止事项：不读取 DOM；不在前端计算权威计数；不绕过 Policy。
 */

import type { CopilotPageContextDescriptorV1 } from '@aiproj/types'
import type {
  CopilotContextFact,
  CopilotPageContextFilter,
  CopilotPageContextSort,
  CopilotPageContextTimeRange,
} from '@aiproj/types'
import {
  type COPILOT_PAGE_CONTEXT_STATUSES,
  COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
  validateCopilotContextFact,
  validatePageContextDescriptor,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 页面筛选 → 任务事实查询的 allowlist 映射（闭合；设计 §C）
// ---------------------------------------------------------------------------

/**
 * canonical filter key → tasks 表列/查询函数。
 *
 * 只允许映射到 tasks 表的结构化列；`label` 等无可信列映射的 allowlisted 键
 * 在事实查询中不生效（仍在 disclosure 中如实披露为页面筛选）。
 */
export const PAGE_CONTEXT_FILTER_TO_TASK_COLUMN: Readonly<
  Record<
    string,
    | 'status'
    | 'priority'
    | 'assignee_id'
    | 'milestone_id'
    | 'parent_task_id'
    | 'task_type'
    | 'is_critical_path'
    | 'name_like'
  >
> = {
  status: 'status',
  priority: 'priority',
  assignee: 'assignee_id',
  milestone: 'milestone_id',
  parent: 'parent_task_id',
  level: 'task_type',
  criticalPath: 'is_critical_path',
  keyword: 'name_like',
}

/** 行级明细最多保留条数（exact totals 恒先算，不先截断再算 total）。 */
export const PAGE_CONTEXT_FILTERED_TASK_ROWS = 8

// ---------------------------------------------------------------------------
// Resolver 输出
// ---------------------------------------------------------------------------

export interface CopilotPageContextResolution {
  /** 是否产生可消费的授权解析（false = descriptor 缺失/非法，turn 不带 context）。 */
  readonly ok: boolean
  /** 未通过的原因（低敏）。 */
  readonly reason?:
    'invalid-descriptor' | 'cross-organization' | 'project-not-found' | 'project-api-unavailable'
  /** 校验通过的描述符（ok 且 raw 存在时）。 */
  readonly descriptor: CopilotPageContextDescriptorV1 | null
  /**
   * 服务端重新授权后的项目 ID（客户端提交值仅作候选）。
   * null = 无授权项目（global/跨组织/项目不存在/API 不可用）。
   */
  readonly projectId: number | null
  /** 已应用筛选（allowlist 内且形状合法；disclosure 呈现）。 */
  readonly filters: readonly CopilotPageContextFilter[]
  /** 被忽略的筛选（未知键；disclosure 呈现，绝不传给 SQL）。 */
  readonly ignoredFilters: readonly CopilotPageContextFilter[]
  /** 已应用排序。 */
  readonly sortApplied: readonly CopilotPageContextSort[]
  readonly timeRange?: CopilotPageContextTimeRange
  /** 选中实体引用条数（只给计数）。 */
  readonly selectionCount: number
  /** 事实快照时间（服务端）。 */
  readonly observedAt: string
  /** ready=拿到授权项目语境；context_unavailable=无法取得（不生成伪事实）。 */
  readonly status: (typeof COPILOT_PAGE_CONTEXT_STATUSES)[number]
  /** 固定隐私说明。 */
  readonly privacyNote: string
  /**
   * 授权通过后的当前项目概况（名称/编号/状态/日期/进度/任务状态分布）。
   * 只在 status=ready 且项目已授权时存在；让「我在什么页面 / 这是什么项目」
   * 这类问题能答出项目名称等具体资料，而不是只有项目 ID。
   */
  readonly projectProfile?: CopilotPageProjectProfile
}

/** 当前项目概况（低敏字段，交给回答模型）。 */
export interface CopilotPageProjectProfile {
  readonly id: number
  readonly name: string
  readonly code: string | null
  readonly status: string | null
  readonly healthStatus: string | null
  readonly priority: string | null
  readonly startDate: string | null
  readonly endDate: string | null
  readonly progressPercent: number | null
  /** 项目描述（截断到 200 字）。 */
  readonly description: string | null
  /** 任务总数与状态分布（未删除任务；取数失败时省略）。 */
  readonly taskTotal?: number
  readonly tasksByStatus?: Readonly<Record<string, number>>
}

const PROJECT_DESCRIPTION_MAX_CHARS = 200

function isoDateOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.slice(0, 10)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const candidate = value as { toISODate?: () => string | null }
  if (typeof candidate.toISODate === 'function') return candidate.toISODate()
  return null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** 从项目记录（Lucid 模型或普通对象）提取概况；缺名称视为无法提取。 */
export function toPageProjectProfile(
  projectId: number,
  record: unknown,
): CopilotPageProjectProfile | undefined {
  if (!record || typeof record !== 'object') return undefined
  const row = record as Record<string, unknown>
  const name = stringOrNull(row.name)
  if (!name) return undefined
  const description = stringOrNull(row.description)
  const progress = Number(row.progressPercent)
  return {
    id: projectId,
    name,
    code: stringOrNull(row.code),
    status: stringOrNull(row.status),
    healthStatus: stringOrNull(row.healthStatus),
    priority: stringOrNull(row.priority),
    startDate: isoDateOf(row.startDate),
    endDate: isoDateOf(row.endDate),
    progressPercent: Number.isFinite(progress) ? progress : null,
    description:
      description === null
        ? null
        : description.length > PROJECT_DESCRIPTION_MAX_CHARS
          ? `${description.slice(0, PROJECT_DESCRIPTION_MAX_CHARS)}…`
          : description,
  }
}

export interface CopilotPageContextResolverDeps {
  /**
   * 项目存在性/权限复核（注入方负责 org 过滤与软删除排除）。
   * 返回 null = 该项目在本组织不可见（不存在/软删除/过期）。
   */
  readonly findProject: (projectId: number, organizationId: number) => Promise<unknown | null>
  /** 已授权项目 ID 集合（来自既有 SearchPolicy，不在此重算判权）。 */
  readonly allowedProjectIds: readonly number[]
  /**
   * 任务事实查询执行器（Knex/Lucid db 兼容：from/where/…）。
   * 缺席（纯单元测试）时 `collectPageTaskFacts` 返回空数组。
   */
  readonly db?: { from: (table: string) => any }
  /** 任务事实查询（可注入替身；缺省用模块级 `queryFilteredTaskFacts`）。 */
  readonly queryFilteredTaskFacts?: typeof queryFilteredTaskFacts
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

/**
 * 授权后的 descriptor 回显（防回显泄露）。
 *
 * 客户端提交的 `projectId`/`selectedEntityRefs` 只是候选：未获授权时**不得**
 * 出现在解析结果中（否则把未授权 ID 回显给下游/响应侧）。routeId/viewId/
 * filters/sort/timeRange 为纯标签信息，不构成泄露，可保留。
 */
export function authorizeDescriptorEcho(
  descriptor: CopilotPageContextDescriptorV1,
  projectId: number | null,
): CopilotPageContextDescriptorV1 {
  const echo: CopilotPageContextDescriptorV1 = {
    version: descriptor.version,
    routeId: descriptor.routeId,
    pathname: descriptor.pathname,
    ...(projectId !== null && descriptor.projectId !== undefined
      ? { projectId: descriptor.projectId }
      : {}),
    ...(descriptor.selectedEntityRefs !== undefined && projectId !== null
      ? { selectedEntityRefs: descriptor.selectedEntityRefs }
      : {}),
    ...(descriptor.viewId !== undefined ? { viewId: descriptor.viewId } : {}),
    ...(descriptor.filters !== undefined ? { filters: descriptor.filters } : {}),
    ...(descriptor.sort !== undefined ? { sort: descriptor.sort } : {}),
    ...(descriptor.timeRange !== undefined ? { timeRange: descriptor.timeRange } : {}),
    routeRevision: descriptor.routeRevision,
  }
  return echo
}

export class CopilotPageContextResolver {
  readonly #deps: CopilotPageContextResolverDeps

  constructor(deps: CopilotPageContextResolverDeps) {
    this.#deps = deps
  }

  /**
   * 解析并重新授权页面语境。
   *
   * 流程：schema 校验 → routeId global 直接放行（无项目事实）→ 项目授权复核
   * （allowedProjectIds + 注入的 findProject 存在性）→ 产出 disclosure 数据。
   * 任何失败路径都只把 `projectId` 置 null、状态置 context_unavailable——
   * 绝不让未授权项目的任何 id/名称/计数进入后续事实组装。
   */
  async resolve(
    rawDescriptor: CopilotPageContextDescriptorV1 | undefined,
    organizationId: number,
    actorId: number,
  ): Promise<CopilotPageContextResolution> {
    const observedAt = new Date().toISOString()

    if (!rawDescriptor) {
      return this.#noopResolution(observedAt, actorId)
    }

    const validated = validatePageContextDescriptor(rawDescriptor)
    if (!validated.ok || !validated.descriptor) {
      return {
        ok: false,
        reason: 'invalid-descriptor',
        descriptor: null,
        projectId: null,
        filters: [],
        ignoredFilters: [],
        sortApplied: [],
        selectionCount: 0,
        observedAt,
        status: 'context_unavailable',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
      }
    }
    const descriptor = validated.descriptor

    // global 路由：无项目事实；disclosure 照常呈现（透明）。
    if (descriptor.routeId === 'global') {
      return {
        ok: true,
        descriptor: authorizeDescriptorEcho(descriptor, null),
        projectId: null,
        filters: [],
        ignoredFilters: validated.ignoredFilters,
        sortApplied: [],
        selectionCount: 0,
        observedAt,
        status: 'ready',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
      }
    }

    const requestedProjectId = descriptor.projectId
    if (requestedProjectId === undefined || !Number.isInteger(requestedProjectId)) {
      // 项目路由却无项目 ID：不生成伪项目事实。
      return {
        ok: true,
        descriptor: authorizeDescriptorEcho(descriptor, null),
        projectId: null,
        filters: [],
        ignoredFilters: validated.ignoredFilters,
        sortApplied: validated.ignoredSort,
        selectionCount: 0,
        observedAt,
        status: 'context_unavailable',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
      }
    }

    // 授权复核：不在 actor 可访问项目集合内 → 零泄露（design §F-3）。
    if (!this.#deps.allowedProjectIds.includes(requestedProjectId)) {
      return {
        ok: true,
        descriptor: authorizeDescriptorEcho(descriptor, null),
        projectId: null,
        filters: [],
        ignoredFilters: validated.ignoredFilters,
        sortApplied: validated.ignoredSort,
        selectionCount: 0,
        observedAt,
        status: 'context_unavailable',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
      }
    }

    // 项目存在/过期复核（注入方负责 organization_id + 软删除；失败 → 不泄露）。
    let projectExists = true
    let projectRecord: unknown = null
    try {
      projectRecord = await this.#deps.findProject(requestedProjectId, organizationId)
      projectExists = projectRecord !== null
    } catch {
      // 项目 API 不可用：显式不可用，不编造项目事实（design §F-5）。
      return {
        ok: true,
        descriptor: authorizeDescriptorEcho(descriptor, null),
        projectId: null,
        filters: [],
        ignoredFilters: validated.ignoredFilters,
        sortApplied: validated.ignoredSort,
        selectionCount: 0,
        observedAt,
        status: 'context_unavailable',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
        reason: 'project-api-unavailable',
      }
    }
    if (!projectExists) {
      return {
        ok: true,
        descriptor: authorizeDescriptorEcho(descriptor, null),
        projectId: null,
        filters: [],
        ignoredFilters: validated.ignoredFilters,
        sortApplied: validated.ignoredSort,
        selectionCount: 0,
        observedAt,
        status: 'context_unavailable',
        privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
        reason: 'project-not-found',
      }
    }

    const projectProfile = await this.#buildProjectProfile(
      requestedProjectId,
      organizationId,
      projectRecord,
    )

    return {
      ok: true,
      descriptor: authorizeDescriptorEcho(descriptor, requestedProjectId),
      projectId: requestedProjectId,
      filters: validated.descriptor.filters ?? [],
      ignoredFilters: validated.ignoredFilters,
      sortApplied: validated.descriptor.sort ?? [],
      timeRange: validated.descriptor.timeRange,
      selectionCount: validated.descriptor.selectedEntityRefs?.length ?? 0,
      observedAt,
      status: 'ready',
      privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
      ...(projectProfile !== undefined ? { projectProfile } : {}),
    }
  }

  /**
   * 已授权项目的概况 + 任务状态分布（organization_id 恒强制）。
   * 任务计数取数失败只省略计数，不影响页面语境本身。
   */
  async #buildProjectProfile(
    projectId: number,
    organizationId: number,
    record: unknown,
  ): Promise<CopilotPageProjectProfile | undefined> {
    const profile = toPageProjectProfile(projectId, record)
    if (!profile || !this.#deps.db) return profile
    try {
      const rows = (await this.#deps.db
        .from('tasks')
        .where('project_id', projectId)
        // tasks 表无 organization_id：经项目表收口组织隔离
        .whereIn(
          'project_id',
          this.#deps.db.from('projects').select('id').where('organization_id', organizationId),
        )
        .whereNull('deleted_at')
        .select('status')
        .count('* as count')
        .groupBy('status')) as readonly { status?: unknown; count?: unknown }[]
      const tasksByStatus: Record<string, number> = {}
      let taskTotal = 0
      for (const row of rows) {
        const count = Number(row.count ?? 0)
        if (typeof row.status !== 'string' || !Number.isFinite(count)) continue
        tasksByStatus[row.status] = count
        taskTotal += count
      }
      return { ...profile, taskTotal, tasksByStatus }
    } catch {
      return profile
    }
  }

  /** 无请求语境时的零上下文解析（turn 不附加 disclosure/facts）。 */
  #noopResolution(observedAt: string, _actorId: number): CopilotPageContextResolution {
    return {
      ok: true,
      descriptor: null,
      projectId: null,
      filters: [],
      ignoredFilters: [],
      sortApplied: [],
      selectionCount: 0,
      observedAt,
      status: 'ready',
      privacyNote: COPILOT_PAGE_CONTEXT_PRIVACY_NOTE,
    }
  }

  /**
   * 页面筛选下的权威任务事实（exact totals 先于行级明细；2.1/2.3）。
   *
   * 由注入的查询执行器执行；`db` 缺席（纯单元测试）时返回空数组。
   * 调用方（turn service）负责在授权就绪前提下调用；本方法不再复核授权。
   */
  async collectPageTaskFacts(params: {
    projectId: number
    organizationId: number
    filters: readonly CopilotPageContextFilter[]
    observedAt: string
  }): Promise<CopilotContextFact[]> {
    if (!this.#deps.db) return []
    const query = this.#deps.queryFilteredTaskFacts ?? queryFilteredTaskFacts
    return query({ db: this.#deps.db, ...params })
  }
}

// ---------------------------------------------------------------------------
// 页面筛选下的权威任务事实（2.1/2.3：exact totals 先于行级明细）
// ---------------------------------------------------------------------------

/**
 * 合并 allowlisted 筛选为 tasks 表查询子句。
 * 只允许 `PAGE_CONTEXT_FILTER_TO_TASK_COLUMN` 内映射；keyword 走 name LIKE。
 */
export function buildFilteredTaskQueryClauses(
  filters: readonly CopilotPageContextFilter[],
): { column: string; op: '=' | 'LIKE'; value: string | number }[] {
  const clauses: { column: string; op: '=' | 'LIKE'; value: string | number }[] = []
  for (const filter of filters) {
    const mapping = PAGE_CONTEXT_FILTER_TO_TASK_COLUMN[filter.key]
    if (!mapping) continue
    const values = Array.isArray(filter.value) ? filter.value : [filter.value]
    const first = values[0]
    if (first === undefined) continue
    const trimmed = String(first).trim().slice(0, 128)
    if (trimmed.length === 0) continue

    if (mapping === 'name_like') {
      clauses.push({ column: 'name', op: 'LIKE', value: `%${escapeLike(trimmed)}%` })
    } else if (
      mapping === 'assignee_id' ||
      mapping === 'milestone_id' ||
      mapping === 'parent_task_id'
    ) {
      const id = Number(trimmed)
      if (!Number.isInteger(id) || id <= 0) continue
      clauses.push({ column: mapping, op: '=', value: id })
    } else if (mapping === 'is_critical_path') {
      if (trimmed === 'true' || trimmed === '1')
        clauses.push({ column: mapping, op: '=', value: 1 })
    } else {
      clauses.push({ column: mapping, op: '=', value: trimmed })
    }
  }
  return clauses
}

/** LIKE 通配符转义。 */
export function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`)
}

/**
 * 查询页面筛选下的任务权威事实（exact totals 先于行级明细）。
 *
 * - `tasks.filteredTotal` / `tasks.filteredByStatus` 由同一筛选查询聚合，
 *   **先算总数再裁剪明细**（design §F-6「不能先截断再算 total」）；
 * - 行级明细 `tasks.filteredRows` 最多 `PAGE_CONTEXT_FILTERED_TASK_ROWS` 条，
 *   存在更多时 `truncated: true` 由调用方标记；
 * - organization_id 恒强制（组织隔离红线）。
 *
 * @param db 查询执行器（Knex/Lucid db 兼容：from/where/…）。
 */
export async function queryFilteredTaskFacts(params: {
  db: {
    from: (table: string) => any
  }
  projectId: number
  organizationId: number
  filters: readonly CopilotPageContextFilter[]
  observedAt: string
}): Promise<CopilotContextFact[]> {
  const { db, projectId, organizationId, filters, observedAt } = params
  const clauses = buildFilteredTaskQueryClauses(filters)

  const base = () => {
    const query = db
      .from('tasks')
      .where('project_id', projectId)
      // tasks 表没有 organization_id 列（此前直接按该列过滤，查询恒失败、事实恒为空）；
      // 组织隔离经 projects 表收口
      .whereIn(
        'project_id',
        db.from('projects').select('id').where('organization_id', organizationId),
      )
      .whereNull('deleted_at')
    for (const clause of clauses) {
      if (clause.op === 'LIKE') {
        query.where(clause.column, 'like', clause.value)
      } else {
        query.where(clause.column, clause.value)
      }
    }
    return query
  }

  // ① 精确总数（先于明细）
  const totalRow = await base().count('* as count').first()
  const total = Number(totalRow?.count ?? 0)

  // ② 状态分布（同一筛选）——`count(*)` 随行返回，不是数行数
  const statusRows = await base().select('status').count('* as count').groupBy('status')
  const byStatus: Record<string, number> = {}
  for (const row of statusRows as readonly { status?: unknown; count?: unknown }[]) {
    const status = String(row.status ?? 'unknown')
    byStatus[status] = Number(row.count ?? 1)
  }

  // ③ 行级明细（有界，截断标记由该事实的 truncated 承担）
  const rowRows = await base()
    .select('id', 'name', 'status', 'priority')
    .orderBy('id', 'desc')
    .limit(PAGE_CONTEXT_FILTERED_TASK_ROWS + 1)
  const hasMore = rowRows.length > PAGE_CONTEXT_FILTERED_TASK_ROWS
  const rows = rowRows.slice(0, PAGE_CONTEXT_FILTERED_TASK_ROWS) as readonly {
    id?: unknown
    name?: unknown
    status?: unknown
  }[]

  const facts: CopilotContextFact[] = [
    {
      factKey: 'tasks.filteredTotal',
      value: total,
      displayLabel: `符合当前页面筛选的任务数`,
      facet: 'taskStatus',
      sourceRef: `project:${projectId}/tasks`,
      observedAt,
      sensitivity: 'low',
    },
    {
      factKey: 'tasks.filteredByStatus',
      value: byStatus,
      displayLabel: '按状态分布（当前页面筛选）',
      facet: 'taskStatus',
      sourceRef: `project:${projectId}/tasks`,
      observedAt,
      sensitivity: 'low',
    },
    {
      factKey: 'tasks.filteredRows',
      value: rows.map((row) => `${String(row.name ?? '')}（${String(row.status ?? 'unknown')}）`),
      displayLabel: '当前页面筛选的任务明细（部分）',
      facet: 'taskStatus',
      sourceRef: `project:${projectId}/tasks`,
      observedAt,
      sensitivity: 'low',
      truncated: hasMore,
    },
  ]

  return facts.filter((fact) => {
    const validated = validateCopilotContextFact(fact)
    return validated.ok
  })
}
