/**
 * ai-draft-generation / T036 —— 生产草案后端权威 zod schema（运行时校验）。
 *
 * 与 `@aiproj/types` 的 `ProjectDraft` 静态类型互为镜像。职责（design D3）：
 *   - parse：safeParse，失败时把 zod issues 映射为可定位字段路径的 `DraftSchemaError[]`；
 *   - 高影响推断字段强制 `AIMarker.needsConfirmation === true`（spec「推断日期带标记」）；
 *   - referential integrity：依赖只引用存在任务、WBS 叶节点必映射任务（spec「WBS 与任务可映射」「依赖引用有效」）。
 * 三档判定（strict/repairable/failed）由 `services/ai_draft/generation_service.ts` 编排。
 */

import { z } from 'zod'
import type {
  DraftSchemaError,
  ProjectDraft,
  ProjectDraftWbsNode,
  ProjectDraftStructuredStrategy,
} from '@aiproj/types'
import {
  AI_MARKER_SOURCES,
  DRAFT_DEPENDENCY_TYPES,
  PROJECT_DRAFT_RISK_STRATEGIES,
  DRAFT_TASK_STATUSES,
  PROJECT_DRAFT_RISK_LEVELS,
  PROJECT_DRAFT_SCHEMA_VERSION,
  PROJECT_TYPES,
} from '@aiproj/types'

const aiMarker = z.object({
  confidence: z.number().min(0).max(1),
  source: z.enum(AI_MARKER_SOURCES),
  reason: z.string().min(1),
  needsConfirmation: z.boolean(),
})

/**
 * 高影响字段（日期/工期/负责人/依赖 lag/风险等级/里程碑日期）marker 规则：
 *   - source='explicit'（用户显式提供的事实）豁免——事实无需确认；
 *   - source='inferred'/'default'（AI 推断或默认假设）必须 needsConfirmation === true。
 */
const highImpactMarker = aiMarker.refine(
  (marker) => marker.source === 'explicit' || marker.needsConfirmation === true,
  { message: '高影响推断/默认字段的 AIMarker.needsConfirmation 必须为 true（显式字段除外）' },
)

const marked = <T extends z.ZodTypeAny>(value: T) => z.object({ value, marker: aiMarker })
const highImpactMarked = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, marker: highImpactMarker })

const charter = z.object({
  title: marked(z.string().min(1)),
  vision: marked(z.string().min(1)),
  scope: marked(z.string().min(1)),
  objectives: marked(z.array(z.string().min(1)).min(1)),
  successCriteria: marked(z.array(z.string().min(1)).min(1)),
  startDate: highImpactMarked(z.string().min(1)),
  endDate: highImpactMarked(z.string().min(1)),
})

const wbsNodeBase = z.object({
  id: z.string().min(1),
  parentId: z.string().nullable(),
  outlineCode: z.string().min(1),
  name: marked(z.string().min(1)),
  description: marked(z.string()),
  isLeaf: z.boolean(),
  isNote: z.boolean(),
})
type WbsNodeShape = z.infer<typeof wbsNodeBase> & { children: WbsNodeShape[] }
const wbsNode: z.ZodType<WbsNodeShape> = wbsNodeBase.extend({
  get children() {
    return z.array(wbsNode)
  },
}) as z.ZodType<WbsNodeShape>

const task = z.object({
  id: z.string().min(1),
  wbsNodeId: z.string().min(1),
  name: marked(z.string().min(1)),
  description: marked(z.string()),
  status: z.enum(DRAFT_TASK_STATUSES),
  durationDays: highImpactMarked(z.number().nonnegative()),
  startDate: highImpactMarked(z.string().min(1)),
  endDate: highImpactMarked(z.string().min(1)),
  assigneeHint: highImpactMarked(z.string()),
  assigneeRoleIds: marked(z.array(z.string().min(1)).min(1)).optional(),
  estimate: z
    .object({
      optimisticDays: z.number().positive(),
      pessimisticDays: z.number().positive(),
    })
    .optional(),
  headcount: z.number().int().min(1).max(50).optional(),
  execution: z
    .object({
      purpose: z.string(),
      inputs: z.array(z.string()),
      outputs: z.array(z.string()),
      doneCriteria: z.array(z.string()),
      steps: z.array(z.string()),
      reviewerRole: z.string().optional(),
    })
    .optional(),
  trace: z
    .object({
      capabilityId: z.string(),
      capabilityName: z.string(),
      workPackageId: z.string(),
      workPackageName: z.string(),
    })
    .optional(),
})

const dependency = z.object({
  id: z.string().min(1),
  predecessorId: z.string().min(1),
  successorId: z.string().min(1),
  type: z.enum(DRAFT_DEPENDENCY_TYPES),
  lagDays: highImpactMarked(z.number()),
})

const acceptanceCriterion = z.object({
  id: z.string().min(1),
  statement: marked(z.string().min(1)),
  linkedTaskId: z.string().nullable(),
  linkedSuccessIndex: z.number().int().nonnegative().nullable(),
})

const resourceHint = z.object({
  id: z.string().min(1),
  role: marked(z.string().min(1)),
  headcount: marked(z.number().int().positive()),
  allocationNote: marked(z.string()),
})

const riskHint = z.object({
  id: z.string().min(1),
  description: marked(z.string().min(1)),
  level: highImpactMarked(z.enum(PROJECT_DRAFT_RISK_LEVELS)),
  mitigation: marked(z.string()),
  trigger: marked(z.string()).optional(),
  ownerRole: marked(z.string()).optional(),
  strategy: marked(z.enum(PROJECT_DRAFT_RISK_STRATEGIES)).optional(),
})

const governance = z.object({
  raci: z.array(
    z.object({
      activity: z.string().min(1),
      responsible: z.array(z.string().min(1)),
      accountable: z.string(),
      consulted: z.array(z.string()),
      informed: z.array(z.string()),
    }),
  ),
  qualityGates: z.array(
    z.object({
      name: z.string().min(1),
      entryCriteria: z.array(z.string().min(1)),
      exitCriteria: z.array(z.string().min(1)),
    }),
  ),
  releaseWindows: z.array(
    z.object({
      name: z.string().min(1),
      startDate: z.string().min(1),
      endDate: z.string().min(1),
      scope: z.string(),
      rollbackPlan: z.string(),
    }),
  ),
})

const milestoneHint = z.object({
  id: z.string().min(1),
  name: marked(z.string().min(1)),
  targetDate: highImpactMarked(z.string().min(1)),
  linkedTaskIds: z.array(z.string().min(1)),
})

const ganttPreview = z.object({
  startDate: marked(z.string().min(1)),
  endDate: marked(z.string().min(1)),
  totalDurationDays: marked(z.number().nonnegative()),
  criticalPathTaskIds: z.array(z.string().min(1)),
  phaseCount: z.number().int().nonnegative(),
})

export const projectDraftSchema = z.object({
  schemaVersion: z.literal(PROJECT_DRAFT_SCHEMA_VERSION),
  projectType: z.enum(PROJECT_TYPES),
  charter,
  wbs: z.array(wbsNode).min(1),
  tasks: z.array(task).min(1),
  dependencies: z.array(dependency),
  acceptanceCriteria: z.array(acceptanceCriterion).min(1),
  resourceHints: z.array(resourceHint),
  riskHints: z.array(riskHint),
  milestoneHints: z.array(milestoneHint),
  ganttPreview,
  governance: governance.optional(),
})

/** zod issue.path → 点分/括号路径字符串（如 `tasks[2].durationDays.marker`）。 */
function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`
    } else {
      out += out ? `.${String(segment)}` : String(segment)
    }
  }
  return out || '(root)'
}

export type ParsedDraftResult =
  { ok: true; value: ProjectDraft } | { ok: false; errors: DraftSchemaError[] }

/** 严格 schema 解析（不含引用完整性）。失败返回可定位字段路径的错误列表。 */
export function parseProjectDraft(raw: unknown): ParsedDraftResult {
  const result = projectDraftSchema.safeParse(raw)
  if (result.success) {
    return { ok: true, value: result.data as ProjectDraft }
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path),
      message: issue.message,
    })),
  }
}

/** 扁平化 WBS 树，收集全部节点。 */
export function flattenWbs(nodes: ProjectDraftWbsNode[]): ProjectDraftWbsNode[] {
  const out: ProjectDraftWbsNode[] = []
  const walk = (list: ProjectDraftWbsNode[]) => {
    for (const node of list) {
      out.push(node)
      if (node.children.length) walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/**
 * 引用完整性校验（schema 通过后执行）。覆盖：
 *   - 依赖 predecessor/successor 必须引用草案内存在任务，且不自环；
 *   - 任务 wbsNodeId 必须引用存在的 WBS 叶节点；
 *   - 可执行 WBS 叶节点（isLeaf && !isNote）必须至少映射一个任务；
 *   - 里程碑/验收关联的 taskId 必须存在。
 */
export function validateDraftIntegrity(draft: ProjectDraft): DraftSchemaError[] {
  const errors: DraftSchemaError[] = []
  const wbsNodes = flattenWbs(draft.wbs)
  const wbsIds = new Set(wbsNodes.map((n) => n.id))
  const taskIds = new Set(draft.tasks.map((t) => t.id))
  const tasksByWbs = new Map<string, number>()
  for (const t of draft.tasks) {
    tasksByWbs.set(t.wbsNodeId, (tasksByWbs.get(t.wbsNodeId) ?? 0) + 1)
  }

  draft.tasks.forEach((t, i) => {
    if (!wbsIds.has(t.wbsNodeId)) {
      errors.push({
        path: `tasks[${i}].wbsNodeId`,
        message: `任务引用了不存在的 WBS 节点 ${t.wbsNodeId}`,
      })
    }
  })

  wbsNodes.forEach((node, i) => {
    if (node.isLeaf && !node.isNote && !(tasksByWbs.get(node.id) ?? 0)) {
      errors.push({
        path: `wbs.${node.outlineCode}`,
        message: `可执行 WBS 叶节点 ${node.id} 未映射任何任务（或应标记为说明节点）`,
      })
    }
    void i
  })

  draft.dependencies.forEach((dep, i) => {
    if (!taskIds.has(dep.predecessorId)) {
      errors.push({
        path: `dependencies[${i}].predecessorId`,
        message: `依赖引用了不存在的前置任务 ${dep.predecessorId}`,
      })
    }
    if (!taskIds.has(dep.successorId)) {
      errors.push({
        path: `dependencies[${i}].successorId`,
        message: `依赖引用了不存在的后继任务 ${dep.successorId}`,
      })
    }
    if (dep.predecessorId === dep.successorId) {
      errors.push({
        path: `dependencies[${i}]`,
        message: `依赖不能自环（${dep.predecessorId}）`,
      })
    }
  })

  draft.milestoneHints.forEach((ms, i) => {
    ms.linkedTaskIds.forEach((id, j) => {
      if (!taskIds.has(id)) {
        errors.push({
          path: `milestoneHints[${i}].linkedTaskIds[${j}]`,
          message: `里程碑引用了不存在的任务 ${id}`,
        })
      }
    })
  })

  draft.acceptanceCriteria.forEach((ac, i) => {
    if (ac.linkedTaskId !== null && !taskIds.has(ac.linkedTaskId)) {
      errors.push({
        path: `acceptanceCriteria[${i}].linkedTaskId`,
        message: `验收标准引用了不存在的任务 ${ac.linkedTaskId}`,
      })
    }
  })

  return errors
}

/** 完整校验：schema + 引用完整性。 */
export function validateProjectDraft(raw: unknown): ParsedDraftResult {
  const parsed = parseProjectDraft(raw)
  if (!parsed.ok) return parsed
  const integrityErrors = validateDraftIntegrity(parsed.value)
  if (integrityErrors.length) {
    return { ok: false, errors: integrityErrors }
  }
  return parsed
}

// ---------------------------------------------------------------------------
// 分阶段结构校验（v3 hardening 缺陷修复：阶段产物不再只查字段存在性）
// ---------------------------------------------------------------------------

/**
 * 各生成阶段的产物子 schema——直接复用上方模块化字段定义，与完整草案 schema 零漂移。
 * reconcile_review 输出完整草案，不在此表（走 validateProjectDraft）。
 */
export const STAGE_ARTIFACT_SCHEMAS = {
  charter_scope: z.object({ charter }),
  wbs_tasks: z.object({ wbs: z.array(wbsNode).min(1), tasks: z.array(task).min(1) }),
  schedule_dependencies: z.object({ dependencies: z.array(dependency), ganttPreview }),
  resources_risks_acceptance: z.object({
    acceptanceCriteria: z.array(acceptanceCriterion).min(1),
    resourceHints: z.array(resourceHint),
    riskHints: z.array(riskHint),
    milestoneHints: z.array(milestoneHint),
    governance: governance.optional(),
  }),
} as const

export type StageArtifactStage = keyof typeof STAGE_ARTIFACT_SCHEMAS

/**
 * 校验单个阶段的产物字段结构（不含跨阶段引用，引用由编排层另查）。
 * 输入应为经 normalizeLooseDraft 归一化后的阶段字段子集。
 */
export function validateStageArtifactStructure(
  stage: StageArtifactStage,
  artifactFields: unknown,
): DraftSchemaError[] {
  const result = STAGE_ARTIFACT_SCHEMAS[stage].safeParse(artifactFields)
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }))
}

/** 把运行时 zod schema 转为 Provider 的 JSON Schema；prompt 策略无需传入。 */
export function draftJsonSchemaForStrategy(
  strategy: ProjectDraftStructuredStrategy,
): Record<string, unknown> | undefined {
  if (strategy === 'prompt') return undefined
  return z.toJSONSchema(projectDraftSchema) as Record<string, unknown>
}

/** schedule 阶段允许携带可选 tasks（仅用于日历校正），native/tool 输出 schema 必须放行。 */
const scheduleStageJsonSchema = z.object({
  dependencies: z.array(dependency),
  ganttPreview,
  tasks: z.array(task).optional(),
})

/** 分阶段 JSON Schema：native/tool 策略下按阶段裁剪顶层字段，prompt 返回 undefined。 */
export function stageJsonSchemaForStrategy(
  stage: keyof typeof STAGE_ARTIFACT_SCHEMAS,
  strategy: ProjectDraftStructuredStrategy,
): Record<string, unknown> | undefined {
  if (strategy === 'prompt') return undefined
  const shape =
    stage === 'schedule_dependencies' ? scheduleStageJsonSchema : STAGE_ARTIFACT_SCHEMAS[stage]
  return z.toJSONSchema(shape) as Record<string, unknown>
}

/** 编译期防退化：确保共享类型与 zod 推断类型不漂移。 */
type SchemaMirror = z.infer<typeof projectDraftSchema>
// eslint-disable-next-line @typescript-eslint/naming-convention
const _mirror: SchemaMirror extends { charter: unknown } ? true : false = true
void _mirror
