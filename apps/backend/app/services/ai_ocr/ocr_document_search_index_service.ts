/**
 * OcrDocumentSearchIndexService — OCR 文档搜索索引核心服务（v3-ocr-document-search-indexing §5）
 *
 * 职责：
 * - listStatus：项目/来源/提取范围索引状态分页列表
 * - previewIndexing：非破坏性索引预览，计算预览哈希
 * - executeIndexing：幂等索引执行，重新验证预览哈希与作用域
 * - previewReindex / executeReindex：来源/提取重新索引
 * - previewUnindex / executeUnindex：取消索引与 tombstone
 *
 * 不改变 source file、task、WBS、risk、Compiler、AI draft、knowledge base。
 */

import { DateTime } from 'luxon'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrDocumentSearchIndexEntry from '#models/ocr_document_search_index_entry'
import OcrDocumentSearchIndexRun from '#models/ocr_document_search_index_run'
import OcrRetentionHold from '#models/ocr_retention_hold'
import AuditService, { AuditEvent } from '#services/audit_service'
import { OcrPermissionAuditResolver } from './ocr_permission_audit_resolver.js'
import { writeOcrBoundaryAudit } from './ocr_permission_audit_logger.js'
import {
  type OcrSearchIndexPreviewEntry,
  type OcrSearchIndexPreviewResponse,
  type OcrSearchIndexExecuteRequest,
  type OcrSearchIndexExecuteResponse,
  type OcrSearchIndexReindexRequest,
  type OcrSearchIndexListQuery,
  type OcrSearchIndexListResponse,
  type OcrSearchIndexEntrySummary,
  type OcrSearchIndexRunSummary,
  type OcrSearchIndexBlockedReason,
  type OcrSearchIndexWarningCode,
  type OcrSearchIndexRunType,
  type OcrSearchIndexRunStatus,
  computeIndexContentHash,
  computeOcrSearchIndexPreviewHash,
  computeOcrSearchIndexIdempotencyKeyHash,
  isExtractionIndexable,
  normalizeSearchableText,
  generateSearchSnippet,
  truncateSearchableText,
  sortOcrSearchIndexWarningsBySeverity,
  buildOcrSearchIndexAuditMetadata,
  OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX,
} from '@aiproj/types'
import db from '@adonisjs/lucid/services/db'

export class OcrDocumentSearchIndexService {
  readonly #audit = new AuditService()
  readonly #resolver: OcrPermissionAuditResolver

  /**
   * 注入授权决策解析器（v3-ocr-permission-and-audit §6.7）。
   * 默认使用共享守卫（真实 RBAC/可见性/生命周期/滞留/隐私组合）；
   * 测试可注入假适配器 resolver 做确定性阻断/放行。
   */
  // 默认值而非 @inject()：容器按 Function.length 判定构造依赖数，TS 的可选标记不降 arity；
  // 而 OcrPermissionAuditResolver 自身是 `constructor(deps?: Partial<OcrResolverDeps>)`，
  // 容器同样构造不了它，@inject() 只会把报错从本类推到它身上。
  constructor(resolver: OcrPermissionAuditResolver = new OcrPermissionAuditResolver()) {
    this.#resolver = resolver
  }

  // ── 列表/状态 ──────────────────────────────────────────────────────────

  async listStatus(
    organizationId: number,
    projectId: number,
    query: OcrSearchIndexListQuery,
  ): Promise<OcrSearchIndexListResponse> {
    const page = query.page ?? 1
    const perPage = Math.min(query.perPage ?? 20, 50)

    let q = OcrDocumentSearchIndexEntry.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (query.sourceKind) q = q.where('source_kind', query.sourceKind)
    if (query.sourceId) q = q.where('source_id', query.sourceId)
    if (query.extractionId) q = q.where('extraction_id', query.extractionId)
    if (query.status) q = q.where('status', query.status)

    const totalQuery = await q.clone().count('* as total')
    const total = Number(totalQuery[0].$extras?.total ?? 0)

    const entries = await q
      .orderBy('updated_at', 'desc')
      .limit(perPage)
      .offset((page - 1) * perPage)

    const data: OcrSearchIndexEntrySummary[] = entries.map((e) => this.#toEntrySummary(e))

    return {
      data,
      meta: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    }
  }

  // ── 预览索引 ────────────────────────────────────────────────────────────

  async previewIndexing(
    organizationId: number,
    projectId: number,
    extractionIds?: number[],
    sourceKind?: 'attachment' | 'document',
    sourceId?: number,
    /**
     * 发起者（v3-ocr-permission-and-audit §6.7 敏感复用边界）。
     * 默认 0 表示未显式声明动作者——真实入口由控制器传入 userId。
     */
    actorId = 0,
  ): Promise<OcrSearchIndexPreviewResponse> {
    // 获取已接受的提取
    let extractionQuery = OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'current')

    if (extractionIds && extractionIds.length > 0) {
      extractionQuery = extractionQuery.whereIn('id', extractionIds)
    }

    const extractions = await extractionQuery

    // 获取活跃 holds
    const activeHolds = await OcrRetentionHold.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    // Hold scopeKind === 'project' means project-wide hold
    const holdProjectWide = activeHolds.some((h) => h.scopeKind === 'project')

    // 获取已有索引条目
    const extractionIdsList = extractions.map((e) => e.id)
    const existingEntries =
      extractionIdsList.length > 0
        ? await OcrDocumentSearchIndexEntry.query()
            .whereIn('extraction_id', extractionIdsList)
            .where('status', 'active')
        : []
    const existingMap = new Map(existingEntries.map((e) => [e.extractionId, e]))

    // 过滤 source kind/id
    const filtered = sourceKind
      ? extractions.filter((e) => e.sourceKind === sourceKind)
      : extractions
    const scopeFiltered = sourceId ? filtered.filter((e) => e.sourceId === sourceId) : filtered

    // 构建预览条目
    const entries: OcrSearchIndexPreviewEntry[] = []
    for (const ext of scopeFiltered) {
      const eligibility = isExtractionIndexable({
        status: ext.status,
        retentionLifecycle: ext.retentionLifecycle,
        purgedAt: ext.purgedAt?.toISO() ?? null,
        tombstoneId: ext.tombstoneId,
        sourceHash: ext.sourceHash,
        candidateHash: ext.candidateHash,
        selectedText: ext.selectedText,
      })

      const warnings: OcrSearchIndexWarningCode[] = []
      let blockedReason: OcrSearchIndexBlockedReason | null = eligibility.blockedReason

      // 检查 stale source
      if (eligibility.eligible && ext.sourceHash) {
        if (ext.sourceHash.length < 8) {
          blockedReason = 'stale_source'
        }
      }

      // 检查 hold
      if (eligibility.eligible && holdProjectWide) {
        blockedReason = 'hold_active'
      }

      // 检查 retention 策略
      if (eligibility.eligible && !ext.retentionPolicyHash) {
        warnings.push('retention_policy_unavailable')
      }
      if (eligibility.eligible && ext.retentionEligibleAt) {
        warnings.push('retention_deadline_approaching')
      }

      // 检查权限/隐私/生命周期等授权决策（v3-ocr-permission-and-audit §6.7 敏感复用边界）
      // 拒绝/降级/仅元数据/陈旧/保留滞留/隐私阻止 → 标记 permission_blocked，不产生索引写计划。
      if (eligibility.eligible && blockedReason === null) {
        const decision = await this.#resolver.resolve({
          actorId,
          organizationId,
          projectId,
          action: 'search_indexing_preview',
          // sourceId 可空（来源已被清理/未登记）：此时不构造来源引用，
          // 由 resolver 只按 artifactRef + 组织/项目上下文判定，而不是伪造一个 id。
          sourceRef:
            ext.sourceId === null
              ? null
              : { type: 'ocr_source', id: ext.sourceId, kind: ext.sourceKind },
          artifactRef: { type: 'ocr_artifact', id: ext.id, kind: 'accepted_extraction' },
          sourceHash: ext.sourceHash,
        })
        if (decision.result !== 'allow' && decision.result !== 'confirm_required') {
          blockedReason = 'permission_blocked'
          await writeOcrBoundaryAudit(this.#audit, decision)
        }
      }

      const isEligible = eligibility.eligible && blockedReason === null
      const existing = existingMap.get(ext.id)

      const plannedIndexHash = isEligible
        ? computeIndexContentHash(ext.id, ext.sourceHash, ext.selectedTextHash, ext.pageRefsJson)
        : null

      entries.push({
        extractionId: ext.id,
        sourceKind: ext.sourceKind,
        sourceId: ext.sourceId,
        sourceHash: ext.sourceHash,
        selectedTextHash: ext.selectedTextHash,
        pageRefs: ext.pageRefsJson,
        eligible: isEligible,
        blockedReason,
        warnings: sortOcrSearchIndexWarningsBySeverity(warnings),
        plannedIndexHash,
        currentEntryId: existing?.id ?? null,
        currentStatus: existing?.status ?? null,
      })
    }

    const eligibleEntries = entries.filter((e) => e.eligible)
    const blockedEntries = entries.filter((e) => !e.eligible)

    const allWarnings = sortOcrSearchIndexWarningsBySeverity([
      ...new Set(entries.flatMap((e) => e.warnings)),
    ])

    return {
      data: {
        entries,
        eligibleCount: eligibleEntries.length,
        blockedCount: blockedEntries.length,
        blockedReasons: blockedEntries
          .map((e) => e.blockedReason!)
          .filter((b): b is OcrSearchIndexBlockedReason => b !== null),
        warnings: allWarnings,
        previewHash: computeOcrSearchIndexPreviewHash(entries),
        requiresConfirmation: eligibleEntries.length > 0,
      },
    }
  }

  // ── 执行索引 ────────────────────────────────────────────────────────────

  async executeIndexing(
    organizationId: number,
    projectId: number,
    request: OcrSearchIndexExecuteRequest,
    userId: number,
  ): Promise<OcrSearchIndexExecuteResponse> {
    // 先查幂等重放（理由同 executeUnindex）：首次执行后条目状态已变，
    // 重算 previewHash 与首次不同，先校验 stale 会让合法重放拿不到已存结果。
    const idemHash = computeOcrSearchIndexIdempotencyKeyHash(request.idempotencyKey)
    const existingRun = await OcrDocumentSearchIndexRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key_hash', idemHash)
      .where('run_type', 'index')
      .first()

    if (existingRun) {
      const entries = await OcrDocumentSearchIndexEntry.query().where('last_run_id', existingRun.id)
      return {
        data: {
          run: this.#toRunSummary(existingRun),
          entries: entries.map((e) => this.#toEntrySummary(e)),
          createdCount: existingRun.entryCount,
          updatedCount: 0,
          blockedCount: existingRun.blockedCount,
        },
      }
    }

    // 非重放才重新预览并校验哈希（带着动作者，供权限门禁复用）
    const preview = await this.previewIndexing(
      organizationId,
      projectId,
      undefined,
      undefined,
      undefined,
      userId,
    )
    if (preview.data.previewHash !== request.previewHash) {
      throw new Error('STALE_PREVIEW')
    }

    const eligibleEntries = preview.data.entries.filter((e) => e.eligible)
    const blockedEntries = preview.data.entries.filter((e) => !e.eligible)

    // 在事务中创建/更新条目
    const createdEntries: OcrDocumentSearchIndexEntry[] = []

    const trx = await db.transaction()
    try {
      for (const previewEntry of eligibleEntries) {
        const extraction = await OcrReviewAcceptedExtraction.query({ client: trx })
          .where('id', previewEntry.extractionId)
          .first()

        if (!extraction) continue

        // 执行边界二次授权决策（v3-ocr-permission-and-audit §6.7）：拒绝/降级/仅元数据
        // /陈旧/保留滞留/隐私阻止 → 跳过该条目的敏感文本复用，不写索引。
        const decision = await this.#resolver.resolve({
          actorId: userId,
          organizationId,
          projectId,
          action: 'search_indexing_execution',
          // 与 previewIndexing 同口径：sourceId 为空时不伪造来源引用
          sourceRef:
            previewEntry.sourceId === null
              ? null
              : {
                  type: 'ocr_source',
                  id: previewEntry.sourceId,
                  kind: previewEntry.sourceKind,
                },
          artifactRef: {
            type: 'ocr_artifact',
            id: previewEntry.extractionId,
            kind: 'accepted_extraction',
          },
          sourceHash: previewEntry.sourceHash,
        })
        if (decision.result !== 'allow' && decision.result !== 'confirm_required') {
          // 传 trx：本调用在事务内，走独立连接会耗尽 SQLite 单连接池并死锁
          await writeOcrBoundaryAudit(this.#audit, decision, trx)
          continue
        }

        const searchableText = truncateSearchableText(
          normalizeSearchableText(extraction.selectedText),
          OCR_SEARCH_INDEX_SEARCHABLE_TEXT_MAX,
        )

        // 停用已有 active 条目
        // 注意 `.toSQL()`：query builder 的 update 直接走驱动绑定，传 Luxon DateTime 对象
        // 会被 SQLite 拒绝（"can only bind numbers, strings, bigints, buffers, and null"）。
        // 与 notification_service / project_service 的既有写法一致。
        await OcrDocumentSearchIndexEntry.query({ client: trx })
          .where('extraction_id', previewEntry.extractionId)
          .where('status', 'active')
          .update({ status: 'inactive', updated_at: DateTime.now().toSQL() })

        const entry = new OcrDocumentSearchIndexEntry()
        entry.organizationId = organizationId
        entry.projectId = projectId
        entry.extractionId = previewEntry.extractionId
        entry.sourceKind = previewEntry.sourceKind
        entry.sourceId = previewEntry.sourceId
        entry.sourceHash = previewEntry.sourceHash
        entry.selectedTextHash = previewEntry.selectedTextHash
        entry.indexContentHash = previewEntry.plannedIndexHash!
        entry.pageRefsJson = previewEntry.pageRefs
        entry.searchableText = searchableText
        entry.searchableSnippet = generateSearchSnippet(searchableText, '')
        entry.status = 'active'
        entry.indexedBy = userId
        entry.indexedAt = DateTime.now()

        entry.useTransaction(trx)
        await entry.save()
        createdEntries.push(entry)
      }

      await trx.commit()
    } catch (err) {
      await trx.rollback()
      throw err
    }

    // 创建运行记录
    const run = await OcrDocumentSearchIndexRun.create({
      organizationId,
      projectId,
      runType: 'index' as OcrSearchIndexRunType,
      status: (blockedEntries.length > 0 ? 'partial' : 'succeeded') as OcrSearchIndexRunStatus,
      previewHash: request.previewHash,
      idempotencyKeyHash: idemHash,
      entryCount: createdEntries.length,
      blockedCount: blockedEntries.length,
      warningCount: preview.data.warnings.length,
      warningsJson: preview.data.warnings,
      blockedReasonsJson: preview.data.blockedReasons,
      note: request.note ?? null,
      runBy: userId,
    })

    // 回写 last_run_id
    if (createdEntries.length > 0) {
      await OcrDocumentSearchIndexEntry.query()
        .whereIn(
          'id',
          createdEntries.map((e) => e.id),
        )
        .update({ last_run_id: run.id })
    }

    // 低敏审计
    await this.#audit.log({
      event: AuditEvent.OCR_SEARCH_INDEX_EXECUTE,
      userId,
      organizationId,
      projectId,
      entityType: 'ocr_search_index',
      entityId: run.id,
      metadata: buildOcrSearchIndexAuditMetadata({
        organizationId,
        projectId,
        runId: run.id,
        runType: 'index',
        entryIds: createdEntries.map((e) => e.id),
        extractionIds: createdEntries.map((e) => e.extractionId),
        sourceKinds: createdEntries.map((e) => e.sourceKind),
        sourceIds: createdEntries.map((e) => e.sourceId),
        sourceHashes: createdEntries.map((e) => e.sourceHash),
        selectedTextHashes: createdEntries.map((e) => e.selectedTextHash),
        indexContentHashes: createdEntries.map((e) => e.indexContentHash),
        previewHash: request.previewHash,
        idempotencyKeyHash: idemHash,
        createdCount: createdEntries.length,
        blockedCount: blockedEntries.length,
        warningCodes: preview.data.warnings,
        blockedReasons: preview.data.blockedReasons,
      }),
    })

    return {
      data: {
        run: this.#toRunSummary(run),
        entries: createdEntries.map((e) => this.#toEntrySummary(e)),
        createdCount: createdEntries.length,
        updatedCount: 0,
        blockedCount: blockedEntries.length,
      },
    }
  }

  // ── 重新索引预览 ───────────────────────────────────────────────────────

  async previewReindex(
    organizationId: number,
    projectId: number,
    request: OcrSearchIndexReindexRequest,
    actorId = 0,
  ): Promise<OcrSearchIndexPreviewResponse> {
    return this.previewIndexing(
      organizationId,
      projectId,
      request.extractionIds,
      request.sourceKind,
      request.sourceId,
      actorId,
    )
  }

  // ── 执行重新索引 ───────────────────────────────────────────────────────

  async executeReindex(
    organizationId: number,
    projectId: number,
    request: OcrSearchIndexExecuteRequest,
    userId: number,
  ): Promise<OcrSearchIndexExecuteResponse> {
    // 幂等重放先查（理由同 executeUnindex）：reindex 成功后条目状态已变，
    // 重算 previewHash 与首次不同，先校验 stale 会让合法重放拿不到已存结果。
    const idemHash = computeOcrSearchIndexIdempotencyKeyHash(request.idempotencyKey)
    const existingRun = await OcrDocumentSearchIndexRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key_hash', idemHash)
      .where('run_type', 'reindex')
      .first()

    if (!existingRun) {
      const preview = await this.previewIndexing(
        organizationId,
        projectId,
        undefined,
        undefined,
        undefined,
        userId,
      )
      if (preview.data.previewHash !== request.previewHash) {
        throw new Error('STALE_PREVIEW')
      }
    }

    if (existingRun) {
      const entries = await OcrDocumentSearchIndexEntry.query().where('last_run_id', existingRun.id)
      return {
        data: {
          run: this.#toRunSummary(existingRun),
          entries: entries.map((e) => this.#toEntrySummary(e)),
          createdCount: existingRun.entryCount,
          updatedCount: 0,
          blockedCount: existingRun.blockedCount,
        },
      }
    }

    // 将已有 active 条目标记为 stale，然后重新索引（`.toSQL()` 理由同上）
    await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'active')
      .update({ status: 'inactive', updated_at: DateTime.now().toSQL() })

    const result = await this.executeIndexing(organizationId, projectId, request, userId)

    // 更新 run type
    await OcrDocumentSearchIndexRun.query()
      .where('id', result.data.run.id)
      .update({ run_type: 'reindex' })

    return result
  }

  // ── 取消索引预览 ───────────────────────────────────────────────────────

  async previewUnindex(
    organizationId: number,
    projectId: number,
    entryIds: number[],
  ): Promise<OcrSearchIndexPreviewResponse> {
    const entries = await OcrDocumentSearchIndexEntry.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .whereIn('id', entryIds)
      .where('status', 'active')

    const previewEntries: OcrSearchIndexPreviewEntry[] = entries.map((e) => ({
      extractionId: e.extractionId,
      sourceKind: e.sourceKind,
      sourceId: e.sourceId,
      sourceHash: e.sourceHash,
      selectedTextHash: e.selectedTextHash,
      pageRefs: e.pageRefsJson,
      eligible: true,
      blockedReason: null,
      warnings: [],
      plannedIndexHash: e.indexContentHash,
      currentEntryId: e.id,
      currentStatus: e.status,
    }))

    return {
      data: {
        entries: previewEntries,
        eligibleCount: previewEntries.length,
        blockedCount: 0,
        blockedReasons: [],
        warnings: [],
        previewHash: computeOcrSearchIndexPreviewHash(previewEntries),
        requiresConfirmation: previewEntries.length > 0,
      },
    }
  }

  // ── 执行取消索引 ───────────────────────────────────────────────────────

  async executeUnindex(
    organizationId: number,
    projectId: number,
    entryIds: number[],
    previewHash: string,
    idempotencyKey: string,
    note: string | null,
    userId: number,
  ): Promise<OcrSearchIndexExecuteResponse> {
    // 幂等重放**必须先查**：unindex 成功后条目已 tombstoned，重算的 previewHash
    // 必然与首次不同；若先校验 stale preview，合法重放永远拿不到已存结果，
    // 幂等键在「第一次已成功」这个唯一需要它的场景下形同虚设。
    // 幂等键的语义就是「同一次操作」，命中即返回既有 run。
    const idemHash = computeOcrSearchIndexIdempotencyKeyHash(idempotencyKey)
    const existingRun = await OcrDocumentSearchIndexRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key_hash', idemHash)
      .where('run_type', 'unindex')
      .first()

    if (!existingRun) {
      const preview = await this.previewUnindex(organizationId, projectId, entryIds)
      if (preview.data.previewHash !== previewHash) {
        throw new Error('STALE_PREVIEW')
      }
    }

    if (existingRun) {
      const entries = await OcrDocumentSearchIndexEntry.query().where('last_run_id', existingRun.id)
      return {
        data: {
          run: this.#toRunSummary(existingRun),
          entries: entries.map((e) => this.#toEntrySummary(e)),
          createdCount: 0,
          updatedCount: existingRun.entryCount,
          blockedCount: existingRun.blockedCount,
        },
      }
    }

    // 执行取消索引 — 标记为 tombstoned 并清除搜索文本
    let count = 0
    const trx = await db.transaction()
    try {
      const entries = await OcrDocumentSearchIndexEntry.query({ client: trx })
        .where('organization_id', organizationId)
        .where('project_id', projectId)
        .whereIn('id', entryIds)
        .where('status', 'active')

      for (const entry of entries) {
        entry.status = 'tombstoned'
        entry.searchableText = ''
        entry.searchableSnippet = null
        entry.tombstonedBy = userId
        entry.tombstonedAt = DateTime.now()
        entry.useTransaction(trx)
        await entry.save()
        count++
      }

      await trx.commit()
    } catch (err) {
      await trx.rollback()
      throw err
    }

    const run = await OcrDocumentSearchIndexRun.create({
      organizationId,
      projectId,
      runType: 'unindex' as OcrSearchIndexRunType,
      status: 'succeeded' as OcrSearchIndexRunStatus,
      previewHash,
      idempotencyKeyHash: idemHash,
      entryCount: count,
      blockedCount: 0,
      warningCount: 0,
      warningsJson: [],
      blockedReasonsJson: [],
      note: note,
      runBy: userId,
    })

    await this.#audit.log({
      event: AuditEvent.OCR_SEARCH_INDEX_UNINDEX,
      userId,
      organizationId,
      projectId,
      entityType: 'ocr_search_index',
      entityId: run.id,
      metadata: buildOcrSearchIndexAuditMetadata({
        organizationId,
        projectId,
        runId: run.id,
        runType: 'unindex',
        previewHash,
        idempotencyKeyHash: idemHash,
        updatedCount: count,
      }),
    })

    return {
      data: {
        run: this.#toRunSummary(run),
        entries: [],
        createdCount: 0,
        updatedCount: count,
        blockedCount: 0,
      },
    }
  }

  // ── 私有映射方法 ───────────────────────────────────────────────────────

  #toEntrySummary(entry: OcrDocumentSearchIndexEntry): OcrSearchIndexEntrySummary {
    return {
      id: entry.id,
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      extractionId: entry.extractionId,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      sourceHash: entry.sourceHash,
      selectedTextHash: entry.selectedTextHash,
      indexContentHash: entry.indexContentHash,
      pageRefs: entry.pageRefsJson,
      status: entry.status as OcrSearchIndexEntrySummary['status'],
      indexedBy: entry.indexedBy,
      indexedAt: entry.indexedAt?.toISO() ?? null,
      tombstonedAt: entry.tombstonedAt?.toISO() ?? null,
      createdAt: entry.createdAt.toISO()!,
      updatedAt: (entry.updatedAt ?? entry.createdAt).toISO()!,
    }
  }

  #toRunSummary(run: OcrDocumentSearchIndexRun): OcrSearchIndexRunSummary {
    return {
      id: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      runType: run.runType as OcrSearchIndexRunSummary['runType'],
      status: run.status as OcrSearchIndexRunSummary['status'],
      previewHash: run.previewHash,
      idempotencyKeyHash: run.idempotencyKeyHash,
      entryCount: run.entryCount,
      blockedCount: run.blockedCount,
      warningCount: run.warningCount,
      warnings: run.warningsJson as OcrSearchIndexRunSummary['warnings'],
      blockedReasons: run.blockedReasonsJson as OcrSearchIndexRunSummary['blockedReasons'],
      note: run.note,
      runBy: run.runBy,
      createdAt: run.createdAt.toISO()!,
      updatedAt: (run.updatedAt ?? run.createdAt).toISO()!,
    }
  }
}
