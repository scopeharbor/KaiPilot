/**
 * v3-triz-innovation-workbench —— 创新工作台方案持久化服务（§2.2）。
 *
 * 负责 scheme/option/handoff/对比快照 ref/废弃状态的 CRUD。
 * 强制 organization_id + project_id 双隔离；scheme_id 在 org+project 内唯一。
 * 禁止写正式业务表（任务/资源/风险/依赖/计划/范围）；本服务只读写 triz_innovation_schemes。
 * 全部 audit 仅记录 refs/hash/summary/status，不记录正文。
 */
import TrizInnovationScheme from '#models/triz_innovation_scheme'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ResourceNotFoundException, ValidationException } from '#exceptions/api_exception'
import { inject } from '@adonisjs/core'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'
import type {
  InnovationHandoffMeta,
  InnovationOption,
  InnovationReviewState,
  InnovationScheme,
  InnovationSchemeDTO,
  InnovationSchemeNarrative,
  InnovationSchemeStatus,
} from '@aiproj/types'
import {
  INNOVATION_SCHEME_MAX_OPTIONS,
  INNOVATION_SCHEME_SCHEMA_VERSION,
  computeInnovationOptionHash,
  computeInnovationSchemeHash,
  isInnovationReviewState,
  isInnovationSchemeStatus,
  validateInnovationScheme,
} from '@aiproj/types'

@inject()
export default class InnovationWorkbenchService {
  constructor(private audit: AuditService) {}

  // ──────── 创建 ────────

  async createScheme(args: {
    organizationId: number
    projectId: number
    userId: number
    name: string
    note?: string | null
    requestId?: string | null
  }): Promise<TrizInnovationScheme> {
    const name = args.name?.trim()
    if (!name) throw new ValidationException('方案名称不能为空')

    const schemeId = this.generateSchemeId(args.projectId)
    const now = DateTime.now()
    const payload: InnovationScheme = {
      schemeId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      name,
      note: args.note?.trim() || null,
      options: [],
      scores: {},
      status: 'open',
      reviewState: 'pending',
      handoff: {
        status: 'none',
        draftSessionRef: null,
        handedOffAt: null,
        blockedReason: null,
      },
      narrative: null,
      schemeHash: computeInnovationSchemeHash({ optionHashes: [], name }),
      comparisonRef: null,
      schemaVersion: INNOVATION_SCHEME_SCHEMA_VERSION,
      createdBy: args.userId,
      createdAt: now.toISO() ?? '',
      updatedAt: null,
      reviewedAt: null,
      abandonedAt: null,
    }

    const record = new TrizInnovationScheme()
    record.organizationId = args.organizationId
    record.projectId = args.projectId
    record.schemeId = schemeId
    record.name = name
    record.status = 'open'
    record.reviewState = 'pending'
    record.schemeHash = payload.schemeHash
    record.handoffStatus = 'none'
    record.draftSessionRef = null
    record.idempotencyKey = null
    record.payload = payload
    record.createdBy = args.userId
    record.reviewedAt = null
    record.abandonedAt = null
    await record.save()

    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_SCHEME_CREATED,
      userId: args.userId,
      organizationId: args.organizationId,
      projectId: args.projectId,
      entityType: 'triz_innovation_scheme',
      entityId: record.id,
      requestId: args.requestId ?? null,
      metadata: { schemeId, name, schemeHash: payload.schemeHash },
    })

    return record
  }

  // ──────── 列表 / 详情 ────────

  async list(
    organizationId: number,
    projectId: number,
    opts: {
      page?: number
      perPage?: number
      status?: string | null
    } = {},
  ): Promise<{
    data: TrizInnovationScheme[]
    meta: { total: number; page: number; perPage: number; totalPages: number }
  }> {
    const page = Math.max(1, opts.page ?? 1)
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20))
    const query = TrizInnovationScheme.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
    if (opts.status) query.where('status', opts.status)
    query.orderBy('created_at', 'desc').orderBy('id', 'desc')

    const paginator = await query.paginate(page, perPage)
    const meta = paginator.getMeta()
    return {
      data: paginator.all(),
      meta: {
        total: meta.total,
        page: meta.currentPage,
        perPage: meta.perPage,
        totalPages: meta.lastPage,
      },
    }
  }

  async getBySchemeId(
    organizationId: number,
    projectId: number,
    schemeId: string,
  ): Promise<TrizInnovationScheme> {
    return this.findInScopeOrFail(organizationId, projectId, schemeId)
  }

  // ──────── 更新（名称/备注/评审状态）────────

  async updateScheme(
    organizationId: number,
    projectId: number,
    schemeId: string,
    userId: number,
    patch: { name?: string; note?: string | null; reviewState?: InnovationReviewState },
    requestId?: string | null,
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    if (record.status === 'abandoned') {
      throw new ValidationException('已废弃的方案不能更新')
    }
    const payload = { ...record.payload }
    let changed = false

    if (typeof patch.name === 'string') {
      const name = patch.name.trim()
      if (!name) throw new ValidationException('方案名称不能为空')
      payload.name = name
      record.name = name
      changed = true
    }
    if (patch.note !== undefined) {
      payload.note = typeof patch.note === 'string' && patch.note.trim() ? patch.note.trim() : null
      changed = true
    }
    if (patch.reviewState !== undefined) {
      if (!isInnovationReviewState(patch.reviewState)) {
        throw new ValidationException('评审状态不合法')
      }
      payload.reviewState = patch.reviewState
      record.reviewState = patch.reviewState
      record.reviewedAt = DateTime.now()
      payload.reviewedAt = record.reviewedAt.toISO()
      changed = true
    }

    if (changed) {
      payload.updatedAt = DateTime.now().toISO()
      this.validatePayloadOrThrow(payload)
      record.payload = payload
      await record.save()
      await this.audit.log({
        event: AuditEvent.TRIZ_INNOVATION_SCHEME_UPDATED,
        userId,
        organizationId,
        projectId,
        entityType: 'triz_innovation_scheme',
        entityId: record.id,
        requestId: requestId ?? null,
        metadata: {
          schemeId,
          fields: Object.keys(patch),
          reviewState: payload.reviewState,
        },
      })
    }
    return record
  }

  // ──────── 废弃 ────────

  async abandonScheme(
    organizationId: number,
    projectId: number,
    schemeId: string,
    userId: number,
    requestId?: string | null,
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    if (record.status === 'abandoned') return record
    const prevStatus = record.status
    const payload = { ...record.payload }
    payload.status = 'abandoned'
    payload.abandonedAt = DateTime.now().toISO()
    payload.updatedAt = payload.abandonedAt
    record.status = 'abandoned'
    record.abandonedAt = DateTime.now()
    record.payload = payload
    await record.save()
    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_SCHEME_ABANDONED,
      userId,
      organizationId,
      projectId,
      entityType: 'triz_innovation_scheme',
      entityId: record.id,
      requestId: requestId ?? null,
      metadata: { schemeId, prevStatus, optionCount: payload.options.length },
    })
    return record
  }

  // ──────── Option 增删 ────────

  async addOption(
    organizationId: number,
    projectId: number,
    schemeId: string,
    userId: number,
    option: InnovationOption,
    requestId?: string | null,
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    if (record.status !== 'open') {
      throw new ValidationException('仅 open 状态的方案可添加候选路径')
    }
    const payload = { ...record.payload }
    if (payload.options.some((o) => o.optionId === option.optionId)) {
      throw new ValidationException('该候选路径已在方案中')
    }
    if (payload.options.length >= INNOVATION_SCHEME_MAX_OPTIONS) {
      throw new ValidationException(`方案篮子上限为 ${INNOVATION_SCHEME_MAX_OPTIONS} 个候选路径`)
    }
    // 重算 option hash 以保证稳定
    const enriched: InnovationOption = {
      ...option,
      hashes: {
        ...option.hashes,
        selectedPathId: option.selectedPathId ?? option.hashes.selectedPathId ?? null,
      },
    }
    payload.options = [...payload.options, enriched]
    payload.scores = { ...payload.scores } // 评分由 §4 服务单独写入
    payload.schemeHash = this.recomputeSchemeHash(payload)
    payload.comparisonRef = null // 结构变化，清空旧对比 ref
    payload.updatedAt = DateTime.now().toISO()
    this.validatePayloadOrThrow(payload)

    record.payload = payload
    record.schemeHash = payload.schemeHash
    await record.save()

    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_OPTION_CHANGED,
      userId,
      organizationId,
      projectId,
      entityType: 'triz_innovation_scheme',
      entityId: record.id,
      requestId: requestId ?? null,
      metadata: {
        schemeId,
        change: 'add_option',
        optionId: option.optionId,
        origin: option.origin,
        schemeHash: payload.schemeHash,
      },
    })
    return record
  }

  async removeOption(
    organizationId: number,
    projectId: number,
    schemeId: string,
    userId: number,
    optionId: string,
    requestId?: string | null,
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    if (record.status !== 'open') {
      throw new ValidationException('仅 open 状态的方案可移除候选路径')
    }
    const payload = { ...record.payload }
    const before = payload.options.length
    payload.options = payload.options.filter((o) => o.optionId !== optionId)
    if (payload.options.length === before) {
      throw new ResourceNotFoundException('候选路径不存在')
    }
    payload.scores = { ...payload.scores }
    delete payload.scores[optionId]
    payload.schemeHash = this.recomputeSchemeHash(payload)
    payload.comparisonRef = null
    payload.updatedAt = DateTime.now().toISO()
    this.validatePayloadOrThrow(payload)

    record.payload = payload
    record.schemeHash = payload.schemeHash
    await record.save()

    await this.audit.log({
      event: AuditEvent.TRIZ_INNOVATION_OPTION_CHANGED,
      userId,
      organizationId,
      projectId,
      entityType: 'triz_innovation_scheme',
      entityId: record.id,
      requestId: requestId ?? null,
      metadata: { schemeId, change: 'remove_option', optionId, schemeHash: payload.schemeHash },
    })
    return record
  }

  // ──────── 评分 / 对比快照 ref / Narrative / Handoff 落库 ────────

  /** 由 §4 评分服务调用：写入确定性评分 + 对比 ref。 */
  async saveScoresAndComparison(
    organizationId: number,
    projectId: number,
    schemeId: string,
    update: {
      scores: Record<string, import('@aiproj/types').InnovationScore>
      comparisonRef: string
    },
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    const payload = { ...record.payload }
    payload.scores = update.scores
    payload.comparisonRef = update.comparisonRef
    payload.updatedAt = DateTime.now().toISO()
    record.payload = payload
    await record.save()
    return record
  }

  async saveNarrative(
    organizationId: number,
    projectId: number,
    schemeId: string,
    narrative: InnovationSchemeNarrative,
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    const payload = { ...record.payload }
    payload.narrative = narrative
    payload.updatedAt = DateTime.now().toISO()
    record.payload = payload
    await record.save()
    return record
  }

  async saveHandoff(
    organizationId: number,
    projectId: number,
    schemeId: string,
    handoff: InnovationHandoffMeta,
    idempotencyKey: string | null,
  ): Promise<TrizInnovationScheme> {
    const record = await this.findInScopeOrFail(organizationId, projectId, schemeId)
    const payload = { ...record.payload }
    payload.handoff = handoff
    payload.updatedAt = DateTime.now().toISO()
    record.payload = payload
    record.handoffStatus = handoff.status
    record.draftSessionRef = handoff.draftSessionRef
    record.idempotencyKey = idempotencyKey
    await record.save()
    return record
  }

  /** 幂等判定：同 idempotency_key 已存在则返回既有记录。 */
  async findByHandoffIdempotencyKey(
    organizationId: number,
    projectId: number,
    idempotencyKey: string,
  ): Promise<TrizInnovationScheme | null> {
    return TrizInnovationScheme.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('idempotency_key', idempotencyKey)
      .first()
  }

  // ──────── 状态迁移便利 ────────

  setStatus(record: TrizInnovationScheme, status: InnovationSchemeStatus): void {
    if (!isInnovationSchemeStatus(status)) return
    record.status = status
  }

  // ──────── DTO ────────

  toDTO(record: TrizInnovationScheme): InnovationSchemeDTO {
    return record.payload
  }

  // ──────── 内部 ────────

  private async findInScopeOrFail(
    organizationId: number,
    projectId: number,
    schemeId: string,
  ): Promise<TrizInnovationScheme> {
    const record = await TrizInnovationScheme.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('scheme_id', schemeId)
      .first()
    if (!record) {
      throw new ResourceNotFoundException('方案不存在')
    }
    return record
  }

  private recomputeSchemeHash(payload: InnovationScheme): string {
    const optionHashes = payload.options.map((o) =>
      computeInnovationOptionHash({
        sourceRefs: o.sourceRefs,
        selectedPathId: o.selectedPathId,
        principleIds: o.principleIds,
        origin: o.origin,
      }),
    )
    return computeInnovationSchemeHash({ optionHashes, name: payload.name })
  }

  private validatePayloadOrThrow(payload: InnovationScheme): void {
    const errors = validateInnovationScheme(payload)
    if (errors.length > 0) {
      throw new ValidationException(`方案结构校验失败：${errors.join('；')}`)
    }
  }

  private generateSchemeId(projectId: number): string {
    const rand = createHash('sha256')
      .update(`${projectId}:${Date.now()}:${Math.random()}`)
      .digest('hex')
      .slice(0, 10)
    return `iw-${projectId}-${rand}`
  }
}
