import type { ProjectDraftGenerationStage, ProjectDraftStageArtifact } from '@aiproj/types'
import { ToolGate, type AllowedToolEntry, type ToolDescriptor } from '#services/compiler/tool_gate'

/** 目录版本：prompt/schema 变更必须 bump，checkpoint 只在版本一致时复用。 */
export const DRAFT_STAGE_CATALOG_VERSION = '2.0' as const

export interface DraftStageDefinition {
  stage: ProjectDraftGenerationStage
  contextScope: string[]
  allowedTools: AllowedToolEntry[]
  outputFields: string[]
  /** 可选产物字段：模型可输出但缺失不报 STAGE_OUTPUT_FIELD_MISSING。 */
  optionalOutputFields?: string[]
}

const AVAILABLE_TOOLS: ToolDescriptor[] = [
  { toolId: 'draft.reference_lookup', description: '只读查询已确认事实引用。' },
  { toolId: 'draft.dependency_check', description: '只读检查任务依赖引用。' },
  { toolId: 'draft.calendar_check', description: '只读检查日期与工作日。' },
]

export const DRAFT_STAGE_CATALOG: readonly DraftStageDefinition[] = [
  {
    stage: 'charter_scope',
    contextScope: ['domain', 'business_concept', 'in_scope', 'out_of_scope', 'date', 'metric'],
    allowedTools: [
      { toolId: 'draft.reference_lookup', description: '核对已确认事实', required: false },
    ],
    outputFields: ['charter'],
  },
  {
    stage: 'wbs_tasks',
    contextScope: ['business_concept', 'deliverable', 'role', 'in_scope'],
    allowedTools: [
      { toolId: 'draft.reference_lookup', description: '核对交付物', required: false },
    ],
    outputFields: ['wbs', 'tasks'],
  },
  {
    stage: 'schedule_dependencies',
    contextScope: ['date', 'metric', 'role'],
    allowedTools: [
      { toolId: 'draft.dependency_check', description: '检查依赖引用', required: true },
      { toolId: 'draft.calendar_check', description: '检查日期', required: false },
    ],
    // 甘特预览由系统按任务与依赖确定性推导（模型只判断先后约束）。
    outputFields: ['dependencies', 'ganttPreview'],
  },
  {
    stage: 'resources_risks_acceptance',
    contextScope: ['role', 'metric', 'business_concept', 'deliverable'],
    allowedTools: [
      { toolId: 'draft.reference_lookup', description: '核对验收事实', required: false },
    ],
    outputFields: ['acceptanceCriteria', 'resourceHints', 'riskHints', 'milestoneHints'],
    optionalOutputFields: ['governance'],
  },
  {
    stage: 'reconcile_review',
    contextScope: [
      'domain',
      'business_concept',
      'in_scope',
      'out_of_scope',
      'date',
      'metric',
      'role',
      'deliverable',
    ],
    allowedTools: [
      { toolId: 'draft.dependency_check', description: '复核跨阶段引用', required: true },
    ],
    outputFields: [],
  },
] as const

export class DraftStageToolGate {
  readonly #gate = new ToolGate(AVAILABLE_TOOLS)

  resolve(definition: DraftStageDefinition): string[] {
    if (definition.allowedTools.length > 2) {
      throw new Error('DRAFT_STAGE_TOOL_LIMIT_EXCEEDED')
    }
    const visible = this.#gate.resolve(definition.allowedTools)
    if (visible.toolIds.length !== definition.allowedTools.length) {
      throw new Error('DRAFT_STAGE_TOOL_NOT_REGISTERED')
    }
    return visible.toolIds
  }

  assertInvocation(definition: DraftStageDefinition, toolId: string): void {
    if (!this.#gate.isAllowed(definition.allowedTools, toolId)) {
      throw new Error('DRAFT_STAGE_TOOL_NOT_ALLOWED')
    }
  }

  emptyArtifact(definition: DraftStageDefinition): ProjectDraftStageArtifact {
    return {
      stage: definition.stage,
      status: 'failed',
      contextScope: [...definition.contextScope],
      allowedTools: this.resolve(definition),
      artifactHash: null,
      attemptCount: 0,
      errorCodes: [],
    }
  }
}
