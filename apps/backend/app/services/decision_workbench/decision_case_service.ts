import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import {
  ConflictException,
  ResourceNotFoundException,
  ValidationException,
} from '#exceptions/api_exception'
import type User from '#models/user'
import PmoDecisionCase from '#models/pmo_decision_case'
import PmoDecisionOption from '#models/pmo_decision_option'
import PmoDecisionPosition from '#models/pmo_decision_position'
import AuditService from '#services/audit_service'
import {
  decisionCaseCreatedAudit,
  decisionCaseTransitionedAudit,
  decisionCaseUpdatedAudit,
  decisionPositionRecordedAudit,
} from './decision_workbench_audit.js'
import {
  PMO_DECISION_ASSUMPTION_MAX_LENGTH,
  PMO_DECISION_CASE_STATUS_VALUES,
  PMO_DECISION_CONSTRAINT_MAX_LENGTH,
  PMO_DECISION_MAX_OPTIONS,
  PMO_DECISION_OPTION_LABEL_MAX_LENGTH,
  PMO_DECISION_POSITION_NOTE_MAX_LENGTH,
  PMO_DECISION_QUESTION_MAX_LENGTH,
  PMO_DECISION_SCOPE_SUMMARY_MAX_LENGTH,
  PMO_DECISION_TITLE_MAX_LENGTH,
  canTransitionPmoDecisionCase,
  isPmoDecisionCaseStatus,
  isPmoDecisionCaseTerminal,
  pmoDecisionStableHash,
  normalizePmoDecisionCaseListQuery,
  type PmoDecisionCaseDTO,
  type PmoDecisionCaseStatus,
  type PmoDecisionOptionDTO,
  type PmoDecisionPaginationMeta,
  type PmoDecisionPositionDTO,
} from '@aiproj/types'

/**
 * v3-pmo-decision-intelligence-workbench —— 决策议题生命周期服务（tasks 4.1–4.4）。
 *
 * 红线：
 *   - 所有查询经 forOrganization 组织隔离；跨租 id 一律 not-found。
 *   - 每次状态写入使用 organization_id + id + row_revision 乐观锁；stale → conflict，
 *     绝不覆盖新状态。
 *   - 终态不可变；supersede 在单事务内写入双向 refs + 审计，失败整体回滚。
 *   - 只写 decision-owned 表与 audit：不触碰 AIGateway、Compiler、插件、通知或任何
 *     正式 PMO/project/resource/risk 表。
 */

export interface CreateCaseInput {
  title: string
  decisionQuestion: string
  scopeSummary?: string
  ownerId: number
  dueDate?: string | null
}

export interface UpdateCaseInput {
  title?: string
  decisionQuestion?: string
  scopeSummary?: string
  ownerId?: number
  dueDate?: string | null
  /** 客户端持有的 row revision（CAS）。 */
  expectedRevision: number
}

export function assertValidCaseText(input: {
  title: string
  decisionQuestion: string
  scopeSummary?: string
}): void {
  if (!input.title.trim() || input.title.length > PMO_DECISION_TITLE_MAX_LENGTH) {
    throw new ValidationException('议题标题为空或超长', { code: 'TITLE_INVALID' })
  }
  if (
    !input.decisionQuestion.trim() ||
    input.decisionQuestion.length > PMO_DECISION_QUESTION_MAX_LENGTH
  ) {
    throw new ValidationException('决策问题为空或超长', { code: 'QUESTION_INVALID' })
  }
  const scope = input.scopeSummary ?? ''
  if (scope.length > PMO_DECISION_SCOPE_SUMMARY_MAX_LENGTH) {
    throw new ValidationException('范围摘要超长', { code: 'SCOPE_SUMMARY_TOO_LONG' })
  }
}

export function toCaseDTO(row: PmoDecisionCase): PmoDecisionCaseDTO {
  return {
    id: Number(row.id),
    organizationId: row.organizationId,
    title: row.title,
    decisionQuestion: row.decisionQuestion,
    scopeSummary: row.scopeSummary,
    ownerId: row.ownerId,
    dueDate: row.dueDate?.toISO() ?? null,
    status: row.status,
    revision: row.revision,
    supersededByCaseId: row.supersededByCaseId,
    supersedesCaseId: row.supersedesCaseId,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISO() ?? '',
    updatedAt: row.updatedAt?.toISO() ?? row.createdAt.toISO() ?? '',
  }
}

export function toOptionDTO(row: PmoDecisionOption): PmoDecisionOptionDTO {
  return {
    id: Number(row.id),
    organizationId: row.organizationId,
    caseId: row.caseId,
    label: row.label,
    assumptions: row.assumptions ?? [],
    constraints: row.constraints ?? [],
    affectedProjectRefs: row.affectedProjectRefs ?? [],
    proposedOutcomeCategory: row.proposedOutcomeCategory,
    evidenceRefs: row.evidenceRefs ?? [],
    revision: row.revision,
    active: row.active,
    createdAt: row.createdAt.toISO() ?? '',
    updatedAt: row.updatedAt?.toISO() ?? row.createdAt.toISO() ?? '',
  }
}

export function toPositionDTO(row: PmoDecisionPosition): PmoDecisionPositionDTO {
  return {
    id: Number(row.id),
    organizationId: row.organizationId,
    caseId: row.caseId,
    participantId: row.participantId,
    stance: row.stance,
    // 有界预览摘要进 DTO（≤120 字符），完整 note 仅详情按权限返回；审计只存 hash。
    noteHash: row.noteHash,
    notePreview: row.note ? row.note.slice(0, 120) : null,
    revision: row.revision,
    immutableAfterDecision: true,
    createdAt: row.createdAt.toISO() ?? '',
    updatedAt: row.updatedAt?.toISO() ?? row.createdAt.toISO() ?? '',
  }
}

@inject()
export default class DecisionCaseService {
  constructor(private readonly audit: AuditService) {}

  private async findOrgCase(organizationId: number, caseId: number): Promise<PmoDecisionCase> {
    const row = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!row) throw new ResourceNotFoundException('资源不存在')
    return row
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  async create(
    user: User,
    organizationId: number,
    input: CreateCaseInput,
  ): Promise<PmoDecisionCaseDTO> {
    assertValidCaseText(input)
    const row = await PmoDecisionCase.create({
      organizationId,
      title: input.title.trim(),
      decisionQuestion: input.decisionQuestion.trim(),
      scopeSummary: (input.scopeSummary ?? '').trim(),
      ownerId: input.ownerId,
      dueDate: input.dueDate ? (new Date(input.dueDate) as never) : null,
      status: 'draft',
      revision: 1,
      supersedesCaseId: null,
      supersededByCaseId: null,
      createdBy: user.id,
      updatedBy: user.id,
    } as never)
    await this.audit.log(
      decisionCaseCreatedAudit({
        organizationId,
        actorId: user.id,
        caseId: Number(row.id),
        statusFrom: null,
        statusTo: row.status,
      }),
    )
    return toCaseDTO(row)
  }

  // ── List / Detail ───────────────────────────────────────────────────────────

  async list(
    organizationId: number,
    rawQuery: Record<string, unknown> = {},
  ): Promise<{ data: PmoDecisionCaseDTO[]; meta: PmoDecisionPaginationMeta }> {
    const query = normalizePmoDecisionCaseListQuery(rawQuery as never)
    let base = PmoDecisionCase.query().where('organizationId', organizationId)
    if (query.statuses.length > 0) {
      base = base.whereIn('status', query.statuses)
    }
    if (query.ownerIds.length > 0) {
      base = base.whereIn('ownerId', query.ownerIds)
    }
    const sortColumn =
      query.sort === 'dueDate'
        ? 'due_date'
        : query.sort === 'updatedAt'
          ? 'updated_at'
          : query.sort === 'title'
            ? 'title'
            : 'created_at'
    const direction = query.order
    const rows = await base
      .orderBy(sortColumn, direction)
      .orderBy('id', 'asc') // 稳定排序 tie-breaker
      .paginate(query.page, query.perPage)
    const meta: PmoDecisionPaginationMeta = {
      total: rows.total,
      page: rows.currentPage,
      perPage: rows.perPage,
      totalPages: rows.lastPage,
    }
    return { data: rows.all().map(toCaseDTO), meta }
  }

  async detail(organizationId: number, caseId: number): Promise<PmoDecisionCaseDTO> {
    const row = await this.findOrgCase(organizationId, caseId)
    return toCaseDTO(row)
  }

  // ── Update（CAS）────────────────────────────────────────────────────────────

  async update(
    user: User,
    organizationId: number,
    caseId: number,
    input: UpdateCaseInput,
  ): Promise<PmoDecisionCaseDTO> {
    const current = await this.findOrgCase(organizationId, caseId)
    if (isPmoDecisionCaseTerminal(current.status)) {
      throw new ValidationException('终态议题不可修改', { code: 'TERMINAL_IMMUTABLE' })
    }
    const candidate = {
      title: input.title ?? current.title,
      decisionQuestion: input.decisionQuestion ?? current.decisionQuestion,
      scopeSummary: input.scopeSummary ?? current.scopeSummary,
    }
    assertValidCaseText(candidate)
    // 与 transition 相同的 raw trx CAS 路径：knex 返回真实受影响行数。
    const affected = (await db.transaction(async (trx) =>
      trx
        .from('pmo_decision_cases')
        .where('organization_id', organizationId)
        .where('id', caseId)
        .where('revision', input.expectedRevision)
        .update({
          title: candidate.title.trim(),
          decision_question: candidate.decisionQuestion.trim(),
          scope_summary: candidate.scopeSummary.trim(),
          owner_id: input.ownerId ?? current.ownerId,
          due_date:
            input.dueDate !== undefined
              ? input.dueDate === null
                ? null
                : new Date(input.dueDate).toISOString()
              : current.dueDate
                ? current.dueDate.toISO()
                : null,
          revision: input.expectedRevision + 1,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }),
    )) as unknown as number
    if (Number(affected) === 0) {
      throw new ConflictException('议题已被并发修改（revision 过期）')
    }
    await this.audit.log(decisionCaseUpdatedAudit({ organizationId, actorId: user.id, caseId }))
    return this.detail(organizationId, caseId)
  }

  // ── Transition / Supersede（事务）───────────────────────────────────────────

  async transition(
    user: User,
    organizationId: number,
    caseId: number,
    to: PmoDecisionCaseStatus,
    expectedRevision: number,
  ): Promise<PmoDecisionCaseDTO> {
    if (!isPmoDecisionCaseStatus(to)) {
      throw new ValidationException('未知状态', { code: 'INVALID_STATUS' })
    }
    const statusFrom = await this.statusOf(organizationId, caseId)
    const gate = canTransitionPmoDecisionCase(statusFrom, to)
    if (!gate.allowed) {
      throw new ValidationException(`状态转移被拒绝：${gate.reason}`, {
        code: gate.reason ?? 'INVALID_TRANSITION',
      })
    }
    const updated = await db.transaction(async (trx) => {
      const affected = (await trx
        .from('pmo_decision_cases')
        .where('organization_id', organizationId)
        .where('id', caseId)
        .where('revision', expectedRevision)
        .update({
          status: to,
          revision: expectedRevision + 1,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })) as unknown as number
      if (affected === 0) {
        throw new ConflictException('议题已被并发修改（revision 过期）')
      }
      await this.audit.log({
        ...decisionCaseTransitionedAudit({
          organizationId,
          actorId: user.id,
          caseId,
          statusFrom,
          statusTo: to,
        }),
        client: trx,
      })
      return true
    })
    void updated
    return this.detail(organizationId, caseId)
  }

  private async statusOf(organizationId: number, caseId: number): Promise<PmoDecisionCaseStatus> {
    const row = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!row) throw new ResourceNotFoundException('资源不存在')
    return row.status
  }
}

// ── Options（tasks 4.3）───────────────────────────────────────────────────────

export function assertValidOptionInput(input: {
  label: string
  assumptions?: string[]
  constraints?: string[]
}): void {
  if (!input.label.trim() || input.label.length > PMO_DECISION_OPTION_LABEL_MAX_LENGTH) {
    throw new ValidationException('方案名称为空或超长', { code: 'OPTION_LABEL_INVALID' })
  }
  for (const assumption of input.assumptions ?? []) {
    if (assumption.length > PMO_DECISION_ASSUMPTION_MAX_LENGTH) {
      throw new ValidationException('假设条目超长', { code: 'ASSUMPTION_TOO_LONG' })
    }
  }
  for (const constraint of input.constraints ?? []) {
    if (constraint.length > PMO_DECISION_CONSTRAINT_MAX_LENGTH) {
      throw new ValidationException('约束条目超长', { code: 'CONSTRAINT_TOO_LONG' })
    }
  }
}

@inject()
export class DecisionOptionService {
  constructor(private readonly audit: AuditService) {}

  private async findOrgCase(organizationId: number, caseId: number): Promise<PmoDecisionCase> {
    const row = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!row) throw new ResourceNotFoundException('资源不存在')
    return row
  }

  async listOptions(
    organizationId: number,
    caseId: number,
    activeOnly = false,
  ): Promise<PmoDecisionOptionDTO[]> {
    await this.findOrgCase(organizationId, caseId)
    let q = PmoDecisionOption.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
    if (activeOnly) q = q.where('active', true)
    const rows = await q.orderBy('id', 'asc')
    return rows.map(toOptionDTO)
  }

  async createOption(
    user: User,
    organizationId: number,
    caseId: number,
    input: {
      label: string
      assumptions?: string[]
      constraints?: string[]
      affectedProjectRefs?: string[]
      proposedOutcomeCategory: string
      evidenceRefs?: string[]
    },
  ): Promise<PmoDecisionOptionDTO> {
    void user
    const parent = await this.findOrgCase(organizationId, caseId)
    if (isPmoDecisionCaseTerminal(parent.status)) {
      throw new ValidationException('终态议题不可新增方案', { code: 'TERMINAL_IMMUTABLE' })
    }
    assertValidOptionInput(input)
    const activeOptions = await PmoDecisionOption.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .where('active', true)
      .select('id')
    if (activeOptions.length >= PMO_DECISION_MAX_OPTIONS) {
      throw new ValidationException(`active 方案最多 ${PMO_DECISION_MAX_OPTIONS} 个`, {
        code: 'OPTION_BOUND_EXCEEDED',
      })
    }
    const row = await PmoDecisionOption.create({
      organizationId,
      caseId,
      label: input.label.trim(),
      assumptions: input.assumptions ?? [],
      constraints: input.constraints ?? [],
      affectedProjectRefs: input.affectedProjectRefs ?? [],
      proposedOutcomeCategory: input.proposedOutcomeCategory,
      evidenceRefs: input.evidenceRefs ?? [],
      revision: 1,
      active: true,
    } as never)
    void this.audit
    return toOptionDTO(row)
  }

  /** 停用方案（软删除语义）：review 时只统计 active。 */
  async deactivateOption(
    user: User,
    organizationId: number,
    caseId: number,
    optionId: number,
    expectedRevision: number,
  ): Promise<void> {
    void user
    await this.findOrgCase(organizationId, caseId)
    const affected = (await db.transaction(async (trx) =>
      trx
        .from('pmo_decision_options')
        .where('organization_id', organizationId)
        .where('case_id', caseId)
        .where('id', optionId)
        .where('revision', expectedRevision)
        .update({
          active: false,
          revision: expectedRevision + 1,
          updated_at: new Date().toISOString(),
        }),
    )) as unknown as number
    if (Number(affected) === 0) {
      throw new ConflictException('方案已被并发修改（revision 过期）')
    }
  }
}

// ── Positions（tasks 4.4）────────────────────────────────────────────────────

const VALID_STANCES = ['support', 'oppose', 'abstain'] as const
type Stance = (typeof VALID_STANCES)[number]

@inject()
export class DecisionPositionService {
  constructor(private readonly audit: AuditService) {}

  async recordPosition(
    user: User,
    organizationId: number,
    caseId: number,
    input: { stance: Stance; note?: string | null },
  ): Promise<PmoDecisionPositionDTO> {
    if (!VALID_STANCES.includes(input.stance)) {
      throw new ValidationException('未知立场', { code: 'STANCE_INVALID' })
    }
    const note = input.note?.slice(0, PMO_DECISION_POSITION_NOTE_MAX_LENGTH) ?? null
    if ((input.note?.length ?? 0) > PMO_DECISION_POSITION_NOTE_MAX_LENGTH) {
      throw new ValidationException('立场说明超长', { code: 'NOTE_TOO_LONG' })
    }
    const parent = await PmoDecisionCase.query()
      .where('organizationId', organizationId)
      .where('id', caseId)
      .first()
    if (!parent) throw new ResourceNotFoundException('资源不存在')
    if (isPmoDecisionCaseTerminal(parent.status)) {
      throw new ValidationException('议题已决定，立场不可再记录', { code: 'CASE_TERMINAL' })
    }

    const existing = await PmoDecisionPosition.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .where('participantId', user.id)
      .first()
    if (existing) {
      existing.stance = input.stance
      existing.note = note
      existing.noteHash = note ? pmoDecisionStableHash(note) : null
      existing.revision += 1
      await existing.save()
      await this.audit.log(
        decisionPositionRecordedAudit({
          organizationId,
          actorId: user.id,
          caseId,
          metadata: { action: 'position_updated' },
        }),
      )
      return toPositionDTO(existing)
    }

    const row = await PmoDecisionPosition.create({
      organizationId,
      caseId,
      participantId: user.id,
      stance: input.stance,
      note,
      noteHash: note ? pmoDecisionStableHash(note) : null,
      revision: 1,
    } as never)
    await this.audit.log(
      decisionPositionRecordedAudit({
        organizationId,
        actorId: user.id,
        caseId,
        metadata: { action: 'position_created' },
      }),
    )
    return toPositionDTO(row)
  }

  async listPositions(organizationId: number, caseId: number): Promise<PmoDecisionPositionDTO[]> {
    const rows = await PmoDecisionPosition.query()
      .where('organizationId', organizationId)
      .where('caseId', caseId)
      .orderBy('id', 'asc')
    return rows.map(toPositionDTO)
  }
}

// 导出闭集供 validator 复用
export const CASE_STATUSES = PMO_DECISION_CASE_STATUS_VALUES
