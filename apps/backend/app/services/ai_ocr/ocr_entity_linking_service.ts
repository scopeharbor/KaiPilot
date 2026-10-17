import type {
  OcrEntityLinkRunSummary,
  OcrEntityLinkRunDetail,
  OcrEntityLinkRunInputSignature,
  OcrEntityLinkCandidate,
  OcrEntityLinkSourceExtractionRef,
  OcrEntityLinkPreview,
  OcrEntityLinkAdvisoryPayload,
  OcrEntityLinkTargetSuggestion,
  OcrEntityLinkTargetSummary,
  OcrEntityLinkConfirmedLink,
  OcrEntityLinkListFilters,
  OcrEntityLinkExplanation,
  OcrEntityLinkRedlineSummary,
  OcrEntityLinkWarning,
  OcrEntityLinkWarningCode,
  OcrEntityLinkPermissionAction,
  OcrTargetKind,
  OcrMatchReason,
  OcrEntityMentionType,
} from '@aiproj/types'
import {
  computeEntityLinkRunInputSignature,
  // barrel 为避开与 ai-draft-layer / OCR 审查确认版同名函数的冲突，统一加 EntityLink 域前缀
  computeEntityLinkPreviewHash,
  computeEntityLinkConfirmationHash,
  // barrel 里为避开与 OCR 审查确认版同名常量的冲突，改名为 ENTITY_LINK_ 前缀
  ENTITY_LINK_DEFAULT_REDLINE_SUMMARY,
} from '@aiproj/types'
import OcrEntityLinkRun from '#models/ocr_entity_link_run'
import OcrEntityLinkCandidateModel from '#models/ocr_entity_link_candidate'
import OcrEntityLinkConfirmedLinkModel from '#models/ocr_entity_link_confirmed_link'
import OcrEntityLinkSourceAdapter from '#services/ai_ocr/ocr_entity_link_source_adapter'
import OcrEntityLinkRuleEngine from '#services/ai_ocr/ocr_entity_link_rule_engine'
import {
  TargetAdapterRegistry,
  defaultTargetRegistry,
} from '#services/ai_ocr/ocr_entity_link_target_adapter'
import type { EntityLinkContext } from '#services/ai_ocr/ocr_entity_link_target_adapter'
import OcrEntityLinkingPolicy from '#policies/ocr_entity_linking_policy'
import { ValidationException, ResourceNotFoundException } from '#exceptions/api_exception'
import type { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'

// ─── 常量 ──────────────────────────────────────────────────────────────────

const DEFAULT_RULE_VERSION = 'v1.0.0'
const MAX_MENTIONS_PER_EXTRACTION = 500
const MAX_CANDIDATES_PER_RUN = 5000

/** 警告严重程度映射 */
const WARNING_SEVERITY: Record<OcrEntityLinkWarningCode, 'info' | 'warn' | 'error'> = {
  TRUNCATED_TEXT: 'warn',
  EXTRACTION_SUPERSEDED: 'error',
  SOURCE_HASH_STALE: 'error',
  RETENTION_EXPIRED: 'warn',
  RETENTION_HOLD: 'warn',
  TARGET_NOT_FOUND: 'warn',
  TARGET_INACCESSIBLE: 'error',
  TARGET_ARCHIVED: 'warn',
  TARGET_DELETED: 'error',
  TARGET_RENAMED: 'info',
  DUPLICATE_CANDIDATE: 'info',
  DUPLICATE_CONFIRMED: 'warn',
  LOW_CONFIDENCE: 'info',
  AMBIGUOUS_MENTION: 'warn',
  MULTIPLE_TARGETS: 'warn',
  UNSUPPORTED_TARGET_KIND: 'error',
  BUDGET_LIMIT: 'error',
  RATE_LIMIT: 'error',
  AI_EXPLANATION_FALLBACK: 'info',
  AI_EXPLANATION_HALLUCINATION: 'error',
  EXTRACTION_CURRENTLY_PROCESSING: 'warn',
}

/**
 * OCR 实体链接主服务（v3-ocr-entity-linking §5）。
 *
 * 编排来源适配器、规则引擎、目标适配器和持久化层：
 * - 创建运行 → 检测 mention → 匹配目标 → 保存候选
 * - 预览/确认/取代/拒绝 advisory link
 * - 幂等复用（输入签名匹配时复用已有运行）
 *
 * 红/线：
 * - 永不修改正式项目数据（advisory link 仅作标注）
 * - 所有操作限制在 organization + project 双隔离内
 * - 不调用真实 AI 模型（explain 返回确定性降级）
 */
@inject()
export default class OcrEntityLinkingService {
  private readonly ruleEngine: OcrEntityLinkRuleEngine
  private readonly sourceAdapter: OcrEntityLinkSourceAdapter
  private readonly targetRegistry: TargetAdapterRegistry

  constructor(targetRegistry?: TargetAdapterRegistry, sourceAdapter?: OcrEntityLinkSourceAdapter) {
    this.ruleEngine = new OcrEntityLinkRuleEngine()
    this.sourceAdapter = sourceAdapter ?? new OcrEntityLinkSourceAdapter()
    this.targetRegistry = targetRegistry ?? defaultTargetRegistry
  }

  // ─── 运行管理 ────────────────────────────────────────────────────────────

  /**
   * 创建实体链接运行。
   *
   * 流程：
   * 1. 权限检查
   * 2. 读取可用提取
   * 3. 计算输入签名 → 幂等复用检查
   * 4. 创建 run 记录 (status='running')
   * 5. 对每条提取运行规则引擎 → 目标匹配 → 保存候选
   * 6. 更新 run status='completed'
   */
  async createRun(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    actorId: number,
    extractionIds?: number[],
    targetKinds?: OcrTargetKind[],
    ruleVersion?: string,
  ): Promise<OcrEntityLinkRunSummary> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertManage()

    const ruleVer = ruleVersion ?? DEFAULT_RULE_VERSION
    const kinds =
      targetKinds && targetKinds.length > 0 ? targetKinds : this.targetRegistry.registeredKinds()

    // 读取可用提取
    const sourceExtractions = await this.sourceAdapter.getAvailableExtractions(
      organizationId,
      projectId,
      extractionIds,
    )

    if (sourceExtractions.length === 0) {
      throw new ValidationException('没有可用的已接受提取用于实体链接')
    }

    // 计算输入签名
    const inputSig: OcrEntityLinkRunInputSignature = {
      organizationId,
      projectId,
      actorId,
      acceptedExtractionIds: sourceExtractions.map((e) => e.extractionId),
      extractionHashes: sourceExtractions.map((e) => e.selectedTextHash),
      sourceHashes: sourceExtractions.map((e) => e.sourceHash),
      ruleVersion: ruleVer,
      targetKinds: kinds,
    }
    const signature = computeEntityLinkRunInputSignature(inputSig)

    // 幂等复用：查找同签名 + 同项目 + completed 的运行
    const existingRun = await OcrEntityLinkRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('input_signature', signature)
      .where('status', 'completed')
      .first()

    if (existingRun) {
      logger.info({ runId: existingRun.id, signature }, '[EntityLink] 幂等复用已有运行')
      await this.audit(ctx, 'OCR_ENTITY_LINK_RUN_REUSED', {
        runId: existingRun.id,
        signature,
      })
      return this.runToSummary(existingRun)
    }

    // 创建运行
    const run = new OcrEntityLinkRun()
    run.organizationId = organizationId
    run.projectId = projectId
    run.actorId = actorId
    run.inputSignature = signature
    run.ruleVersion = ruleVer
    run.status = 'running'
    run.candidateCount = 0
    run.confirmedCount = 0
    run.sourceExtractionIdsJson = sourceExtractions.map((e) => e.extractionId)
    run.targetKindsJson = kinds
    run.staleSummaryJson = null
    await run.save()

    const runId = run.id
    logger.info({ runId, extractionCount: sourceExtractions.length }, '[EntityLink] 开始创建运行')

    try {
      const linkCtx: EntityLinkContext = { organizationId, projectId, actorId }

      // 对每条提取运行规则引擎 + 目标匹配
      let totalCandidates = 0
      const allWarnings: OcrEntityLinkWarningCode[] = []

      for (const extraction of sourceExtractions) {
        const text = await this.sourceAdapter.getExtractionText(
          extraction.extractionId,
          organizationId,
          projectId,
        )

        if (!text) continue

        const { mentions, warnings: detectionWarnings } = await this.ruleEngine.detectMentions(
          extraction.extractionId,
          text,
          extraction.pageRefs,
        )
        allWarnings.push(...detectionWarnings)

        // 对每条 mention 执行目标匹配（单条提取的 mention 数量设上限，防止超长文本拖垮运行）
        for (const mention of mentions.slice(0, MAX_MENTIONS_PER_EXTRACTION)) {
          // 将 mentionType 映射到 targetKinds 子集
          const relevantKinds = this.mentionTypeToTargetKinds(mention.mentionType).filter((k) =>
            kinds.includes(k),
          )

          // 没有相关 target kind 的 mention 仍然记录为 pending
          if (relevantKinds.length === 0) {
            await this.saveCandidate(
              runId,
              organizationId,
              projectId,
              extraction,
              mention,
              null,
              mention.confidence < 0.5 ? ['LOW_CONFIDENCE'] : [],
            )
            totalCandidates++
            continue
          }

          // 并行匹配所有相关 target kind
          const matchResults = await this.targetRegistry.matchAll(
            mention.normalizedLabel,
            relevantKinds,
            linkCtx,
          )

          // 取最佳匹配
          let bestSuggestion: OcrEntityLinkTargetSuggestion | null = null
          let bestConfidence = 0
          let candidateWarnings: OcrEntityLinkWarningCode[] = []

          for (const [, suggestions] of matchResults) {
            for (const s of suggestions) {
              if (s.confidence > bestConfidence) {
                bestConfidence = s.confidence
                bestSuggestion = s
              }
            }
          }

          // 检查是否有多个匹配
          let totalSuggestions = 0
          for (const [, suggestions] of matchResults) {
            totalSuggestions += suggestions.length
          }

          if (totalSuggestions > 1) {
            candidateWarnings.push('MULTIPLE_TARGETS')
          }

          if (!bestSuggestion) {
            candidateWarnings.push('TARGET_NOT_FOUND')
          }

          if (mention.confidence < 0.5) {
            candidateWarnings.push('LOW_CONFIDENCE')
          }

          await this.saveCandidate(
            runId,
            organizationId,
            projectId,
            extraction,
            mention,
            bestSuggestion,
            candidateWarnings,
          )
          totalCandidates++
        }

        // 上限检查
        if (totalCandidates >= MAX_CANDIDATES_PER_RUN) {
          allWarnings.push('TRUNCATED_TEXT')
          logger.warn({ runId }, '[EntityLink] 候选数达到上限，截断')
          break
        }
      }

      // 更新运行状态
      run.candidateCount = totalCandidates
      run.status = 'completed'
      run.staleSummaryJson =
        allWarnings.length > 0
          ? { isStale: false, staleReason: null, staleSince: new Date().toISOString() }
          : null
      await run.save()

      await this.audit(ctx, 'OCR_ENTITY_LINK_RUN_CREATED', {
        runId,
        candidateCount: totalCandidates,
        extractionCount: sourceExtractions.length,
      })

      logger.info({ runId, candidateCount: totalCandidates }, '[EntityLink] 运行创建完成')

      return this.runToSummary(run)
    } catch (err) {
      // 失败回滚
      run.status = 'failed'
      run.errorMessage = err instanceof Error ? err.message : '未知错误'
      await run.save()
      logger.error({ runId, err }, '[EntityLink] 运行创建失败')
      throw err
    }
  }

  /**
   * 获取运行详情（含候选分页列表）。
   */
  async getRun(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    runId: number,
    page: number = 1,
    perPage: number = 50,
  ): Promise<OcrEntityLinkRunDetail> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertView()

    const run = await OcrEntityLinkRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('实体链接运行未找到')
    }

    // 加载候选（分页）
    const candidatesQuery = OcrEntityLinkCandidateModel.query()
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('confidence', 'desc')

    const candidatesResult = await candidatesQuery.paginate(page, perPage)

    const candidates: OcrEntityLinkCandidate[] = candidatesResult.all().map((c) => ({
      candidateId: c.id,
      runId: c.runId,
      extractionId: c.extractionId,
      pageRefs: c.pageRefsJson,
      spanOffset: { start: c.spanStart, end: c.spanEnd },
      mentionType: c.mentionType,
      normalizedLabel: c.normalizedLabel,
      selectedTextHash: c.selectedTextHash,
      spanHash: c.spanHash,
      confidence: c.confidence,
      status: c.status,
      targetSuggestion: c.targetSuggestionJson,
      warnings: c.warningsJson,
      candidateKey: c.candidateKey,
    }))

    // 加载来源提取引用
    const sourceExtractions = await this.sourceAdapter.getAvailableExtractions(
      organizationId,
      projectId,
      run.sourceExtractionIdsJson,
    )

    const scope = policy.resolveScope()
    const allowedActions: OcrEntityLinkPermissionAction[] = []
    if (scope === 'full') {
      allowedActions.push('view', 'manage', 'confirm', 'explain')
    } else if (scope === 'readonly') {
      allowedActions.push('view')
    }

    const warnings: OcrEntityLinkWarning[] = run.staleSummaryJson
      ? [
          {
            code: 'SOURCE_HASH_STALE',
            message: '来源文件可能已变更',
            severity: WARNING_SEVERITY.SOURCE_HASH_STALE,
          },
        ]
      : []

    return {
      run: this.runToSummary(run),
      sourceExtractions,
      candidates,
      targetKinds: run.targetKindsJson,
      allowedActions,
      warnings,
    }
  }

  /**
   * 列出项目的实体链接运行。
   */
  async listRuns(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    filters?: OcrEntityLinkListFilters,
  ): Promise<{
    data: OcrEntityLinkRunSummary[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    if (!policy.view()) {
      return { data: [], meta: { total: 0, page: 1, perPage: 20, totalPages: 0 } }
    }

    const p = filters?.page ?? 1
    const pp = filters?.perPage ?? 20

    let query = OcrEntityLinkRun.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('created_at', 'desc')

    if (filters?.status) {
      query = query.where('status', filters.status)
    }

    const result = await query.paginate(p, pp)

    const data = result.all().map((r) => this.runToSummary(r))
    return {
      data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: result.lastPage,
      },
    }
  }

  // ─── 预览与确认 ──────────────────────────────────────────────────────────

  /**
   * 预览候选链接——重新验证来源/目标新鲜度后返回确认预览。
   */
  async preview(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    runId: number,
    candidateId: number,
  ): Promise<OcrEntityLinkPreview> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertConfirm()

    const candidate = await OcrEntityLinkCandidateModel.query()
      .where('id', candidateId)
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!candidate) {
      throw new ResourceNotFoundException('候选实体链接未找到')
    }

    const run = await OcrEntityLinkRun.query()
      .where('id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!run) {
      throw new ResourceNotFoundException('实体链接运行未找到')
    }

    // 重新验证来源新鲜度
    const extraction = await this.sourceAdapter.getExtractionText(
      candidate.extractionId,
      organizationId,
      projectId,
    )

    if (extraction === null) {
      throw new ValidationException('来源提取已不可用（可能已过期或超集）', {
        code: 'EXTRACTION_SUPERSEDED',
      })
    }

    // 构建 advisory payload
    const target = candidate.targetSuggestionJson
    if (!target) {
      throw new ValidationException('该候选尚未匹配到目标，无法预览')
    }

    const advisoryPayload: OcrEntityLinkAdvisoryPayload = {
      organizationId,
      projectId,
      extractionId: candidate.extractionId,
      sourceHash: candidate.selectedTextHash, // 用 selectedTextHash 代理 sourceHash 验证
      selectedTextHash: candidate.selectedTextHash,
      spanHash: candidate.spanHash,
      targetKind: target.targetKind,
      targetId: target.targetId,
      normalizedLabel: candidate.normalizedLabel,
      confidence: candidate.confidence,
      matchReason: target.matchReason,
    }

    const previewHash = computeEntityLinkPreviewHash(advisoryPayload)

    // 重新验证目标可访问性
    const linkCtx: EntityLinkContext = { organizationId, projectId, actorId: run.actorId }
    let targetSummary: OcrEntityLinkTargetSummary | null = null
    try {
      const adapter = this.targetRegistry.get(target.targetKind)
      if (adapter) {
        targetSummary = await adapter.resolve(target.targetKind, target.targetId, linkCtx)
      }
    } catch {
      // 解析失败，使用已有 suggestion
    }

    const resolvedTarget: OcrEntityLinkTargetSuggestion = targetSummary
      ? {
          targetKind: target.targetKind,
          targetId: targetSummary.targetId,
          title: targetSummary.title,
          matchReason: target.matchReason,
          confidence: target.confidence,
          navigationRef: null,
          redacted: !targetSummary.isAccessible,
        }
      : { ...target, redacted: true, title: '[已脱敏]' }

    const previewWarnings = [...candidate.warningsJson]
    if (!targetSummary?.isAccessible) {
      previewWarnings.push('TARGET_INACCESSIBLE')
    }

    const redlineSummary: OcrEntityLinkRedlineSummary = {
      ...ENTITY_LINK_DEFAULT_REDLINE_SUMMARY,
    }

    return {
      runId,
      candidateId,
      sourceSpan: {
        extractionId: candidate.extractionId,
        sourceHash: candidate.selectedTextHash,
        selectedTextHash: candidate.selectedTextHash,
        spanHash: candidate.spanHash,
        pageRefs: candidate.pageRefsJson,
        spanOffset: { start: candidate.spanStart, end: candidate.spanEnd },
      },
      target: resolvedTarget,
      confidence: candidate.confidence,
      warnings: previewWarnings,
      advisoryLinkPayload: advisoryPayload,
      previewHash,
      requiresUserConfirmation: true,
      redlineSummary,
    }
  }

  /**
   * 确认 advisory link——验证后写入 OcrEntityLinkConfirmedLink。
   */
  async confirm(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    runId: number,
    candidateId: number,
    previewHash: string,
    reviewerId: number,
  ): Promise<OcrEntityLinkConfirmedLink> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertConfirm()

    const candidate = await OcrEntityLinkCandidateModel.query()
      .where('id', candidateId)
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!candidate) {
      throw new ResourceNotFoundException('候选实体链接未找到')
    }

    if (!candidate.targetSuggestionJson) {
      throw new ValidationException('该候选尚未匹配到目标，无法确认')
    }

    // 重新计算预览哈希以验证
    const target = candidate.targetSuggestionJson
    const advisoryPayload: OcrEntityLinkAdvisoryPayload = {
      organizationId,
      projectId,
      extractionId: candidate.extractionId,
      sourceHash: candidate.selectedTextHash,
      selectedTextHash: candidate.selectedTextHash,
      spanHash: candidate.spanHash,
      targetKind: target.targetKind,
      targetId: target.targetId,
      normalizedLabel: candidate.normalizedLabel,
      confidence: candidate.confidence,
      matchReason: target.matchReason,
    }

    const expectedHash = computeEntityLinkPreviewHash(advisoryPayload)
    if (previewHash !== expectedHash) {
      throw new ValidationException('预览哈希不匹配，请重新预览后再确认', {
        code: 'PREVIEW_HASH_MISMATCH',
      })
    }

    // 检查是否已有 active 的确认链接（防止重复确认）
    const existingActive = await OcrEntityLinkConfirmedLinkModel.query()
      .where('candidate_id', candidateId)
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('lifecycle_status', 'active')
      .first()

    if (existingActive) {
      throw new ValidationException('该候选已被确认', { code: 'DUPLICATE_CONFIRMED' })
    }

    const confirmedAt = new Date().toISOString()
    const confirmationHash = computeEntityLinkConfirmationHash(previewHash, reviewerId, confirmedAt)

    return db.transaction(async (trx) => {
      // 创建确认链接
      const link = new OcrEntityLinkConfirmedLinkModel()
      link.organizationId = organizationId
      link.projectId = projectId
      link.runId = runId
      link.candidateId = candidateId
      link.extractionId = candidate.extractionId
      link.sourceHash = candidate.selectedTextHash
      link.selectedTextHash = candidate.selectedTextHash
      link.spanHash = candidate.spanHash
      link.targetKind = target.targetKind
      link.targetId = target.targetId
      link.normalizedLabel = candidate.normalizedLabel
      link.confidence = candidate.confidence
      link.matchReason = target.matchReason
      link.ruleVersion = 'v1.0.0' // TODO: 从 run 获取
      link.reviewerId = reviewerId
      link.lifecycleStatus = 'active'
      link.confirmationHash = confirmationHash
      link.supersededById = null
      link.supersedeReason = null
      link.auditRef = null
      link.confirmedAt = db.raw('CURRENT_TIMESTAMP') as any
      await link.useTransaction(trx).save()

      // 更新运行上的确认计数
      const run = await OcrEntityLinkRun.query({ client: trx }).where('id', runId).first()
      if (run) {
        run.confirmedCount = (run.confirmedCount ?? 0) + 1
        await run.useTransaction(trx).save()
      }

      await this.audit(ctx, 'OCR_ENTITY_LINK_CONFIRMED', {
        linkId: link.id,
        candidateId,
        runId,
      })

      return {
        linkId: link.id,
        runId: link.runId,
        organizationId: link.organizationId,
        projectId: link.projectId,
        extractionId: link.extractionId,
        sourceHash: link.sourceHash,
        selectedTextHash: link.selectedTextHash,
        spanHash: link.spanHash,
        targetKind: link.targetKind,
        targetId: link.targetId,
        normalizedLabel: link.normalizedLabel,
        confidence: link.confidence,
        matchReason: link.matchReason,
        reviewerId: link.reviewerId,
        lifecycleStatus: link.lifecycleStatus,
        confirmationHash: link.confirmationHash,
        supersededById: link.supersededById,
        confirmedAt: confirmedAt,
        auditRef: link.auditRef ?? '',
      }
    })
  }

  /**
   * 取代已有的 advisory link（append-only supersede 语义）。
   */
  async supersede(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    linkId: number,
    reason: string,
    actorId: number,
  ): Promise<void> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertConfirm()

    const link = await OcrEntityLinkConfirmedLinkModel.query()
      .where('id', linkId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!link) {
      throw new ResourceNotFoundException('已确认的实体链接未找到')
    }

    if (link.lifecycleStatus !== 'active') {
      throw new ValidationException('只能取代活跃状态的链接')
    }

    await db.transaction(async (trx) => {
      // 创建新的 superseding 记录
      const superseding = new OcrEntityLinkConfirmedLinkModel()
      superseding.organizationId = link.organizationId
      superseding.projectId = link.projectId
      superseding.runId = link.runId
      superseding.candidateId = link.candidateId
      superseding.extractionId = link.extractionId
      superseding.sourceHash = link.sourceHash
      superseding.selectedTextHash = link.selectedTextHash
      superseding.spanHash = link.spanHash
      superseding.targetKind = link.targetKind
      superseding.targetId = link.targetId
      superseding.normalizedLabel = link.normalizedLabel
      superseding.confidence = link.confidence
      superseding.matchReason = link.matchReason
      superseding.ruleVersion = link.ruleVersion
      superseding.reviewerId = actorId
      superseding.lifecycleStatus = 'superseded'
      superseding.confirmationHash = '' // superseded 记录不需要 confirmation hash
      superseding.supersededById = linkId
      superseding.supersedeReason = reason
      superseding.auditRef = null
      superseding.confirmedAt = db.raw('CURRENT_TIMESTAMP') as any
      await superseding.useTransaction(trx).save()

      // 将原链接标记为 superseded
      link.lifecycleStatus = 'superseded'
      link.supersededAt = db.raw('CURRENT_TIMESTAMP') as any
      await link.useTransaction(trx).save()

      await this.audit(ctx, 'OCR_ENTITY_LINK_SUPERSEDED', {
        linkId,
        supersededById: superseding.id,
        reason,
      })
    })
  }

  /**
   * 拒绝 advisory link。
   */
  async reject(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    linkId: number,
    reason: string,
    _actorId: number,
  ): Promise<void> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertConfirm()

    const link = await OcrEntityLinkConfirmedLinkModel.query()
      .where('id', linkId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!link) {
      throw new ResourceNotFoundException('已确认的实体链接未找到')
    }

    if (link.lifecycleStatus !== 'active') {
      throw new ValidationException('只能拒绝活跃状态的链接')
    }

    await db.transaction(async (trx) => {
      link.lifecycleStatus = 'rejected'
      link.supersedeReason = reason
      link.supersededAt = db.raw('CURRENT_TIMESTAMP') as any
      await link.useTransaction(trx).save()

      await this.audit(ctx, 'OCR_ENTITY_LINK_REJECTED', {
        linkId,
        reason,
      })
    })
  }

  // ─── AI 解释（确定性降级） ──────────────────────────────────────────────

  /**
   * 返回候选链接的确定性解释（无 AI 调用）。
   *
   * 本项目不调用真实 AI 模型——始终返回确定性降级文本。
   */
  async explain(
    ctx: HttpContext,
    organizationId: number,
    projectId: number,
    runId: number,
    candidateId: number,
  ): Promise<OcrEntityLinkExplanation> {
    const policy = new OcrEntityLinkingPolicy(ctx)
    policy.assertExplain()

    const candidate = await OcrEntityLinkCandidateModel.query()
      .where('id', candidateId)
      .where('run_id', runId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!candidate) {
      throw new ResourceNotFoundException('候选实体链接未找到')
    }

    const target = candidate.targetSuggestionJson
    const mentionTypeLabel: Record<OcrEntityMentionType, string> = {
      task_ref: '任务引用',
      wbs_ref: 'WBS 节点引用',
      milestone_ref: '里程碑引用',
      risk_ref: '风险引用',
      person_name: '人名',
      organization_name: '组织名称',
      project_name: '项目名称',
      date_expression: '日期表达式',
      amount_expression: '金额表达式',
      file_ref: '文件引用',
      attachment_ref: '附件引用',
      custom_label: '自定义标签',
    }

    const matchReasonLabel: Record<OcrMatchReason, string> = {
      exact_label: '完全匹配',
      normalized_label: '规范化匹配',
      alias: '别名匹配',
      fuzzy: '模糊匹配',
      custom_rule: '自定义规则',
    }

    const mentionLabel = mentionTypeLabel[candidate.mentionType] ?? candidate.mentionType
    const reasonLabel = target
      ? (matchReasonLabel[target.matchReason] ?? target.matchReason)
      : '未匹配'

    let text = `在 OCR 提取文本中检测到${mentionLabel}「${candidate.normalizedLabel}」。`

    if (target) {
      text += ` 此实体经${reasonLabel}关联到${target.targetKind === 'task' ? '任务' : target.targetKind === 'wbs_node' ? 'WBS 节点' : target.targetKind === 'milestone' ? '里程碑' : target.targetKind === 'risk' ? '风险' : target.targetKind}「${target.title}」（ID: ${target.targetId}）。`
      text += ` 匹配置信度: ${(candidate.confidence * 100).toFixed(0)}%。`
    } else {
      text += ` 未找到匹配的项目实体。`
    }

    if (candidate.warningsJson.length > 0) {
      text += ` 警告: ${candidate.warningsJson.join(', ')}。`
    }

    return {
      runId,
      candidateId,
      text,
      isFallback: true,
      degradedReason: 'AI 解释功能尚未集成，此解释为确定性规则生成',
    }
  }

  // ─── 内部辅助 ────────────────────────────────────────────────────────────

  private runToSummary(run: OcrEntityLinkRun): OcrEntityLinkRunSummary {
    return {
      runId: run.id,
      organizationId: run.organizationId,
      projectId: run.projectId,
      actorId: run.actorId,
      inputSignature: run.inputSignature,
      ruleVersion: run.ruleVersion,
      status: run.status,
      candidateCount: run.candidateCount,
      confirmedCount: run.confirmedCount,
      staleSummary: run.staleSummaryJson,
      createdAt: run.createdAt.toISO() ?? '',
      updatedAt: run.updatedAt?.toISO() ?? null,
    }
  }

  private async saveCandidate(
    runId: number,
    organizationId: number,
    projectId: number,
    extraction: OcrEntityLinkSourceExtractionRef,
    mention: {
      mentionType: OcrEntityMentionType
      normalizedLabel: string
      spanStart: number
      spanEnd: number
      confidence: number
    },
    targetSuggestion: OcrEntityLinkTargetSuggestion | null,
    warnings: OcrEntityLinkWarningCode[],
  ): Promise<OcrEntityLinkCandidateModel> {
    const spanHash = `${extraction.extractionId}:${mention.spanStart}:${mention.spanEnd}`

    const candidateKey = this.computeCandidateKey(
      extraction.extractionId,
      extraction.pageRefs,
      mention.spanStart,
      mention.spanEnd,
      mention.mentionType,
      mention.normalizedLabel,
    )

    const candidate = new OcrEntityLinkCandidateModel()
    candidate.organizationId = organizationId
    candidate.projectId = projectId
    candidate.runId = runId
    candidate.extractionId = extraction.extractionId
    candidate.pageRefsJson = extraction.pageRefs
    candidate.spanStart = mention.spanStart
    candidate.spanEnd = mention.spanEnd
    candidate.mentionType = mention.mentionType
    candidate.normalizedLabel = mention.normalizedLabel
    candidate.selectedTextHash = extraction.selectedTextHash
    candidate.spanHash = spanHash
    candidate.confidence = mention.confidence
    candidate.status = targetSuggestion ? 'matched' : 'unmatched'
    candidate.targetSuggestionJson = targetSuggestion
    candidate.warningsJson = warnings
    candidate.candidateKey = candidateKey
    await candidate.save()

    return candidate
  }

  private computeCandidateKey(
    extractionId: number,
    pageRefs: number[],
    spanStart: number,
    spanEnd: number,
    mentionType: OcrEntityMentionType,
    normalizedLabel: string,
  ): string {
    // Simple stable key without importing from @aiproj/types (which needs a slightly different shape)
    const parts = [
      extractionId,
      ...pageRefs.slice().sort((a, b) => a - b),
      spanStart,
      spanEnd,
      mentionType,
      normalizedLabel,
    ]
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    const input = parts.join('|')
    for (let i = 0; i < input.length; i++) {
      const ch = input.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
  }

  /**
   * 将 mentionType 映射到可用的 targetKinds。
   */
  private mentionTypeToTargetKinds(mentionType: OcrEntityMentionType): OcrTargetKind[] {
    const map: Record<OcrEntityMentionType, OcrTargetKind[]> = {
      task_ref: ['task'],
      wbs_ref: ['wbs_node'],
      milestone_ref: ['milestone'],
      risk_ref: ['risk'],
      person_name: ['project_member'],
      organization_name: [],
      project_name: ['project'],
      date_expression: ['milestone', 'task'],
      amount_expression: [],
      file_ref: ['file'],
      attachment_ref: ['attachment', 'file'],
      custom_label: [],
    }
    return map[mentionType] ?? []
  }

  /**
   * 轻量级审计——仅记录低敏感元数据。
   */
  private async audit(
    _ctx: HttpContext,
    action: string,
    meta: Record<string, unknown>,
  ): Promise<void> {
    try {
      logger.info({ action, ...meta }, '[EntityLink Audit]')
      // 在审计服务中注册对应事件后可启用落库
      // await AuditService.log(ctx, action, meta)
    } catch {
      // 审计失败不应阻塞主流程
    }
  }
}
