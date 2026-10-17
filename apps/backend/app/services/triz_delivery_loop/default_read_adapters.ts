/**
 * v3-triz-to-delivery-closed-loop —— 默认 DB-backed closed delivery adapters
 * （tasks 5.2/5.4/5.6）。
 *
 * 权威事实接缝（A7 冻结）：
 * - task: tasks（软删除 deleted_at；status 六态 CHECK）
 * - milestone: milestones（status 五态 CHECK）
 * - risk: risks / change_request: change_requests（仅 context，不参与完成判定）
 *
 * 组织隔离经 projects join（四表均无 organization_id）；批量为单条 whereIn 查询。
 * revisionHint = updatedAt ISO 字符串（软 revision）。
 */
import db from '@adonisjs/lucid/services/db'
import type { TrizDlEntityPosture } from '@aiproj/types'
import {
  TrizDlAdapterRegistryError,
  TrizDlClosedAdapterRegistry,
  type TrizDlClosedDeliveryPort,
  type TrizDlPortEntry,
  type TrizDlPortFetchContext,
} from './read_adapters.js'

void TrizDlAdapterRegistryError

// ---------------------------------------------------------------------------
// 状态标准化映射闭集（spec: 禁止猜测合成）
// ---------------------------------------------------------------------------

const TASK_STATUS_MAP: Record<string, TrizDlEntityPosture> = {
  not_started: 'not_started',
  in_progress: 'in_progress',
  completed: 'completed',
  blocked: 'blocked',
  on_hold: 'blocked',
  cancelled: 'cancelled',
}

const MILESTONE_STATUS_MAP: Record<string, TrizDlEntityPosture> = {
  not_started: 'not_started',
  planned: 'not_started',
  at_risk: 'blocked',
  missed: 'blocked',
  achieved: 'completed',
}

/** context kinds 仅做展示性标准化，绝不驱动 completion。 */
export const CONTEXT_STATUS_MAPS: Record<string, Record<string, TrizDlEntityPosture>> = {
  risk: {
    identified: 'not_started',
    analyzing: 'in_progress',
    mitigating: 'in_progress',
    resolved: 'completed',
    accepted: 'cancelled',
    closed: 'cancelled',
  },
  change_request: {
    draft: 'not_started',
    submitted: 'in_progress',
    under_review: 'in_progress',
    approved: 'in_progress',
    rejected: 'cancelled',
    implemented: 'completed',
    closed: 'completed',
    cancelled: 'cancelled',
  },
}

export function mapTaskStatus(status: string): TrizDlEntityPosture | null {
  return TASK_STATUS_MAP[status] ?? null
}
export function mapMilestoneStatus(status: string): TrizDlEntityPosture | null {
  return MILESTONE_STATUS_MAP[status] ?? null
}
export function mapContextStatus(kind: string, status: string): TrizDlEntityPosture | null {
  return CONTEXT_STATUS_MAPS[kind]?.[status] ?? null
}

// ---------------------------------------------------------------------------
// 内部批量查询助手
// ---------------------------------------------------------------------------

interface RawRow {
  id: number | string
  entity_name: string | null
  entity_status: string
  updated_at: string | Date | null
  deleted_at?: string | Date | null
}

/** 别名显式选择：避免 join 两侧同名列（status/name）互相覆盖。 */
const TABLE_SELECTS: Record<string, Record<string, string>> = {
  tasks: {
    id: 'tasks.id',
    entity_name: 'tasks.name',
    entity_status: 'tasks.status',
    updated_at: 'tasks.updated_at',
    deleted: 'tasks.deleted_at',
  },
  milestones: {
    id: 'milestones.id',
    entity_name: 'milestones.name',
    entity_status: 'milestones.status',
    updated_at: 'milestones.updated_at',
    deleted: 'milestones.deleted_at',
  },
  risks: {
    id: 'risks.id',
    entity_name: 'risks.title',
    entity_status: 'risks.status',
    updated_at: 'risks.updated_at',
    deleted: 'risks.deleted_at',
  },
  change_requests: {
    id: 'change_requests.id',
    entity_name: 'change_requests.title',
    entity_status: 'change_requests.status',
    updated_at: 'change_requests.updated_at',
    deleted: 'change_requests.deleted_at',
  },
}

/** tasks/risks/change_requests 具备软删除列；milestones 删除即不存在。 */
const SOFT_DELETE_TABLES = new Set(['tasks', 'risks', 'change_requests'])

async function fetchRowsByTable(
  table: 'tasks' | 'milestones' | 'risks' | 'change_requests',
  entityIds: readonly string[],
  ctx: TrizDlPortFetchContext,
): Promise<RawRow[]> {
  const ids = [...entityIds].map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0)
  if (ids.length === 0) return []
  // join projects 仅用于组织归属校验；业务列全部以别名显式取出，
  // 避免 projects 同名列（status/name）覆盖实体列。
  const select: Record<string, string> = { ...TABLE_SELECTS[table] }
  if (!SOFT_DELETE_TABLES.has(table)) delete select.deleted
  const rows = (await db
    .query()
    .from(table)
    .join('projects', 'projects.id', `${table}.project_id`)
    .where('projects.organization_id', ctx.organizationId)
    .where(`${table}.project_id`, ctx.projectId)
    .whereIn(`${table}.id`, ids)
    .select(select)) as unknown as Array<RawRow & { deleted?: string | Date | null }>
  return rows.map((r) => ({
    id: r.id,
    entity_name: r.entity_name,
    entity_status: r.entity_status,
    updated_at: r.updated_at,
    deleted_at: r.deleted ?? null,
  }))
}

function toEntry(
  kind: TrizDlClosedDeliveryPort['kind'],
  row: RawRow,
  posture: TrizDlEntityPosture | null,
  ctx: TrizDlPortFetchContext,
): TrizDlPortEntry {
  const entityId = String(row.id)
  if (ctx.hiddenEntityIds?.has(entityId)) {
    return {
      kind,
      entityId,
      posture: 'unavailable',
      revisionHint: null,
      title: null,
      unavailableReason: 'forbidden',
    }
  }
  const title = row.entity_name ?? null
  const revisionHint = row.updated_at ? String(row.updated_at) : null
  if (row.deleted_at) {
    return {
      kind,
      entityId,
      posture: 'unavailable',
      revisionHint,
      title: null,
      unavailableReason: 'deleted',
    }
  }
  if (posture === null) {
    // 未知状态值：fail closed（禁止猜测合成），不泄露状态原文。
    return {
      kind,
      entityId,
      posture: 'unavailable',
      revisionHint,
      title: null,
      unavailableReason: 'error',
    }
  }
  return {
    kind,
    entityId,
    posture,
    revisionHint,
    title,
    unavailableReason: null,
  }
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export class TrizDlTaskDbPort implements TrizDlClosedDeliveryPort {
  readonly kind = 'task' as const

  async fetchSummaries(
    entityIds: readonly string[],
    ctx: TrizDlPortFetchContext,
  ): Promise<Map<string, TrizDlPortEntry>> {
    const rows = await fetchRowsByTable('tasks', entityIds, ctx)
    const out = new Map<string, TrizDlPortEntry>()
    for (const row of rows) {
      out.set(
        String(row.id),
        toEntry(this.kind, row, mapTaskStatus(String(row.entity_status)), ctx),
      )
    }
    for (const id of entityIds) {
      if (!out.has(id)) {
        // 不存在或跨项目：统一 not-found 形态（无存在泄露）
        out.set(id, {
          kind: 'task',
          entityId: id,
          posture: 'unavailable',
          revisionHint: null,
          title: null,
          unavailableReason: 'deleted',
        })
      }
    }
    return out
  }
}

export class TrizDlMilestoneDbPort implements TrizDlClosedDeliveryPort {
  readonly kind = 'milestone' as const

  async fetchSummaries(
    entityIds: readonly string[],
    ctx: TrizDlPortFetchContext,
  ): Promise<Map<string, TrizDlPortEntry>> {
    const rows = await fetchRowsByTable('milestones', entityIds, ctx)
    const out = new Map<string, TrizDlPortEntry>()
    for (const row of rows) {
      out.set(
        String(row.id),
        toEntry(this.kind, row, mapMilestoneStatus(String(row.entity_status)), ctx),
      )
    }
    for (const id of entityIds) {
      if (!out.has(id)) {
        out.set(id, {
          kind: 'milestone',
          entityId: id,
          posture: 'unavailable',
          revisionHint: null,
          title: null,
          unavailableReason: 'deleted',
        })
      }
    }
    return out
  }
}

export class TrizDlRiskContextPort implements TrizDlClosedDeliveryPort {
  readonly kind = 'risk' as const

  async fetchSummaries(
    entityIds: readonly string[],
    ctx: TrizDlPortFetchContext,
  ): Promise<Map<string, TrizDlPortEntry>> {
    const rows = await fetchRowsByTable('risks', entityIds, ctx)
    const out = new Map<string, TrizDlPortEntry>()
    for (const row of rows) {
      out.set(
        String(row.id),
        toEntry(this.kind, row, mapContextStatus('risk', String(row.entity_status)), ctx),
      )
    }
    for (const id of entityIds) {
      if (!out.has(id)) {
        out.set(id, {
          kind: 'risk',
          entityId: id,
          posture: 'unavailable',
          revisionHint: null,
          title: null,
          unavailableReason: 'deleted',
        })
      }
    }
    return out
  }
}

export class TrizDlChangeRequestContextPort implements TrizDlClosedDeliveryPort {
  readonly kind = 'change_request' as const

  async fetchSummaries(
    entityIds: readonly string[],
    ctx: TrizDlPortFetchContext,
  ): Promise<Map<string, TrizDlPortEntry>> {
    const rows = await fetchRowsByTable('change_requests', entityIds, ctx)
    const out = new Map<string, TrizDlPortEntry>()
    for (const row of rows) {
      out.set(
        String(row.id),
        toEntry(this.kind, row, mapContextStatus('change_request', String(row.entity_status)), ctx),
      )
    }
    for (const id of entityIds) {
      if (!out.has(id)) {
        out.set(id, {
          kind: 'change_request',
          entityId: id,
          posture: 'unavailable',
          revisionHint: null,
          title: null,
          unavailableReason: 'deleted',
        })
      }
    }
    return out
  }
}

/** 生产默认 registry（closed 闭集）。 */
export function createDefaultTrizDlRegistry(): TrizDlClosedAdapterRegistry {
  return new TrizDlClosedAdapterRegistry()
    .register(new TrizDlTaskDbPort())
    .register(new TrizDlMilestoneDbPort())
    .register(new TrizDlRiskContextPort())
    .register(new TrizDlChangeRequestContextPort())
}
