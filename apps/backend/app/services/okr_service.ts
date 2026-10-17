import { inject } from '@adonisjs/core'
import { ValidationException } from '#exceptions/api_exception'
import OkrCycle from '#models/okr_cycle'
import OkrObjective from '#models/okr_objective'
import OkrKeyResult from '#models/okr_key_result'
import OkrAlignment from '#models/okr_alignment'
import OkrEvidenceLink from '#models/okr_evidence_link'
import OkrProgressHistory from '#models/okr_progress_history'
import OkrPolicy from '#policies/okr_policy'
import type User from '#models/user'
import { DateTime } from 'luxon'
import {
  type OkrCycleCreateRequest,
  type OkrCycleUpdateRequest,
  type OkrObjectiveCreateRequest,
  type OkrObjectiveUpdateRequest,
  type OkrKeyResultCreateRequest,
  type OkrKeyResultUpdateRequest,
  type OkrProgressUpdateRequest,
  type OkrAlignmentCreateRequest,
  type OkrEvidenceLinkCreateRequest,
  type OkrAiDraftRequest,
  type OkrAiDraftResponse,
  type OkrAiDraftConfirmationRequest,
  type OkrCycleListQuery,
  type OkrObjectiveListQuery,
  type OkrTreeQuery,
  type OkrKeyResultListQuery,
  type OkrEvidenceListQuery,
  type OkrListMeta,
  type OkrObjectiveTree,
  type OkrWarning,
  type OkrMeasurementType,
  OKR_METRIC_VERSION,
  OKR_ALIGNMENT_CONSTRAINTS,
  OKR_DISABLED_SCOPES,
  computeOkrRollup,
  validateAlignment,
  validateMeasurementBounds,
  okrStableHash,
} from '@aiproj/types'

// ── DTO Helpers ─────────────────────────────────────────────────────────────

function toCycleDto(row: OkrCycle) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    title: row.title,
    description: row.description ?? null,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function toObjectiveDto(row: OkrObjective) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    cycleId: row.cycleId,
    projectId: row.projectId,
    teamId: null as number | null,
    ownerId: row.ownerId,
    scope: row.scope,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    weight: row.weight,
    progress: row.progress,
    confidence: row.confidence,
    startDate: row.startDate,
    endDate: row.endDate,
    metricVersion: row.metricVersion,
    calculatedAt:
      row.calculatedAt instanceof DateTime
        ? row.calculatedAt.toISO()!
        : row.calculatedAt
          ? String(row.calculatedAt)
          : null,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function toKeyResultDto(row: OkrKeyResult) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    objectiveId: row.objectiveId,
    title: row.title,
    description: row.description ?? null,
    measurementType: row.measurementType,
    unitLabel: row.unitLabel ?? null,
    baselineValue: row.baselineValue,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    confidence: row.confidence,
    status: row.status,
    weight: row.weight,
    lastUpdatedAt:
      row.lastUpdatedAt instanceof DateTime
        ? row.lastUpdatedAt.toISO()!
        : row.lastUpdatedAt
          ? String(row.lastUpdatedAt)
          : null,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function toAlignmentDto(row: OkrAlignment) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    childObjectiveId: row.childObjectiveId,
    parentObjectiveId: row.parentObjectiveId,
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function toEvidenceLinkDto(row: OkrEvidenceLink) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    targetType: row.targetType,
    targetId: row.targetId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    summary: row.summary,
    hash: row.hash,
    lastSeenAt:
      row.lastSeenAt instanceof DateTime ? row.lastSeenAt.toISO()! : String(row.lastSeenAt),
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
    updatedAt: row.updatedAt instanceof DateTime ? row.updatedAt.toISO()! : String(row.updatedAt),
    deletedAt: row.deletedAt instanceof DateTime ? row.deletedAt.toISO()! : null,
  }
}

function toProgressHistoryDto(row: OkrProgressHistory) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    keyResultId: row.keyResultId,
    previousValue: row.previousValue,
    newValue: row.newValue,
    source: row.source,
    confidence: row.confidence,
    note: row.note,
    evidenceRefs: row.evidenceRefs,
    recordedBy: row.recordedBy,
    recordedAt:
      row.recordedAt instanceof DateTime ? row.recordedAt.toISO()! : String(row.recordedAt),
    createdAt: row.createdAt instanceof DateTime ? row.createdAt.toISO()! : String(row.createdAt),
  }
}

function makeMeta(total: number, page: number, perPage: number): OkrListMeta {
  return { total, page, perPage, totalPages: Math.ceil(total / perPage) }
}

// ── Service ─────────────────────────────────────────────────────────────────

@inject()
export default class OkrService {
  constructor(private readonly policy: OkrPolicy) {}

  // ══════════════════════════════════════════════════════════════════════
  // Cycles
  // ══════════════════════════════════════════════════════════════════════

  async listCycles(organizationId: number, query: OkrCycleListQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    const sort = query.sort ?? 'createdAt'
    const order = query.order ?? 'desc'

    let q = OkrCycle.query().where('organization_id', organizationId).whereNull('deleted_at')
    if (query.status) q = q.where('status', query.status)

    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy(sort, order)
      .offset((page - 1) * perPage)
      .limit(perPage)
    return { data: rows.map(toCycleDto), meta: makeMeta(total, page, perPage) }
  }

  async getCycle(cycleId: number, user: User) {
    const cycle = await OkrCycle.find(cycleId)
    if (!cycle || cycle.deletedAt) throw new ValidationException('OKR 周期不存在')
    await this.policy.assertOrganizationVisible(user, cycle.organizationId)
    await this.policy.authorizeView(user, cycle.organizationId)
    return { data: toCycleDto(cycle) }
  }

  async createCycle(organizationId: number, input: OkrCycleCreateRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeCreate(user, organizationId)
    const cycle = await OkrCycle.create({
      organizationId,
      title: input.title,
      description: input.description ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status ?? 'draft',
    })
    return { data: toCycleDto(cycle) }
  }

  async updateCycle(cycleId: number, input: OkrCycleUpdateRequest, user: User) {
    const cycle = await OkrCycle.find(cycleId)
    if (!cycle || cycle.deletedAt) throw new ValidationException('OKR 周期不存在')
    await this.policy.assertOrganizationVisible(user, cycle.organizationId)
    await this.policy.authorizeUpdate(user, cycle.organizationId)
    if (input.title !== undefined) cycle.title = input.title
    if (input.description !== undefined) cycle.description = input.description
    if (input.startDate !== undefined) cycle.startDate = input.startDate
    if (input.endDate !== undefined) cycle.endDate = input.endDate
    if (input.status !== undefined) cycle.status = input.status
    await cycle.save()
    return { data: toCycleDto(cycle) }
  }

  async archiveCycle(cycleId: number, user: User) {
    const cycle = await OkrCycle.find(cycleId)
    if (!cycle || cycle.deletedAt) throw new ValidationException('OKR 周期不存在')
    await this.policy.assertOrganizationVisible(user, cycle.organizationId)
    await this.policy.authorizeArchive(user, cycle.organizationId)
    cycle.deletedAt = DateTime.now()
    await cycle.save()
    return { data: toCycleDto(cycle) }
  }

  async restoreCycle(cycleId: number, user: User) {
    const cycle = await OkrCycle.queryOnlyTrashed().where('id', cycleId).first()
    if (!cycle) throw new ValidationException('OKR 周期不存在或未被归档')
    await this.policy.assertOrganizationVisible(user, cycle.organizationId)
    await this.policy.authorizeRestore(user, cycle.organizationId)
    cycle.deletedAt = null
    await cycle.save()
    return { data: toCycleDto(cycle) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Objectives
  // ══════════════════════════════════════════════════════════════════════

  async listObjectives(organizationId: number, query: OkrObjectiveListQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)

    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    const sort = query.sort ?? 'createdAt'
    const order = query.order ?? 'desc'

    let q = OkrObjective.query().where('organization_id', organizationId).whereNull('deleted_at')
    if (query.cycleId) q = q.where('cycle_id', query.cycleId)
    if (query.scope) q = q.where('scope', query.scope)
    if (query.status) q = q.where('status', query.status)
    if (query.ownerId) q = q.where('owner_id', query.ownerId)
    if (query.projectId) q = q.where('project_id', query.projectId)

    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy(sort, order)
      .offset((page - 1) * perPage)
      .limit(perPage)
    return { data: rows.map(toObjectiveDto), meta: makeMeta(total, page, perPage) }
  }

  async getObjective(objectiveId: number, user: User) {
    const objective = await OkrObjective.find(objectiveId)
    if (!objective || objective.deletedAt) throw new ValidationException('目标不存在')
    await this.policy.assertOrganizationVisible(user, objective.organizationId)
    await this.policy.authorizeView(user, objective.organizationId)
    const krs = await OkrKeyResult.query()
      .where('objective_id', objectiveId)
      .whereNull('deleted_at')
    const rollup = computeOkrRollup(krs.map(toKeyResultDto) as any, [])
    return { data: { ...toObjectiveDto(objective), rollup, keyResults: krs.map(toKeyResultDto) } }
  }

  async createObjective(organizationId: number, input: OkrObjectiveCreateRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeCreate(user, organizationId)
    if (OKR_DISABLED_SCOPES.includes(input.scope as any))
      throw new ValidationException(`scope '${input.scope}' 当前默认禁用写入`)
    const objective = await OkrObjective.create({
      organizationId,
      cycleId: input.cycleId ?? null,
      projectId: input.projectId ?? null,
      ownerId: input.ownerId ?? null,
      scope: input.scope,
      title: input.title,
      description: input.description ?? null,
      status: input.status ?? 'draft',
      weight: input.weight ?? 1,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      metricVersion: OKR_METRIC_VERSION,
    })
    return { data: toObjectiveDto(objective) }
  }

  async updateObjective(objectiveId: number, input: OkrObjectiveUpdateRequest, user: User) {
    const objective = await OkrObjective.find(objectiveId)
    if (!objective || objective.deletedAt) throw new ValidationException('目标不存在')
    await this.policy.assertOrganizationVisible(user, objective.organizationId)
    await this.policy.authorizeUpdate(user, objective.organizationId)
    if (input.scope && OKR_DISABLED_SCOPES.includes(input.scope as any))
      throw new ValidationException(`scope '${input.scope}' 当前默认禁用写入`)
    if (input.cycleId !== undefined) objective.cycleId = input.cycleId
    if (input.projectId !== undefined) objective.projectId = input.projectId
    if (input.ownerId !== undefined) objective.ownerId = input.ownerId
    if (input.scope !== undefined) objective.scope = input.scope
    if (input.title !== undefined) objective.title = input.title
    if (input.description !== undefined) objective.description = input.description
    if (input.status !== undefined) objective.status = input.status
    if (input.weight !== undefined) objective.weight = input.weight
    if (input.startDate !== undefined) objective.startDate = input.startDate
    if (input.endDate !== undefined) objective.endDate = input.endDate
    await objective.save()
    return { data: toObjectiveDto(objective) }
  }

  async archiveObjective(objectiveId: number, user: User) {
    const objective = await OkrObjective.find(objectiveId)
    if (!objective || objective.deletedAt) throw new ValidationException('目标不存在')
    await this.policy.assertOrganizationVisible(user, objective.organizationId)
    await this.policy.authorizeArchive(user, objective.organizationId)
    objective.deletedAt = DateTime.now()
    await objective.save()
    return { data: toObjectiveDto(objective) }
  }

  async restoreObjective(objectiveId: number, user: User) {
    const objective = await OkrObjective.queryOnlyTrashed().where('id', objectiveId).first()
    if (!objective) throw new ValidationException('Objective 不存在或未被归档')
    await this.policy.assertOrganizationVisible(user, objective.organizationId)
    await this.policy.authorizeRestore(user, objective.organizationId)
    objective.deletedAt = null
    await objective.save()
    return { data: toObjectiveDto(objective) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Tree
  // ══════════════════════════════════════════════════════════════════════

  async getTree(organizationId: number, query: OkrTreeQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)
    const maxDepth = query.depth ?? OKR_ALIGNMENT_CONSTRAINTS.MAX_DEPTH

    let rootQuery = OkrObjective.query()
      .where('organization_id', organizationId)
      .whereNull('deleted_at')
    if (query.cycleId) rootQuery = rootQuery.where('cycle_id', query.cycleId)
    if (query.scope) rootQuery = rootQuery.where('scope', query.scope)
    if (query.status) rootQuery = rootQuery.where('status', query.status)
    if (query.rootObjectiveId) rootQuery = rootQuery.where('id', query.rootObjectiveId)

    const roots = await rootQuery.orderBy('created_at', 'asc')
    const warnings: OkrWarning[] = []
    let totalNodes = 0
    let actualMaxDepth = 0
    const trees: OkrObjectiveTree[] = []

    for (const root of roots) {
      const tree = await this.buildTreeNode(root, maxDepth, 0, warnings, user)
      trees.push(tree)
      totalNodes += this.countNodes(tree)
      actualMaxDepth = Math.max(actualMaxDepth, this.maxDepth(tree, 0))
    }

    const truncated = totalNodes > 1000
    if (truncated)
      warnings.push({
        code: 'LARGE_TREE_TRUNCATED',
        message: `大树已被截断，总节点数 ${totalNodes}`,
      })

    return { data: trees, meta: { totalNodes, maxDepth: actualMaxDepth, truncated, warnings } }
  }

  private async buildTreeNode(
    objective: OkrObjective,
    maxDepth: number,
    currentDepth: number,
    warnings: OkrWarning[],
    _user: User,
  ): Promise<OkrObjectiveTree> {
    const krs = await OkrKeyResult.query()
      .where('objective_id', objective.id)
      .whereNull('deleted_at')
    const alignments = await OkrAlignment.query()
      .where('child_objective_id', objective.id)
      .whereNull('deleted_at')
    const evidence = await OkrEvidenceLink.query()
      .where('target_type', 'objective')
      .where('target_id', objective.id)
      .whereNull('deleted_at')

    let children: OkrObjectiveTree[] = []
    if (currentDepth < maxDepth) {
      const childAlignments = await OkrAlignment.query()
        .where('parent_objective_id', objective.id)
        .whereNull('deleted_at')
      const childIds = childAlignments.map((a) => a.childObjectiveId)
      if (childIds.length > 0) {
        const childObjectives = await OkrObjective.query()
          .whereIn('id', childIds)
          .whereNull('deleted_at')
        for (const child of childObjectives) {
          children.push(
            await this.buildTreeNode(child, maxDepth, currentDepth + 1, warnings, _user),
          )
        }
      }
    }
    return {
      objective: toObjectiveDto(objective) as any,
      children,
      keyResults: krs.map(toKeyResultDto) as any,
      alignments: alignments.map(toAlignmentDto) as any,
      evidence: evidence.map(toEvidenceLinkDto) as any,
    }
  }

  private countNodes(tree: OkrObjectiveTree): number {
    return 1 + tree.children.reduce((sum, c) => sum + this.countNodes(c), 0)
  }

  private maxDepth(tree: OkrObjectiveTree, depth: number): number {
    return tree.children.reduce((max, c) => Math.max(max, this.maxDepth(c, depth + 1)), depth)
  }

  // ══════════════════════════════════════════════════════════════════════
  // Key Results
  // ══════════════════════════════════════════════════════════════════════

  async listKeyResults(organizationId: number, query: OkrKeyResultListQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)
    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    const sort = query.sort ?? 'createdAt'
    const order = query.order ?? 'desc'
    let q = OkrKeyResult.query().where('organization_id', organizationId).whereNull('deleted_at')
    if (query.objectiveId) q = q.where('objective_id', query.objectiveId)
    if (query.status) q = q.where('status', query.status)
    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy(sort, order)
      .offset((page - 1) * perPage)
      .limit(perPage)
    return { data: rows.map(toKeyResultDto), meta: makeMeta(total, page, perPage) }
  }

  async getKeyResult(krId: number, user: User) {
    const kr = await OkrKeyResult.find(krId)
    if (!kr || kr.deletedAt) throw new ValidationException('关键结果不存在')
    await this.policy.assertOrganizationVisible(user, kr.organizationId)
    await this.policy.authorizeView(user, kr.organizationId)
    return { data: toKeyResultDto(kr) }
  }

  async createKeyResult(organizationId: number, input: OkrKeyResultCreateRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeCreate(user, organizationId)
    const objective = await OkrObjective.find(input.objectiveId)
    if (!objective || objective.deletedAt || objective.organizationId !== organizationId)
      throw new ValidationException('Objective 不存在')
    const boundCheck = validateMeasurementBounds(
      input.measurementType as OkrMeasurementType,
      input.baselineValue,
    )
    if (!boundCheck.valid) throw new ValidationException(boundCheck.message!)
    const kr = await OkrKeyResult.create({
      organizationId,
      objectiveId: input.objectiveId,
      title: input.title,
      description: input.description ?? null,
      measurementType: input.measurementType,
      unitLabel: input.unitLabel ?? null,
      baselineValue: input.baselineValue,
      targetValue: input.targetValue,
      currentValue: input.currentValue ?? input.baselineValue,
      confidence: input.confidence ?? 'medium',
      status: input.status ?? 'draft',
      weight: input.weight ?? 1,
    })
    return { data: toKeyResultDto(kr) }
  }

  async updateKeyResult(krId: number, input: OkrKeyResultUpdateRequest, user: User) {
    const kr = await OkrKeyResult.find(krId)
    if (!kr || kr.deletedAt) throw new ValidationException('关键结果不存在')
    await this.policy.assertOrganizationVisible(user, kr.organizationId)
    await this.policy.authorizeUpdate(user, kr.organizationId)
    if (input.title !== undefined) kr.title = input.title
    if (input.description !== undefined) kr.description = input.description
    if (input.measurementType !== undefined) kr.measurementType = input.measurementType
    if (input.unitLabel !== undefined) kr.unitLabel = input.unitLabel
    if (input.baselineValue !== undefined) kr.baselineValue = input.baselineValue
    if (input.targetValue !== undefined) kr.targetValue = input.targetValue
    if (input.currentValue !== undefined) kr.currentValue = input.currentValue
    if (input.confidence !== undefined) kr.confidence = input.confidence
    if (input.status !== undefined) kr.status = input.status
    if (input.weight !== undefined) kr.weight = input.weight
    await kr.save()
    return { data: toKeyResultDto(kr) }
  }

  async archiveKeyResult(krId: number, user: User) {
    const kr = await OkrKeyResult.find(krId)
    if (!kr || kr.deletedAt) throw new ValidationException('关键结果不存在')
    await this.policy.assertOrganizationVisible(user, kr.organizationId)
    await this.policy.authorizeArchive(user, kr.organizationId)
    kr.deletedAt = DateTime.now()
    await kr.save()
    return { data: toKeyResultDto(kr) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Progress
  // ══════════════════════════════════════════════════════════════════════

  async updateProgress(krId: number, input: OkrProgressUpdateRequest, user: User) {
    const kr = await OkrKeyResult.find(krId)
    if (!kr || kr.deletedAt) throw new ValidationException('关键结果不存在')
    await this.policy.assertOrganizationVisible(user, kr.organizationId)
    await this.policy.authorizeProgress(user, kr.organizationId)
    const boundCheck = validateMeasurementBounds(
      kr.measurementType as OkrMeasurementType,
      input.currentValue,
    )
    if (!boundCheck.valid) throw new ValidationException(boundCheck.message!)
    const previousValue = kr.currentValue
    kr.currentValue = input.currentValue
    kr.confidence = input.confidence ?? kr.confidence
    kr.lastUpdatedAt = DateTime.now()
    await kr.save()
    await OkrProgressHistory.create({
      organizationId: kr.organizationId,
      keyResultId: kr.id,
      previousValue,
      newValue: input.currentValue,
      source: 'manual',
      confidence: input.confidence ?? kr.confidence,
      note: input.note ?? null,
      evidenceRefs: input.evidenceRefs ?? null,
      recordedBy: user.id,
      recordedAt: DateTime.now(),
    })
    const objective = await OkrObjective.find(kr.objectiveId)
    if (objective) {
      const allKrs = await OkrKeyResult.query()
        .where('objective_id', objective.id)
        .whereNull('deleted_at')
      const rollup = computeOkrRollup(allKrs.map(toKeyResultDto) as any, [])
      objective.progress = rollup.progress
      objective.confidence = rollup.confidence
      objective.calculatedAt = DateTime.now()
      await objective.save()
    }
    return { data: toKeyResultDto(kr) }
  }

  async getProgressHistory(krId: number, user: User) {
    const kr = await OkrKeyResult.find(krId)
    if (!kr || kr.deletedAt) throw new ValidationException('关键结果不存在')
    await this.policy.assertOrganizationVisible(user, kr.organizationId)
    await this.policy.authorizeView(user, kr.organizationId)
    const history = await OkrProgressHistory.query()
      .where('key_result_id', krId)
      .orderBy('recorded_at', 'desc')
    return { data: history.map(toProgressHistoryDto) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Alignments
  // ══════════════════════════════════════════════════════════════════════

  async createAlignment(organizationId: number, input: OkrAlignmentCreateRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeUpdate(user, organizationId)
    const child = await OkrObjective.find(input.childObjectiveId)
    const parent = await OkrObjective.find(input.parentObjectiveId)
    if (!child || child.deletedAt || child.organizationId !== organizationId)
      throw new ValidationException('子目标不存在')
    if (!parent || parent.deletedAt || parent.organizationId !== organizationId)
      throw new ValidationException('父目标不存在')
    const existingAlignments = await OkrAlignment.query()
      .where('child_objective_id', input.childObjectiveId)
      .whereNull('deleted_at')
    const ancestors = await this.getAncestorIds(input.parentObjectiveId)
    const alignmentCheck = validateAlignment(
      toObjectiveDto(child) as any,
      toObjectiveDto(parent) as any,
      existingAlignments.map(toAlignmentDto) as any,
      ancestors,
    )
    if (!alignmentCheck.valid)
      throw new ValidationException(alignmentCheck.warning?.message ?? '对齐校验失败')
    const alignment = await OkrAlignment.create({
      organizationId,
      childObjectiveId: input.childObjectiveId,
      parentObjectiveId: input.parentObjectiveId,
    })
    return { data: toAlignmentDto(alignment) }
  }

  async removeAlignment(alignmentId: number, user: User) {
    const alignment = await OkrAlignment.find(alignmentId)
    if (!alignment || alignment.deletedAt) throw new ValidationException('对齐关系不存在')
    await this.policy.assertOrganizationVisible(user, alignment.organizationId)
    await this.policy.authorizeUpdate(user, alignment.organizationId)
    alignment.deletedAt = DateTime.now()
    await alignment.save()
    return { data: toAlignmentDto(alignment) }
  }

  async listAlignments(objectiveId: number, user: User) {
    const objective = await OkrObjective.find(objectiveId)
    if (!objective || objective.deletedAt) throw new ValidationException('目标不存在')
    await this.policy.assertOrganizationVisible(user, objective.organizationId)
    await this.policy.authorizeView(user, objective.organizationId)
    const alignments = await OkrAlignment.query()
      .where('child_objective_id', objectiveId)
      .orWhere('parent_objective_id', objectiveId)
      .whereNull('deleted_at')
    return { data: alignments.map(toAlignmentDto) }
  }

  private async getAncestorIds(objectiveId: number): Promise<number[]> {
    const ancestors: number[] = []
    let currentId: number | null = objectiveId
    const visited = new Set<number>()
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId)
      const alignment = await OkrAlignment.query()
        .where('child_objective_id', currentId)
        .whereNull('deleted_at')
        .first()
      if (alignment) {
        ancestors.push(alignment.parentObjectiveId)
        currentId = alignment.parentObjectiveId
      } else currentId = null
    }
    return ancestors
  }

  // ══════════════════════════════════════════════════════════════════════
  // Evidence
  // ══════════════════════════════════════════════════════════════════════

  async createEvidenceLink(
    organizationId: number,
    input: OkrEvidenceLinkCreateRequest,
    user: User,
  ) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeEvidence(user, organizationId)
    const hash = okrStableHash(
      `${input.targetType}:${input.targetId}:${input.sourceKind}:${input.sourceId}`,
    )
    const link = await OkrEvidenceLink.create({
      organizationId,
      targetType: input.targetType,
      targetId: input.targetId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      summary: input.summary,
      hash,
      lastSeenAt: DateTime.now(),
    })
    return { data: toEvidenceLinkDto(link) }
  }

  async listEvidence(organizationId: number, query: OkrEvidenceListQuery, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeView(user, organizationId)
    const page = query.page ?? 1
    const perPage = query.perPage ?? 25
    let q = OkrEvidenceLink.query().where('organization_id', organizationId).whereNull('deleted_at')
    if (query.targetType) q = q.where('target_type', query.targetType)
    if (query.targetId) q = q.where('target_id', query.targetId)
    if (query.sourceKind) q = q.where('source_kind', query.sourceKind)
    const totalRows = await q.clone().count('* as total')
    const total = Number(totalRows[0].$extras.total)
    const rows = await q
      .orderBy('last_seen_at', 'desc')
      .offset((page - 1) * perPage)
      .limit(perPage)
    const access = await this.policy.resolveAccess(user, organizationId)
    const filtered = rows.map((r) => {
      if (!access.canViewEvidence && r.sourceKind === 'project')
        return { ...toEvidenceLinkDto(r), summary: '[受限]', hash: '[redacted]' }
      return toEvidenceLinkDto(r)
    })
    return { data: filtered, meta: makeMeta(total, page, perPage) }
  }

  // ══════════════════════════════════════════════════════════════════════
  // AI Draft (mock — 不调用真实 AI)
  // ══════════════════════════════════════════════════════════════════════

  async generateAiDraft(
    organizationId: number,
    input: OkrAiDraftRequest,
    user: User,
  ): Promise<OkrAiDraftResponse> {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeAiDraft(user, organizationId)
    return {
      objectives: [
        {
          title: '示例目标',
          description: '这是 AI 生成的 OKR 草案示例',
          scope: input.scope ?? 'organization',
          confidence: 'medium',
          keyResults: [
            {
              title: '示例关键结果',
              description: '可度量的关键结果',
              measurementType: 'percent',
              unitLabel: '%',
              baselineValue: 0,
              targetValue: 100,
              confidence: 'medium',
            },
          ],
          alignment: input.includeAlignment
            ? { parentObjectiveTitle: '组织战略目标', rationale: '支持组织整体方向' }
            : undefined,
        },
      ],
      risks: input.includeRisk
        ? [
            {
              code: 'AI_DRAFT_UNAVAILABLE' as any,
              message: 'AI 草案功能使用 mock 模式',
              severity: 'low' as const,
              suggestion: '后续对接真实 AIGateway',
            },
          ]
        : [],
      assumptions: ['基于当前组织数据生成', '需人工审查确认'],
      sourceRefs: ['组织上下文', '项目列表'],
      confidence: 'medium',
      warnings: [],
    }
  }

  async confirmAiDraft(organizationId: number, input: OkrAiDraftConfirmationRequest, user: User) {
    await this.policy.assertOrganizationVisible(user, organizationId)
    await this.policy.authorizeCreate(user, organizationId)
    const created: any[] = []
    for (const item of input.accepted) {
      if (item.kind === 'objective') {
        const objective = await this.createObjective(organizationId, item.data as any, user)
        created.push(objective.data)
      } else if (item.kind === 'key_result') {
        const keyResult = await this.createKeyResult(organizationId, item.data as any, user)
        created.push(keyResult.data)
      }
    }
    return { data: created }
  }
}
