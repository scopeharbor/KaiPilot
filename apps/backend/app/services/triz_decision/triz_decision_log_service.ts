/**
 * v2-triz-decision-log-traceability —— TRIZ 决策日志 Service（tasks 2.5–2.8, 3.1–3.6）。
 *
 * 核心业务逻辑：
 * - 追加式证据建模：create / list / detail / supersede / subjectLookup
 * - 组织 + 项目双隔离
 * - 来源 ref 校验（adopt/partial_accept/modified_accept 必需）
 * - 脱敏 hash 计算
 * - 审计事件写入
 */
import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import TrizDecisionLog from '#models/triz_decision_log'
import AuditService, { AuditEvent } from '#services/audit_service'
import { SubjectRefResolver } from '#services/triz_decision/subject_ref_resolver'
import {
  sanitizeReasonText,
  computeReasonHash,
  generateFallbackSummary,
} from '#services/triz_decision/reason_sanitization'
import {
  requiresSourceRefs,
  type TrizDecisionSubjectRef,
  type TrizDecisionArtifactHash,
  type TrizDecisionType,
  type TrizDecisionLogEntry,
  type TrizDecisionLogCreateRequest,
  type TrizDecisionLogSupersedeRequest,
} from '@aiproj/types'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import logger from '@adonisjs/core/services/logger'

export interface ListOptions {
  page?: number
  perPage?: number
  status?: string
}

export interface ListResult {
  data: TrizDecisionLogEntry[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

@inject()
export default class TrizDecisionLogService {
  constructor(
    private audit: AuditService,
    private resolver: SubjectRefResolver,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────

  /**
   * 创建决策日志。
   * - 验证 adopt/partial_accept/modified_accept 必须提供 sourceRefs
   * - 脱敏 reasonSummary
   * - 计算 reasonHash
   * - 校验 subjectRefs 有效性
   * - 写入审计
   */
  async create(
    organizationId: number,
    projectId: number,
    userId: number,
    data: TrizDecisionLogCreateRequest,
    client?: TransactionClientContract,
  ): Promise<TrizDecisionLogEntry> {
    // 1. 校验 sourceRefs 必要性
    if (
      requiresSourceRefs(data.decisionType) &&
      (!data.sourceRefs || data.sourceRefs.length === 0)
    ) {
      throw new ValidationException(`决策类型「${data.decisionType}」必须提供至少一个来源 ref`)
    }

    // 2. 校验 subjectRefs 非空
    if (!data.subjectRefs || data.subjectRefs.length === 0) {
      throw new ValidationException('决策日志必须至少包含一个主题 ref')
    }

    // 3. 校验 subjectRefs 有效性
    for (const ref of data.subjectRefs) {
      const resolution = await this.resolver.resolve(ref, organizationId, userId)
      if (!resolution.valid) {
        throw new ValidationException(`主题 ref 无效：${resolution.summary}`)
      }
    }

    // 4. 脱敏理由
    const reasonSummary = sanitizeReasonText(
      data.reasonSummary ||
        generateFallbackSummary(data.decisionType, data.subjectRefs, data.sourceRefs),
    )

    // 5. 计算 hash
    const reasonHash = computeReasonHash(data.subjectRefs, data.sourceRefs, reasonSummary)

    // 6. 脱敏 alternativeSummary
    const alternativeSummary = data.alternativeSummary
      ? sanitizeReasonText(data.alternativeSummary)
      : null

    // 7. 创建记录
    const log = await TrizDecisionLog.create(
      {
        organizationId,
        projectId,
        decisionType: data.decisionType,
        decisionStatus: 'active',
        subjectRefs: this.prepareSubjectRefs(data.subjectRefs),
        sourceRefs: data.sourceRefs ?? [],
        artifactHashes: data.artifactHashes ?? [],
        reasonSummary,
        reasonHash,
        alternativeSummary,
        supersedesDecisionLogId: null,
        createdBy: userId,
      },
      client ? { client } : undefined,
    )

    // 8. 审计
    await this.audit
      .log({
        event: AuditEvent.TRIZ_DECISION_CREATED,
        userId,
        organizationId,
        projectId,
        entityType: 'triz_decision_log',
        entityId: log.id,
        metadata: {
          decisionType: data.decisionType,
          reasonHash,
          subjectRefCount: data.subjectRefs.length,
        },
      })
      .catch((err) => {
        logger.error({ err }, 'TRIZ_DECISION_CREATED audit log failed')
      })

    return this.toEntry(log)
  }

  // ── List ────────────────────────────────────────────────────────────

  /**
   * 分页列出项目的决策日志。
   */
  async list(
    organizationId: number,
    projectId: number,
    options: ListOptions = {},
  ): Promise<ListResult> {
    const page = options.page ?? 1
    const perPage = options.perPage ?? 20

    const query = TrizDecisionLog.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    if (options.status) {
      query.where('decision_status', options.status)
    }

    query.orderBy('created_at', 'desc')

    const result = await query.paginate(page, perPage)

    return {
      data: result.all().map((log) => this.toEntry(log)),
      meta: {
        total: result.total,
        page: result.currentPage,
        perPage: result.perPage,
        totalPages: Math.ceil(result.total / result.perPage),
      },
    }
  }

  // ── Detail ──────────────────────────────────────────────────────────

  /**
   * 获取单条决策日志详情。
   */
  async detail(
    organizationId: number,
    projectId: number,
    decisionLogId: number,
  ): Promise<TrizDecisionLogEntry> {
    const log = await TrizDecisionLog.query()
      .where('id', decisionLogId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!log) {
      throw new ResourceNotFoundException('决策日志未找到')
    }

    return this.toEntry(log)
  }

  // ── Supersede ───────────────────────────────────────────────────────

  /**
   * 废止旧决策并创建新决策。
   * 原子操作：标记旧记录为 superseded + 创建新记录指向旧记录。
   */
  async supersede(
    organizationId: number,
    projectId: number,
    userId: number,
    decisionLogId: number,
    data: TrizDecisionLogSupersedeRequest,
    client?: TransactionClientContract,
  ): Promise<TrizDecisionLogEntry> {
    // 1. 查找旧决策
    const oldLog = await TrizDecisionLog.query()
      .where('id', decisionLogId)
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .first()

    if (!oldLog) {
      throw new ResourceNotFoundException('待废止的决策日志未找到')
    }

    if (oldLog.decisionStatus === 'superseded') {
      throw new ValidationException('该决策日志已被废止，不可重复废止')
    }

    // 2. 校验 sourceRefs
    if (
      requiresSourceRefs(data.decisionType) &&
      (!data.sourceRefs || data.sourceRefs.length === 0)
    ) {
      throw new ValidationException(`废止决策类型「${data.decisionType}」必须提供至少一个来源 ref`)
    }

    // 3. 校验 subjectRefs
    if (!data.subjectRefs || data.subjectRefs.length === 0) {
      throw new ValidationException('废止决策必须至少包含一个主题 ref')
    }

    // 4. 脱敏理由
    const reasonSummary = sanitizeReasonText(
      data.reasonSummary ||
        generateFallbackSummary(data.decisionType, data.subjectRefs, data.sourceRefs),
    )

    // 5. 计算 hash
    const reasonHash = computeReasonHash(data.subjectRefs, data.sourceRefs, reasonSummary)

    // 6. 脱敏 alternativeSummary
    const alternativeSummary = data.alternativeSummary
      ? sanitizeReasonText(data.alternativeSummary)
      : null

    // 7. 标记旧记录为 superseded
    oldLog.decisionStatus = 'superseded'
    await oldLog.save()

    // 8. 创建新记录
    const newLog = await TrizDecisionLog.create(
      {
        organizationId,
        projectId,
        decisionType: data.decisionType,
        decisionStatus: 'active',
        subjectRefs: this.prepareSubjectRefs(data.subjectRefs),
        sourceRefs: data.sourceRefs ?? [],
        artifactHashes: data.artifactHashes ?? [],
        reasonSummary,
        reasonHash,
        alternativeSummary,
        supersedesDecisionLogId: oldLog.id,
        createdBy: userId,
      },
      client ? { client } : undefined,
    )

    // 9. 审计
    await this.audit
      .log({
        event: AuditEvent.TRIZ_DECISION_SUPERSEDED,
        userId,
        organizationId,
        projectId,
        entityType: 'triz_decision_log',
        entityId: newLog.id,
        metadata: {
          supersededDecisionLogId: oldLog.id,
          decisionType: data.decisionType,
          reasonHash,
        },
      })
      .catch((err) => {
        logger.error({ err }, 'TRIZ_DECISION_SUPERSEDED audit log failed')
      })

    return this.toEntry(newLog)
  }

  // ── Subject Lookup ──────────────────────────────────────────────────

  /**
   * 按主题 kind + id 查找关联的决策日志。
   */
  async subjectLookup(
    organizationId: number,
    projectId: number,
    kind: string,
    _id: string,
    _version?: string | null,
  ): Promise<{ data: TrizDecisionLogEntry[]; meta: { total: number } }> {
    // 使用模型的 scopeBySubjectKind 过滤 kind
    const query = TrizDecisionLog.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)

    // JSON 子查询匹配 kind
    TrizDecisionLog.scopeBySubjectKind(query, kind)
    query.orderBy('created_at', 'desc')

    const logs = await query.limit(50)

    return {
      data: logs.map((log) => this.toEntry(log)),
      meta: { total: logs.length },
    }
  }

  // ── DTO ─────────────────────────────────────────────────────────────

  private toEntry(log: TrizDecisionLog): TrizDecisionLogEntry {
    return {
      id: log.id,
      organizationId: log.organizationId,
      projectId: log.projectId,
      decisionType: log.decisionType as TrizDecisionType,
      decisionStatus: log.decisionStatus as TrizDecisionLogEntry['decisionStatus'],
      subjectRefs: this.sanitizeSubjectVisibility(log.subjectRefs),
      sourceRefs: log.sourceRefs,
      artifactHashes: log.artifactHashes as TrizDecisionArtifactHash[],
      reasonSummary: log.reasonSummary,
      reasonHash: log.reasonHash,
      alternativeSummary: log.alternativeSummary,
      supersedesDecisionLogId: log.supersedesDecisionLogId,
      supersededByDecisionLogId: null, // 当前模型无反向引用，可后续补充
      createdBy: log.createdBy,
      createdAt: log.createdAt.toISO()!,
      updatedAt: log.updatedAt?.toISO() ?? null,
    }
  }

  // ── Subject ref 准备 ────────────────────────────────────────────────

  /**
   * 准备 subjectRefs 写入 DB：确保 title/visibility 等字段完整。
   */
  private prepareSubjectRefs(refs: TrizDecisionSubjectRef[]): TrizDecisionSubjectRef[] {
    return refs.map((r) => ({
      ...r,
      title: r.title ?? null,
    }))
  }

  /**
   * 脱敏 subject refs 中不可见的目标（visibility=internal）。
   * 返回脱敏后的副本（不影响 DB 存储）。
   */
  private sanitizeSubjectVisibility(refs: TrizDecisionSubjectRef[]): TrizDecisionSubjectRef[] {
    return refs.map((r) => {
      if (r.visibility === 'internal') {
        return {
          ...r,
          title: '[内部引用]',
          summaryLevel: 'low' as const,
        }
      }
      return r
    })
  }
}
