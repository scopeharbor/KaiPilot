import { ValidationException } from '#exceptions/api_exception'
import CompilerRun from '#models/compiler_run'
import TaskResourceRequirement from '#models/task_resource_requirement'
import AuditService, { AuditEvent } from '#services/audit_service'
import { ArtifactStore } from '#services/compiler/artifact_store'
import ResourceAllocationService, {
  type CreateAllocationInput,
} from '#services/resource_allocation_service'
import ResourceInvalidationService from '#services/resource_invalidation_service'
import ResourceMatchingService from '#services/resource_matching_service'
import ResourcePlanningService from '#services/resource_planning_service'
import TaskResourceRequirementService, {
  type CreateTaskResourceRequirementInput,
  type UpdateTaskResourceRequirementInput,
} from '#services/task_resource_requirement_service'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import { createHash } from 'node:crypto'

type RequirementOperationType = 'create_requirement' | 'update_requirement' | 'delete_requirement'

type SuggestionOperationType = RequirementOperationType | 'create_resource_allocation'

interface RequirementOperationInput {
  type: RequirementOperationType
  requirementId?: number
  input?: Record<string, unknown>
}

interface AllocationCandidateInput {
  requirementId: number
  resourceId?: number
  allocationType?: string
  allocationPercent?: number
}

export interface ResourceSuggestionPreviewInput {
  requirementOperations?: RequirementOperationInput[]
  allocationCandidates?: AllocationCandidateInput[]
  from?: string
  to?: string
}

export interface ResourceSuggestionApplyInput {
  confirm?: boolean
  previewHash?: string
  operations?: ResourceSuggestionOperation[]
}

export interface ResourceSuggestionOperation {
  id: string
  type: SuggestionOperationType
  entityType: 'task_resource_requirement' | 'resource_allocation'
  action: 'create' | 'update' | 'delete'
  requirementId?: number
  resourceId?: number
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  input?: Record<string, unknown>
}

const FORBIDDEN_COMPUTED_FIELDS = new Set([
  'computedload',
  'computedcapacity',
  'computedloadpercent',
  'loadpercent',
  'utilization',
  'utilizationpercent',
  'remaininghours',
  'capacityhours',
  'availablecapacityhours',
  'requiredcapacityhours',
  'overload',
  'overloaded',
])

export default class ResourceSuggestionService {
  private matching = new ResourceMatchingService()
  private planning = new ResourcePlanningService()
  private invalidation = new ResourceInvalidationService()

  constructor(
    private requirements = new TaskResourceRequirementService(),
    private allocations = new ResourceAllocationService(new AuditService()),
    private audit = new AuditService(),
    private artifactStore = new ArtifactStore(),
  ) {}

  async preview(
    organizationId: number,
    projectId: number,
    input: ResourceSuggestionPreviewInput,
    actorUserId: number,
  ) {
    this.rejectComputedFields(input)
    const operations: ResourceSuggestionOperation[] = []

    for (const operation of input.requirementOperations ?? []) {
      operations.push(await this.previewRequirementOperation(organizationId, projectId, operation))
    }

    for (const candidate of input.allocationCandidates ?? []) {
      operations.push(await this.previewAllocationCandidate(organizationId, projectId, candidate))
    }

    const window = await this.resolveWindow(organizationId, projectId, input, operations)
    const planning = await this.planning.getPlanning(organizationId, projectId, window)
    const previewHash = this.hashOperations(operations)
    const diff = {
      creates: operations.filter((operation) => operation.action === 'create').length,
      updates: operations.filter((operation) => operation.action === 'update').length,
      deletes: operations.filter((operation) => operation.action === 'delete').length,
    }
    const evidence = await this.writeSuggestionEvidence({
      organizationId,
      projectId,
      actorUserId,
      previewHash,
      operations,
      diff,
      window,
      phase: 'preview',
      writesApplied: false,
    })

    return {
      previewHash,
      operations,
      diff,
      deterministicFacts: {
        source: 'resource_planning_service',
        generatedAt: new Date().toISOString(),
        writesApplied: false,
        trustedClientComputedLoadFields: false,
        window,
        summary: planning.summary,
      },
      evidence,
    }
  }

  async apply(
    organizationId: number,
    projectId: number,
    input: ResourceSuggestionApplyInput,
    actorUserId: number,
  ) {
    this.rejectComputedFields(input)
    if (input.confirm !== true) {
      throw new ValidationException('采纳资源建议必须显式确认')
    }
    const operations = input.operations ?? []
    if (operations.length === 0) throw new ValidationException('采纳操作不能为空')
    const previewHash = this.hashOperations(operations)
    if (!input.previewHash || input.previewHash !== previewHash) {
      throw new ValidationException('资源建议预览摘要不匹配，请重新生成预览')
    }

    const applied = await db.transaction(async (trx) => {
      const results: Array<{ operationId: string; entityType: string; entityId?: number }> = []
      for (const operation of operations) {
        results.push(
          await this.applyOperation(organizationId, projectId, operation, actorUserId, trx),
        )
      }
      await this.audit.log({
        event: AuditEvent.RESOURCE_SUGGESTION_APPLIED,
        userId: actorUserId,
        organizationId,
        projectId,
        entityType: 'resource_suggestion',
        entityId: null,
        metadata: {
          previewHash,
          operationCount: operations.length,
          operationTypes: operations.map((operation) => operation.type),
        },
        client: trx,
        strict: true,
      })
      return results
    })

    const evidence = await this.writeSuggestionEvidence({
      organizationId,
      projectId,
      actorUserId,
      previewHash,
      operations,
      diff: {
        creates: operations.filter((operation) => operation.action === 'create').length,
        updates: operations.filter((operation) => operation.action === 'update').length,
        deletes: operations.filter((operation) => operation.action === 'delete').length,
      },
      window: await this.resolveWindow(organizationId, projectId, {}, operations),
      phase: 'apply',
      writesApplied: true,
      applied,
    })

    this.invalidation.broadcast({
      organizationId,
      projectId,
      actorUserId,
      reason: 'resource_suggestion_applied',
      entityType: 'resource_suggestion',
      entityId: 0,
    })

    return {
      previewHash,
      applied,
      meta: {
        writesApplied: true,
        appliedAt: new Date().toISOString(),
        evidence,
      },
    }
  }

  unsupportedLeveling(): never {
    throw new ValidationException('RESOURCE_LEVELING_NOT_SUPPORTED')
  }

  hashOperations(operations: ResourceSuggestionOperation[]): string {
    return createHash('sha256')
      .update(JSON.stringify(this.stable(operations)))
      .digest('hex')
  }

  private async previewRequirementOperation(
    organizationId: number,
    projectId: number,
    operation: RequirementOperationInput,
  ): Promise<ResourceSuggestionOperation> {
    if (
      !['create_requirement', 'update_requirement', 'delete_requirement'].includes(operation.type)
    ) {
      throw new ValidationException('资源需求建议操作类型无效')
    }
    if (operation.type === 'create_requirement') {
      if (!operation.input) throw new ValidationException('新增资源需求建议缺少输入')
      return {
        id: this.operationId(operation),
        type: operation.type,
        entityType: 'task_resource_requirement',
        action: 'create',
        before: null,
        after: operation.input,
        input: operation.input,
      }
    }

    if (!operation.requirementId) throw new ValidationException('资源需求建议缺少 requirementId')
    const requirement = await this.requirements.get(
      organizationId,
      projectId,
      operation.requirementId,
    )
    const before = this.requirementSnapshot(requirement)
    if (operation.type === 'delete_requirement') {
      return {
        id: this.operationId(operation),
        type: operation.type,
        entityType: 'task_resource_requirement',
        action: 'delete',
        requirementId: operation.requirementId,
        before,
        after: null,
      }
    }
    if (!operation.input) throw new ValidationException('更新资源需求建议缺少输入')
    return {
      id: this.operationId(operation),
      type: operation.type,
      entityType: 'task_resource_requirement',
      action: 'update',
      requirementId: operation.requirementId,
      before,
      after: { ...before, ...operation.input },
      input: operation.input,
    }
  }

  private async previewAllocationCandidate(
    organizationId: number,
    projectId: number,
    candidate: AllocationCandidateInput,
  ): Promise<ResourceSuggestionOperation> {
    const match = await this.matching.matchRequirement(
      organizationId,
      projectId,
      candidate.requirementId,
      10,
    )
    const selected =
      candidate.resourceId !== undefined
        ? match.candidates.find((item) => item.resourceId === candidate.resourceId)
        : match.candidates[0]
    if (!selected) throw new ValidationException('未找到可采纳的资源分配候选')

    const requirement = await this.requirements.get(
      organizationId,
      projectId,
      candidate.requirementId,
    )
    const allocationInput: CreateAllocationInput = {
      taskId: requirement.taskId,
      allocationType: candidate.allocationType ?? 'assigned',
      allocationPercent:
        candidate.allocationPercent ?? Number(requirement.allocationPercent ?? 100),
      startDate: requirement.startDate.toISODate()!,
      endDate: requirement.endDate.toISODate()!,
      plannedUnits:
        requirement.estimatedPersonDays === null ? null : Number(requirement.estimatedPersonDays),
    }

    return {
      id: this.operationId({ type: 'create_resource_allocation', ...candidate }),
      type: 'create_resource_allocation',
      entityType: 'resource_allocation',
      action: 'create',
      requirementId: candidate.requirementId,
      resourceId: selected.resourceId,
      before: null,
      after: {
        resourceId: selected.resourceId,
        taskId: allocationInput.taskId,
        allocationType: allocationInput.allocationType,
        allocationPercent: allocationInput.allocationPercent,
        startDate: allocationInput.startDate,
        endDate: allocationInput.endDate,
        plannedUnits: allocationInput.plannedUnits,
      },
      input: allocationInput as unknown as Record<string, unknown>,
    }
  }

  private async applyOperation(
    organizationId: number,
    projectId: number,
    operation: ResourceSuggestionOperation,
    actorUserId: number,
    trx: TransactionClientContract,
  ) {
    if (operation.type === 'create_requirement') {
      const created = await this.requirements.create(
        organizationId,
        projectId,
        this.requirementCreateInput(operation.input),
        actorUserId,
        trx,
      )
      return { operationId: operation.id, entityType: operation.entityType, entityId: created.id }
    }
    if (operation.type === 'update_requirement') {
      if (!operation.requirementId)
        throw new ValidationException('更新资源需求建议缺少 requirementId')
      const updated = await this.requirements.update(
        organizationId,
        projectId,
        operation.requirementId,
        this.requirementUpdateInput(operation.input),
        actorUserId,
        trx,
      )
      return { operationId: operation.id, entityType: operation.entityType, entityId: updated.id }
    }
    if (operation.type === 'delete_requirement') {
      if (!operation.requirementId)
        throw new ValidationException('删除资源需求建议缺少 requirementId')
      await this.requirements.delete(
        organizationId,
        projectId,
        operation.requirementId,
        actorUserId,
        trx,
      )
      return {
        operationId: operation.id,
        entityType: operation.entityType,
        entityId: operation.requirementId,
      }
    }
    if (operation.type === 'create_resource_allocation') {
      if (!operation.resourceId) throw new ValidationException('资源分配建议缺少 resourceId')
      const created = await this.allocations.create(
        organizationId,
        projectId,
        operation.resourceId,
        this.allocationCreateInput(operation.input),
        actorUserId,
        {},
        trx,
      )
      return { operationId: operation.id, entityType: operation.entityType, entityId: created.id }
    }
    throw new ValidationException('资源建议操作类型无效')
  }

  private requirementCreateInput(input: unknown): CreateTaskResourceRequirementInput {
    if (!input || typeof input !== 'object') throw new ValidationException('资源需求输入无效')
    return { ...(input as CreateTaskResourceRequirementInput), sourceKind: 'rule_suggestion' }
  }

  private requirementUpdateInput(input: unknown): UpdateTaskResourceRequirementInput {
    if (!input || typeof input !== 'object') throw new ValidationException('资源需求输入无效')
    return input as UpdateTaskResourceRequirementInput
  }

  private allocationCreateInput(input: unknown): CreateAllocationInput {
    if (!input || typeof input !== 'object') throw new ValidationException('资源分配输入无效')
    return input as CreateAllocationInput
  }

  private async resolveWindow(
    organizationId: number,
    projectId: number,
    input: ResourceSuggestionPreviewInput,
    operations: ResourceSuggestionOperation[],
  ): Promise<{ from: string; to: string }> {
    if (input.from && input.to) return { from: input.from, to: input.to }
    const dates = operations
      .flatMap((operation) => [operation.after?.startDate, operation.after?.endDate])
      .filter((date): date is string => typeof date === 'string')
      .sort()
    if (dates.length > 0) return { from: dates[0], to: dates[dates.length - 1] }
    const requirement = await TaskResourceRequirement.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .orderBy('start_date', 'asc')
      .first()
    const from = requirement?.startDate.toISODate() ?? new Date().toISOString().slice(0, 10)
    const to = requirement?.endDate.toISODate() ?? from
    return { from, to }
  }

  private requirementSnapshot(requirement: TaskResourceRequirement): Record<string, unknown> {
    return {
      id: requirement.id,
      taskId: requirement.taskId,
      role: requirement.role,
      skillTags: requirement.skillTags ? JSON.parse(requirement.skillTags) : [],
      allocationPercent: requirement.allocationPercent,
      estimatedPersonDays: requirement.estimatedPersonDays,
      startDate: requirement.startDate.toISODate(),
      endDate: requirement.endDate.toISODate(),
      priority: requirement.priority,
      status: requirement.status,
      sourceKind: requirement.sourceKind,
      sourceRef: requirement.sourceRef,
    }
  }

  private operationId(input: unknown): string {
    return createHash('sha1')
      .update(JSON.stringify(this.stable(input)))
      .digest('hex')
      .slice(0, 16)
  }

  private async writeSuggestionEvidence(input: {
    organizationId: number
    projectId: number
    actorUserId: number
    previewHash: string
    operations: ResourceSuggestionOperation[]
    diff: { creates: number; updates: number; deletes: number }
    window: { from: string; to: string }
    phase: 'preview' | 'apply'
    writesApplied: boolean
    applied?: Array<{ operationId: string; entityType: string; entityId?: number }>
  }) {
    const now = DateTime.now()
    const run = await CompilerRun.create({
      organizationId: input.organizationId,
      requestedByUserId: input.actorUserId,
      status: 'completed',
      currentPhase: 'resource_suggestion',
      currentStage: input.phase,
      input: {
        projectId: input.projectId,
        previewHash: input.previewHash,
        source: 'resource_management_full',
      },
      error: null,
      startedAt: now,
      completedAt: now,
    })

    const artifactId = `resource_suggestion_${input.phase}_${input.previewHash.slice(0, 12)}`
    const artifact = await this.artifactStore.save({
      compilerRunId: run.id,
      organizationId: input.organizationId,
      kind: 'validation_feedback',
      stageId: `resource_suggestion.${input.phase}`,
      artifactId,
      version: 1,
      idempotencyKey: `resource-suggestion-${input.phase}-${input.previewHash}`,
      summaryLevel: 'compact',
      payload: {
        evidenceType: 'resource_suggestion',
        phase: input.phase,
        projectId: input.projectId,
        previewHash: input.previewHash,
        writesApplied: input.writesApplied,
        deterministicSource: 'resource_planning_service',
        trustedClientComputedLoadFields: false,
        window: input.window,
        diff: input.diff,
        operationCount: input.operations.length,
        operations: input.operations.map((operation) => ({
          id: operation.id,
          type: operation.type,
          entityType: operation.entityType,
          action: operation.action,
          requirementId: operation.requirementId ?? null,
          resourceId: operation.resourceId ?? null,
        })),
        applied:
          input.applied?.map((item) => ({
            operationId: item.operationId,
            entityType: item.entityType,
            entityId: item.entityId ?? null,
          })) ?? [],
      },
    })

    return {
      compilerRunId: run.id,
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      summaryLevel: artifact.summaryLevel,
    }
  }

  private rejectComputedFields(value: unknown, path: string[] = []): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.rejectComputedFields(item, [...path, String(index)]))
      return
    }
    if (!value || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalized = key.toLowerCase().replace(/[_-]/g, '')
      if (FORBIDDEN_COMPUTED_FIELDS.has(normalized) || normalized.startsWith('computed')) {
        throw new ValidationException('资源建议禁止信任 computed 负载字段')
      }
      this.rejectComputedFields(nested, [...path, key])
    }
  }

  private stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.stable(item))
    if (!value || typeof value !== 'object') return value
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = this.stable((value as Record<string, unknown>)[key])
        return result
      }, {})
  }
}
