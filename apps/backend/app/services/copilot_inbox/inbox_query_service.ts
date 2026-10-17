/**
 * v3-copilot-suggestion-inbox — 查询服务（任务 7.1–7.6）
 *
 * 只读聚合查询：按项目、来源、状态、严重度、时间窗分页与稳定排序。
 * 单来源不可用时降级为部分聚合并标注缺失。
 * 一个来源失败不导致整体请求失败。
 */

import CopilotSuggestionInbox from '#models/copilot_suggestion_inbox'
import type { DateTime } from 'luxon'
import type {
  InboxEntry,
  InboxEntryState,
  InboxQueryParams,
  InboxAggregateResult,
} from '@aiproj/types'
import { serializeInboxDedupeKey, sortInboxEntries } from '@aiproj/types'

/**
 * severity 是文本列：直接 `orderBy('severity','desc')` 走字母序
 * （medium > low > info > high > critical），与 `inboxSeverityScore` 的语义顺序相反。
 * 用 CASE 映射成分值排序，保证分页边界正确；CASE WHEN 为 SQLite/PostgreSQL 通用语法。
 */
const INBOX_SEVERITY_RANK_SQL =
  "CASE severity WHEN 'critical' THEN 50 WHEN 'high' THEN 40 WHEN 'medium' THEN 30 WHEN 'low' THEN 20 WHEN 'info' THEN 10 ELSE 0 END"

/**
 * 查询服务。
 */
export class InboxQueryService {
  /**
   * 查询收件箱条目（组织隔离 + 分页 + 排序）。
   */
  async query(
    params: Omit<InboxQueryParams, 'projectId'> & { organizationId: number; projectId?: number },
  ): Promise<InboxAggregateResult> {
    const {
      organizationId,
      projectId,
      state,
      severity,
      since,
      until,
      page = 1,
      perPage = 20,
    } = params

    let query = CopilotSuggestionInbox.query().where('organization_id', organizationId)

    if (projectId) {
      query = query.where('project_id', projectId)
    }
    if (state) {
      query = query.where('state', state)
    }
    if (severity) {
      query = query.where('severity', severity)
    }
    if (since) {
      query = query.where('created_at', '>=', since)
    }
    if (until) {
      query = query.where('created_at', '<=', until)
    }

    const offset = (page - 1) * perPage
    const result = await query
      .orderByRaw(INBOX_SEVERITY_RANK_SQL + ' DESC')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'asc')
      .offset(offset)
      .limit(perPage)

    const totalQuery = CopilotSuggestionInbox.query().where('organization_id', organizationId)

    if (projectId) totalQuery.where('project_id', projectId)
    if (state) totalQuery.where('state', state)
    if (severity) totalQuery.where('severity', severity)
    if (since) totalQuery.where('created_at', '>=', since)
    if (until) totalQuery.where('created_at', '<=', until)

    const [totalRow] = await totalQuery.count('* as count')
    const total = Number(totalRow?.$extras.count ?? 0)

    // 未读计数
    let unreadCount = 0
    const unreadQuery = CopilotSuggestionInbox.query()
      .where('organization_id', organizationId)
      .where('state', 'unread')
    if (projectId) unreadQuery.where('project_id', projectId)
    const [unreadRow] = await unreadQuery.count('* as count')
    unreadCount = Number(unreadRow?.$extras.count ?? 0)

    const entries: InboxEntry[] = sortInboxEntries(result.map((r) => this.toInboxEntry(r)))

    return {
      entries,
      total,
      unreadCount,
      missingSources: [],
      pagination: {
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  /**
   * 按 ID 获取单个条目（组织隔离）。
   */
  async getEntryById(organizationId: number, id: string): Promise<InboxEntry | null> {
    const model = await CopilotSuggestionInbox.query()
      .where('organization_id', organizationId)
      .where('id', id)
      .first()
    if (!model) return null
    return this.toInboxEntry(model)
  }

  /**
   * 按项目获取所有条目（组织隔离）。
   */
  async getEntriesByProject(organizationId: number, projectId: number): Promise<InboxEntry[]> {
    const models = await CopilotSuggestionInbox.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderByRaw(INBOX_SEVERITY_RANK_SQL + ' DESC')
      .orderBy('created_at', 'desc')
    return models.map((m) => this.toInboxEntry(m))
  }

  /**
   * 落库聚合结果。
   *
   * 聚合器产出的条目带 `id: ''` / `organizationId: ''`（注释写明「由持久化层分配 /
   * 由调用方填充」），但此前**没有任何代码把它们写进表**——refresh 聚合完就丢掉，
   * 于是 index 永远返回空。这里补上该步。
   *
   * 表上有唯一约束 `uq_csi_dedupe(organization_id, project_id, dedupe_key_json)`，
   * 一个去重键只允许一行，因此冲突策略是被约束定死的：
   * - 不存在 → 以 `unread` 新建；
   * - 已存在且**非终态** → 只更新来源引用与严重度，**不动 state**，
   *   否则用户已读过的条目会被刷新重新标成未读；
   * - 已存在且为终态（adopted / dismissed / expired，按状态机不可迁出）→ **原样跳过**。
   *   用户已经处理过，重新聚合不得复活它，也不能插重复行。
   */
  async upsertAggregated(
    organizationId: number,
    projectId: number,
    entries: readonly InboxEntry[],
  ): Promise<{ created: number; updated: number; skippedTerminal: number }> {
    if (entries.length === 0) return { created: 0, updated: 0, skippedTerminal: 0 }

    // 一次取回本项目现有条目，在内存里按去重键比对——去重键存在 json 列里，
    // 放进 SQL 比对会踩 PostgreSQL 不支持 json 直接比较/LIKE 的坑。
    const existingModels = await CopilotSuggestionInbox.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
    const byDedupeKey = new Map(
      existingModels.map((m) => [serializeInboxDedupeKey(m.dedupeKey), m]),
    )

    const TERMINAL_STATES: InboxEntryState[] = ['adopted', 'dismissed', 'expired']
    let created = 0
    let updated = 0
    let skippedTerminal = 0

    for (const entry of entries) {
      const key = serializeInboxDedupeKey(entry.dedupeKey)
      const existing = byDedupeKey.get(key)

      if (!existing) {
        await CopilotSuggestionInbox.create({
          organizationId,
          projectId,
          state: 'unread',
          problemKind: entry.problemKind,
          severity: entry.severity,
          dedupeKey: entry.dedupeKey,
          sourceRefs: [...entry.sourceRefs],
          expiryReason: null,
          expiryDetail: null,
        })
        created += 1
        continue
      }

      if (TERMINAL_STATES.includes(existing.state)) {
        skippedTerminal += 1
        continue
      }

      existing.severity = entry.severity
      existing.sourceRefs = [...entry.sourceRefs]
      await existing.save()
      updated += 1
    }

    return { created, updated, skippedTerminal }
  }

  /**
   * 更新条目状态。
   */
  async updateEntry(
    id: string,
    updates: {
      state?: InboxEntryState
      expiryReason?: string | null
      expiryDetail?: string | null
      // 必须是 luxon DateTime：Lucid 的 @column.dateTime 只接受 DateTime，
      // 传原生 Date 会在 prepare 阶段抛「It must be an instance of luxon.DateTime」。
      readAt?: DateTime | null
      actionedAt?: DateTime | null
    },
  ): Promise<void> {
    const model = await CopilotSuggestionInbox.find(id)
    if (!model) return
    if (updates.state) model.state = updates.state
    if (updates.expiryReason !== undefined) model.expiryReason = updates.expiryReason as any
    if (updates.expiryDetail !== undefined) model.expiryDetail = updates.expiryDetail
    if (updates.readAt !== undefined) model.readAt = updates.readAt
    if (updates.actionedAt !== undefined) model.actionedAt = updates.actionedAt
    await model.save()
  }

  /**
   * 获取未读计数。
   */
  async getUnreadCount(params: { organizationId: number; projectId?: number }): Promise<number> {
    let query = CopilotSuggestionInbox.query()
      .where('organization_id', params.organizationId)
      .where('state', 'unread')

    if (params.projectId) {
      query = query.where('project_id', params.projectId)
    }

    const [countRow] = await query.count('* as count')
    return Number(countRow?.$extras.count ?? 0)
  }

  /**
   * 将 Lucid 模型转换为 InboxEntry 形态。
   */
  private toInboxEntry(model: CopilotSuggestionInbox): InboxEntry {
    return {
      id: String(model.id),
      organizationId: String(model.organizationId),
      projectId: String(model.projectId),
      state: model.state,
      problemKind: model.problemKind,
      severity: model.severity,
      dedupeKey: model.dedupeKey,
      sourceRefs: model.sourceRefs,
      expiryReason: model.expiryReason ?? null,
      expiryDetail: model.expiryDetail ?? null,
      createdAt: model.createdAt?.toISO() ?? new Date().toISOString(),
      updatedAt: model.updatedAt?.toISO() ?? new Date().toISOString(),
      readAt: model.readAt?.toISO() ?? null,
      actionedAt: model.actionedAt?.toISO() ?? null,
    }
  }
}
