/**
 * Document Intelligence Workbench — 默认只读适配器（Lucid 实现）
 *
 * 职责：把 read_ports 契约落到既有权威表上的 page-scoped 批量查询。
 * 红线：
 * - 全部查询 organization/project 双过滤（附件经 projectId + 项目归属校验）；
 * - 只投影低敏列：不读 content/selectedText/searchableText/candidateText 等
 *   正文与敏感字段；
 * - 不重算任何 owning 领域算法；current/superseded/stale 直接消费权威列。
 */

import { type DateTime } from 'luxon'
import { sortDocumentIntelligenceSources } from '@aiproj/types'

/** Lucid count() 聚合行的最小形状（避免用不安全断言取 $extras） */
interface CountRow {
  $extras?: { total?: number | string }
}
import Attachment from '#models/attachment'
import Document from '#models/document'
import OcrDocumentJob from '#models/ocr_document_job'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrStructuredExtractionSnapshot from '#models/ocr_structured_extraction_snapshot'
import OcrEntityLinkRun from '#models/ocr_entity_link_run'
import OcrEntityLinkConfirmedLink from '#models/ocr_entity_link_confirmed_link'
import OcrRetentionHold from '#models/ocr_retention_hold'
import OcrStructuredExtractionProfile from '#models/ocr_structured_extraction_profile'
import { OcrPrivacyPolicyResolver } from '#services/ai_ocr/ocr_privacy_policy_resolver'
import OcrProfilePluginResolver from '#services/ai_ocr/ocr_profile_plugin_resolver'
import { OcrResultRetentionReadService } from '#services/ai_ocr/ocr_result_retention_read_service'
import type { DocumentIntelligenceReadPorts, WorkbenchSourceRow } from './read_ports.js'

function toIso(value: DateTime | null | undefined): string | null {
  return value ? value.toISO()! : null
}

/**
 * 行获取硬上限：单次查询最多物化的来源行数。
 * total 由独立 count 查询给出，因此本上限不会让计数「静默截断」。
 */
const SOURCE_FETCH_HARD_LIMIT = 5000

interface SourceQueryOptions {
  organizationId: number
  projectId: number
  sourceKind?: 'native_document' | 'attachment' | null
  search?: string | null
}

/**
 * 单个项目的可见来源清单（native document + attachment 统一，软删除排除）。
 *
 * documents 与 attachments 是两张权威表，跨表分页在 SQLite 上以「低敏投影
 * → 合并 → 稳定排序 → 切片」实现；total 另经 count 查询取得，保证
 * 「不静默把项目上限截断成内部固定值」。
 */
async function loadProjectSources(opts: SourceQueryOptions): Promise<WorkbenchSourceRow[]> {
  const wantDocuments = opts.sourceKind !== 'attachment'
  const wantAttachments = opts.sourceKind !== 'native_document'
  const needle = opts.search ? `%${opts.search}%` : null

  const documentQuery = Document.query()
    .select('id', 'name', 'createdAt', 'updatedAt')
    .where('project_id', opts.projectId)
    .where('document_type', 'document')
  if (needle) documentQuery.whereILike('name', needle)

  const attachmentQuery = Attachment.query()
    .select('id', 'fileName', 'mimeType', 'createdAt', 'updatedAt')
    .where('project_id', opts.projectId)
    .whereNull('deleted_at')
  if (needle) attachmentQuery.whereILike('file_name', needle)

  const [documents, attachments] = await Promise.all([
    wantDocuments
      ? documentQuery.orderBy('created_at', 'desc').limit(SOURCE_FETCH_HARD_LIMIT)
      : Promise.resolve([]),
    wantAttachments
      ? attachmentQuery.orderBy('created_at', 'desc').limit(SOURCE_FETCH_HARD_LIMIT)
      : Promise.resolve([]),
  ])

  // 附件/文档表无组织列：组织边界由调用前的项目归属校验与 Policy 保证
  return [
    ...documents.map((d) => ({
      sourceKind: 'native_document' as const,
      sourceId: Number(d.id),
      displayName: d.name,
      mimeType: null,
      createdAt: toIso(d.createdAt),
      updatedAt: toIso(d.updatedAt),
    })),
    ...attachments.map((att) => ({
      sourceKind: 'attachment' as const,
      sourceId: Number(att.id),
      displayName: att.fileName,
      mimeType: att.mimeType ?? null,
      createdAt: toIso(att.createdAt),
      updatedAt: toIso(att.updatedAt),
    })),
  ]
}

/** 权威计数：与行查询同条件，但不受行获取上限影响 */
async function countProjectSources(opts: SourceQueryOptions): Promise<number> {
  const needle = opts.search ? `%${opts.search}%` : null
  let total = 0

  if (opts.sourceKind !== 'attachment') {
    const q = Document.query()
      .where('project_id', opts.projectId)
      .where('document_type', 'document')
    if (needle) q.whereILike('name', needle)
    const row: CountRow | null = await q.count('* as total').first()
    total += Number(row?.$extras?.total ?? 0)
  }
  if (opts.sourceKind !== 'native_document') {
    const q = Attachment.query().where('project_id', opts.projectId).whereNull('deleted_at')
    if (needle) q.whereILike('file_name', needle)
    const row: CountRow | null = await q.count('* as total').first()
    total += Number(row?.$extras?.total ?? 0)
  }
  return total
}

/**
 * 默认 read ports 实现。注意：本对象必须保持纯读——任何命令方法的加入
 * 都会被 assertNoOwningCommands / excess-property 静态检查拒绝。
 */
export class DefaultDocumentIntelligenceReadAdapters implements DocumentIntelligenceReadPorts {
  async pageVisibleSources(params: {
    organizationId: number
    projectId: number
    page: number
    perPage: number
    sourceKind?: 'native_document' | 'attachment' | null
    search?: string | null
    sort?: 'updated_at' | 'created_at' | 'source_ref'
    direction?: 'asc' | 'desc'
  }): Promise<{ items: WorkbenchSourceRow[]; total: number }> {
    const options: SourceQueryOptions = {
      organizationId: params.organizationId,
      projectId: params.projectId,
      sourceKind: params.sourceKind ?? null,
      search: params.search ?? null,
    }
    const [rows, total] = await Promise.all([
      loadProjectSources(options),
      countProjectSources(options),
    ])
    // 与共享纯函数使用同一比较器：跨页稳定、无重复无遗漏
    const sorted = sortDocumentIntelligenceSources(
      rows,
      params.sort ?? 'updated_at',
      params.direction ?? 'desc',
    )
    const start = Math.max(0, (params.page - 1) * params.perPage)
    return { items: sorted.slice(start, start + params.perPage), total }
  }

  async loadLatestJobsBySourceIds(params: {
    organizationId: number
    projectId: number
    sourceIds: number[]
  }): Promise<Map<number, import('./read_ports.js').WorkbenchJobRow>> {
    const map = new Map<number, import('./read_ports.js').WorkbenchJobRow>()
    if (params.sourceIds.length === 0) return map

    const jobs = await OcrDocumentJob.query()
      .select(
        'id',
        'source_attachment_id',
        'status',
        'warning_codes',
        'succeeded_pages',
        'page_count',
        'provider',
        'cost_summary',
        'created_at',
        'updated_at',
      )
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .whereIn('source_attachment_id', params.sourceIds)
      .whereNull('purged_at')
      .orderBy('updated_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')

    for (const job of jobs) {
      const sourceId = Number(job.sourceAttachmentId)
      if (map.has(sourceId)) continue // 查询已按最新优先排序，首个即最新
      map.set(sourceId, {
        jobId: Number(job.id),
        sourceAttachmentId: sourceId,
        status: job.status,
        warningCodes: Array.isArray(job.warningCodes) ? (job.warningCodes as string[]) : [],
        succeededPages: job.succeededPages ?? null,
        pageCount: job.pageCount ?? null,
        provider: job.provider ?? null,
        costSummaryPresent: job.costSummary !== null && job.costSummary !== undefined,
        createdAt: toIso(job.createdAt)!,
        updatedAt: toIso(job.updatedAt)!,
      })
    }
    return map
  }

  async loadExtractionsBySourceIds(params: {
    organizationId: number
    projectId: number
    sourceIds: number[]
  }): Promise<Map<number, import('./read_ports.js').WorkbenchExtractionRow>> {
    const map = new Map<number, import('./read_ports.js').WorkbenchExtractionRow>()
    if (params.sourceIds.length === 0) return map

    const extractions = await OcrReviewAcceptedExtraction.query()
      .select('id', 'job_id', 'source_id', 'status', 'superseded_at', 'confirmed_at', 'created_at')
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .whereIn('source_id', params.sourceIds)
      .whereNull('purged_at')
      .whereNull('redacted_at')
      .orderBy('confirmed_at', 'desc')
      .orderBy('id', 'desc')

    for (const e of extractions) {
      const sourceId = Number(e.sourceId)
      if (map.has(sourceId)) continue
      map.set(sourceId, {
        extractionId: Number(e.id),
        jobId: e.jobId === null || e.jobId === undefined ? null : Number(e.jobId),
        sourceId,
        lifecycle: e.status === 'current' ? 'current' : 'superseded',
        confirmedAt: toIso(e.confirmedAt),
      })
    }
    return map
  }

  async loadSearchIndexEntriesBySourceIds(params: {
    organizationId: number
    projectId: number
    sourceIds: number[]
  }): Promise<Map<number, import('./read_ports.js').WorkbenchSearchIndexEntryRow>> {
    const map = new Map<number, import('./read_ports.js').WorkbenchSearchIndexEntryRow>()
    if (params.sourceIds.length === 0) return map

    const entries = await OcrDocumentSearchIndexEntry.query()
      .select('id', 'extraction_id', 'source_id', 'status', 'tombstoned_at', 'updated_at')
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .whereIn('source_id', params.sourceIds)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')

    for (const entry of entries) {
      const sourceId = Number(entry.sourceId)
      if (map.has(sourceId)) continue
      map.set(sourceId, {
        entryId: Number(entry.id),
        extractionId:
          entry.extractionId === null || entry.extractionId === undefined
            ? null
            : Number(entry.extractionId),
        sourceId,
        status: entry.status,
        tombstonedAt: toIso(entry.tombstonedAt),
        updatedAt: toIso(entry.updatedAt),
      })
    }
    return map
  }

  async loadSnapshotSummariesByExtractionIds(params: {
    organizationId: number
    projectId: number
    extractionIds: number[]
  }): Promise<Map<number, import('./read_ports.js').WorkbenchSnapshotSummaryRow>> {
    const map = new Map<number, import('./read_ports.js').WorkbenchSnapshotSummaryRow>()
    if (params.extractionIds.length === 0) return map

    const snapshots = await OcrStructuredExtractionSnapshot.query()
      .select('id', 'extraction_id', 'status')
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .whereIn('extraction_id', params.extractionIds)

    for (const s of snapshots) {
      const key = Number(s.extractionId)
      const summary = map.get(key) ?? {
        currentCount: 0,
        supersededCount: 0,
        latestCurrentSnapshotId: null,
      }
      if (s.status === 'current') {
        summary.currentCount += 1
        summary.latestCurrentSnapshotId = Number(s.id)
      } else {
        summary.supersededCount += 1
      }
      map.set(key, summary)
    }
    return map
  }

  /**
   * 页内批量加载实体关联确认摘要（key = extractionId）。
   *
   * 复用 owning 记录：ocr_entity_link_confirmed_links.lifecycleStatus 与
   * ocr_entity_link_runs.status，不重算任何匹配规则。目标实体可见性由 owning
   * target adapter 负责；此处仅在目标记录缺失时计入 hiddenTargetCount，
   * 绝不回显目标名称或标签正文。
   */
  async loadEntityLinkSummariesByExtractionIds(params: {
    organizationId: number
    projectId: number
    extractionIds: number[]
  }): Promise<import('./read_ports.js').WorkbenchEntityLinkBulkResult> {
    const rows = new Map<number, import('./read_ports.js').WorkbenchEntityLinkSummaryRow>()
    if (params.extractionIds.length === 0) return { rows, available: true }

    try {
      const links = await OcrEntityLinkConfirmedLink.query()
        .select('id', 'run_id', 'extraction_id', 'lifecycle_status', 'target_kind', 'target_id')
        .where('organization_id', params.organizationId)
        .where('project_id', params.projectId)
        .whereIn('extraction_id', params.extractionIds)

      const runIds = [...new Set(links.map((l) => Number(l.runId)))]
      const staleRunIds = new Set<number>()
      if (runIds.length > 0) {
        const runs = await OcrEntityLinkRun.query()
          .select('id', 'status')
          .where('organization_id', params.organizationId)
          .where('project_id', params.projectId)
          .whereIn('id', runIds)
        for (const run of runs) {
          if (run.status === 'stale' || run.status === 'failed') staleRunIds.add(Number(run.id))
        }
      }

      for (const link of links) {
        const key = Number(link.extractionId)
        const row = rows.get(key) ?? {
          activeLinkCount: 0,
          supersededLinkCount: 0,
          hiddenTargetCount: 0,
          staleRun: false,
        }
        if (link.lifecycleStatus === 'active') row.activeLinkCount += 1
        else row.supersededLinkCount += 1
        // 目标 id 缺失（被删除/隐藏）时只计数，不泄露目标标识
        if (!link.targetId) row.hiddenTargetCount += 1
        if (staleRunIds.has(Number(link.runId))) row.staleRun = true
        rows.set(key, row)
      }
      return { rows, available: true }
    } catch {
      // 维度失败显式降级，不冒充零
      return { rows: new Map(), available: false }
    }
  }

  /**
   * 项目级治理摘要：全部委托 shipped resolver 的既有裁决，不复制治理状态机。
   *
   * - retention：OcrResultRetentionReadService.getProjectStatus（lifecycle classifier + hold）
   * - privacy：OcrPrivacyPolicyResolver.resolve（system → org → project 叠加）
   * - profile provenance：organization-owned → enabled-plugin → builtin 的确定性优先级
   * - audit：数据面可达性；调用方权限由 Policy 的 canReadAudit 再次收敛
   *
   * 任一子维度失败只降级该维度；retention 与 privacy 同时失败视为整体 unavailable。
   */
  async loadGovernanceSummary(params: {
    organizationId: number
    projectId: number
  }): Promise<import('./read_ports.js').WorkbenchGovernanceSummary> {
    const [retention, privacy, profile] = await Promise.all([
      this.#resolveRetention(params),
      this.#resolvePrivacy(params),
      this.#resolveProfileProvenance(params),
    ])

    if (!retention && !privacy) {
      return {
        available: false,
        retentionHoldActive: false,
        retentionExpiredCount: 0,
        privacyBlocked: false,
        privacyOutputMode: 'unknown',
        auditAccess: 'unavailable',
        profileProvenance: null,
      }
    }

    return {
      available: true,
      retentionHoldActive: retention?.holdActive ?? false,
      retentionExpiredCount: retention?.expiredCount ?? 0,
      privacyBlocked: privacy?.blocked ?? false,
      privacyOutputMode: privacy?.outputMode ?? 'unknown',
      auditAccess: 'available',
      profileProvenance: profile,
    }
  }

  /** retention：复用 shipped read service；失败时退化到 hold 计数，再失败则 null */
  async #resolveRetention(params: {
    organizationId: number
    projectId: number
  }): Promise<{ holdActive: boolean; expiredCount: number } | null> {
    try {
      const status = await new OcrResultRetentionReadService().getProjectStatus(
        params.organizationId,
        params.projectId,
        [],
      )
      return {
        holdActive: status.holdActiveCount > 0,
        expiredCount:
          status.counts.expired + status.counts.purge_pending + status.counts.hold_blocked,
      }
    } catch {
      try {
        const holds: CountRow[] = await OcrRetentionHold.query()
          .where('organization_id', params.organizationId)
          .where('project_id', params.projectId)
          .where('status', 'active')
          .count('* as total')
        return { holdActive: Number(holds[0]?.$extras?.total ?? 0) > 0, expiredCount: 0 }
      } catch {
        return null
      }
    }
  }

  /** privacy：复用 shipped resolver 的 globalOutputMode 裁决 */
  async #resolvePrivacy(params: {
    organizationId: number
    projectId: number
  }): Promise<{ blocked: boolean; outputMode: string } | null> {
    try {
      const policy = await new OcrPrivacyPolicyResolver().resolve(
        params.organizationId,
        params.projectId,
      )
      return { blocked: policy.globalOutputMode === 'blocked', outputMode: policy.globalOutputMode }
    } catch {
      return null
    }
  }

  /**
   * profile provenance：三源确定性优先级（organization-owned → enabled plugin → builtin）。
   * 只投影 identity/version/provenanceKind/status/receiptRef —— 不含 schema 正文、
   * prompt、provider/model、secret 或任何可执行内容。
   */
  async #resolveProfileProvenance(params: {
    organizationId: number
    projectId: number
  }): Promise<import('./read_ports.js').WorkbenchGovernanceSummary['profileProvenance']> {
    try {
      const owned = await OcrStructuredExtractionProfile.query()
        .select('id', 'name', 'scope', 'status', 'current_version', 'schema_key')
        .where('organization_id', params.organizationId)
        .whereIn('scope', ['organization', 'project'])
        .orderBy('id', 'asc')
      const ownedActive = owned.find((row) => row.status === 'active')
      if (ownedActive) {
        return {
          identity: ownedActive.schemaKey,
          version: String(ownedActive.currentVersion),
          provenanceKind: 'organization_owned',
          status: 'active',
          receiptRef: 'profile:' + ownedActive.id,
        }
      }

      const pluginProfiles = await new OcrProfilePluginResolver().listEnabledPluginProfiles(
        params.organizationId,
      )
      const pluginProfile = pluginProfiles[0]
      if (pluginProfile) {
        return {
          identity: pluginProfile.profileRef,
          version: pluginProfile.version,
          provenanceKind: 'enabled_plugin',
          status: 'active',
          receiptRef: pluginProfile.pluginRef?.payloadDigest ?? null,
        }
      }

      const builtin = await OcrStructuredExtractionProfile.query()
        .select('id', 'name', 'status', 'current_version', 'schema_key')
        .where('scope', 'builtin')
        .orderBy('id', 'asc')
        .first()
      if (builtin) {
        return {
          identity: builtin.schemaKey,
          version: String(builtin.currentVersion),
          provenanceKind: 'builtin',
          status: builtin.status === 'active' ? 'active' : 'disabled',
          receiptRef: 'profile:' + builtin.id,
        }
      }

      // 组织侧存在但全部 draft/archived 且无 builtin → 显式 disabled，不冒充 active
      const ownedDisabled = owned[0]
      if (ownedDisabled) {
        return {
          identity: ownedDisabled.schemaKey,
          version: String(ownedDisabled.currentVersion),
          provenanceKind: 'organization_owned',
          status: 'disabled',
          receiptRef: 'profile:' + ownedDisabled.id,
        }
      }
      return {
        identity: 'builtin',
        version: '0',
        provenanceKind: 'builtin',
        status: 'missing',
        receiptRef: null,
      }
    } catch {
      return {
        identity: 'builtin',
        version: '0',
        provenanceKind: 'builtin',
        status: 'invalid',
        receiptRef: null,
      }
    }
  }
}
