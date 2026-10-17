/**
 * ProjectHealthDiagnosisService —— 项目健康诊断核心服务。
 *
 * v2-ai-project-health-diagnosis / Group 3 — 诊断服务与人工确认
 *
 * 红线：不修改任何正式业务数据（任务、资源、风险、变更、里程碑、项目状态）
 */
import { DateTime } from 'luxon'
import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import AuditService, { AuditEvent } from '#services/audit_service'
import ProjectHealthDiagnosis from '#models/project_health_diagnosis'
import ProjectHealthDiagnosisItem from '#models/project_health_diagnosis_item'
import Project from '#models/project'
import ProjectHealthInputCollector from './input_collector.js'
import { ProjectHealthRuleset } from './ruleset.js'
import type {
  HealthDiagnosisStatus,
  HealthDiagnosis,
  HealthDiagnosisListItem,
  HealthDiagnosisSummary,
  HealthDataWarning,
} from '@aiproj/types'
import { inject } from '@adonisjs/core'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// 查询参数类型
// ---------------------------------------------------------------------------

export interface ListDiagnosesParams {
  projectId: number
  organizationId: number
  status?: HealthDiagnosisStatus
  page: number
  perPage: number
  sort?: string
}

export interface CreateDiagnosisParams {
  organizationId: number
  projectId: number
  userId: number
  hasRiskView: boolean
  hasResourceView: boolean
  hasChangeImpactView: boolean
  enableAiDraft?: boolean
}

export interface ConfirmationParams {
  diagnosisId: number
  userId: number
  organizationId: number
  projectId: number
  notes?: string
}

export interface RejectionParams {
  diagnosisId: number
  userId: number
  organizationId: number
  projectId: number
  reason: string
}

export interface StaleCheckResult {
  stale: boolean
  staleReason: string | null
  inputSignatureChanged: boolean
  ruleVersionChanged: boolean
  timeExpired: boolean
}

const MAX_PER_PAGE = 100
const DEFAULT_PER_PAGE = 20

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@inject()
export default class ProjectHealthDiagnosisService {
  private collector: ProjectHealthInputCollector
  private ruleset: ProjectHealthRuleset

  constructor(private audit: AuditService) {
    this.collector = new ProjectHealthInputCollector()
    this.ruleset = new ProjectHealthRuleset()
  }

  // -----------------------------------------------------------------------
  // 3.1 create — 写事务外收集/计算，事务内只保存
  // -----------------------------------------------------------------------

  async create(params: CreateDiagnosisParams): Promise<{
    diagnosis: HealthDiagnosis
    warnings: HealthDataWarning[]
  }> {
    const project = await Project.query()
      .where('id', params.projectId)
      .where('organization_id', params.organizationId)
      .first()
    if (!project) {
      throw new Error('RESOURCE_NOT_FOUND')
    }

    // 事务外：只读操作
    const collectorInput = {
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      hasRiskView: params.hasRiskView,
      hasResourceView: params.hasResourceView,
      hasChangeImpactView: params.hasChangeImpactView,
    }

    const collected = await this.collector.collect(collectorInput)
    const summary = this.ruleset.evaluate(collected)
    const inputSignature = collected.sourceHash
    const evidenceHash = summary.evidenceHash
    const outputHash = this.computeOutputHash(summary)

    // 事务内：只保存诊断快照和信号项
    const trx = await db.transaction()
    try {
      const diagnosis = await ProjectHealthDiagnosis.create(
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          status: 'pending',
          ruleVersion: this.ruleset.ruleVersion,
          inputSignature,
          outputHash,
          evidenceHash,
          summary,
          aiDraft: null,
          warnings: collected.warnings,
          generatedBy: params.userId,
          generatedAt: DateTime.now(),
          stale: false,
          staleReason: null,
        },
        { client: trx },
      )

      for (const ds of summary.dimensionScores) {
        if (ds.evidence.length === 0) continue
        for (const ev of ds.evidence) {
          await ProjectHealthDiagnosisItem.create(
            {
              diagnosisId: diagnosis.id,
              dimension: ds.dimension,
              ruleId: ev.ruleId,
              severity: ev.severity,
              scoreImpact: ev.impact,
              evidence: ev.summary,
              sourceType: ev.entityType,
              sourceId: ev.entityId > 0 ? ev.entityId : null,
              suggestedAction: ds.suggestedActions[0] ?? null,
              requiresReview: ev.severity === 'critical' || ev.severity === 'high',
            },
            { client: trx },
          )
        }
      }

      await trx.commit()

      await this.audit.log({
        event: AuditEvent.HEALTH_DIAGNOSIS_CREATED,
        userId: params.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        entityType: 'project_health_diagnosis',
        entityId: diagnosis.id,
        metadata: {
          ruleVersion: this.ruleset.ruleVersion,
          inputSignature: inputSignature.substring(0, 8),
          overallScore: summary.overallScore,
        },
      })

      return {
        diagnosis: this.toDto(diagnosis, summary),
        warnings: collected.warnings,
      }
    } catch (error) {
      await trx.rollback()
      logger.error({ err: error, projectId: params.projectId }, 'health diagnosis create failed')
      throw error
    }
  }

  // -----------------------------------------------------------------------
  // 3.2 读取操作
  // -----------------------------------------------------------------------

  async getLatest(
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<HealthDiagnosis | null> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const diagnosis = await ProjectHealthDiagnosis.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('generated_at', 'desc')
      .first()

    if (!diagnosis) return null

    if (!diagnosis.stale) {
      const staleResult = await this.checkStale(diagnosis, organizationId, projectId, userId)
      if (staleResult.stale) {
        diagnosis.stale = true
        diagnosis.staleReason = staleResult.staleReason
      }
    }

    return this.toDto(diagnosis)
  }

  async getById(
    diagnosisId: number,
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<HealthDiagnosis> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const diagnosis = await ProjectHealthDiagnosis.query()
      .where('id', diagnosisId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!diagnosis) {
      throw new Error('RESOURCE_NOT_FOUND')
    }

    return this.toDto(diagnosis)
  }

  async list(params: ListDiagnosesParams): Promise<{
    data: HealthDiagnosisListItem[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    await this.assertProjectAccess(params.organizationId, params.projectId, params.page)

    const page = Math.max(1, params.page)
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, params.perPage || DEFAULT_PER_PAGE))

    const query = ProjectHealthDiagnosis.query()
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)

    if (params.status) {
      query.where('status', params.status)
    }

    if (params.sort) {
      const parsed = this.parseSort(params.sort)
      if (parsed) {
        query.orderBy(parsed.field, parsed.direction)
      }
    }
    query.orderBy('generated_at', 'desc')

    const result = await query.paginate(page, perPage)

    const data: HealthDiagnosisListItem[] = result.all().map((d) => ({
      id: d.id,
      projectId: d.projectId,
      status: d.status,
      overallScore: d.summary?.overallScore ?? 0,
      overallLabel: d.summary?.overallLabel ?? 'unknown',
      ruleVersion: d.ruleVersion,
      inputSignature: d.inputSignature,
      stale: d.stale,
      generatedBy: d.generatedBy,
      generatedAt: d.generatedAt.toISO() ?? d.generatedAt.toString(),
      confirmedBy: d.confirmedBy,
      confirmedAt: d.confirmedAt?.toISO() ?? null,
      severity: this.getOverallSeverity(d.summary),
    }))

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
  // 3.3 refresh
  // -----------------------------------------------------------------------

  async refresh(params: CreateDiagnosisParams): Promise<{
    diagnosis: HealthDiagnosis
    warnings: HealthDataWarning[]
  }> {
    return this.create(params)
  }

  // -----------------------------------------------------------------------
  // 3.4 confirm / reject
  // -----------------------------------------------------------------------

  async confirm(params: ConfirmationParams): Promise<HealthDiagnosis> {
    await this.assertProjectAccess(params.organizationId, params.projectId, params.userId)

    const diagnosis = await ProjectHealthDiagnosis.query()
      .where('id', params.diagnosisId)
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .first()

    if (!diagnosis) throw new Error('RESOURCE_NOT_FOUND')
    if (diagnosis.status === 'rejected') throw new Error('HEALTH_DIAGNOSIS_REJECTED_CANNOT_CONFIRM')
    if (diagnosis.status === 'confirmed') throw new Error('HEALTH_DIAGNOSIS_ALREADY_CONFIRMED')

    diagnosis.status = 'confirmed'
    diagnosis.confirmedBy = params.userId
    diagnosis.confirmedAt = DateTime.now()
    diagnosis.confirmedNotes = params.notes ?? null
    await diagnosis.save()

    await this.audit.log({
      event: AuditEvent.HEALTH_DIAGNOSIS_CONFIRMED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'project_health_diagnosis',
      entityId: diagnosis.id,
      metadata: { ruleVersion: diagnosis.ruleVersion },
    })

    return this.toDto(diagnosis)
  }

  async reject(params: RejectionParams): Promise<HealthDiagnosis> {
    await this.assertProjectAccess(params.organizationId, params.projectId, params.userId)

    const diagnosis = await ProjectHealthDiagnosis.query()
      .where('id', params.diagnosisId)
      .where('organization_id', params.organizationId)
      .where('project_id', params.projectId)
      .first()

    if (!diagnosis) throw new Error('RESOURCE_NOT_FOUND')
    if (diagnosis.status === 'rejected') throw new Error('HEALTH_DIAGNOSIS_ALREADY_REJECTED')

    diagnosis.status = 'rejected'
    diagnosis.rejectedBy = params.userId
    diagnosis.rejectedAt = DateTime.now()
    diagnosis.rejectReason = params.reason
    await diagnosis.save()

    await this.audit.log({
      event: AuditEvent.HEALTH_DIAGNOSIS_REJECTED,
      userId: params.userId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      entityType: 'project_health_diagnosis',
      entityId: diagnosis.id,
      metadata: {
        ruleVersion: diagnosis.ruleVersion,
        rejectReason: params.reason.substring(0, 100),
      },
    })

    return this.toDto(diagnosis)
  }

  // -----------------------------------------------------------------------
  // 3.5 stale 检测
  // -----------------------------------------------------------------------

  async checkStale(
    diagnosis: ProjectHealthDiagnosis,
    organizationId: number,
    projectId: number,
    userId: number,
  ): Promise<StaleCheckResult> {
    const reasons: string[] = []
    let inputSignatureChanged = false
    let ruleVersionChanged = false
    let timeExpired = false

    // 1. 规则版本变化
    const currentRuleVersion = this.ruleset.ruleVersion
    if (diagnosis.ruleVersion !== currentRuleVersion) {
      ruleVersionChanged = true
      reasons.push(`规则版本已从 ${diagnosis.ruleVersion} 更新至 ${currentRuleVersion}`)
    }

    // 2. 输入签名变化
    try {
      const collectorInput = {
        organizationId,
        projectId,
        userId,
        hasRiskView: true,
        hasResourceView: true,
        hasChangeImpactView: true,
      }
      const collected = await this.collector.collect(collectorInput)
      if (collected.sourceHash !== diagnosis.inputSignature) {
        inputSignatureChanged = true
        reasons.push('项目数据已发生变化，诊断输入签名不匹配')
      }
    } catch {
      inputSignatureChanged = true
      reasons.push('无法验证输入签名一致性')
    }

    // 3. 时间过期（生成超过 7 天）
    const generatedAt = diagnosis.generatedAt
    if (generatedAt) {
      const daysSinceGenerated = DateTime.now().diff(generatedAt, 'days').days
      if (daysSinceGenerated > 7) {
        timeExpired = true
        reasons.push(`诊断已生成 ${Math.floor(daysSinceGenerated)} 天，超过 7 天有效期`)
      }
    }

    const stale = inputSignatureChanged || ruleVersionChanged || timeExpired
    return {
      stale,
      staleReason: stale ? reasons.join('；') : null,
      inputSignatureChanged,
      ruleVersionChanged,
      timeExpired,
    }
  }

  async confirmStale(
    diagnosisId: number,
    organizationId: number,
    projectId: number,
    userId: number,
    reason?: string,
  ): Promise<HealthDiagnosis> {
    await this.assertProjectAccess(organizationId, projectId, userId)

    const diagnosis = await ProjectHealthDiagnosis.query()
      .where('id', diagnosisId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!diagnosis) throw new Error('RESOURCE_NOT_FOUND')
    if (diagnosis.status !== 'confirmed') throw new Error('HEALTH_DIAGNOSIS_NOT_CONFIRMED')

    diagnosis.stale = false
    diagnosis.staleReason = null
    diagnosis.confirmedNotes = reason ?? diagnosis.confirmedNotes
    await diagnosis.save()

    await this.audit.log({
      event: AuditEvent.HEALTH_DIAGNOSIS_STALE_CONFIRMED,
      userId,
      organizationId,
      projectId,
      entityType: 'project_health_diagnosis',
      entityId: diagnosis.id,
      metadata: { ruleVersion: diagnosis.ruleVersion },
    })

    return this.toDto(diagnosis)
  }

  // -----------------------------------------------------------------------
  // 内部辅助方法
  // -----------------------------------------------------------------------

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

  private computeOutputHash(summary: HealthDiagnosisSummary): string {
    const hash = createHash('sha256')
    hash.update(JSON.stringify(summary))
    return hash.digest('hex').substring(0, 16)
  }

  private parseSort(sort: string): { field: string; direction: 'asc' | 'desc' } | null {
    const match = sort.match(/^([+-])(\w+)$/)
    if (!match) return null
    const direction = match[1] === '-' ? 'desc' : 'asc'
    const rawField = match[2]
    const fieldMap: Record<string, string> = {
      id: 'id',
      status: 'status',
      generatedAt: 'generated_at',
      confirmedAt: 'confirmed_at',
    }
    const field = fieldMap[rawField]
    if (!field) return null
    return { field, direction }
  }

  private getOverallSeverity(
    summary: HealthDiagnosisSummary | null,
  ): 'critical' | 'high' | 'medium' | 'low' | 'ok' {
    if (!summary) return 'ok'
    const label = summary.overallLabel
    if (label === 'critical') return 'critical'
    if (label === 'warning') return 'high'
    if (label === 'attention') return 'medium'
    return 'ok'
  }

  private toDto(model: ProjectHealthDiagnosis, summary?: HealthDiagnosisSummary): HealthDiagnosis {
    return {
      id: model.id,
      organizationId: model.organizationId,
      projectId: model.projectId,
      status: model.status,
      ruleVersion: model.ruleVersion,
      inputSignature: model.inputSignature,
      outputHash: model.outputHash ?? '',
      evidenceHash: model.evidenceHash ?? '',
      summary: summary ?? model.summary,
      aiDraft: model.aiDraft,
      warnings: model.warnings ?? [],
      generatedBy: model.generatedBy,
      generatedAt: model.generatedAt.toISO() ?? model.generatedAt.toString(),
      confirmedBy: model.confirmedBy,
      confirmedAt: model.confirmedAt?.toISO() ?? null,
      confirmedNotes: model.confirmedNotes,
      rejectedBy: model.rejectedBy,
      rejectedAt: model.rejectedAt?.toISO() ?? null,
      rejectReason: model.rejectReason,
      stale: model.stale,
      staleReason: model.staleReason,
      createdAt: model.createdAt.toISO() ?? model.createdAt.toString(),
      updatedAt: model.updatedAt?.toISO() ?? model.createdAt.toISO() ?? model.createdAt.toString(),
    }
  }
}
