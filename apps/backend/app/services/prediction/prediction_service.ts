/**
 * ProjectPredictionService —— 风险与进度预测核心服务。
 *
 * 创建快照、列表、读取、过期检测、确认和清除操作。
 * 红线：不修改任何正式业务数据（任务、资源、风险等）
 *
 * v2-ai-risk-progress-prediction / design D3
 */
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import AuditService, { AuditEvent } from '#services/audit_service'
import ProjectPredictionSnapshot from '#models/project_prediction_snapshot'
import ProjectPredictionSignal from '#models/project_prediction_signal'
import Project from '#models/project'
import ProjectPredictionInputCollector from './input_collector.js'
import { ProjectPredictionRuleset } from './ruleset.js'
import { computeOutputHash } from './utils.js'
import type {
  PredictionSnapshot,
  PredictionSnapshotListItem,
  PredictionSnapshotStatus,
  PredictionWindow,
  PredictionDataWarning,
  PredictionSignalInput,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'

// ---------------------------------------------------------------------------
// 查询参数类型
// ---------------------------------------------------------------------------

export interface CreatePredictionParams {
  organizationId: number
  projectId: number
  userId: number
  window: PredictionWindow
  hasRiskView: boolean
  hasResourceView: boolean
  hasChangeImpactView: boolean
}

export interface ListPredictionsParams {
  projectId: number
  organizationId: number
  status?: PredictionSnapshotStatus
  window?: PredictionWindow
  page: number
  perPage: number
  sort?: string
}

export interface IdempotencyCheckResult {
  isDuplicate: boolean
  existingSnapshot: ProjectPredictionSnapshot | null
}

const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20
const STALE_DAYS = 7

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class ProjectPredictionService {
  private collector: ProjectPredictionInputCollector
  private ruleset: ProjectPredictionRuleset

  constructor(private audit: AuditService) {
    this.collector = new ProjectPredictionInputCollector()
    this.ruleset = new ProjectPredictionRuleset()
  }

  // -----------------------------------------------------------------------
  // 4.1 createSnapshot — 幂等创建
  // -----------------------------------------------------------------------

  async createSnapshot(params: CreatePredictionParams): Promise<{
    snapshot: PredictionSnapshot
    warnings: PredictionDataWarning[]
    isDuplicate: boolean
  }> {
    const project = await Project.query()
      .where('id', params.projectId)
      .where('organization_id', params.organizationId)
      .first()
    if (!project) throw new Error('RESOURCE_NOT_FOUND')

    // 收集输入 + 运行规则
    const collected = await this.collector.collect({
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      window: params.window,
      hasRiskView: params.hasRiskView,
      hasResourceView: params.hasResourceView,
      hasChangeImpactView: params.hasChangeImpactView,
    })

    const { signals } = this.ruleset.evaluate(collected)
    const inputSignature = collected.sourceHash
    const outputHash = computeOutputHash(signals)

    // 幂等检查：同项目/窗口/inputSignature/ruleVersion 且未过期
    const { isDuplicate, existingSnapshot } = await this.checkIdempotency(
      params.projectId,
      params.window,
      inputSignature,
      this.ruleset.ruleVersion,
    )
    if (isDuplicate && existingSnapshot) {
      return {
        snapshot: this.toDto(existingSnapshot, signals),
        warnings: collected.warnings,
        isDuplicate: true,
      }
    }

    // 事务内保存
    const trx = await db.transaction()
    try {
      const snapshot = await ProjectPredictionSnapshot.create(
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          window: params.window,
          status: 'pending',
          ruleVersion: this.ruleset.ruleVersion,
          inputSignature,
          outputHash,
          sourceHash: collected.sourceHash,
          warnings: collected.warnings,
          confirmationStatus: 'pending',
          stale: false,
          staleReason: null,
          generatedBy: params.userId,
          generatedAt: DateTime.now(),
          aiExplanation: null,
        },
        { client: trx },
      )

      // 保存信号
      for (const sig of signals) {
        await ProjectPredictionSignal.create(
          {
            snapshotId: snapshot.id,
            signalType: sig.signalType,
            severity: sig.severity,
            score: sig.score,
            confidenceBand: sig.confidenceBand,
            confidenceLower: sig.confidenceLower ?? null,
            confidenceUpper: sig.confidenceUpper ?? null,
            ruleId: sig.ruleId,
            ruleVersion: sig.ruleVersion,
            description: sig.description,
            evidenceRefs: sig.evidenceRefs,
            expiresAt: this.computeExpiresAt(),
          },
          { client: trx },
        )
      }

      await trx.commit()

      await this.audit.log({
        event: AuditEvent.PREDICTION_CREATED,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'project_prediction_snapshot',
        entityId: snapshot.id,
        metadata: {
          window: params.window,
          ruleVersion: this.ruleset.ruleVersion,
          inputSignature: inputSignature.substring(0, 8),
          signalCount: signals.length,
        },
      })

      return {
        snapshot: this.toDto(snapshot, signals),
        warnings: collected.warnings,
        isDuplicate: false,
      }
    } catch (error) {
      await trx.rollback()
      logger.error({ err: error, projectId: params.projectId }, 'prediction create failed')
      throw error
    }
  }

  // -----------------------------------------------------------------------
  // 读取操作
  // -----------------------------------------------------------------------

  async getLatest(
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<PredictionSnapshot | null> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const snapshot = await ProjectPredictionSnapshot.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('generated_at', 'desc')
      .first()

    if (!snapshot) return null

    // 过期检测
    if (!snapshot.stale) {
      const staleResult = await this.checkExpired(snapshot)
      if (staleResult.isStale) {
        snapshot.stale = true
        snapshot.staleReason = staleResult.reason
      }
    }

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    return this.toDto(snapshot, this.signalsToInputs(signals))
  }

  async getById(
    snapshotId: number,
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<PredictionSnapshot> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const snapshot = await ProjectPredictionSnapshot.query()
      .where('id', snapshotId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!snapshot) throw new Error('RESOURCE_NOT_FOUND')

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    return this.toDto(snapshot, this.signalsToInputs(signals))
  }

  async list(params: ListPredictionsParams): Promise<{
    data: PredictionSnapshotListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.assertProjectAccess(params.organizationId, params.projectId, 0)

    const page = Math.max(1, params.page)
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, params.perPage || DEFAULT_PER_PAGE))

    const query = ProjectPredictionSnapshot.query()
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)

    if (params.status) {
      query.where('status', params.status)
    }
    if (params.window) {
      query.where('window', params.window)
    }

    if (params.sort) {
      const parsed = this.parseSort(params.sort)
      if (parsed) {
        query.orderBy(parsed.field, parsed.direction)
      }
    }
    query.orderBy('generated_at', 'desc')

    const result = await query.paginate(page, perPage)
    const snapshots = result.all()

    // 获取每个快照的信号计数
    const snapshotIds = snapshots.map((s) => s.id)
    const signalCounts =
      snapshotIds.length > 0
        ? await ProjectPredictionSignal.query()
            .whereIn('snapshot_id', snapshotIds)
            .select('snapshot_id', 'severity')
        : []

    const countMap = new Map<number, { total: number; critical: number; high: number }>()
    for (const sig of signalCounts) {
      const entry = countMap.get(sig.snapshotId) ?? { total: 0, critical: 0, high: 0 }
      entry.total++
      if (sig.severity === 'critical') entry.critical++
      if (sig.severity === 'high') entry.high++
      countMap.set(sig.snapshotId, entry)
    }

    const data: PredictionSnapshotListItem[] = snapshots.map((s) => {
      const counts = countMap.get(s.id) ?? { total: 0, critical: 0, high: 0 }
      return {
        id: s.id,
        projectId: s.projectId,
        window: s.window,
        status: s.status,
        signalCount: counts.total,
        criticalCount: counts.critical,
        highCount: counts.high,
        maxSeverity: counts.critical > 0 ? 'critical' : counts.high > 0 ? 'high' : 'info',
        ruleVersion: s.ruleVersion,
        inputSignature: s.inputSignature,
        stale: s.stale,
        generatedBy: s.generatedBy,
        generatedAt: s.generatedAt.toISO() ?? s.generatedAt.toString(),
        confirmedBy: s.confirmedBy,
        confirmedAt: s.confirmedAt?.toISO() ?? null,
      }
    })

    return {
      data,
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: Math.ceil(result.total / result.perPage),
      },
    }
  }

  // -----------------------------------------------------------------------
  // 确认 / 清除操作
  // -----------------------------------------------------------------------

  async confirm(
    snapshotId: number,
    organizationId: number,
    projectId: number,
    userId: number,
    notes?: string,
  ): Promise<PredictionSnapshot> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const snapshot = await ProjectPredictionSnapshot.query()
      .where('id', snapshotId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!snapshot) throw new Error('RESOURCE_NOT_FOUND')
    if (snapshot.status === 'confirmed') throw new Error('PREDICTION_ALREADY_CONFIRMED')
    if (snapshot.status === 'dismissed') throw new Error('PREDICTION_DISMISSED_CANNOT_CONFIRM')

    snapshot.status = 'confirmed'
    snapshot.confirmationStatus = 'confirmed'
    snapshot.confirmedBy = userId
    snapshot.confirmedAt = DateTime.now()
    snapshot.confirmedNotes = notes ?? null
    await snapshot.save()

    await this.audit.log({
      event: AuditEvent.PREDICTION_CONFIRMED,
      userId,
      organizationId,
      projectId,
      entityType: 'project_prediction_snapshot',
      entityId: snapshot.id,
      metadata: { window: snapshot.window, ruleVersion: snapshot.ruleVersion },
    })

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    return this.toDto(snapshot, this.signalsToInputs(signals))
  }

  async dismiss(
    snapshotId: number,
    organizationId: number,
    projectId: number,
    userId: number,
    reason: string,
  ): Promise<PredictionSnapshot> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const snapshot = await ProjectPredictionSnapshot.query()
      .where('id', snapshotId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!snapshot) throw new Error('RESOURCE_NOT_FOUND')
    if (snapshot.status === 'dismissed') throw new Error('PREDICTION_ALREADY_DISMISSED')

    snapshot.status = 'dismissed'
    snapshot.confirmationStatus = 'dismissed'
    snapshot.dismissedBy = userId
    snapshot.dismissedAt = DateTime.now()
    snapshot.dismissReason = reason
    await snapshot.save()

    await this.audit.log({
      event: AuditEvent.PREDICTION_DISMISSED,
      userId,
      organizationId,
      projectId,
      entityType: 'project_prediction_snapshot',
      entityId: snapshot.id,
      metadata: { window: snapshot.window, reason: reason.substring(0, 100) },
    })

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    return this.toDto(snapshot, this.signalsToInputs(signals))
  }

  // -----------------------------------------------------------------------
  // 过期检测
  // -----------------------------------------------------------------------

  async checkExpired(snapshot: ProjectPredictionSnapshot): Promise<{
    isStale: boolean
    reason: string | null
  }> {
    const reasons: string[] = []

    // 1. 规则版本变化
    if (snapshot.ruleVersion !== this.ruleset.ruleVersion) {
      reasons.push(`规则版本已从 ${snapshot.ruleVersion} 更新至 ${this.ruleset.ruleVersion}`)
    }

    // 2. 时间过期
    const generatedAt = snapshot.generatedAt
    if (generatedAt) {
      const daysSince = DateTime.now().diff(generatedAt, 'days').days
      if (daysSince > STALE_DAYS) {
        reasons.push(`快照已生成 ${Math.floor(daysSince)} 天，超过 ${STALE_DAYS} 天有效期`)
      }
    }

    return {
      isStale: reasons.length > 0,
      reason: reasons.length > 0 ? reasons.join('；') : null,
    }
  }

  // -----------------------------------------------------------------------
  // AI 解释更新
  // -----------------------------------------------------------------------

  async updateAiExplanation(
    snapshotId: number,
    organizationId: number,
    projectId: number,
    aiExplanation: Record<string, unknown>,
  ): Promise<PredictionSnapshot> {
    const snapshot = await ProjectPredictionSnapshot.query()
      .where('id', snapshotId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!snapshot) throw new Error('RESOURCE_NOT_FOUND')

    snapshot.aiExplanation = aiExplanation as any
    await snapshot.save()

    const signals = await ProjectPredictionSignal.query().where('snapshot_id', snapshot.id)
    return this.toDto(snapshot, this.signalsToInputs(signals))
  }

  // -----------------------------------------------------------------------
  // 内部辅助方法
  // -----------------------------------------------------------------------

  private async checkIdempotency(
    projectId: number,
    window: PredictionWindow,
    inputSignature: string,
    ruleVersion: string,
  ): Promise<IdempotencyCheckResult> {
    const existing = await ProjectPredictionSnapshot.query()
      .where('project_id', projectId)
      .where('window', window)
      .where('input_signature', inputSignature)
      .where('rule_version', ruleVersion)
      .where('stale', false)
      .whereNotIn('status', ['dismissed'])
      .first()

    if (existing) {
      return { isDuplicate: true, existingSnapshot: existing }
    }
    return { isDuplicate: false, existingSnapshot: null }
  }

  private async assertProjectAccess(
    organizationId: number,
    projectId: number,
    _userId: number,
  ): Promise<void> {
    const project = await Project.query()
      .where('id', projectId)
      .where('organization_id', organizationId)
      .first()
    if (!project) throw new Error('RESOURCE_NOT_FOUND')
  }

  private parseSort(sort: string): { field: string; direction: 'asc' | 'desc' } | null {
    const match = sort.match(/^([+-])(\w+)$/)
    if (!match) return null
    const direction = match[1] === '-' ? 'desc' : 'asc'
    const fieldMap: Record<string, string> = {
      id: 'id',
      status: 'status',
      window: 'window',
      generatedAt: 'generated_at',
      confirmedAt: 'confirmed_at',
    }
    const field = fieldMap[match[2]]
    if (!field) return null
    return { field, direction }
  }

  private computeExpiresAt(): DateTime {
    return DateTime.now().plus({ days: 7 })
  }

  private signalsToInputs(models: ProjectPredictionSignal[]): PredictionSignalInput[] {
    return models.map((m) => ({
      signalType: m.signalType as any,
      severity: m.severity as any,
      score: m.score,
      confidenceBand: m.confidenceBand as any,
      confidenceLower: m.confidenceLower ?? undefined,
      confidenceUpper: m.confidenceUpper ?? undefined,
      ruleId: m.ruleId,
      ruleVersion: m.ruleVersion,
      description: m.description,
      evidenceRefs: (m.evidenceRefs ?? []) as any,
    }))
  }

  private toDto(
    model: ProjectPredictionSnapshot,
    signals: PredictionSignalInput[],
  ): PredictionSnapshot {
    return {
      id: model.id,
      organizationId: model.organizationId,
      projectId: model.projectId,
      window: model.window,
      status: model.status,
      ruleVersion: model.ruleVersion,
      inputSignature: model.inputSignature,
      outputHash: model.outputHash,
      sourceHash: model.sourceHash,
      signals: signals.map((s, i) => ({
        id: i + 1,
        snapshotId: model.id,
        signalType: s.signalType,
        severity: s.severity,
        score: s.score,
        confidenceBand: s.confidenceBand,
        confidenceLower: s.confidenceLower,
        confidenceUpper: s.confidenceUpper,
        ruleId: s.ruleId,
        ruleVersion: s.ruleVersion,
        description: s.description,
        evidenceRefs: s.evidenceRefs,
        expiresAt: model.createdAt.plus({ days: 7 }).toISO() ?? '',
        createdAt: model.createdAt.toISO() ?? '',
      })),
      warnings: (model.warnings ?? []) as PredictionDataWarning[],
      aiExplanation: model.aiExplanation as any,
      confirmation: {
        status: model.status,
        confirmedBy: model.confirmedBy,
        confirmedAt: model.confirmedAt?.toISO() ?? null,
        confirmedNotes: model.confirmedNotes,
        dismissedBy: model.dismissedBy,
        dismissedAt: model.dismissedAt?.toISO() ?? null,
        dismissReason: model.dismissReason,
      },
      generatedBy: model.generatedBy,
      generatedAt: model.generatedAt.toISO() ?? model.generatedAt.toString(),
      stale: model.stale,
      staleReason: model.staleReason,
      createdAt: model.createdAt.toISO() ?? model.createdAt.toString(),
      updatedAt: model.updatedAt?.toISO() ?? model.createdAt.toISO() ?? model.createdAt.toString(),
    }
  }
}
