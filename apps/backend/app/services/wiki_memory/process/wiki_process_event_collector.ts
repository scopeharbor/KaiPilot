/**
 * v3-llm-wiki-process-reality —— 流程事件收集（只读、组织隔离）。
 *
 * 读本组织最近的任务 / 变更请求审计，在内存中按 metadata.event 过滤（与 burndown 一致，不依赖 JSON 查询方言），
 * 只投影「对象 ID + 时间 + 从哪个状态到哪个状态」；不读名称、备注与操作人。
 */
import { DateTime } from 'luxon'
import type { WikiProcessKind, WikiProcessTransition } from '@aiproj/types'
import AuditLog from '#models/audit_log'

/** 每类最多读取的审计条数（取最新的，正序处理）。 */
export const WIKI_PROCESS_SCAN_LIMIT = 20_000

const CHANGE_REQUEST_EVENT_STATUS: Record<string, string> = {
  CHANGE_REQUEST_SUBMITTED: 'submitted',
  CHANGE_REQUEST_APPROVED: 'approved',
  CHANGE_REQUEST_REJECTED: 'rejected',
  CHANGE_REQUEST_RETURNED: 'returned',
  CHANGE_REQUEST_IMPLEMENTED: 'implemented',
  CHANGE_REQUEST_CLOSED: 'closed',
  CHANGE_REQUEST_CANCELLED: 'cancelled',
}

const ENTITY_TYPE: Record<WikiProcessKind, string> = {
  'task-flow': 'task',
  'change-approval': 'change_request',
}

function statusOf(side: unknown): string | null {
  if (!side || typeof side !== 'object') return null
  const status = (side as Record<string, unknown>).status
  return typeof status === 'string' && status ? status : null
}

function millis(value: unknown): number {
  if (value instanceof DateTime) return value.toMillis()
  if (value instanceof Date) return value.getTime()
  return Number.NaN
}

export default class WikiProcessEventCollector {
  async collect(organizationId: number, kind: WikiProcessKind): Promise<WikiProcessTransition[]> {
    const rows = await AuditLog.query()
      .where('organization_id', organizationId)
      .where('entity_type', ENTITY_TYPE[kind])
      .whereNotNull('entity_id')
      .select('id', 'entity_id', 'metadata', 'changes', 'created_at')
      .orderBy('id', 'desc')
      .limit(WIKI_PROCESS_SCAN_LIMIT)

    const out: WikiProcessTransition[] = []
    for (const row of rows.reverse()) {
      const event = row.metadata?.event
      if (typeof event !== 'string') continue
      const entityId = Number(row.entityId)
      const at = millis(row.createdAt)
      if (kind === 'task-flow') {
        if (event !== 'TASK_STATUS_CHANGED') continue
        const from = typeof row.metadata?.from === 'string' ? row.metadata.from : null
        const to = typeof row.metadata?.to === 'string' ? row.metadata.to : null
        if (to) out.push({ entityId, at, from, to })
        continue
      }
      const mapped = CHANGE_REQUEST_EVENT_STATUS[event]
      if (!mapped) continue
      const to = statusOf(row.changes?.after) ?? mapped
      out.push({ entityId, at, from: statusOf(row.changes?.before), to })
    }
    return out
  }
}
