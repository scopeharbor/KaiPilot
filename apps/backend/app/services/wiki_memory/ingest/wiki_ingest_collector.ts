/**
 * v3-llm-wiki-ingest-pipeline —— 编入原料收集。
 *
 * 从目标项目的 audit_logs 按审计 ID 游标正序增量读取，经 Timeline 映射只保留关键事件，
 * 映射为维基来源（kind#id）与低敏原料文本（Timeline 摘要 + 对象名 + 发生日期）；
 * 剔除已被删除的来源；单次最多 WIKI_INGEST_MAX_EVENTS 条，其余留给下次（hasMore）。
 * 首次运行只回看最近 30 天，避免把整个历史一次塞给模型。
 */
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import { WIKI_INGEST_MAX_EVENTS, type WikiSourceKind, type WikiSourceRef } from '@aiproj/types'
import AuditLog from '#models/audit_log'
import TimelineEventAdapter from '#services/timeline/timeline_event_adapter'
import WikiSourceRegistry, { sourceKey } from '../wiki_source_registry.js'

/** Timeline 对象类型 → 维基来源类型（未登记的类型不作为原料）。 */
const OBJECT_KIND: Record<string, WikiSourceKind> = {
  task: 'task',
  milestone: 'milestone',
  risk: 'risk',
  change_request: 'change_request',
  comment: 'comment',
  document: 'document',
  wbs_node: 'wbs_node',
  project: 'project',
}

export interface WikiIngestEvent {
  auditId: number
  ref: string
  source: WikiSourceRef
  when: string
  text: string
}

export interface WikiIngestBatch {
  events: WikiIngestEvent[]
  /** 本次扫描到的最大审计 ID（含被过滤的非关键事件），成功后作为新游标。 */
  scannedToAuditId: number | null
  hasMore: boolean
}

const SCAN_LIMIT = 500
const FIRST_RUN_LOOKBACK_DAYS = 30

@inject()
export default class WikiIngestCollector {
  constructor(private readonly sources: WikiSourceRegistry) {}

  async collect(args: {
    organizationId: number
    projectId: number
    cursorAuditId: number
    now?: DateTime
  }): Promise<WikiIngestBatch> {
    const adapter = new TimelineEventAdapter()
    const query = AuditLog.query()
      .where('organization_id', args.organizationId)
      .where('project_id', args.projectId)
      .where('id', '>', args.cursorAuditId)
      .orderBy('id', 'asc')
      .limit(SCAN_LIMIT + 1)
    if (args.cursorAuditId === 0) {
      const since = (args.now ?? DateTime.now()).minus({ days: FIRST_RUN_LOOKBACK_DAYS })
      query.where('created_at', '>=', since.toSQL()!)
    }
    const logs = await query
    const scanHasMore = logs.length > SCAN_LIMIT
    const scanned = logs.slice(0, SCAN_LIMIT)

    const candidates: WikiIngestEvent[] = []
    let lastIncludedAuditId: number | null = null
    let truncated = false
    for (const log of scanned) {
      const activity = adapter.toActivityEvent(log)
      if (!activity || !activity.isKeyEvent || activity.objectId === null) continue
      const kind = OBJECT_KIND[activity.objectType]
      if (!kind) continue
      if (candidates.length >= WIKI_INGEST_MAX_EVENTS) {
        truncated = true
        break
      }
      const when = DateTime.fromJSDate(activity.occurredAt).toISODate() ?? ''
      const label = activity.objectLabel ? `「${activity.objectLabel}」` : ''
      const source: WikiSourceRef = { kind, id: String(activity.objectId), version: null }
      candidates.push({
        auditId: Number(log.id),
        ref: sourceKey(source),
        source,
        when,
        text: `${activity.summaryTemplate}${label && !activity.summaryTemplate.includes(label) ? ` ${label}` : ''} ${when}`.trim(),
      })
      lastIncludedAuditId = Number(log.id)
    }

    const missing = await this.sources.findMissing(
      args.organizationId,
      candidates.map((c) => c.source),
    )
    const events = candidates.filter((c) => !missing.has(c.ref))
    const scannedToAuditId = truncated
      ? lastIncludedAuditId
      : scanned.length
        ? Number(scanned[scanned.length - 1]!.id)
        : null
    return { events, scannedToAuditId, hasMore: truncated || scanHasMore }
  }
}
