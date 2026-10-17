import { inject } from '@adonisjs/core'
import { ValidationException, ResourceNotFoundException } from '#exceptions/api_exception'
import OkrProgressBackflowSuggestion from '#models/okr_progress_backflow_suggestion'
import OkrProgressBackflowSourceSnapshot from '#models/okr_progress_backflow_source_snapshot'
import OkrKeyResult from '#models/okr_key_result'
import OkrObjective from '#models/okr_objective'
import OkrEvidenceLink from '#models/okr_evidence_link'
import OkrProgressHistory from '#models/okr_progress_history'
import OkrPolicy from '#policies/okr_policy'
import type User from '#models/user'
import { DateTime } from 'luxon'
import type {
  OkrBackflowSuggestion,
  OkrBackflowContribution,
  OkrBackflowSourceRef,
  OkrBackflowWarning,
  OkrBackflowListQuery,
  OkrBackflowSuggestionStatus,
  OkrBackflowReasonCode,
} from '@aiproj/types'
import {
  computeBackflowSuggestionHash,
  computeBackflowDelta,
  computeBackflowFreshness,
  normalizeBackflowContributionWeights,
  clampBackflowProgress,
  makeRestrictedSourceWarning,
  makeSourceUnavailableWarning,
  makeStaleSourceWarning,
  makeCancelledProjectWarning,
  makePausedProjectWarning,
  makeManualOverrideWarning,
  makeRecentManualUpdateWarning,
  makeNestedSourceDedupWarning,
  OKR_BACKFLOW_DEFAULTS,
} from '@aiproj/types'

// ── DTO helpers ─────────────────────────────────────────────────────────────

function toSuggestionDto(row: OkrProgressBackflowSuggestion): OkrBackflowSuggestion {
  return {
    id: row.id,
    organizationId: row.organizationId,
    keyResultId: row.keyResultId,
    proposedValue: row.proposedValue,
    currentValue: row.currentValue,
    delta: row.delta,
    contributions: row.contributionsJson ? JSON.parse(row.contributionsJson) : [],
    confidence: row.confidence as OkrBackflowSuggestion['confidence'],
    status: row.status as OkrBackflowSuggestionStatus,
    warnings: row.warningsJson ? JSON.parse(row.warningsJson) : [],
    suggestionHash: row.suggestionHash,
    baseProgressVersion: row.baseProgressVersion,
    freshness: row.freshnessJson
      ? JSON.parse(row.freshnessJson)
      : { oldestSourceUpdatedAt: null, newestSourceUpdatedAt: null, stale: true },
    calculatedAt:
      row.calculatedAt instanceof DateTime ? row.calculatedAt.toISO()! : String(row.calculatedAt),
    reasonCode: row.reasonCode as OkrBackflowReasonCode | null,
    reasonNote: row.reasonNote,
    actorId: row.actorId,
    actionedAt:
      row.actionedAt instanceof DateTime
        ? row.actionedAt.toISO()!
        : row.actionedAt
          ? String(row.actionedAt)
          : null,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
  }
}

function makeMeta(total: number, page: number, perPage: number) {
  return { total, page, perPage, totalPages: Math.ceil(total / perPage) }
}

// ── Service ─────────────────────────────────────────────────────────────────

@inject()
export default class OkrProgressBackflowService {
  constructor(private readonly okrPolicy: OkrPolicy) {}

  // ══════════════════════════════════════════════════════════════════════
  // Recalculate
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 重算单个 KR 的回流建议。只生成建议，不写 KR 当前值。
   * 返回低敏 suggestion 数据供前端预览与用户确认。
   */
  async recalculateKeyResult(
    organizationId: number,
    keyResultId: number,
    user: User,
  ): Promise<OkrBackflowSuggestion> {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
    await this.okrPolicy.authorizeView(user, organizationId)

    const kr = await OkrKeyResult.find(keyResultId)
    if (!kr || kr.deletedAt) throw new ValidationException('关键结果不存在')
    if (kr.organizationId !== organizationId) throw new ResourceNotFoundException('关键结果不存在')

    // 生命周期检查
    if (kr.status === 'archived') {
      throw new ValidationException('已归档的关键结果不支持回流计算')
    }

    // 收集执行源
    const { sources, warnings } = await this.collectSources(organizationId, kr, user)

    // 非受限源的贡献和 aggregate
    const contributingSources = sources.filter((s) => !s.restricted)
    const unavailableSources = sources.filter((s) => s.restricted)

    if (contributingSources.length === 0 && unavailableSources.length > 0) {
      // 全部受限
      const suggestion = this.buildEmptySuggestion(kr, warnings, 'low')
      return this.persistSuggestion(suggestion)
    }

    if (contributingSources.length === 0) {
      const suggestion = this.buildEmptySuggestion(kr, warnings, 'low')
      return this.persistSuggestion(suggestion)
    }

    // 归一化权重
    const contributions: OkrBackflowContribution[] = contributingSources.map((s) => ({
      source: {
        kind: s.kind,
        id: s.sourceId,
        organizationId: s.sourceOrganizationId,
        weight: s.weight,
        progress: s.progress,
        lastUpdatedAt: s.sourceLastUpdatedAt,
      },
      contributedValue: s.progress,
      weightedValue: 0,
    }))
    const normalized = normalizeBackflowContributionWeights(contributions)

    // 计算聚合建议值
    const rawProposedValue = normalized.reduce((sum, c) => sum + c.weightedValue, 0)
    const proposedValue = clampBackflowProgress(rawProposedValue, kr.measurementType as any)

    const delta = computeBackflowDelta(proposedValue, kr.currentValue)
    const sourceRefs: OkrBackflowSourceRef[] = contributingSources.map((s) => ({
      kind: s.kind as any,
      id: s.sourceId,
      organizationId: s.sourceOrganizationId,
      weight: s.weight,
      progress: s.progress,
      lastUpdatedAt: s.sourceLastUpdatedAt,
    }))
    const freshness = computeBackflowFreshness(sourceRefs)
    const baseProgressVersion = String(
      kr.updatedAt instanceof DateTime ? kr.updatedAt.toMillis() : Date.now(),
    )
    const suggestionHash = computeBackflowSuggestionHash(
      kr.id,
      proposedValue,
      normalized,
      baseProgressVersion,
    )

    // 检查手动覆盖
    const progressHistory = await OkrProgressHistory.query()
      .where('key_result_id', kr.id)
      .orderBy('recorded_at', 'desc')
      .limit(5)

    const hasManualOverride = progressHistory.some((h) => h.source === 'manual')
    const recentManualUpdate = progressHistory.some((h) => {
      if (h.source !== 'manual') return false
      const age =
        Date.now() -
        (h.recordedAt instanceof DateTime
          ? h.recordedAt.toMillis()
          : new Date(h.recordedAt).getTime())
      return age < 24 * 60 * 60 * 1000 // 24h
    })

    if (hasManualOverride) {
      warnings.push(makeManualOverrideWarning())
    }
    if (recentManualUpdate) {
      warnings.push(makeRecentManualUpdateWarning())
    }

    // 确定建议状态
    let status: OkrBackflowSuggestionStatus = 'pending'
    if (hasManualOverride || recentManualUpdate) {
      status = 'needs_review'
    }
    if (freshness.stale) {
      status = 'needs_review'
    }

    const suggestion: OkrBackflowSuggestion = {
      id: 0, // placeholder, assigned after persist
      organizationId,
      keyResultId: kr.id,
      proposedValue,
      currentValue: kr.currentValue,
      delta,
      contributions: normalized,
      confidence: (kr.confidence || 'medium') as any,
      status,
      warnings,
      suggestionHash,
      baseProgressVersion,
      freshness,
      calculatedAt: new Date().toISOString(),
      reasonCode: null,
      reasonNote: null,
      actorId: null,
      actionedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    return this.persistSuggestion(suggestion)
  }

  // ══════════════════════════════════════════════════════════════════════
  // List
  // ══════════════════════════════════════════════════════════════════════

  async listSuggestions(organizationId: number, query: OkrBackflowListQuery, user: User) {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
    await this.okrPolicy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? OKR_BACKFLOW_DEFAULTS.DEFAULT_PAGE_SIZE
    const sort = query.sort ?? 'calculatedAt'
    const order = query.order ?? 'desc'

    let q = OkrProgressBackflowSuggestion.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')

    if (query.keyResultId) q = q.where('key_result_id', query.keyResultId)
    if (query.status) q = q.where('status', query.status)
    if (query.objectiveId) {
      // Filter by objective via subquery
      const krIds = await OkrKeyResult.query()
        .where('objective_id', query.objectiveId)
        .whereNull('deleted_at')
        .select('id')
      q = q.whereIn(
        'key_result_id',
        krIds.map((k) => k.id),
      )
    }
    if (query.cycleId) {
      const objIds = await OkrObjective.query()
        .where('cycle_id', query.cycleId)
        .whereNull('deleted_at')
        .select('id')
      const krIds = await OkrKeyResult.query()
        .whereIn(
          'objective_id',
          objIds.map((o) => o.id),
        )
        .whereNull('deleted_at')
        .select('id')
      q = q.whereIn(
        'key_result_id',
        krIds.map((k) => k.id),
      )
    }

    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy(sort, order)
      .offset((page - 1) * perPage)
      .limit(perPage)

    const data = rows.map(toSuggestionDto)
    // Apply in-memory warning filter
    const filtered = query.warningCode
      ? data.filter((s) => s.warnings.some((w) => w.code === query.warningCode))
      : data

    return { data: filtered, meta: makeMeta(total, page, perPage) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Detail
  // ══════════════════════════════════════════════════════════════════════

  async getSuggestion(organizationId: number, suggestionId: number, user: User) {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
    await this.okrPolicy.authorizeView(user, organizationId)

    const suggestion = await OkrProgressBackflowSuggestion.find(suggestionId)
    if (!suggestion || suggestion.deletedAt) throw new ValidationException('回流建议不存在')
    if (suggestion.organizationId !== organizationId)
      throw new ResourceNotFoundException('回流建议不存在')

    const snapshots = await OkrProgressBackflowSourceSnapshot.query()
      .where('suggestion_id', suggestionId)
      .orderBy('source_kind', 'asc')

    return {
      data: {
        ...toSuggestionDto(suggestion),
        sourceSnapshots: snapshots.map((s) => ({
          id: s.id,
          sourceKind: s.sourceKind,
          sourceId: s.sourceId,
          sourceOrganizationId: s.sourceOrganizationId,
          weight: s.weight,
          progress: s.progress,
          sourceLastUpdatedAt:
            s.sourceLastUpdatedAt instanceof DateTime
              ? s.sourceLastUpdatedAt.toISO()!
              : String(s.sourceLastUpdatedAt),
          restricted: s.restricted,
        })),
      },
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Batch Recalculate
  // ══════════════════════════════════════════════════════════════════════

  async batchRecalculate(
    organizationId: number,
    scope: 'objective' | 'cycle',
    scopeId: number,
    maxKrCount: number,
    user: User,
  ) {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
    await this.okrPolicy.authorizeView(user, organizationId)

    const maxCount = Math.min(
      maxKrCount ?? OKR_BACKFLOW_DEFAULTS.MAX_KR_PER_BATCH,
      OKR_BACKFLOW_DEFAULTS.MAX_KR_PER_BATCH,
    )

    let krIds: number[]
    if (scope === 'objective') {
      const objective = await OkrObjective.find(scopeId)
      if (!objective || objective.deletedAt || objective.organizationId !== organizationId) {
        throw new ValidationException('目标不存在')
      }
      const krs = await OkrKeyResult.query()
        .where('objective_id', scopeId)
        .whereNull('deleted_at')
        .select('id')
        .limit(maxCount)
      krIds = krs.map((k) => k.id)
    } else {
      const cycleObjectives = await OkrObjective.query()
        .where('cycle_id', scopeId)
        .whereNull('deleted_at')
        .select('id')
      const krs = await OkrKeyResult.query()
        .whereIn(
          'objective_id',
          cycleObjectives.map((o) => o.id),
        )
        .whereNull('deleted_at')
        .select('id')
        .limit(maxCount)
      krIds = krs.map((k) => k.id)
    }

    const results: OkrBackflowSuggestion[] = []
    const partialFailures: Array<{ keyResultId: number; reason: string }> = []

    for (const krId of krIds) {
      try {
        const suggestion = await this.recalculateKeyResult(organizationId, krId, user)
        results.push(suggestion)
      } catch (err: any) {
        partialFailures.push({ keyResultId: krId, reason: err.message || '计算失败' })
      }
    }

    return {
      data: results,
      meta: {
        total: krIds.length,
        page: 1,
        perPage: krIds.length,
        totalPages: 1,
        recalculatedCount: results.length,
        partialFailureCount: partialFailures.length,
        partialFailures: partialFailures.length > 0 ? partialFailures : undefined,
      },
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Confirm
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 确认回流建议，写入 KR 进度。做以下检查：
   * - RBAC/organization 隔离
   * - KR 生命周期检查
   * - 建议状态检查（不是 already confirmed/rejected/stale）
   * - base progress version / suggestion hash 检查（并发安全）
   * - 幂等性检查
   */
  async confirmSuggestion(
    organizationId: number,
    suggestionId: number,
    note: string | null,
    user: User,
  ): Promise<OkrBackflowSuggestion> {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
    await this.okrPolicy.authorizeProgress(user, organizationId)

    const suggestion = await OkrProgressBackflowSuggestion.find(suggestionId)
    if (!suggestion || suggestion.deletedAt) throw new ValidationException('回流建议不存在')
    if (suggestion.organizationId !== organizationId)
      throw new ResourceNotFoundException('回流建议不存在')

    // 状态检查
    if (suggestion.status === 'confirmed') {
      // 幂等：已确认则直接返回（不重复写入）
      return toSuggestionDto(suggestion)
    }
    if (suggestion.status === 'rejected') {
      throw new ValidationException('已拒绝的回流建议不能确认')
    }
    if (suggestion.status === 'stale') {
      throw new ValidationException('已过期的回流建议不能确认')
    }

    // KR 验证
    const kr = await OkrKeyResult.find(suggestion.keyResultId)
    if (!kr || kr.deletedAt) throw new ValidationException('关联关键结果不存在')
    if (kr.organizationId !== organizationId) throw new ResourceNotFoundException('关键结果不存在')

    // 生命周期检查
    if (kr.status === 'archived' || kr.status === 'completed') {
      throw new ValidationException('已关闭的关键结果不支持回流确认')
    }

    // Base progress version 检查
    const currentBaseVersion = String(
      kr.updatedAt instanceof DateTime ? kr.updatedAt.toMillis() : Date.now(),
    )
    if (suggestion.baseProgressVersion !== currentBaseVersion) {
      // Mark as stale, reject confirmation
      suggestion.status = 'stale'
      await suggestion.save()
      throw new ValidationException('KR 进度在建议生成后已被更新，请重新计算回流建议')
    }

    // Suggestion hash 检查
    const contributions = suggestion.contributionsJson
      ? JSON.parse(suggestion.contributionsJson)
      : []
    const expectedHash = computeBackflowSuggestionHash(
      kr.id,
      suggestion.proposedValue,
      contributions,
      suggestion.baseProgressVersion,
    )
    if (suggestion.suggestionHash !== expectedHash) {
      suggestion.status = 'stale'
      await suggestion.save()
      throw new ValidationException('建议 hash 不匹配，请重新计算回流建议')
    }

    // 写入 KR 当前值（经过既有 progress 路径）
    const previousValue = kr.currentValue
    kr.currentValue = suggestion.proposedValue
    kr.confidence = suggestion.confidence || kr.confidence
    kr.lastUpdatedAt = DateTime.now()
    await kr.save()

    // 写入进度历史（标记来源为 backflow）
    await OkrProgressHistory.create({
      organizationId: kr.organizationId,
      keyResultId: kr.id,
      previousValue,
      newValue: suggestion.proposedValue,
      source: 'backflow',
      confidence: suggestion.confidence || kr.confidence,
      note: note || null,
      evidenceRefs: null,
      recordedBy: user.id,
      recordedAt: DateTime.now(),
    })

    // Objective rollup 重算
    const objective = await OkrObjective.find(kr.objectiveId)
    if (objective) {
      const allKrs = await OkrKeyResult.query()
        .where('objective_id', objective.id)
        .whereNull('deleted_at')
      const krsForRollup = allKrs.map((k) => ({
        id: k.id,
        organizationId: k.organizationId,
        objectiveId: k.objectiveId,
        title: k.title,
        description: k.description,
        measurementType: k.measurementType,
        unitLabel: k.unitLabel,
        baselineValue: k.baselineValue,
        targetValue: k.targetValue,
        currentValue: k.currentValue,
        confidence: k.confidence,
        status: k.status,
        weight: k.weight,
        lastUpdatedAt: null,
        createdAt: '',
        updatedAt: '',
        deletedAt: null,
      }))
      const { computeOkrRollup } = await import('@aiproj/types')
      const rollup = computeOkrRollup(krsForRollup as any, [])
      objective.progress = rollup.progress
      objective.confidence = rollup.confidence
      objective.calculatedAt = DateTime.now()
      await objective.save()
    }

    // 更新建议状态
    suggestion.status = 'confirmed'
    suggestion.actorId = user.id
    suggestion.actionedAt = DateTime.now()
    await suggestion.save()

    return toSuggestionDto(suggestion)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Reject
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 拒绝回流建议。不会修改 KR 当前值和进度历史。
   */
  async rejectSuggestion(
    organizationId: number,
    suggestionId: number,
    reasonCode: OkrBackflowReasonCode,
    reasonNote: string,
    user: User,
  ): Promise<OkrBackflowSuggestion> {
    await this.okrPolicy.assertOrganizationVisible(user, organizationId)
    await this.okrPolicy.authorizeProgress(user, organizationId)

    const suggestion = await OkrProgressBackflowSuggestion.find(suggestionId)
    if (!suggestion || suggestion.deletedAt) throw new ValidationException('回流建议不存在')
    if (suggestion.organizationId !== organizationId)
      throw new ResourceNotFoundException('回流建议不存在')

    // 状态检查
    if (suggestion.status === 'confirmed') {
      throw new ValidationException('已确认的回流建议不能拒绝')
    }
    if (suggestion.status === 'rejected') {
      // 幂等：已拒绝则直接返回
      return toSuggestionDto(suggestion)
    }

    // 更新建议状态
    suggestion.status = 'rejected'
    suggestion.reasonCode = reasonCode
    suggestion.reasonNote = reasonNote.substring(0, OKR_BACKFLOW_DEFAULTS.MAX_REASON_NOTE_LENGTH)
    suggestion.actorId = user.id
    suggestion.actionedAt = DateTime.now()
    await suggestion.save()

    return toSuggestionDto(suggestion)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Collect Sources (internal)
  // ══════════════════════════════════════════════════════════════════════

  private async collectSources(
    organizationId: number,
    kr: OkrKeyResult,
    user: User,
  ): Promise<{
    sources: InternalSourceSnapshot[]
    warnings: OkrBackflowWarning[]
  }> {
    const sources: InternalSourceSnapshot[] = []
    const warnings: OkrBackflowWarning[] = []

    // 获取该 KR 关联的 evidence links
    const evidenceLinks = await OkrEvidenceLink.query()
      .where('target_type', 'key_result')
      .where('target_id', kr.id)
      .whereNull('deleted_at')

    if (evidenceLinks.length === 0) {
      // 无直接 evidence，尝试通过 objective 的 evidence 查找
      const objLinks = await OkrEvidenceLink.query()
        .where('target_type', 'objective')
        .where('target_id', kr.objectiveId)
        .whereNull('deleted_at')

      for (const link of objLinks) {
        await this.collectSourceFromEvidence(organizationId, link, sources, warnings, user)
      }

      // 也检查 objective 关联的项目
      const objective = await OkrObjective.find(kr.objectiveId)
      if (objective?.projectId) {
        await this.collectProjectSource(
          organizationId,
          objective.projectId,
          sources,
          warnings,
          user,
        )
      }

      return { sources, warnings }
    }

    // 收集每个 evidence link 对应的源
    const sourceMap = new Map<string, InternalSourceSnapshot>()
    for (const link of evidenceLinks) {
      const key = `${link.sourceKind}:${link.sourceId}`
      if (sourceMap.has(key)) continue

      await this.collectSourceFromEvidence(organizationId, link, sources, warnings, user)
      sourceMap.set(key, sources[sources.length - 1])
    }

    // 嵌套源去重：按 precedence 保留最高优先级
    const deduped = this.deduplicateNestedSources(sources)
    if (deduped.length < sources.length) {
      warnings.push(makeNestedSourceDedupWarning())
    }

    return { sources: deduped, warnings }
  }

  private async collectSourceFromEvidence(
    organizationId: number,
    link: OkrEvidenceLink,
    sources: InternalSourceSnapshot[],
    warnings: OkrBackflowWarning[],
    user: User,
  ) {
    switch (link.sourceKind) {
      case 'project':
        await this.collectSourceData(
          'project',
          link.sourceId,
          organizationId,
          sources,
          warnings,
          user,
        )
        break
      case 'milestone':
        await this.collectSourceData(
          'milestone',
          link.sourceId,
          organizationId,
          sources,
          warnings,
          user,
        )
        break
      case 'task':
        await this.collectSourceData('task', link.sourceId, organizationId, sources, warnings, user)
        break
      default:
        warnings.push(makeSourceUnavailableWarning(link.sourceKind as any))
    }
  }

  private async collectSourceData(
    kind: string,
    sourceId: number,
    organizationId: number,
    sources: InternalSourceSnapshot[],
    warnings: OkrBackflowWarning[],
    _user: User,
  ) {
    try {
      let sourceOrgId = organizationId
      let progress = 0
      let lastUpdatedAt = new Date().toISOString()
      let restricted = false

      switch (kind) {
        case 'project': {
          const { default: ProjectModel } = await import('#models/project')
          const project = await ProjectModel.find(sourceId)
          if (!project || (project as any).deleted_at) {
            warnings.push(makeSourceUnavailableWarning('project'))
            return
          }
          sourceOrgId = (project as any).organizationId
          // 跨组织检查
          if (sourceOrgId !== organizationId) {
            restricted = true
            warnings.push(makeRestrictedSourceWarning())
            return
          }
          // 项目状态检查
          if (project.status === 'cancelled') {
            warnings.push(makeCancelledProjectWarning())
          } else if (project.status === 'paused') {
            warnings.push(makePausedProjectWarning())
          }
          // 从项目元数据获取 progress（若有）
          progress = (project as any).progress ?? 0
          lastUpdatedAt =
            project.updatedAt instanceof DateTime
              ? project.updatedAt.toISO()!
              : String(project.updatedAt)
          break
        }
        case 'milestone': {
          const { default: MilestoneModel } = await import('#models/milestone')
          const milestone = await MilestoneModel.find(sourceId)
          if (!milestone) {
            warnings.push(makeSourceUnavailableWarning('milestone'))
            return
          }
          sourceOrgId = (milestone as any).organizationId ?? organizationId
          if (sourceOrgId !== organizationId) {
            restricted = true
            warnings.push(makeRestrictedSourceWarning())
            return
          }
          if (milestone.status === 'achieved') progress = 100
          else if (milestone.status === 'missed') progress = 0
          else progress = 50 // planned/at_risk/not_started
          lastUpdatedAt =
            milestone.updatedAt instanceof DateTime
              ? milestone.updatedAt.toISO()!
              : String(milestone.updatedAt)
          break
        }
        case 'task': {
          const { default: TaskModel } = await import('#models/task')
          const task = await TaskModel.find(sourceId)
          if (!task || (task as any).deleted_at) {
            warnings.push(makeSourceUnavailableWarning('task'))
            return
          }
          sourceOrgId = (task as any).organizationId ?? organizationId
          if (sourceOrgId !== organizationId) {
            restricted = true
            warnings.push(makeRestrictedSourceWarning())
            return
          }
          // task progress: completed = 100, in progress 按实际进度
          if ((task as any).status === 'completed') progress = 100
          else if ((task as any).progress !== undefined) progress = (task as any).progress
          else progress = 0
          lastUpdatedAt =
            task.updatedAt instanceof DateTime ? task.updatedAt.toISO()! : String(task.updatedAt)
          break
        }
      }

      // 陈旧检查
      const age = Date.now() - new Date(lastUpdatedAt).getTime()
      if (age > OKR_BACKFLOW_DEFAULTS.STALE_THRESHOLD_MS) {
        warnings.push(makeStaleSourceWarning(kind as any))
      }

      // 同一个 (kind, sourceId) 只计一次。DB 的 UNIQUE 约束只保证「同一 target 下不出现
      // 重复 evidence link」，管不住「KR 与其 objective 各挂一条指向同一项目」这类跨 target
      // 的重复；一旦哪条收集路径同时走到两边，进度就会被重复计入而虚高。这里做最终守卫。
      if (sources.some((s) => s.kind === (kind as any) && s.sourceId === sourceId)) {
        return
      }

      sources.push({
        kind: kind as any,
        sourceId,
        sourceOrganizationId: sourceOrgId,
        weight: 100,
        progress,
        sourceLastUpdatedAt: lastUpdatedAt,
        restricted,
      })
    } catch {
      warnings.push(makeSourceUnavailableWarning(kind as any))
    }
  }

  private async collectProjectSource(
    organizationId: number,
    projectId: number,
    sources: InternalSourceSnapshot[],
    warnings: OkrBackflowWarning[],
    user: User,
  ) {
    await this.collectSourceData('project', projectId, organizationId, sources, warnings, user)
  }

  /**
   * 嵌套源去重：同一执行事实的 multi-layer 来源按 precedence 保留最高优先级。
   * 简化规则：project 下包含 milestone（milestone 属于该 project 时，保留 project 级）。
   */
  private deduplicateNativeSources(sources: InternalSourceSnapshot[]): InternalSourceSnapshot[] {
    // 按 sourceKind precedence 排序
    const precedence = { project: 3, milestone: 2, task: 1 }
    const sorted = [...sources].sort((a, b) => precedence[b.kind] - precedence[a.kind])
    // 去重：如果已有更高优先级的同 ID 源，跳过
    const seen = new Set<string>()
    return sorted.filter((s) => {
      const key = `${s.kind}:${s.sourceId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private deduplicateNestedSources(sources: InternalSourceSnapshot[]): InternalSourceSnapshot[] {
    return this.deduplicateNativeSources(sources)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Persist (internal)
  // ══════════════════════════════════════════════════════════════════════

  private async persistSuggestion(s: OkrBackflowSuggestion): Promise<OkrBackflowSuggestion> {
    const row = await OkrProgressBackflowSuggestion.create({
      organizationId: s.organizationId,
      keyResultId: s.keyResultId,
      proposedValue: s.proposedValue,
      currentValue: s.currentValue,
      delta: s.delta,
      contributionsJson: JSON.stringify(s.contributions),
      confidence: s.confidence,
      status: s.status,
      warningsJson: s.warnings.length > 0 ? JSON.stringify(s.warnings) : null,
      suggestionHash: s.suggestionHash,
      baseProgressVersion: s.baseProgressVersion,
      freshnessJson: JSON.stringify(s.freshness),
      calculatedAt: DateTime.now(),
    })

    // 持久化 source snapshots
    for (const c of s.contributions) {
      const src = c.source
      await OkrProgressBackflowSourceSnapshot.create({
        organizationId: s.organizationId,
        suggestionId: row.id,
        sourceKind: src.kind,
        sourceId: src.id,
        sourceOrganizationId: src.organizationId,
        weight: src.weight,
        progress: src.progress,
        sourceLastUpdatedAt: DateTime.fromISO(src.lastUpdatedAt),
        restricted: false,
      })
    }

    return { ...s, id: row.id, createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) }
  }

  private buildEmptySuggestion(
    kr: OkrKeyResult,
    warnings: OkrBackflowWarning[],
    confidence: OkrBackflowSuggestion['confidence'],
  ): OkrBackflowSuggestion {
    return {
      id: 0,
      organizationId: kr.organizationId,
      keyResultId: kr.id,
      proposedValue: kr.currentValue,
      currentValue: kr.currentValue,
      delta: 0,
      contributions: [],
      confidence,
      status: 'stale',
      warnings,
      suggestionHash: '',
      baseProgressVersion: '1',
      freshness: { oldestSourceUpdatedAt: null, newestSourceUpdatedAt: null, stale: true },
      calculatedAt: new Date().toISOString(),
      reasonCode: null,
      reasonNote: null,
      actorId: null,
      actionedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }
}

// Internal type for source collection
interface InternalSourceSnapshot {
  kind: 'project' | 'milestone' | 'task'
  sourceId: number
  sourceOrganizationId: number
  weight: number
  progress: number
  sourceLastUpdatedAt: string
  restricted: boolean
}
