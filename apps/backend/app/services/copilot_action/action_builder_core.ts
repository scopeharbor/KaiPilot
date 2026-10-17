/**
 * v3-copilot-action-and-preview-boundary —— CopilotActionBuilder 纯核心（任务 3.1/3.2/3.4/3.5）。
 *
 * 纯函数层：把 Copilot 动作/建议物化为草案层 session 与 change set 的 DTO。
 * **零 Adonis/Lucid/数据库依赖**，可被 vitest 直跑；不包含任何领域写入 API。
 *
 * 红线：本核心只产出草案态 DTO（ai_draft_layer_sessions / ai_draft_layer_changes 形状），
 * 绝不含对 Project/Task/WbsNode/Milestone/Risk/Resource 等正式业务表的写入逻辑。
 */
import { createHash } from 'node:crypto'
import type { DraftLayerEntityType } from '@aiproj/types'

// ===========================================================================
// 3.4 动作目标 → 草案层实体引用映射
// ===========================================================================

/** Copilot 目标引用前缀 → 草案层实体类型。排期(schedule)落到任务日期字段（fieldPath 必填）。 */
export const COPILOT_TARGET_REF_PREFIX_TO_ENTITY: Record<string, DraftLayerEntityType> = {
  task: 'task',
  wbs: 'wbs_node',
  wbs_node: 'wbs_node',
  dependency: 'dependency',
  resource: 'resource',
  risk: 'risk',
  milestone: 'milestone',
  acceptance_criterion: 'acceptance_criterion',
  project: 'project',
  /** 排期变更 = 任务字段更新（fieldPath 如 startDate/endDate/durationDays）。 */
  schedule: 'task',
}

export interface CopilotTargetRefParsed {
  readonly prefix: string
  readonly entityId: string
  readonly fieldPath: string | null
}

/** 解析 `prefix:entityId` 或 `prefix:entityId:fieldPath`。 */
export function parseCopilotTargetRef(ref: string): CopilotTargetRefParsed | null {
  if (!ref || typeof ref !== 'string') return null
  const parts = ref.split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const [prefix, entityId, fieldPath] = parts
  if (!prefix || !entityId) return null
  return { prefix, entityId, fieldPath: fieldPath && fieldPath.length > 0 ? fieldPath : null }
}

export interface CopilotDraftTarget {
  readonly entityType: DraftLayerEntityType
  readonly entityId: string
  readonly fieldPath: string | null
}

/**
 * 动作目标引用 → 草案层 change target。
 * 未知前缀 → null（调用方须拒绝，非泄露）。
 * 排期(schedule)无 fieldPath → null（必须指明改哪个任务字段）。
 */
export function mapCopilotTargetRefToDraftTarget(ref: string): CopilotDraftTarget | null {
  const parsed = parseCopilotTargetRef(ref)
  if (!parsed) return null
  const entityType = COPILOT_TARGET_REF_PREFIX_TO_ENTITY[parsed.prefix]
  if (!entityType) return null
  if (parsed.prefix === 'schedule' && !parsed.fieldPath) return null
  return { entityType, entityId: parsed.entityId, fieldPath: parsed.fieldPath }
}

// ===========================================================================
// 3.1/3.5 change set 构造（逐条 confidence 写入）
// ===========================================================================

export interface CopilotActionChangeInput {
  /** 形如 `task:1201` / `wbs:3` / `risk:7` / `schedule:1201:startDate`。 */
  readonly targetRef: string
  readonly operation: 'create' | 'update' | 'delete'
  readonly value: Record<string, unknown>
  readonly oldValue: Record<string, unknown> | null
  /** 0–1 置信度，逐条写入 change 行。 */
  readonly confidence: number
  readonly dependsOn?: readonly number[]
}

export interface CopilotActionChangeRow {
  readonly targetEntityType: string
  readonly targetEntityId: string
  readonly targetFieldPath: string | null
  readonly operation: 'create' | 'update' | 'delete'
  readonly value: Record<string, unknown>
  readonly oldValue: Record<string, unknown> | null
  readonly reviewStatus: 'pending'
  readonly userModifiedValue: null
  readonly userNote: null
  readonly sequence: number
  readonly dependsOn: readonly number[]
  readonly confidence: number
  readonly validationSummary: null
}

export interface CopilotActionChangeSetBuildResult {
  readonly rows: readonly CopilotActionChangeRow[]
  /** 未通过目标映射的引用（调用方必须拒绝整体，不静默丢弃）。 */
  readonly unmappedRefs: readonly string[]
}

/**
 * 构造草案层 change 行：目标映射 + 逐条 confidence + pending 状态。
 * 任何未映射引用都会在 unmappedRefs 中报告，绝不静默跳过（无绕过路径）。
 */
export function buildCopilotActionChangeRows(
  inputs: readonly CopilotActionChangeInput[],
): CopilotActionChangeSetBuildResult {
  const rows: CopilotActionChangeRow[] = []
  const unmappedRefs: string[] = []

  inputs.forEach((input, index) => {
    const target = mapCopilotTargetRefToDraftTarget(input.targetRef)
    if (!target) {
      unmappedRefs.push(input.targetRef)
      return
    }
    rows.push({
      targetEntityType: target.entityType,
      targetEntityId: target.entityId,
      targetFieldPath: target.fieldPath,
      operation: input.operation,
      value: input.value,
      oldValue: input.oldValue,
      reviewStatus: 'pending',
      userModifiedValue: null,
      userNote: null,
      sequence: index + 1,
      dependsOn: input.dependsOn ?? [],
      confidence: input.confidence,
      validationSummary: null,
    })
  })

  return { rows, unmappedRefs }
}

// ===========================================================================
// 3.1 会话 DTO（sourceType='v3_copilot_action'，compilerRunId=null）
// ===========================================================================

export interface CopilotActionSessionPayload {
  readonly organizationId: number
  readonly createdByUserId: number
  readonly sourceType: 'v3_copilot_action'
  readonly compilerRunId: null
  readonly pdmArtifactId: null
  /** 会话指纹：动作归一化输入 + 目标引用 + source 签名的确定性摘要。 */
  readonly pdmHash: string
  readonly status: 'active'
  readonly version: 1
  readonly summary: {
    /** Copilot 动作会话无 Compiler Run，显式标记不适用。 */
    compilerRunStatus: 'not_applicable'
    ledgerStatus: 'not_applicable'
    pdmEntityCount: 0
    totalChanges: number
    acceptedChanges: 0
    rejectedChanges: 0
    pendingChanges: number
    unresolvedConflicts: 0
    dryRunStatus: null
    applyStatus: null
  }
  readonly metadata: {
    source: 'copilot_action'
    actionCardId: string
    idempotencyKey: string
    sourceSignaturePrefixes: readonly string[]
    reliedOnSubstitutedDefaults: boolean
  }
  readonly expiresAt: null
}

export interface CopilotActionMaterializeInput {
  readonly organizationId: number
  readonly userId: number
  readonly actionCardId: string
  readonly normalizedActionInput: string
  readonly idempotencyKey: string
  readonly sourceSignaturePrefixes: readonly string[]
  readonly reliedOnSubstitutedDefaults: boolean
  readonly changeInputs: readonly CopilotActionChangeInput[]
}

/**
 * 构造草案层会话 DTO：唯一可落库来源类型 `v3_copilot_action`、compilerRunId=null、
 * 低敏 metadata（actionCardId / 幂等键 / source hash 前缀），不含 prompt/模型输出/证据正文。
 */
export function buildCopilotActionSessionPayload(
  input: CopilotActionMaterializeInput,
  changeCount: number,
  pdmHash: string,
): CopilotActionSessionPayload {
  return {
    organizationId: input.organizationId,
    createdByUserId: input.userId,
    sourceType: 'v3_copilot_action',
    compilerRunId: null,
    pdmArtifactId: null,
    pdmHash,
    status: 'active',
    version: 1,
    summary: {
      compilerRunStatus: 'not_applicable',
      ledgerStatus: 'not_applicable',
      pdmEntityCount: 0,
      totalChanges: changeCount,
      acceptedChanges: 0,
      rejectedChanges: 0,
      pendingChanges: changeCount,
      unresolvedConflicts: 0,
      dryRunStatus: null,
      applyStatus: null,
    },
    metadata: {
      source: 'copilot_action',
      actionCardId: input.actionCardId,
      idempotencyKey: input.idempotencyKey,
      sourceSignaturePrefixes: input.sourceSignaturePrefixes,
      reliedOnSubstitutedDefaults: input.reliedOnSubstitutedDefaults,
    },
    expiresAt: null,
  }
}

/** 会话指纹：动作归一化输入 + 目标引用 + 幂等键的确定性 sha256 摘要（低敏）。 */
export function deriveCopilotActionSessionHash(
  normalizedActionInput: string,
  idempotencyKey: string,
  targetRefs: readonly string[],
): string {
  const targets = [...targetRefs].sort().join('|')
  return createHash('sha256')
    .update(`${normalizedActionInput}|${idempotencyKey}|${targets}`)
    .digest('hex')
}
