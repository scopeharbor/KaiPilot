/**
 * ai-draft-generation / T036 —— 生产级项目草案生成引擎。
 *
 * 编排（design D2，tasks 2.2）：charter → wbs → tasks/dependencies → acceptance → hints → ganttPreview
 *   由确定性 blueprint builder 一次性合成（各模块顺序体现在 SSE 事件里，见 stream service）。
 *
 * 结构化保证（design D3，tasks 2.3/2.4）：
 *   - `resolveStrategy` 依据连接能力探测在 native/tool/prompt 间降级，写入 fallback 元数据；
 *   - 模型路径走 parse → sanitize → validate → repair/retry → classify，输出 strict/repairable/failed 三档；
 *   - V1 生产默认走确定性引擎（内容 grounded 于 ConfirmedProjectContext），
 *     真实模型内容生成通过注入 `rawTextProvider` 接入（见 tasks 迁移计划「先接 fixture，再接 AIGateway」）。
 *
 * 红线（tasks 2.5）：本服务只产出内存草案，**不 import 任何正式业务 Model/Service**
 * （Project/WbsNode/Task/TaskDependency/Milestone），生成阶段零正式落库。
 */

import { createHash } from 'node:crypto'
import type {
  AiMarker,
  AiMarkerSource,
  DraftSchemaError,
  ProjectDraft,
  ProjectDraftConsistency,
  ProjectDraftMeta,
  ProjectDraftModuleCounts,
  ProjectDraftStructuredStrategy,
  ConfirmedProjectContext,
  ProgressPhase,
  DraftValidationIssue,
  ProjectDraftGroundingManifest,
  ProjectDraftStageArtifact,
  ProjectDraftRepairEnvelope,
  ProjectDraftGenerationStage,
  ProjectDraftPipelineCheckpoint,
  ProjectDraftStageCheckpoint,
  ProjectDraftFailureError,
  ProjectDraftTaskExecution,
  ProjectPlanUnderstanding,
  ProjectDraftReviewItem,
  ProjectDraftQualityLoop,
  ProjectDraftDecomposition,
  ProjectDraftTaskTrace,
} from '@aiproj/types'
import { PROJECT_DRAFT_SCHEMA_VERSION, redactProjectDraftQualityText } from '@aiproj/types'
import type { ResolvedAdapter } from '../ai_m0/resolver.ts'
import type { PromptSet } from '../ai_m0/prompts.ts'
import { tryParseJson } from '../ai_m0/recovery.ts'
import { buildDraftFromBlueprint } from './fixtures.ts'
import {
  validateProjectDraft,
  validateDraftIntegrity,
  validateStageArtifactStructure,
  flattenWbs,
  draftJsonSchemaForStrategy,
  stageJsonSchemaForStrategy,
  type StageArtifactStage,
} from './schema.ts'
import {
  ProjectDraftPromptBuilder,
  type DraftFactOverlay,
  type DraftFactValue,
} from './prompt_builder.ts'
import { buildGroundingManifest } from './grounding_manifest.ts'
import {
  deriveGanttPreview,
  longestChainWorkdays,
  salvageScheduleOutput,
} from './schedule_salvage.ts'
import { contextTeamRoster, planDraftResources, type TeamRosterEntry } from './resource_plan.ts'
import { autoLinkTraceability, evaluateStageGates, stageGateTemplate } from './plan_insights.ts'
import { normalizeDraftExtensions } from './draft_extensions.ts'
import { stageGateRule } from './wbs_tasks_chunked.ts'
import {
  buildDraftCalendar,
  calendarPromptFacts,
  WORK_CALENDAR_RULE,
  type DraftCalendar,
} from './cn_calendar.ts'
import {
  computeDraftGranularity,
  contextTeamSize,
  draftGranularityGuide,
  type DraftGranularityTarget,
} from './granularity_guide.ts'
import {
  CHUNKED_WBS_TASKS_MIN_TASKS,
  createChunkedWbsTasksCache,
  generateWbsTasksChunked,
} from './wbs_tasks_chunked.ts'
import {
  DRAFT_BUDGET_EXHAUSTION_LABELS,
  resolveDraftGenerationBudget,
  type DraftBudgetExhaustion,
} from './generation_budget.ts'
import {
  DRAFT_STAGE_CATALOG,
  DRAFT_STAGE_CATALOG_VERSION,
  DraftStageToolGate,
  type DraftStageDefinition,
} from './stage_catalog.ts'
import {
  DRAFT_ID_CONVENTION_GUIDE,
  DRAFT_MARKER_CONTRACT_GUIDE,
  DRAFT_STAGE_GUIDE_VERSION,
  STAGE_OUTPUT_GUIDES,
} from './stage_schema_guide.ts'
import { validateSemanticGrounding } from './semantic_grounding_gate.ts'
import {
  buildSpine,
  ContextUsageLog,
  DecisionLog,
  memoryView,
  taskIndex,
  wbsOutline,
} from './draft_memory.ts'
import { generatePlanUnderstanding } from './plan_understanding.ts'
import {
  alignTaskDependencies,
  breakDependencyCycles,
  repairWorkPackageFeasibility,
  scheduleWorkPackages,
} from './wp_schedule.ts'
import {
  buildWbsFromDecomposition,
  decomposeCapabilities,
  ensureStageGateWorkPackages,
  rebalanceRoleLoads,
  scaleWorkPackageEffort,
} from './work_packages.ts'

/** 工作包计划挂在 aggregate 上的键（排期阶段注入；结构校验会剥掉，不进最终草案）。 */
const WORK_PACKAGE_PLAN_KEY = '__workPackagePlan'

/** 可投入系数：人天预算与角色容量都按它折算（会议、沟通、请假、依赖等待）。 */
const CAPACITY_FACTOR = 0.65
import {
  calibrateTaskEffort,
  humanizeInternalTerms,
  humanizeReferenceText,
  humanizeTaskReferences,
  referenceNames,
  runQualityLoop,
  runScheduleRepair,
  type ScheduleEvaluation,
} from './quality_loop.ts'
import {
  createWorkingCalendar,
  formatIsoDate,
  isWorkingDay,
  parseIsoDate,
  snapToWorkingDay,
} from '#services/gantt_working_calendar'

/** 注入式真实模型输出获取器（测试或后续接入生产 Adapter 时提供）。 */
export interface DraftRawTextProviderResult {
  rawText: string
  /** Provider 实际回报的模型；缺席时沿用已解析 adapter 模型。 */
  responseModel?: string
  /** Provider 实际采用的结构化策略；缺席时沿用请求策略。 */
  effectiveStrategy?: ProjectDraftStructuredStrategy
}

export type DraftRawTextProvider = (args: {
  prompt: PromptSet
  strategy: ProjectDraftStructuredStrategy
  jsonSchema?: Record<string, unknown>
  attempt: number
  /** 五阶段生产链的当前阶段；旧单次调用缺席。 */
  stage?: ProjectDraftGenerationStage
  /** 不含 rawInput 的低敏任务句。 */
  sentence?: string
  /** 当前阶段输出预算。 */
  maxOutputTokens?: number
  /** 阶段内 / 子请求内的尝试序号（1 起），写入调用账本的 attempt_number。 */
  stageAttempt?: number
  /** 低敏 prompt 类别（如 draft.schedule_dependencies），写入调用账本的 prompt_name。 */
  promptName?: string
  /** 可选进度回调：逐 chunk 接收原始文本。 */
  onChunk?: (chunk: string) => void
  /** 可选阶段回调：接收当前阶段。 */
  onPhase?: (phase: ProgressPhase, receivedChars: number, attempt?: number) => void
}) => Promise<string | DraftRawTextProviderResult>

export interface GenerateDraftOptions {
  context: ConfirmedProjectContext
  resolved: ResolvedAdapter
  /** 提供则走真实模型路径（parse/validate/repair/retry/classify）；缺省走确定性引擎。 */
  rawTextProvider?: DraftRawTextProvider
  /** 模型路径的重试上限（默认 1，即最多 2 次尝试）。 */
  maxRetries?: number
  /** 生产 controller 开启；测试/迁移调用可暂时保留旧单次路径。 */
  useStagePipeline?: boolean
  /** 可选进度回调：透传给 rawTextProvider。 */
  onChunk?: (chunk: string) => void
  /** 可选阶段回调：在生成关键节点触发。 */
  onPhase?: (phase: ProgressPhase, receivedChars: number, attempt?: number) => void
  /** 断点恢复：提供该快照时，已通过的阶段跳过重新生成，从失败阶段继续。 */
  resume?: ProjectDraftPipelineCheckpoint | null
  /** 阶段 checkpoint 落库回调（每个阶段完成或失败后触发一次）。 */
  onCheckpoint?: (checkpoint: ProjectDraftPipelineCheckpoint) => void | Promise<void>
  /**
   * 阶段尝试失败诊断（服务端日志用）：每次失败后、决定重试/修复前触发一次。
   * 最终失败只保留最后一次原因，没有它就无从知道前几次为何失败。
   */
  onAttemptFailed?: (info: {
    stage: ProjectDraftGenerationStage
    attempt: number
    errors: string[]
    stageChars: number
    elapsedMs: number
  }) => void
}

export interface GenerateDraftResult {
  status: 'completed' | 'failed'
  draft: ProjectDraft | null
  meta: ProjectDraftMeta
  consistency: ProjectDraftConsistency
  /** 失败时的统一错误码（AI_SERVICE_ERROR）与可定位字段错误（截断至前 20 条）。 */
  errorCode?: string
  errors?: DraftSchemaError[]
  retries: number
  /** 语义/grounding 门禁结果；只含规则、路径和 fact ID，不含正文。 */
  qualityIssues?: DraftValidationIssue[]
  /** 失败时的具体发生阶段（如 charter_scope/wbs_tasks 等）。 */
  stage?: ProjectDraftGenerationStage
  /** 失败时的稳定原因码（如 GENERATION_BUDGET_EXHAUSTED/HL-001 等）。 */
  reasonCode?: string
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 按来源生成 marker：explicit 恒 needsConfirmation=false；default/inferred 依传入。 */
function markerForSource(
  source: AiMarkerSource,
  reason: string,
  needsConfirmation: boolean,
): AiMarker {
  if (source === 'explicit') {
    return { confidence: 1, source: 'explicit', reason, needsConfirmation: false }
  }
  if (source === 'default') {
    return { confidence: 0.5, source: 'default', reason, needsConfirmation }
  }
  return { confidence: 0.6, source: 'inferred', reason, needsConfirmation }
}

function applyFact<T>(
  target: { value: T; marker: AiMarker },
  fact: DraftFactValue<T>,
  reason: string,
) {
  target.value = fact.value
  target.marker = markerForSource(fact.source, reason, fact.needsConfirmation)
}

/**
 * 把显式事实覆盖层落到草案 charter 上。
 * 对确定性草案与模型草案统一适用，保证「显式事实不被覆盖」（spec 硬约束）。
 */
function applyOverlay(draft: ProjectDraft, overlay: DraftFactOverlay): ProjectDraft {
  const next = clone(draft)
  if (overlay.title) applyFact(next.charter.title, overlay.title, '项目名称来自用户显式输入。')
  if (overlay.objectives) {
    applyFact(next.charter.objectives, overlay.objectives, '项目目标来自用户显式输入。')
  }
  if (overlay.startDate) {
    applyFact(next.charter.startDate, overlay.startDate, '开始日期来自澄清上下文。')
  }
  return next
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMarkedValue(value: unknown): value is { value: unknown; marker: AiMarker } {
  return isPlainObject(value) && 'value' in value && isPlainObject(value.marker)
}

function inferred<T>(value: T, reason: string, needsConfirmation = false) {
  return {
    value,
    marker: markerForSource('inferred', reason, needsConfirmation),
  }
}

const MARKER_SOURCES = new Set(['inferred', 'explicit', 'default'])

/**
 * 修补不完整的 marker（实测：模型会把依据写进 source、漏写 reason），
 * 否则纯元数据缺陷会让整个阶段结构校验失败、触发整段重写。
 */
function repairMarker(
  marker: Record<string, unknown>,
  reason: string,
  needsConfirmation: boolean,
): AiMarker {
  const source = MARKER_SOURCES.has(String(marker.source))
    ? (marker.source as AiMarkerSource)
    : 'inferred'
  const confidence =
    typeof marker.confidence === 'number' && marker.confidence >= 0 && marker.confidence <= 1
      ? marker.confidence
      : 0.6
  const markerReason =
    typeof marker.reason === 'string' && marker.reason.trim()
      ? marker.reason
      : // source 被误填成依据文本时，把它挪回 reason。
        typeof marker.source === 'string' &&
          !MARKER_SOURCES.has(marker.source) &&
          marker.source.trim()
        ? marker.source
        : reason
  return {
    ...marker,
    confidence,
    source,
    reason: markerReason,
    needsConfirmation:
      typeof marker.needsConfirmation === 'boolean' ? marker.needsConfirmation : needsConfirmation,
  } as AiMarker
}

function normalizeMarked<T>(value: unknown, reason: string, needsConfirmation = false) {
  if (!isMarkedValue(value)) return inferred(value as T, reason, needsConfirmation)
  return {
    ...value,
    marker: repairMarker(
      value.marker as unknown as Record<string, unknown>,
      reason,
      needsConfirmation,
    ),
  }
}

function normalizeLooseWbs(nodes: unknown): unknown {
  if (!Array.isArray(nodes)) return nodes
  return nodes.map((node, index) => {
    if (!isPlainObject(node)) return node
    return {
      ...node,
      id: typeof node.id === 'string' ? node.id : `wbs-${index + 1}`,
      parentId: typeof node.parentId === 'string' ? node.parentId : null,
      outlineCode: typeof node.outlineCode === 'string' ? node.outlineCode : String(index + 1),
      name: normalizeMarked<string>(node.name, 'WBS 名称由 AI 生成。'),
      description: normalizeMarked<string>(node.description ?? '', 'WBS 描述由 AI 生成。'),
      isLeaf:
        typeof node.isLeaf === 'boolean'
          ? node.isLeaf
          : !Array.isArray(node.children) || node.children.length === 0,
      isNote: typeof node.isNote === 'boolean' ? node.isNote : false,
      children: normalizeLooseWbs(node.children ?? []),
    }
  })
}

function collectWbsLeafIds(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return []
  const ids: string[] = []
  const walk = (list: unknown[]) => {
    for (const item of list) {
      if (!isPlainObject(item)) continue
      const children = Array.isArray(item.children) ? item.children : []
      const isLeaf = typeof item.isLeaf === 'boolean' ? item.isLeaf : children.length === 0
      const isNote = item.isNote === true
      if (isLeaf && !isNote && typeof item.id === 'string') ids.push(item.id)
      if (children.length > 0) walk(children)
    }
  }
  walk(nodes)
  return ids
}

function normalizeLooseDraft(
  raw: unknown,
  projectType: ProjectDraft['projectType'],
): {
  value: unknown
  applied: boolean
} {
  if (!isPlainObject(raw)) return { value: raw, applied: false }
  const draft: Record<string, unknown> = clone(raw)
  let applied = false
  const mark = () => {
    applied = true
  }

  if (draft.schemaVersion !== PROJECT_DRAFT_SCHEMA_VERSION) {
    draft.schemaVersion = PROJECT_DRAFT_SCHEMA_VERSION
    mark()
  }
  if (draft.projectType !== projectType) {
    draft.projectType = projectType
    mark()
  }

  if (isPlainObject(draft.charter)) {
    const charter = { ...draft.charter }
    const scopeValue = Array.isArray(charter.scope) ? charter.scope.join('；') : charter.scope
    for (const [key, reason] of [
      ['title', '项目标题由 AI 生成。'],
      ['vision', '项目愿景由 AI 生成。'],
      ['scope', '项目范围由 AI 生成。'],
      ['objectives', '项目目标由 AI 生成。'],
      ['successCriteria', '成功标准由 AI 生成。'],
    ] as const) {
      const source = key === 'scope' ? scopeValue : charter[key]
      if (!isMarkedValue(source)) mark()
      charter[key] = normalizeMarked(source, reason)
    }
    for (const [key, reason] of [
      ['startDate', '开始日期由 AI 推断，需人工确认。'],
      ['endDate', '结束日期由 AI 推断，需人工确认。'],
    ] as const) {
      if (!isMarkedValue(charter[key])) mark()
      charter[key] = normalizeMarked(charter[key], reason, true)
    }
    draft.charter = charter
  }

  const beforeWbs = draft.wbs
  draft.wbs = normalizeLooseWbs(draft.wbs)
  if (draft.wbs !== beforeWbs) mark()
  const leafWbsIds = collectWbsLeafIds(draft.wbs)

  // 任务日期由程序排定（资源平衡按依赖、工作日历与角色容量计算）：模型可不写日期，
  // 缺失时先以章程开工日占位，排期阶段后整体重算。
  const charterStart =
    isPlainObject(draft.charter) &&
    isPlainObject(draft.charter.startDate) &&
    typeof draft.charter.startDate.value === 'string'
      ? draft.charter.startDate.value
      : null
  if (Array.isArray(draft.tasks)) {
    draft.tasks = draft.tasks.map((task, index) => {
      if (!isPlainObject(task)) return task
      const next = { ...task }
      if (charterStart) {
        for (const key of ['startDate', 'endDate'] as const) {
          const current = isMarkedValue(next[key])
            ? (next[key] as { value: unknown }).value
            : next[key]
          if (typeof current !== 'string' || current.trim() === '') {
            next[key] = inferred(charterStart, '待程序按依赖与工作日历排期', true)
            mark()
          }
        }
      }
      if (next.execution !== undefined) {
        const execution = normalizeExecution(next.execution)
        if (execution) next.execution = execution
        else delete next.execution
        mark()
      }
      if (next.assigneeHint === undefined && typeof next.role === 'string') {
        next.assigneeHint = next.role
        mark()
      }
      delete next.role
      if (typeof next.id !== 'string') {
        next.id = `task-${index + 1}`
        mark()
      }
      if (typeof next.wbsNodeId !== 'string') {
        next.wbsNodeId = leafWbsIds[index] ?? leafWbsIds[0] ?? `wbs-${index + 1}`
        mark()
      }
      if (typeof next.status !== 'string') {
        next.status = 'not_started'
        mark()
      }
      for (const [key, reason] of [
        ['name', '任务名称由 AI 生成。'],
        ['description', '任务描述由 AI 生成。'],
      ] as const) {
        if (!isMarkedValue(next[key])) mark()
        next[key] = normalizeMarked(next[key] ?? '', reason)
      }
      for (const [key, reason] of [
        ['durationDays', '任务工期由 AI 推断，需人工确认。'],
        ['startDate', '任务开始日期由 AI 推断，需人工确认。'],
        ['endDate', '任务结束日期由 AI 推断，需人工确认。'],
        ['assigneeHint', '任务负责人建议由 AI 推断，需人工确认。'],
      ] as const) {
        if (!isMarkedValue(next[key])) mark()
        next[key] = normalizeMarked(next[key] ?? '', reason, true)
      }
      if (next.assigneeRoleIds !== undefined && !isMarkedValue(next.assigneeRoleIds)) {
        const rawRoles = Array.isArray(next.assigneeRoleIds)
          ? next.assigneeRoleIds
          : isPlainObject(next.assigneeRoleIds) && Array.isArray(next.assigneeRoleIds.value)
            ? next.assigneeRoleIds.value
            : null
        if (rawRoles) {
          mark()
          next.assigneeRoleIds = normalizeMarked<string[]>(
            rawRoles.map((role) => String(role).trim()).filter(Boolean),
            '负责人角色 ID 列表由 AI 生成，需人工确认。',
            true,
          )
        } else {
          delete next.assigneeRoleIds
          mark()
        }
      }
      return next
    })
  }

  if (Array.isArray(draft.dependencies)) {
    draft.dependencies = draft.dependencies.map((item, index) => {
      // 紧凑格式 ["task-1","task-2","FS",0] 或 {"from","to"}：排期阶段为压缩输出体量而采用。
      const dependency = expandCompactDependency(item)
      if (dependency !== item) mark()
      if (!isPlainObject(dependency)) return dependency
      const next = { ...dependency }
      if (typeof next.id !== 'string') {
        next.id = `dep-${index + 1}`
        mark()
      }
      if (typeof next.type !== 'string') {
        next.type = 'FS'
        mark()
      }
      if (!isMarkedValue(next.lagDays)) mark()
      next.lagDays = normalizeMarked(
        next.lagDays ?? 0,
        '依赖滞后天数由 AI 推断，需人工确认。',
        true,
      )
      return next
    })
  }

  if (Array.isArray(draft.acceptanceCriteria)) {
    draft.acceptanceCriteria = draft.acceptanceCriteria.map((criterion, index) => {
      if (!isPlainObject(criterion)) return criterion
      const next = { ...criterion }
      if (typeof next.id !== 'string') {
        next.id = `ac-${index + 1}`
        mark()
      }
      if (!('linkedTaskId' in next)) {
        next.linkedTaskId = null
        mark()
      }
      if (!('linkedSuccessIndex' in next)) {
        next.linkedSuccessIndex = null
        mark()
      }
      if (!isMarkedValue(next.statement)) mark()
      next.statement = normalizeMarked(next.statement, '验收标准由 AI 生成。')
      return next
    })
  }

  if (Array.isArray(draft.resourceHints)) {
    draft.resourceHints = draft.resourceHints.map((resource, index) => {
      if (!isPlainObject(resource)) return resource
      const next = { ...resource }
      if (typeof next.id !== 'string') {
        next.id = `res-${index + 1}`
        mark()
      }
      for (const [key, reason] of [
        ['role', '资源角色由 AI 建议。'],
        ['headcount', '资源人数由 AI 建议。'],
        ['allocationNote', '资源分配说明由 AI 建议。'],
      ] as const) {
        if (!isMarkedValue(next[key])) mark()
        next[key] = normalizeMarked(next[key] ?? '', reason)
      }
      return next
    })
  }

  if (Array.isArray(draft.riskHints)) {
    draft.riskHints = draft.riskHints.map((risk, index) => {
      if (!isPlainObject(risk)) return risk
      const next = { ...risk }
      if (typeof next.id !== 'string') {
        next.id = `rk-${index + 1}`
        mark()
      }
      for (const [key, reason] of [
        ['description', '风险描述由 AI 识别。'],
        ['mitigation', '缓解措施由 AI 建议。'],
      ] as const) {
        if (!isMarkedValue(next[key])) mark()
        next[key] = normalizeMarked(next[key] ?? '', reason)
      }
      if (!isMarkedValue(next.level)) mark()
      next.level = normalizeMarked(next.level ?? 'medium', '风险等级由 AI 评估，需人工确认。', true)
      return next
    })
  }

  if (Array.isArray(draft.milestoneHints)) {
    draft.milestoneHints = draft.milestoneHints.map((milestone, index) => {
      if (!isPlainObject(milestone)) return milestone
      const next = { ...milestone }
      if (typeof next.id !== 'string') {
        next.id = `ms-${index + 1}`
        mark()
      }
      if (!Array.isArray(next.linkedTaskIds)) {
        next.linkedTaskIds = []
        mark()
      }
      if (!isMarkedValue(next.name)) mark()
      next.name = normalizeMarked(next.name, '里程碑名称由 AI 生成。')
      if (!isMarkedValue(next.targetDate)) mark()
      next.targetDate = normalizeMarked(
        next.targetDate ?? '',
        '里程碑日期由 AI 推断，需人工确认。',
        true,
      )
      return next
    })
  }

  if (isPlainObject(draft.ganttPreview)) {
    const gantt = { ...draft.ganttPreview }
    for (const [key, reason] of [
      ['startDate', '甘特预览开始日期由 AI 生成。'],
      ['endDate', '甘特预览结束日期由 AI 生成。'],
      ['totalDurationDays', '甘特预览总工期由 AI 生成。'],
    ] as const) {
      if (!isMarkedValue(gantt[key])) mark()
      gantt[key] = normalizeMarked(gantt[key] ?? '', reason)
    }
    draft.ganttPreview = gantt
  }

  // 兜底：上面逐字段归一化覆盖不到的可选 Marked 字段（如 tasks[].assigneeRoleIds）
  // 同样修补不完整的 marker，避免纯元数据缺陷触发整批重写。
  normalizeDraftExtensions(draft)
  repairNestedMarkers(draft)

  return { value: draft, applied }
}

const DEPENDENCY_TYPES = new Set(['FS', 'SS', 'FF', 'SF'])

function expandCompactDependency(raw: unknown): unknown {
  if (Array.isArray(raw) && raw.length >= 2) {
    const [from, to, type, lag] = raw
    return {
      predecessorId: String(from),
      successorId: String(to),
      type:
        typeof type === 'string' && DEPENDENCY_TYPES.has(type.toUpperCase())
          ? type.toUpperCase()
          : 'FS',
      lagDays: typeof lag === 'number' && Number.isFinite(lag) ? Math.round(lag) : 0,
    }
  }
  if (isPlainObject(raw) && raw.predecessorId === undefined && typeof raw.from === 'string') {
    const { from, to, ...rest } = raw
    return { ...rest, predecessorId: from, successorId: to }
  }
  return raw
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[；;\n]+/u)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

/** 任务可执行说明宽松归一：字符串拆成数组，缺字段补空；内容全空则丢弃。 */
function normalizeExecution(raw: unknown): ProjectDraftTaskExecution | null {
  if (!isPlainObject(raw)) return null
  const execution: ProjectDraftTaskExecution = {
    purpose: typeof raw.purpose === 'string' ? raw.purpose.trim() : '',
    inputs: stringList(raw.inputs),
    outputs: stringList(raw.outputs),
    doneCriteria: stringList(raw.doneCriteria),
    steps: stringList(raw.steps),
  }
  if (typeof raw.reviewerRole === 'string' && raw.reviewerRole.trim()) {
    execution.reviewerRole = raw.reviewerRole.trim()
  }
  const empty =
    !execution.purpose &&
    execution.inputs.length +
      execution.outputs.length +
      execution.doneCriteria.length +
      execution.steps.length ===
      0
  return empty ? null : execution
}

function repairNestedMarkers(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) repairNestedMarkers(item)
    return
  }
  if (!isPlainObject(node)) return
  for (const [key, child] of Object.entries(node)) {
    if (isMarkedValue(child)) {
      const marker = child.marker as unknown as Record<string, unknown>
      node[key] = {
        ...child,
        marker: repairMarker(
          marker,
          '由 AI 生成。',
          typeof marker.needsConfirmation === 'boolean' ? marker.needsConfirmation : false,
        ),
      }
      repairNestedMarkers(child.value)
    } else {
      repairNestedMarkers(child)
    }
  }
}

function countModules(draft: ProjectDraft): ProjectDraftModuleCounts {
  return {
    wbsNodes: flattenWbs(draft.wbs).length,
    tasks: draft.tasks.length,
    dependencies: draft.dependencies.length,
    acceptanceCriteria: draft.acceptanceCriteria.length,
    resourceHints: draft.resourceHints.length,
    riskHints: draft.riskHints.length,
    milestoneHints: draft.milestoneHints.length,
  }
}

const EMPTY_COUNTS: ProjectDraftModuleCounts = {
  wbsNodes: 0,
  tasks: 0,
  dependencies: 0,
  acceptanceCriteria: 0,
  resourceHints: 0,
  riskHints: 0,
  milestoneHints: 0,
}

const MAX_REPAIR_ATTEMPTS = 1
/** 分阶段流水线：每个阶段独立的定向修复上限（不含首次尝试）。 */
const MAX_STAGE_REPAIR_ATTEMPTS = 2
/** 分阶段流水线：全流程修复总次数上限（成本护栏，防止五阶段各自修复叠加失控）。 */
const MAX_TOTAL_REPAIR_ATTEMPTS = 6
/** JSON 解析失败独立于 schema/grounding 修复的重试上限。 */
const MAX_STAGE_PARSE_RETRIES = 2
/** provider 调用失败（瞬时错误）独立于修复预算的重试上限。 */
const MAX_STAGE_PROVIDER_RETRIES = 2
// 全局墙钟预算（默认 6 分钟）中为最终复核预留独立窗口，任何非最终阶段启动前必须保证
// 剩余预算 ≥ 本阶段最小尝试 + 最终复核预留，否则不发起注定无法完成的请求。
// 全局 / 各阶段墙钟上限（先到先停，避免详细 WBS 吃掉最终复核预算）与响应字符上限
// （与 STAGE_OUTPUT_TOKEN_LIMITS 互为冗余护栏）见 generation_budget.ts，
// 可经 AI_DRAFT_TIME_BUDGET_SCALE / AI_DRAFT_OUTPUT_BUDGET_SCALE 为慢模型、大项目放宽。

/** 每阶段单次尝试的最小预算：低于它就不再发起新 provider 请求。 */
const MIN_ATTEMPT_BUDGET_MS: Record<ProjectDraftGenerationStage, number> = {
  charter_scope: 20_000,
  wbs_tasks: 35_000,
  schedule_dependencies: 25_000,
  resources_risks_acceptance: 25_000,
  reconcile_review: 30_000,
}

/** 脱敏解析失败分类（不含原始输出），用于 repair envelope 与 checkpoint 审计。 */
export type DraftParseFailureKind =
  'empty_response' | 'truncated' | 'multi_object' | 'illegal_quote_or_control' | 'malformed_json'

function looksTruncatedText(raw: string): boolean {
  const opens = (raw.match(/[{[]/g) ?? []).length
  const closes = (raw.match(/[}\]]/g) ?? []).length
  return opens > closes
}

function countBalancedObjects(raw: string): number {
  let count = 0
  let depth = 0
  let inString = false
  let escaped = false
  for (const char of raw) {
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) count += 1
    }
  }
  return count
}

export function classifyJsonFailure(raw: string): DraftParseFailureKind {
  if (!raw.trim()) return 'empty_response'
  if (looksTruncatedText(raw)) return 'truncated'
  try {
    JSON.parse(raw)
    return 'malformed_json'
  } catch (error) {
    const message = String((error as Error).message).toLowerCase()
    if (/unterminated string/.test(message)) return 'illegal_quote_or_control'
    if (countBalancedObjects(raw) > 1) return 'multi_object'
    if (/bad control character|unescaped|unexpected token|invalid character/.test(message)) {
      return 'illegal_quote_or_control'
    }
    return 'malformed_json'
  }
}

/** provider 调用异常的脱敏分类：只保留 adapter 抛出的枚举型错误类型（如 token_limit_exceeded）。 */
function providerErrorKind(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (message === 'draft-generation-timeout' || (error as Error)?.name === 'AbortError') {
    return 'request_timeout'
  }
  return /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(message) ? message : 'unknown'
}

function generationFailureCode(errors: readonly DraftSchemaError[]): string {
  const message = errors[0]?.message ?? ''
  if (message.startsWith('GENERATION_BUDGET_EXHAUSTED')) return 'GENERATION_BUDGET_EXHAUSTED'
  if (message.startsWith('MODEL_PROVIDER_CALL_FAILED')) return 'MODEL_PROVIDER_CALL_FAILED'
  if (message.startsWith('JSON_PARSE_FAILED')) return 'MODEL_RESPONSE_JSON_INVALID'
  if (message.startsWith('STAGE_OUTPUT_FIELD_MISSING')) return 'MODEL_STAGE_OUTPUT_INCOMPLETE'
  if (/^(HL-|VE-)/.test(message)) return 'GROUNDING_VALIDATION_FAILED'
  return 'STAGE_GENERATION_FAILED'
}

function sanitizeDraftErrors(
  errors: readonly DraftSchemaError[] | undefined,
  defaultCode?: string,
): ProjectDraftFailureError[] {
  if (!errors || errors.length === 0) return []
  return errors.slice(0, 20).map((err) => {
    let code = defaultCode
    let msg = err.message
    const match = /^([A-Z0-9_-]+):(.*)$/.exec(err.message)
    if (match) {
      code = match[1]
      msg = match[2].trim()
    } else if (err.message.startsWith('HL-') || err.message.startsWith('VE-')) {
      const parts = err.message.split(':')
      code = parts[0]
      msg = parts.slice(1).join(':').trim() || parts[0]
    }
    return {
      path: err.path ? redactProjectDraftQualityText(err.path) : undefined,
      message: redactProjectDraftQualityText(msg || err.message),
      code,
    }
  })
}

function classifyStageErrors(
  errors: readonly DraftSchemaError[],
  missingFactIds: string[],
): 'provider' | 'parse' | 'grounding' | 'schema' {
  const first = errors[0]?.message ?? ''
  if (first.startsWith('MODEL_PROVIDER_CALL_FAILED')) return 'provider'
  if (first.startsWith('JSON_PARSE_FAILED')) return 'parse'
  if (missingFactIds.length > 0) return 'grounding'
  return 'schema'
}

function hashArtifact(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

function buildStageArtifacts(
  draft: ProjectDraft | null,
  attemptCount: number,
  errorCodes: string[] = [],
): ProjectDraftStageArtifact[] {
  const gate = new DraftStageToolGate()
  return DRAFT_STAGE_CATALOG.map((definition) => {
    const allowedTools = gate.resolve(definition)
    const artifact = draft
      ? definition.outputFields.length > 0
        ? Object.fromEntries(
            definition.outputFields.map((field) => [
              field,
              (draft as unknown as Record<string, unknown>)[field],
            ]),
          )
        : { projectType: draft.projectType, moduleCounts: countModules(draft) }
      : null
    return {
      stage: definition.stage,
      status: draft ? 'completed' : 'failed',
      contextScope: [...definition.contextScope],
      allowedTools,
      artifactHash: artifact ? hashArtifact(artifact) : null,
      attemptCount,
      errorCodes: [...errorCodes],
    }
  })
}

/** 阶段 checkpoint 是否可以安全复用（上下文/版本/provider 任一变化即失效）。 */
export function isStageCheckpointReusable(
  checkpoint: ProjectDraftStageCheckpoint,
  context: {
    manifestHash: string
    provider: string
    model: string
    strategy: ProjectDraftStructuredStrategy
  },
): boolean {
  return (
    checkpoint.version === '1.0' &&
    checkpoint.status === 'completed' &&
    checkpoint.artifact !== null &&
    checkpoint.manifestHash === context.manifestHash &&
    checkpoint.catalogVersion === DRAFT_STAGE_CATALOG_VERSION &&
    checkpoint.guideVersion === DRAFT_STAGE_GUIDE_VERSION &&
    checkpoint.schemaVersion === PROJECT_DRAFT_SCHEMA_VERSION &&
    checkpoint.provider === context.provider &&
    checkpoint.model === context.model &&
    checkpoint.strategy === context.strategy
  )
}

function buildPipelineCheckpoint(args: {
  manifestHash: string
  completedStages: ProjectDraftStageCheckpoint[]
  spentMs: number
  spentChars: number
  planUnderstanding?: ProjectPlanUnderstanding | null
}): ProjectDraftPipelineCheckpoint {
  const failed = [...args.completedStages].reverse().find((stage) => stage.status === 'failed')
  return {
    version: '1.0',
    contextHash: args.manifestHash,
    completedStages: args.completedStages.filter((stage) => stage.status === 'completed'),
    ...(failed ? { failedStage: failed } : {}),
    spentMs: args.spentMs,
    spentChars: args.spentChars,
    ...(args.planUnderstanding ? { planUnderstanding: args.planUnderstanding } : {}),
  }
}

function repairEnvelope(args: {
  stage?: ProjectDraftGenerationStage
  attempt: number
  errors: DraftSchemaError[]
  missingFactIds: string[]
  previousFingerprint: string
  /** 剩余修复次数（由调用方按单次/分阶段路径的预算语义计算）。 */
  remainingAttempts: number
  /** 脱敏解析错误类型（可选，仅 parse 类修复携带）。 */
  parseErrorKinds?: string[]
}): ProjectDraftRepairEnvelope {
  const fieldPaths = [...new Set(args.errors.map((error) => error.path))]
    .filter((path) => /^[a-zA-Z0-9_.()[\]-]{1,120}$/.test(path))
    .slice(0, 20)
  const errorCategories: ProjectDraftRepairEnvelope['errorCategories'] = args.parseErrorKinds
    ?.length
    ? ['parse', ...(args.missingFactIds.length ? ['grounding' as const] : [])]
    : args.missingFactIds.length
      ? ['grounding']
      : fieldPaths.some((path) => path === '(root)')
        ? ['parse']
        : ['schema']
  const requestFingerprint = hashArtifact({
    previous: args.previousFingerprint,
    attempt: args.attempt,
    errorCategories,
    fieldPaths,
    missingFactIds: args.missingFactIds.slice(0, 20),
    parseErrorKinds: (args.parseErrorKinds ?? []).slice(0, 5),
  })
  return {
    version: '1.0',
    stage: args.stage ?? 'reconcile_review',
    attempt: args.attempt,
    errorCategories,
    fieldPaths,
    missingFactIds: args.missingFactIds.slice(0, 20),
    remainingAttempts: Math.max(0, args.remainingAttempts),
    requestFingerprint,
    ...(args.parseErrorKinds?.length ? { parseErrorKinds: args.parseErrorKinds.slice(0, 5) } : {}),
  }
}

/** 把任务/甘特日期确定性吸附到工作日；返回变更是否发生（Marked 结构原样保留）。 */
function snapDraftDatesToWorkingDays(
  draft: Record<string, unknown>,
  calendar = createWorkingCalendar(),
): {
  changed: boolean
  tasks: unknown[]
  ganttPreview: unknown
} {
  const tasks = (Array.isArray(draft.tasks) ? draft.tasks : []) as Array<{
    startDate?: { value?: unknown }
    endDate?: { value?: unknown }
  }>
  let changed = false
  const nextTasks = tasks.map((task) => {
    const next = { ...task }
    let start =
      typeof task.startDate?.value === 'string' ? parseIsoDate(task.startDate.value) : null
    let end = typeof task.endDate?.value === 'string' ? parseIsoDate(task.endDate.value) : null
    if (start === null && end === null) return next
    if (start !== null && !isWorkingDay(calendar, start)) {
      start = snapToWorkingDay(calendar, start, 1)
    }
    if (end !== null && !isWorkingDay(calendar, end)) {
      end = snapToWorkingDay(calendar, end, 1)
    }
    if (start !== null && end !== null && end < start) end = start
    let taskChanged = false
    if (
      next.startDate &&
      start !== null &&
      typeof next.startDate.value === 'string' &&
      next.startDate.value !== formatIsoDate(start)
    ) {
      next.startDate = { ...next.startDate, value: formatIsoDate(start) }
      taskChanged = true
    }
    if (
      next.endDate &&
      end !== null &&
      typeof next.endDate.value === 'string' &&
      next.endDate.value !== formatIsoDate(end)
    ) {
      next.endDate = { ...next.endDate, value: formatIsoDate(end) }
      taskChanged = true
    }
    if (taskChanged) changed = true
    return next
  })
  const ganttRaw = (draft.ganttPreview ?? {}) as {
    startDate?: { value?: unknown }
    endDate?: { value?: unknown }
  }
  const ganttPreview = { ...ganttRaw }
  if (typeof ganttRaw.startDate?.value === 'string' && typeof ganttPreview.startDate === 'object') {
    const value = parseIsoDate(ganttRaw.startDate.value)
    if (!isWorkingDay(calendar, value)) {
      ganttPreview.startDate = {
        ...ganttRaw.startDate,
        value: formatIsoDate(snapToWorkingDay(calendar, value, 1)),
      }
      changed = true
    }
  }
  if (typeof ganttRaw.endDate?.value === 'string' && typeof ganttPreview.endDate === 'object') {
    const value = parseIsoDate(ganttRaw.endDate.value)
    if (!isWorkingDay(calendar, value)) {
      ganttPreview.endDate = {
        ...ganttRaw.endDate,
        value: formatIsoDate(snapToWorkingDay(calendar, value, 1)),
      }
      changed = true
    }
  }
  return { changed, tasks: nextTasks, ganttPreview }
}

/**
 * 修复提示 = 原提示 + 有界信封 + 上次校验失败明细（path + message，低敏：
 * 仅 zod/完整性规则消息与模型自产 id，不含用户输入原文）。
 * 只给 fieldPaths 不给明细时模型无从得知错因，重试必然复发（实测缺陷）。
 */
function promptWithRepair(
  prompt: PromptSet,
  envelope: ProjectDraftRepairEnvelope,
  errors: readonly DraftSchemaError[] = [],
): PromptSet {
  const detail = errors
    .slice(0, 20)
    .map((error) => `- ${error.path}: ${error.message.slice(0, 120)}`)
    .join('\n')
  const detailBlock = detail ? `\n【上次校验失败明细】\n${detail}` : ''
  let missingFactsBlock = ''
  try {
    const originalInput = JSON.parse(prompt.userPrompt) as {
      groundingFacts?: Array<{ id?: unknown; category?: unknown; normalizedValue?: unknown }>
    }
    const missingIds = new Set(envelope.missingFactIds)
    const missingFacts = (originalInput.groundingFacts ?? [])
      .filter((fact) => typeof fact.id === 'string' && missingIds.has(fact.id))
      .slice(0, 20)
      .map((fact) => ({
        id: fact.id,
        category: fact.category,
        normalizedValue: fact.normalizedValue,
      }))
    if (missingFacts.length > 0) {
      missingFactsBlock = `\n【必须补回的已确认事实】${JSON.stringify(missingFacts)}`
    }
  } catch {
    // 兼容非 JSON 的旧 prompt；修复信封与失败明细仍会正常发送。
  }
  return {
    systemPrompt: prompt.systemPrompt,
    userPrompt:
      `${prompt.userPrompt}\n\n【定向修复信封】${JSON.stringify(envelope)}${detailBlock}${missingFactsBlock}\n` +
      '严格按照上方输出结构说明修复列出的字段，不扩张范围、不改变其余内容。',
  }
}

/**
 * 阶段级引用完整性检查：在「已聚合产物 + 本阶段产物」上下文中校验跨字段引用。
 * 结构校验先通过才会走到这里；charter_scope 无引用可查，天然通过。
 */
function validateStageIntegrity(
  stage: ProjectDraftGenerationStage,
  normalizedStageFields: Record<string, unknown>,
  mergedDraft: Record<string, unknown>,
): DraftSchemaError[] {
  const candidate = {
    wbs: mergedDraft.wbs ?? [],
    tasks: mergedDraft.tasks ?? [],
    dependencies: mergedDraft.dependencies ?? [],
    milestoneHints: mergedDraft.milestoneHints ?? [],
    acceptanceCriteria: mergedDraft.acceptanceCriteria ?? [],
  } as ProjectDraft
  const errors = validateDraftIntegrity(candidate)
  if (stage === 'schedule_dependencies') {
    const gantt = normalizedStageFields.ganttPreview
    if (isPlainObject(gantt) && Array.isArray(gantt.criticalPathTaskIds)) {
      const taskIds = new Set((candidate.tasks as Array<{ id: string }>).map((task) => task.id))
      gantt.criticalPathTaskIds.forEach((id: unknown, index: number) => {
        if (typeof id !== 'string' || !taskIds.has(id)) {
          errors.push({
            path: `ganttPreview.criticalPathTaskIds[${index}]`,
            message: `甘特关键路径引用了不存在的任务 ${String(id)}`,
          })
        }
      })
    }
  }
  return errors
}

type StageArtifactCheck =
  | { ok: true; normalized: Record<string, unknown>; appliedFixes: string[] }
  | { ok: false; errors: DraftSchemaError[] }

/**
 * 阶段产物质量门（实测缺陷修复：原先只查字段存在性，模型自造结构被一路放行，
 * 全部校验压力堆到 reconcile_review 才暴雷）。现在每阶段当场：
 *   1) 用 normalizeLooseDraft 在聚合上下文中归一化（补 Marked/id 默认值）；
 *   2) 用 STAGE_ARTIFACT_SCHEMAS（与完整草案同源的字段 schema）做结构校验；
 *   3) 做跨阶段引用完整性校验。
 * 通过则把归一化后的产物写回 aggregate（后续阶段与 reconcile 复核拿到的是合法产物）。
 */
function checkStageArtifact(
  definition: DraftStageDefinition,
  extracted: Record<string, unknown>,
  aggregate: Record<string, unknown>,
  projectType: ProjectDraft['projectType'],
): StageArtifactCheck {
  const merged = normalizeLooseDraft(
    {
      schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
      projectType,
      ...aggregate,
      ...extracted,
    },
    projectType,
  )
  const mergedDraft = merged.value as Record<string, unknown>
  const normalized = Object.fromEntries(
    [...definition.outputFields, ...(definition.optionalOutputFields ?? [])].map((field) => [
      field,
      mergedDraft[field],
    ]),
  )
  const appliedFixes: string[] = []
  const structureErrors = validateStageArtifactStructure(
    definition.stage as StageArtifactStage,
    normalized,
  )
  if (structureErrors.length > 0) return { ok: false, errors: structureErrors }
  const integrityErrors = validateStageIntegrity(definition.stage, normalized, mergedDraft)
  if (integrityErrors.length > 0) return { ok: false, errors: integrityErrors }
  // 排期阶段：确定性把任务/甘特日期吸附到工作日（P0 修复：任务日期不再依赖模型自觉）。
  if (definition.stage === 'schedule_dependencies') {
    const snapped = snapDraftDatesToWorkingDays(mergedDraft)
    if (snapped.changed) {
      mergedDraft.tasks = snapped.tasks
      mergedDraft.ganttPreview = snapped.ganttPreview
      const normalizedAfter = Object.fromEntries(
        [...definition.outputFields, ...(definition.optionalOutputFields ?? [])].map((field) => [
          field,
          mergedDraft[field],
        ]),
      )
      const afterStructure = validateStageArtifactStructure(
        definition.stage as StageArtifactStage,
        normalizedAfter,
      )
      if (afterStructure.length > 0) return { ok: false, errors: afterStructure }
      const afterIntegrity = validateStageIntegrity(definition.stage, normalizedAfter, mergedDraft)
      if (afterIntegrity.length > 0) return { ok: false, errors: afterIntegrity }
      appliedFixes.push('schedule_calendar_snap')
      return { ok: true, normalized: normalizedAfter, appliedFixes }
    }
  }
  return { ok: true, normalized, appliedFixes }
}

/**
 * 各阶段不再指定 max_tokens（2026-09-26 放开）：由模型自身最大输出与 controller 的
 * PROJECT_DRAFT_MAX_OUTPUT_TOKENS 夹紧决定。原按阶段设 1.6 万～25.6 万的预算，
 * 思考模型的推理也计入其中，复杂项目仍会在写完之前被截断。
 */

/** wbs_tasks 阶段的颗粒度目标：团队人数取自确认上下文，周期优先取已生成的章程起止日期。 */
/**
 * 资源计划确定性后处理（名册对齐 + 资源平衡），直接改写聚合产物。
 * 结果须仍通过草案结构校验，否则保持原样（后处理不得引入新的结构错误）。
 */
function applyResourcePlan(
  aggregate: Record<string, unknown>,
  roster: readonly TeamRosterEntry[],
  projectType: ProjectDraft['projectType'],
  draftCalendar: DraftCalendar,
  projectStart: string | null = null,
  sizeToDeadline?: { maxPerRole: number; maxTotal: number },
): string[] {
  const plan = planDraftResources(
    aggregate,
    roster,
    draftCalendar.calendar,
    draftCalendar.freezeWindows,
    { projectStart, sizeToDeadline },
  )
  const calendarRisk = estimatedCalendarRisk(draftCalendar, aggregate)
  if (!plan.changed && !calendarRisk) return []
  const riskHints = calendarRisk
    ? [
        ...(plan.riskHints as Array<{ id?: unknown }>).filter(
          (risk) => risk.id !== calendarRisk.id,
        ),
        calendarRisk,
      ]
    : plan.riskHints
  const next = {
    ...aggregate,
    tasks: plan.tasks,
    resourceHints: plan.resourceHints,
    riskHints,
    milestoneHints: plan.milestoneHints,
    ganttPreview: plan.ganttPreview,
  }
  if (!validateProjectDraft(normalizeLooseDraft(next, projectType).value).ok) {
    return ['resource_plan_rejected_invalid_shape']
  }
  Object.assign(aggregate, next)
  const { report } = plan
  const fixes = ['resource_plan_applied']
  if (report.shiftedTasks > 0) fixes.push(`resource_leveling_shifted:${report.shiftedTasks}`)
  if (report.deadlineExceededWorkdays > 0) {
    fixes.push(`resource_leveling_deadline_exceeded:${report.deadlineExceededWorkdays}`)
  }
  if (report.skippedReason) fixes.push(`resource_leveling_skipped:${report.skippedReason}`)
  if (draftCalendar.freezeWindows.length > 0) {
    fixes.push(`change_freeze_windows:${draftCalendar.freezeWindows.length}`)
  }
  if (calendarRisk) {
    fixes.push(`holiday_calendar_estimated:${draftCalendar.estimatedYears.join('/')}`)
  }
  return fixes
}

/**
 * 复核输出只按 9 个模块字段重写整份草案，容易丢掉可选扩展（治理文档、三点估算、风险登记册扩展）。
 * 模型没给的就从前置阶段产物原样带回（按 id 对齐），不覆盖模型复核后给出的值。
 */
function carryOptionalArtifacts(
  output: Record<string, unknown>,
  aggregate: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...output }
  if (next.governance === undefined && aggregate.governance !== undefined) {
    next.governance = aggregate.governance
  }
  const carry = (field: 'tasks' | 'riskHints', keys: readonly string[]) => {
    const source = Array.isArray(aggregate[field]) ? (aggregate[field] as unknown[]) : []
    const byId = new Map(
      source
        .filter((item): item is Record<string, unknown> => isPlainObject(item))
        .map((item) => [String(item.id), item]),
    )
    if (!Array.isArray(next[field])) return
    next[field] = (next[field] as unknown[]).map((item) => {
      if (!isPlainObject(item)) return item
      const prior = byId.get(String(item.id))
      if (!prior) return item
      const merged = { ...item }
      for (const key of keys) {
        if (merged[key] === undefined && prior[key] !== undefined) merged[key] = prior[key]
      }
      return merged
    })
  }
  carry('tasks', ['estimate', 'assigneeRoleIds'])
  carry('riskHints', ['trigger', 'ownerRole', 'strategy'])
  return next
}

/** 排期约束：章程起止之间的可用工作日（含法定节假日与调休），给模型与关键路径检查共用。 */
function scheduleConstraintsFor(
  context: ConfirmedProjectContext,
  aggregate: Record<string, unknown>,
): { startDate: string | null; endDate: string | null; projectWorkdays: number } {
  const draftCalendar = draftCalendarFor(context, aggregate)
  const charter = aggregate.charter as
    { startDate?: { value?: unknown }; endDate?: { value?: unknown } } | undefined
  const start =
    typeof charter?.startDate?.value === 'string'
      ? charter.startDate.value
      : context.parsedIntent.timeline.startDate
  const end =
    typeof charter?.endDate?.value === 'string'
      ? charter.endDate.value
      : context.parsedIntent.timeline.deadline
  if (!start || !end) return { startDate: start ?? null, endDate: end ?? null, projectWorkdays: 0 }
  let workdays = 0
  try {
    for (let day = parseIsoDate(start); day <= parseIsoDate(end); day += 86_400_000) {
      if (isWorkingDay(draftCalendar.calendar, day)) workdays++
    }
  } catch {
    workdays = 0
  }
  return { startDate: start, endDate: end, projectWorkdays: workdays }
}

/**
 * 团队是 AI 假设（用户选「先按角色估算」、未给团队或只有组织人数推断）时，允许按截止日估算各角色人数；
 * 用户给出名册或明确人数时返回 undefined（人数以用户为准，只如实报告延期）。
 */
function teamSizingFor(
  context: ConfirmedProjectContext,
): { maxPerRole: number; maxTotal: number } | undefined {
  const roster = contextTeamRoster(context)
  // 用户给的名册人数不改；理解层建议的团队（AI 假设）可以按工期调整人数。
  if (roster.some((entry) => entry.source !== 'ai')) return undefined
  const team = context.resolvedFields.teamSize
  if (roster.length === 0 && team && team.marker.source === 'explicit') return undefined
  return { maxPerRole: 6, maxTotal: 30 }
}

/**
 * 工期评估：用与最终排期相同的规则（开工日、工作日历、依赖、角色人数）试排一次，
 * 返回延期、纯依赖最长链与各角色负荷，供工期修复判断瓶颈在依赖链还是人手。
 */
function evaluateSchedule(
  aggregate: Record<string, unknown>,
  context: ConfirmedProjectContext,
): ScheduleEvaluation | null {
  const draftCalendar = draftCalendarFor(context, aggregate)
  const plan = planDraftResources(
    aggregate,
    contextTeamRoster(context),
    draftCalendar.calendar,
    draftCalendar.freezeWindows,
    { projectStart: projectStartFor(context, aggregate), sizeToDeadline: teamSizingFor(context) },
  )
  if (!plan.report.leveled) return null
  const tasks = (plan.tasks as unknown[]).filter(isPlainObject)
  const deps = (Array.isArray(aggregate.dependencies) ? aggregate.dependencies : []).filter(
    isPlainObject,
  )
  const chain = longestChainWorkdays(tasks, deps)
  const projectWorkdays = scheduleConstraintsFor(context, aggregate).projectWorkdays
  const workload = new Map<string, number>()
  for (const task of tasks) {
    const roles = (task.assigneeRoleIds as { value?: unknown } | undefined)?.value
    const days = Number((task.durationDays as { value?: unknown } | undefined)?.value) || 0
    for (const role of Array.isArray(roles) ? roles.map(String) : []) {
      workload.set(role, (workload.get(role) ?? 0) + days)
    }
  }
  const headcount = new Map(
    (plan.resourceHints as unknown[])
      .filter(isPlainObject)
      .map((hint) => [
        String((hint.role as { value?: unknown }).value),
        Number((hint.headcount as { value?: unknown }).value) || 1,
      ]),
  )
  return {
    lateWorkdays: plan.report.deadlineExceededWorkdays,
    projectWorkdays,
    plannedEndDate: plan.report.plannedEndDate,
    deadline: plan.report.deadline,
    chainWorkdays: chain?.workdays ?? 0,
    chainTaskIds: (chain?.taskIds ?? []).slice(0, 40),
    roleLoads: [...workload.entries()]
      .map(([role, load]) => ({
        role,
        workload: load,
        headcount: headcount.get(role) ?? 1,
        capacity: (headcount.get(role) ?? 1) * projectWorkdays,
      }))
      .sort((a, b) => b.workload / b.capacity - a.workload / a.capacity)
      .slice(0, 12),
  }
}

/**
 * 团队人数：名册人数合计优先；否则取团队回答里的「N 人」；团队是 AI 假设（按角色估算）时返回 null。
 * 不用 contextTeamSize：它取回答里的第一个数字，「成员#16 负责架构」会被读成 16 人。
 */
function teamHeadcount(context: ConfirmedProjectContext): number | null {
  const roster = contextTeamRoster(context)
  if (roster.length > 0) return roster.reduce((sum, entry) => sum + entry.headcount, 0)
  const team = context.resolvedFields.teamSize
  if (!team || team.marker.source !== 'explicit') return null
  if (typeof team.value === 'number') return team.value
  const match = /(\d+)\s*(?:个)?\s*人/u.exec(String(team.value))
  return match ? Number(match[1]) : null
}

/** 排期锚点：澄清确认的开工日优先，其次章程开工日。 */
function projectStartFor(
  context: ConfirmedProjectContext,
  aggregate: Record<string, unknown>,
): string | null {
  const charter = aggregate.charter as { startDate?: { value?: unknown } } | undefined
  const fromCharter =
    typeof charter?.startDate?.value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(charter.startDate.value)
      ? charter.startDate.value
      : null
  return context.parsedIntent.timeline.startDate ?? fromCharter
}

/**
 * 章程日期锚定到澄清确认值（章程阶段一通过就执行）：模型不得改写用户确认的开工日与截止日，
 * 否则后续阶段按模型编的日期排期（实测今天 9 月却生成 6 月开工）。
 */
function anchorCharterDates(
  aggregate: Record<string, unknown>,
  context: ConfirmedProjectContext,
): string[] {
  const charter = aggregate.charter as
    | {
        startDate?: { value?: unknown; marker?: unknown }
        endDate?: { value?: unknown; marker?: unknown }
      }
    | undefined
  if (!charter) return []
  const fixes: string[] = []
  const { startDate, deadline } = context.parsedIntent.timeline
  const confirmed = (reason: string) => ({
    confidence: 1,
    source: 'explicit',
    reason,
    needsConfirmation: false,
  })
  if (startDate && charter.startDate?.value !== startDate) {
    charter.startDate = { value: startDate, marker: confirmed('开工日来自澄清确认') }
    fixes.push('charter_start_anchored')
  }
  if (deadline && charter.endDate?.value !== deadline) {
    charter.endDate = { value: deadline, marker: confirmed('截止日来自澄清确认的开工日与工期') }
    fixes.push('charter_end_anchored')
  }
  return fixes
}

/** 阶段门模板的判定信号：原始描述 + 意图解析的交付物与目标。 */
function stageGateSignal(context: ConfirmedProjectContext): string {
  return [
    context.rawInput,
    ...context.parsedIntent.deliverables,
    ...context.parsedIntent.objectives,
  ].join(' ')
}

/** 追溯链补链：只补空关联，结果须仍通过结构校验。 */
function applyTraceabilityLinks(
  aggregate: Record<string, unknown>,
  projectType: ProjectDraft['projectType'],
): string[] {
  const linked = autoLinkTraceability(aggregate)
  if (!linked.changed) return []
  const next = {
    ...aggregate,
    acceptanceCriteria: linked.acceptanceCriteria,
    milestoneHints: linked.milestoneHints,
  }
  if (!validateProjectDraft(normalizeLooseDraft(next, projectType).value).ok) return []
  Object.assign(aggregate, next)
  return ['traceability_autolinked']
}

/** 项目窗口内有尚未公布放假安排的年份时，写一条待确认风险（排期按农历估算）。 */
function estimatedCalendarRisk(draftCalendar: DraftCalendar, aggregate: Record<string, unknown>) {
  const charter = aggregate.charter as
    { startDate?: { value?: unknown }; endDate?: { value?: unknown } } | undefined
  const start = typeof charter?.startDate?.value === 'string' ? charter.startDate.value : null
  const end = typeof charter?.endDate?.value === 'string' ? charter.endDate.value : null
  if (!start || !end) return null
  const affected = draftCalendar.estimatedYears.filter(
    (year) => year >= Number(start.slice(0, 4)) && year <= Number(end.slice(0, 4)),
  )
  if (affected.length === 0) return null
  const marker = {
    confidence: 0.9,
    source: 'inferred',
    reason: '工作日历推导',
    needsConfirmation: true,
  }
  return {
    id: 'risk-holiday-calendar-estimated',
    description: {
      value: `${affected.join('、')} 年法定节假日与调休安排尚未公布，排期中的春节、清明等假期按农历估算，实际放假与调休可能使相关任务前后移动数天。`,
      marker,
    },
    level: { value: 'low', marker },
    mitigation: {
      value:
        '国务院公布次年放假安排后（通常为当年 11 月），重新校准工作日历并复核关键路径与封网窗口内的任务。',
      marker,
    },
  }
}

/** 按章程起止（缺失时用意图解析的时间线）构建工作日历与封网窗口。 */
function draftCalendarFor(
  context: ConfirmedProjectContext,
  aggregate: Record<string, unknown>,
): DraftCalendar {
  const charter = aggregate.charter as
    { startDate?: { value?: unknown }; endDate?: { value?: unknown } } | undefined
  const asDate = (value: unknown) =>
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
  return buildDraftCalendar({
    startDate: asDate(charter?.startDate?.value) ?? context.parsedIntent.timeline.startDate ?? null,
    endDate: asDate(charter?.endDate?.value) ?? context.parsedIntent.timeline.deadline ?? null,
    rawInput: context.rawInput,
  })
}

function stageGranularityTarget(
  context: ConfirmedProjectContext,
  priorArtifacts: Record<string, unknown>,
): DraftGranularityTarget {
  const charter = priorArtifacts.charter as
    { startDate?: { value?: unknown }; endDate?: { value?: unknown } } | undefined
  const asDate = (value: unknown) => (typeof value === 'string' ? value : null)
  return computeDraftGranularity({
    teamSize: contextTeamSize(context),
    startDate: asDate(charter?.startDate?.value) ?? context.parsedIntent.timeline.startDate ?? null,
    endDate: asDate(charter?.endDate?.value) ?? context.parsedIntent.timeline.deadline ?? null,
  })
}

/** 按阶段 contextScope 裁剪 grounding 事实（阶段 prompt 与拆分子请求共用）。 */
function scopedGroundingFacts(
  definition: (typeof DRAFT_STAGE_CATALOG)[number],
  manifest: ProjectDraftGroundingManifest,
) {
  return manifest.facts
    .filter((fact) => definition.contextScope.includes(fact.category))
    .slice(0, 32)
    .map(({ id, category, normalizedValue, source, required }) => ({
      id,
      category,
      normalizedValue,
      source,
      required,
    }))
}

const TEAM_ROSTER_RULE =
  '【团队名册】teamRoster 是用户确认的团队构成：任务负责人（assigneeHint / assigneeRoleIds）与 resourceHints.role ' +
  '只能使用名册中的角色名（原文照写）；resourceHints 必须为名册中每个角色各给 1 条，headcount 等于名册人数；' +
  '名册没有的角色（如项目经理）如确需使用，单独给出并说明待确认。同一角色同一时段并行的任务数不得超过其人数。'

/** 需要排期的阶段给模型看日历摘要；章程日期未定时用意图解析的时间线。 */
function stageCalendarFacts(
  stage: ProjectDraftGenerationStage,
  context: ConfirmedProjectContext,
  priorArtifacts: Record<string, unknown>,
) {
  if (
    stage !== 'wbs_tasks' &&
    stage !== 'schedule_dependencies' &&
    stage !== 'resources_risks_acceptance'
  ) {
    return null
  }
  const charter = priorArtifacts.charter as
    { startDate?: { value?: unknown }; endDate?: { value?: unknown } } | undefined
  const start =
    (typeof charter?.startDate?.value === 'string' ? charter.startDate.value : null) ??
    context.parsedIntent.timeline.startDate
  const end =
    (typeof charter?.endDate?.value === 'string' ? charter.endDate.value : null) ??
    context.parsedIntent.timeline.deadline
  if (!start || !end) return null
  return calendarPromptFacts(draftCalendarFor(context, priorArtifacts), start, end)
}

/**
 * 阶段 prompt：每次调用都是全新对话，user 消息只含本阶段需要的记忆片段（见 draft_memory.ts），
 * 不再整包塞入前置产物（实测排期 / 资源阶段单次输入 7–8 万 token 的根因）。
 */
function stagePrompt(
  definition: (typeof DRAFT_STAGE_CATALOG)[number],
  manifest: ProjectDraftGroundingManifest,
  priorArtifacts: Record<string, unknown>,
  context: ConfirmedProjectContext,
  usage?: ContextUsageLog,
): PromptSet {
  const scopedFacts = scopedGroundingFacts(definition, manifest)
  const tools = new DraftStageToolGate().resolve(definition)
  const roster: TeamRosterEntry[] =
    definition.stage === 'wbs_tasks' || definition.stage === 'resources_risks_acceptance'
      ? contextTeamRoster(context)
      : []
  const calendarFacts = stageCalendarFacts(definition.stage, context, priorArtifacts)
  const spine = () => buildSpine({ context, aggregate: priorArtifacts })
  const understanding = context.planUnderstanding ?? null
  const slices: Array<[string, (level: number) => unknown]> = [
    ['spine', spine],
    ['groundingFacts', () => scopedFacts],
  ]
  if (definition.stage === 'wbs_tasks') {
    slices.push(['charter', () => priorArtifacts.charter])
    if (understanding) {
      slices.push(['capabilityMap', () => understanding.capabilities])
      slices.push([
        'businessFlows',
        (level) => (level >= 2 ? undefined : understanding.businessFlows),
      ])
    }
  }
  if (definition.stage === 'schedule_dependencies') {
    slices.push(['wbsOutline', () => wbsOutline(priorArtifacts)])
    slices.push([
      'taskIndex',
      (level) => taskIndex(priorArtifacts, { outputs: level === 0 ? 60 : level === 1 ? 24 : 0 }),
    ])
    slices.push(['scheduleConstraints', () => scheduleConstraintsFor(context, priorArtifacts)])
    if (Array.isArray(priorArtifacts[WORK_PACKAGE_PLAN_KEY])) {
      slices.push(['workPackagePlan', () => priorArtifacts[WORK_PACKAGE_PLAN_KEY]])
    }
  }
  if (definition.stage === 'resources_risks_acceptance') {
    slices.push(['wbsOutline', () => wbsOutline(priorArtifacts)])
    slices.push([
      'taskIndex',
      (level) =>
        taskIndex(priorArtifacts, {
          dates: true,
          outputs: level === 0 ? 60 : level === 1 ? 24 : 0,
        }),
    ])
    slices.push(['criticalChain', () => criticalChainSummary(priorArtifacts)])
    if (understanding) {
      slices.push(['assumptions', () => understanding.assumptions])
      slices.push([
        'capabilityMap',
        (level) => (level >= 1 ? undefined : understanding.capabilities),
      ])
    }
  }
  if (roster.length > 0) slices.push(['teamRoster', () => roster])
  if (calendarFacts) slices.push(['workCalendar', () => calendarFacts])
  const view = memoryView(`draft.${definition.stage}`, slices)
  usage?.record(view.usage)
  return {
    systemPrompt:
      `你正在执行项目草案阶段 ${definition.stage}。只可使用给定事实与项目主干记忆（spine）；` +
      `只可见工具 ${tools.length ? tools.join('、') : '无'}，不得调用或假设其他工具。` +
      '仅返回 JSON，不要 Markdown、解释或额外字段。不得声称已创建或修改正式项目。\n' +
      `今天是 ${String(spine().today)}；开工日与截止日见 spine.schedule，不得改动或早于今天。\n` +
      `${DRAFT_MARKER_CONTRACT_GUIDE}\n${DRAFT_ID_CONVENTION_GUIDE}\n${STAGE_OUTPUT_GUIDES[definition.stage]}` +
      (definition.stage === 'wbs_tasks'
        ? `\n${draftGranularityGuide(stageGranularityTarget(context, priorArtifacts))}`
        : '') +
      (roster.length > 0 ? `\n${TEAM_ROSTER_RULE}` : '') +
      (calendarFacts ? `\n${WORK_CALENDAR_RULE}` : '') +
      (definition.stage === 'wbs_tasks'
        ? `\n${stageGateRule(stageGateTemplate(stageGateSignal(context)).gates.map((gate) => gate.name))}`
        : ''),
    userPrompt: JSON.stringify({
      stage: definition.stage,
      requiredOutputFields:
        definition.stage === 'schedule_dependencies' ? ['dependencies'] : definition.outputFields,
      ...view.payload,
      allowedTools: tools,
      instruction: '只输出当前 requiredOutputFields 对应的 JSON 对象。',
    }),
  }
}

/** 当前依赖网上的最长链（给资源 / 风险阶段看关键路径，不给全部依赖）。 */
function criticalChainSummary(aggregate: Record<string, unknown>) {
  const tasks = (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(isPlainObject)
  const deps = (Array.isArray(aggregate.dependencies) ? aggregate.dependencies : []).filter(
    isPlainObject,
  )
  const chain = longestChainWorkdays(tasks, deps)
  if (!chain) return null
  return { workdays: chain.workdays, taskIds: chain.taskIds.slice(0, 40) }
}

/** 用户在澄清中确认的与系统假设的起止、团队、理解：写入决策库，后续每次调用都带。 */
function recordContextDecisions(
  log: DecisionLog,
  context: ConfirmedProjectContext,
  understanding: ProjectPlanUnderstanding | null,
): void {
  const { startDate, deadline } = context.parsedIntent.timeline
  const startMarker =
    context.resolvedFields.startDate?.marker ?? context.assumptions.startDate?.marker
  if (startDate) {
    log.add(
      `开工日 ${startDate}${deadline ? `，截止日 ${deadline}` : ''}`,
      startMarker?.source === 'explicit'
        ? '用户在澄清中确认'
        : '用户未确认，按今天之后的下一个工作日假设',
      startMarker?.source === 'explicit' ? 'user' : 'system',
      'clarification',
    )
  }
  const team = context.resolvedFields.teamSize ?? context.assumptions.teamSize
  // 有名册（含协商改过的团队）时按名册写，避免只记下人数字段里残留的旧值（实测显示「团队：1 人」）。
  const roster = contextTeamRoster(context)
  const rosterText =
    roster.length > 0
      ? `${roster.map((member) => `${member.role} ${member.headcount}`).join('、')}（共 ${roster.reduce((sum, member) => sum + member.headcount, 0)} 人）`
      : null
  if (team || rosterText) {
    log.add(
      `团队：${rosterText ?? String(team!.value).slice(0, 80)}`,
      context.feasibilityDecision?.team?.length
        ? '生成前评估能否如期完成后由你确认'
        : (team?.marker.reason ?? '用户在需求描述中给出'),
      context.feasibilityDecision?.team?.length || team?.marker.source === 'explicit'
        ? 'user'
        : 'system',
      'clarification',
    )
  }
  if (understanding) {
    log.add(
      `按 ${understanding.capabilities.length} 项能力拆解（${understanding.capabilities
        .map((item) => item.name)
        .join('、')
        .slice(0, 120)}）`,
      understanding.confirmedByUser ? '用户已确认项目理解' : '项目理解由 AI 梳理，用户未确认',
      understanding.confirmedByUser ? 'user' : 'model',
      'understanding',
    )
  }
}

/** 任务层依赖对齐工作包计划：删没有工作包依据的跨包依赖、补缺失的包间衔接，并写入决策库。 */
function recordDependencyAlignment(
  aggregate: Record<string, unknown>,
  extras: StagedExtras,
  appliedFixes: string[],
  stage: string,
): void {
  const packages = extras.decomposition?.workPackages ?? []
  if (!extras.packageOfNode || packages.length === 0) return
  const result = alignTaskDependencies(aggregate, extras.packageOfNode, packages)
  const cyclesBroken = breakDependencyCycles(aggregate)
  if (cyclesBroken > 0) {
    appliedFixes.push(`dependency_cycles_broken:${cyclesBroken}`)
    extras.decisions.add(
      `删除 ${cyclesBroken} 条造成循环的依赖`,
      '依赖成环时排期无法计算；优先删除程序补的衔接，其次删最后加入的依赖',
      'system',
      stage,
    )
  }
  if (result.removed === 0 && result.added === 0) return
  appliedFixes.push(`dependencies_aligned:-${result.removed}+${result.added}`)
  extras.decisions.add(
    `任务依赖对齐工作包计划（删除 ${result.removed} 条无依据的跨包依赖，补齐 ${result.added} 条包间衔接）`,
    '跨工作包的先后只能来自已验证可行的工作包依赖，避免把可并行的工作串成长链',
    'system',
    stage,
  )
}

/** 按拆解层的工作包预算校准任务工期，并写入决策库（有调整才记）。 */
function recordCalibration(
  aggregate: Record<string, unknown>,
  extras: StagedExtras,
  appliedFixes: string[],
  stage: string,
): void {
  const packages = extras.decomposition?.workPackages ?? []
  if (packages.length === 0) return
  const result = calibrateTaskEffort(
    aggregate,
    new Map(packages.map((pkg) => [pkg.wbsNodeId, pkg.effortDays])),
  )
  if (result.packages === 0) return
  appliedFixes.push(`task_effort_calibrated:${result.before}->${result.after}`)
  extras.decisions.add(
    `按工作包工作量校准任务工期（合计 ${result.before} → ${result.after} 人天，涉及 ${result.packages} 个工作包）`,
    '任务拆解合计明显超出工作包的人天估算；按比例缩短，最多缩到原值的 60%',
    'system',
    stage,
  )
}

/** 任务来源追溯：按所属工作包（WBS 叶节点）标注「能力 › 工作包」。返回标注数。 */
function annotateTaskTrace(
  aggregate: Record<string, unknown>,
  traceOfNode: ReadonlyMap<string, ProjectDraftTaskTrace>,
): number {
  let count = 0
  for (const task of (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(
    isPlainObject,
  )) {
    const trace = traceOfNode.get(String(task.wbsNodeId))
    if (!trace) continue
    task.trace = trace
    count++
  }
  return count
}

interface StagedExtras {
  planUnderstanding: ProjectPlanUnderstanding | null
  qualityLoop: ProjectDraftQualityLoop | null
  reviewItems: ProjectDraftReviewItem[]
  usage: ContextUsageLog
  decomposition: ProjectDraftDecomposition | null
  decisions: DecisionLog
  /** WBS 叶节点 → 来源（能力 › 工作包），质量闭环补的任务也按它补标注。 */
  traceOfNode: Map<string, ProjectDraftTaskTrace> | null
  /** WBS 叶节点 → 工作包 id（任务层依赖对齐工作包计划时用）。 */
  packageOfNode: Map<string, string> | null
}

/**
 * 待确认清单去重：理解层的开放问题与各分支修复时提出的「需要你决定」常是同一件事
 * （实测「签到方式」出现 3 次）。按中文二元词重合度判重，保留先出现（更靠前 / 更严重）的一条。
 */
function dedupeReviewItems(items: ProjectDraftReviewItem[]): ProjectDraftReviewItem[] {
  const grams = (value: string) => {
    const compact = value.replace(/[^\u3400-\u9fffA-Za-z0-9]/gu, '')
    const set = new Set<string>()
    for (let index = 0; index < compact.length - 1; index++)
      set.add(compact.slice(index, index + 2))
    return set
  }
  const kept: Array<{ item: ProjectDraftReviewItem; grams: Set<string> }> = []
  for (const item of items) {
    const current = grams(item.detail)
    const duplicate = kept.some(({ grams: other }) => {
      const overlap = [...current].filter((gram) => other.has(gram)).length
      return overlap / Math.max(1, Math.min(current.size, other.size)) >= 0.45
    })
    if (!duplicate) kept.push({ item, grams: current })
  }
  return kept.map(({ item }) => item)
}

/** 理解层里用户尚未确认的假设与开放问题，进入审查页「待你确认」。 */
function understandingReviewItems(
  understanding: ProjectPlanUnderstanding | null,
): ProjectDraftReviewItem[] {
  if (!understanding) return []
  const items: ProjectDraftReviewItem[] = understanding.openQuestions.map((question, index) => ({
    id: `uq-${index + 1}`,
    kind: 'decision_needed' as const,
    severity: 'medium' as const,
    title: '开放问题',
    detail: question,
    attemptedRepairs: 0,
  }))
  if (!understanding.confirmedByUser) {
    for (const assumption of understanding.assumptions) {
      items.push({
        id: `ua-${assumption.id}`,
        kind: 'assumption',
        severity: 'low',
        title: '规划假设',
        detail: assumption.impact
          ? `${assumption.statement}（若不成立：${assumption.impact}）`
          : assumption.statement,
        attemptedRepairs: 0,
      })
    }
  }
  return items
}

/** 质量闭环每轮修补后：归一新增任务 / 依赖（补标注、占位日期），保持阶段产物结构合法。 */
function normalizeRepairedAggregate(
  aggregate: Record<string, unknown>,
  projectType: ProjectDraft['projectType'],
): void {
  const normalized = normalizeLooseDraft(aggregate, projectType).value as Record<string, unknown>
  aggregate.tasks = normalized.tasks
  aggregate.dependencies = normalized.dependencies
}

/**
 * 已确认事实确定性补回（取代「遗漏事实就阻断确认」）：按类别写入章程最匹配的字段，
 * 标注来源为用户确认。
 */
function applyGroundingFacts(
  aggregate: Record<string, unknown>,
  manifest: ProjectDraftGroundingManifest,
  projectType: ProjectDraft['projectType'],
): string[] {
  const normalized = normalizeLooseDraft(aggregate, projectType).value
  const validation = validateProjectDraft(normalized)
  if (!validation.ok) return []
  const semantic = validateSemanticGrounding(validation.value, manifest)
  if (semantic.missingFactIds.length === 0) return []
  const missing = new Set(semantic.missingFactIds)
  const charter = aggregate.charter as
    Record<string, { value: unknown; marker: AiMarker }> | undefined
  if (!charter) return []
  const explicit = (reason: string): AiMarker => ({
    confidence: 1,
    source: 'explicit',
    reason,
    needsConfirmation: false,
  })
  let added = 0
  for (const fact of manifest.facts) {
    if (!missing.has(fact.id)) continue
    const value = fact.normalizedValue
    if (fact.category === 'metric' && Array.isArray(charter.successCriteria?.value)) {
      charter.successCriteria = {
        value: [...(charter.successCriteria.value as string[]), value],
        marker: explicit('含用户确认的量化指标'),
      }
    } else if (
      (fact.category === 'deliverable' || fact.category === 'business_concept') &&
      Array.isArray(charter.objectives?.value)
    ) {
      charter.objectives = {
        value: [...(charter.objectives.value as string[]), value],
        marker: explicit('含用户确认的交付物'),
      }
    } else if (typeof charter.scope?.value === 'string') {
      const scope = charter.scope.value
      charter.scope = {
        value: `${scope}${scope.endsWith('。') ? '' : '。'}已确认：${value}`,
        marker: explicit('含用户确认的事实'),
      }
    } else {
      continue
    }
    added++
  }
  return added > 0 ? [`grounding_facts_restored:${added}`] : []
}

/**
 * 依赖一确定就由程序排期（按开工日、工作日历、依赖与角色人数），后续资源 / 风险 / 里程碑阶段
 * 看到的是真实日期。只改写任务日期与甘特预览，不动其它模块。
 */
function scheduleTasksNow(
  aggregate: Record<string, unknown>,
  context: ConfirmedProjectContext,
): string[] {
  const broken = breakDependencyCycles(aggregate)
  const draftCalendar = draftCalendarFor(context, aggregate)
  const plan = planDraftResources(
    aggregate,
    contextTeamRoster(context),
    draftCalendar.calendar,
    draftCalendar.freezeWindows,
    { projectStart: projectStartFor(context, aggregate), sizeToDeadline: teamSizingFor(context) },
  )
  const cycleFix = broken > 0 ? [`dependency_cycles_broken:${broken}`] : []
  if (!plan.report.leveled) {
    return [
      ...cycleFix,
      ...(plan.report.skippedReason ? [`early_schedule_skipped:${plan.report.skippedReason}`] : []),
    ]
  }
  aggregate.tasks = plan.tasks
  if (plan.ganttPreview) aggregate.ganttPreview = plan.ganttPreview
  return [...cycleFix, 'early_schedule_applied']
}

function failedStageArtifacts(
  completed: ProjectDraftStageArtifact[],
  failedStage: ProjectDraftGenerationStage,
  attemptCount: number,
  errorCode: string,
): ProjectDraftStageArtifact[] {
  const gate = new DraftStageToolGate()
  return DRAFT_STAGE_CATALOG.map((definition) => {
    const existing = completed.find((artifact) => artifact.stage === definition.stage)
    if (existing) return existing
    return {
      stage: definition.stage,
      status: 'failed',
      contextScope: [...definition.contextScope],
      allowedTools: gate.resolve(definition),
      artifactHash: null,
      attemptCount: definition.stage === failedStage ? attemptCount : 0,
      errorCodes: definition.stage === failedStage ? [errorCode] : ['STAGE_NOT_REACHED'],
    }
  })
}

export class ProjectDraftGenerationService {
  constructor(private readonly promptBuilder = new ProjectDraftPromptBuilder()) {}

  /**
   * 结构化策略降级（design D3）：
   *   - source=user：按连接能力 supportsStrictSchema → native > supportsToolCalling → tool > prompt；
   *   - source=fallback（env 默认 OpenAI）：假定 native（strict schema 可用）；
   *   - source=mock（无 key）：prompt（最弱保证，禁止用于判定）。
   */
  resolveStrategy(resolved: ResolvedAdapter): ProjectDraftStructuredStrategy {
    if (resolved.source === 'mock') return 'prompt'
    if (resolved.source === 'fallback') return 'native'
    const cap = resolved.capabilities
    if (cap?.supportsStrictSchema) return 'native'
    if (cap?.supportsToolCalling) return 'tool'
    return 'prompt'
  }

  async generate(options: GenerateDraftOptions): Promise<GenerateDraftResult> {
    const { context, resolved } = options
    const strategy = this.resolveStrategy(resolved)
    const input = this.promptBuilder.buildGenerationInput(context)
    // 确定性草案（grounded 于蓝图 + 显式事实值），作为 fallback 内容与结构基线。
    const deterministic = applyOverlay(buildDraftFromBlueprint(input.blueprint), input.overlay)

    const projectType = input.projectType
    const groundingManifest = buildGroundingManifest(context)

    const stageProvider = options.rawTextProvider
    if (stageProvider && options.useStagePipeline) {
      return this.generateStaged({
        options: { ...options, rawTextProvider: stageProvider },
        projectType,
        groundingManifest,
        overlay: input.overlay,
        strategy,
      })
    }

    // —— 确定性引擎路径（V1 生产默认 / mock 联调 / CI）——
    if (!options.rawTextProvider) {
      const meta = this.buildMeta({
        draft: deterministic,
        projectType,
        strategy,
        consistency: 'strict',
        // 内容来自确定性引擎而非真实模型：如实标注 fallback、usingRealAdapter=false。
        fallbackUsed: true,
        provider: resolved.provider,
        model: resolved.model,
        usingRealAdapter: false,
        appliedFixes: [],
        groundingManifest,
        stages: buildStageArtifacts(deterministic, 1),
        confirmability: {
          status: 'review_blocked',
          reasons: ['DETERMINISTIC_FIXTURE_NOT_PROVIDER_VERIFIED'],
        },
        repairs: [],
      })
      return { status: 'completed', draft: deterministic, meta, consistency: 'strict', retries: 0 }
    }

    // —— 真实模型路径：parse → validate → repair/retry → classify ——
    const prompt = this.promptBuilder.buildPromptSet(context, strategy)
    const jsonSchema = draftJsonSchemaForStrategy(strategy)
    const maxRetries = Math.min(MAX_REPAIR_ATTEMPTS, Math.max(0, options.maxRetries ?? 1))
    let lastErrors: DraftSchemaError[] = []
    let sawRecoverableModelResponse = false
    let totalChars = 0
    let firstTokenEmitted = false
    let lastStructuredDraft: ProjectDraft | null = null
    let lastQualityIssues: DraftValidationIssue[] = []
    let lastMissingFactIds: string[] = []
    const repairs: ProjectDraftRepairEnvelope[] = []
    const startedAt = Date.now()
    const budget = resolveDraftGenerationBudget()
    let previousFingerprint = hashArtifact({ strategy, manifestHash: groundingManifest.hash })
    let responseModel = resolved.model
    let effectiveStrategy = strategy

    // §4.1: 通知开始阶段
    options.onPhase?.('adapter_ready', 0)

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (
        Date.now() - startedAt > budget.maxGenerationWallMs ||
        totalChars > budget.maxTotalResponseChars
      ) {
        const exhausted: DraftBudgetExhaustion =
          totalChars > budget.maxTotalResponseChars ? 'total_output' : 'global_time'
        lastErrors = [
          {
            path: '(root)',
            message: `GENERATION_BUDGET_EXHAUSTED: ${DRAFT_BUDGET_EXHAUSTION_LABELS[exhausted]}`,
          },
          ...lastErrors.slice(0, 5),
        ]
        break
      }
      // §4.2: 重试时上报独立阶段
      if (attempt > 0) {
        options.onPhase?.('retrying', totalChars, attempt)
      }

      let rawText: string
      const charsBeforeAttempt = totalChars
      let effectivePrompt = prompt
      if (attempt > 0) {
        const envelope = repairEnvelope({
          attempt,
          errors: lastErrors,
          missingFactIds: lastMissingFactIds,
          previousFingerprint,
          remainingAttempts: maxRetries - attempt,
        })
        repairs.push(envelope)
        previousFingerprint = envelope.requestFingerprint
        effectivePrompt = promptWithRepair(prompt, envelope, lastErrors)
      }
      try {
        // §4.1: 透传 onChunk 回调
        const providerResult = await options.rawTextProvider({
          prompt: effectivePrompt,
          strategy,
          jsonSchema,
          attempt,
          sentence: '生成经确认事实约束的结构化项目草案',
          onChunk: (chunk: string) => {
            totalChars += chunk.length
            if (!firstTokenEmitted && chunk.length > 0) {
              firstTokenEmitted = true
              options.onPhase?.('first_token', totalChars)
            }
            options.onPhase?.('receiving', totalChars)
            options.onChunk?.(chunk)
          },
          onPhase: options.onPhase,
        })
        if (typeof providerResult === 'string') {
          rawText = providerResult
        } else {
          rawText = providerResult.rawText
          responseModel = providerResult.responseModel?.trim() || responseModel
          effectiveStrategy = providerResult.effectiveStrategy ?? effectiveStrategy
        }
      } catch (err) {
        void err
        lastErrors = [{ path: '(root)', message: 'MODEL_PROVIDER_CALL_FAILED' }]
        continue
      }

      if (totalChars === charsBeforeAttempt) totalChars += rawText.length

      options.onPhase?.('parsing', totalChars)
      const parsed = tryParseJson(rawText)
      if (!parsed.ok) {
        if (parsed.errorKind === 'truncated' || rawText.trim().length === 0) {
          sawRecoverableModelResponse = true
        }
        lastErrors = [
          {
            path: '(root)',
            message: `JSON_PARSE_FAILED:${parsed.errorKind ?? 'malformed_json'}`,
          },
        ]
        continue
      }
      sawRecoverableModelResponse = true

      const strictValidated = validateProjectDraft(parsed.value)
      options.onPhase?.('validating', totalChars)
      const normalized = strictValidated.ok
        ? { value: parsed.value, applied: false }
        : normalizeLooseDraft(parsed.value, projectType)
      const validated = validateProjectDraft(normalized.value)
      if (!validated.ok) {
        lastErrors = validated.errors.slice(0, 20)
        continue
      }

      // 命中：叠加显式事实（禁止模型覆盖），再校验一次确保仍合法。
      const withFacts = applyOverlay(validated.value, input.overlay)
      const reval = validateProjectDraft(withFacts)
      const draft = reval.ok ? withFacts : validated.value
      const semantic = validateSemanticGrounding(draft, groundingManifest)
      if (!semantic.valid) {
        lastStructuredDraft = draft
        lastQualityIssues = semantic.blocking
        lastMissingFactIds = semantic.missingFactIds
        lastErrors = semantic.blocking.map((issue) => ({
          path: issue.path ?? '(root)',
          message: `${issue.ruleId}:${issue.message}`,
        }))
        continue
      }
      const consistency: ProjectDraftConsistency =
        parsed.appliedFixes.length === 0 && !normalized.applied ? 'strict' : 'repairable'
      const meta = this.buildMeta({
        draft,
        projectType,
        strategy,
        consistency,
        fallbackUsed: resolved.source !== 'user',
        provider: resolved.provider,
        model: resolved.model,
        usingRealAdapter: resolved.usingRealAdapter,
        appliedFixes: normalized.applied
          ? [...parsed.appliedFixes, 'normalize_loose_draft']
          : parsed.appliedFixes,
        groundingManifest,
        stages: buildStageArtifacts(draft, attempt + 1),
        confirmability:
          resolved.source === 'user' && resolved.usingRealAdapter
            ? { status: 'confirmable', reasons: [] }
            : { status: 'review_blocked', reasons: ['PROVIDER_OR_FALLBACK_NOT_VERIFIED'] },
        repairs,
        requestedModel: resolved.model,
        responseModel,
        effectiveStrategy,
      })
      return { status: 'completed', draft, meta, consistency, retries: attempt }
    }

    if (lastStructuredDraft) {
      const consistency: ProjectDraftConsistency = 'repairable'
      const meta = this.buildMeta({
        draft: lastStructuredDraft,
        projectType,
        strategy,
        consistency,
        fallbackUsed: false,
        provider: resolved.provider,
        model: resolved.model,
        usingRealAdapter: resolved.usingRealAdapter,
        appliedFixes: [],
        groundingManifest,
        stages: buildStageArtifacts(lastStructuredDraft, maxRetries + 1, ['GROUNDING_FAILED']),
        confirmability: {
          status: 'review_blocked',
          reasons: ['GROUNDING_VALIDATION_FAILED'],
        },
        repairs,
        requestedModel: resolved.model,
        responseModel,
        effectiveStrategy,
      })
      return {
        status: 'completed',
        draft: lastStructuredDraft,
        meta,
        consistency,
        retries: maxRetries,
        qualityIssues: lastQualityIssues,
      }
    }

    if (sawRecoverableModelResponse) {
      const consistency: ProjectDraftConsistency = 'repairable'
      const meta = this.buildMeta({
        draft: deterministic,
        projectType,
        strategy,
        consistency,
        fallbackUsed: true,
        provider: resolved.provider,
        model: resolved.model,
        usingRealAdapter: resolved.usingRealAdapter,
        appliedFixes: ['fallback_to_blueprint_after_model_contract_failure'],
        groundingManifest,
        stages: buildStageArtifacts(deterministic, maxRetries + 1, ['MODEL_CONTRACT_FAILURE']),
        confirmability: {
          status: 'review_blocked',
          reasons: ['MODEL_CONTRACT_FAILURE_FALLBACK'],
        },
        repairs,
        requestedModel: resolved.model,
        responseModel,
        effectiveStrategy,
      })
      return {
        status: 'completed',
        draft: deterministic,
        meta,
        consistency,
        retries: maxRetries,
      }
    }

    // —— 重试耗尽：失败，不可确认（spec「最终失败不可确认」）——
    const singleFailureCode = generationFailureCode(lastErrors)
    const sanitizedSingleErrors = sanitizeDraftErrors(lastErrors, singleFailureCode)
    const meta = this.buildMeta({
      draft: null,
      projectType,
      strategy,
      consistency: 'failed',
      fallbackUsed: resolved.source !== 'user',
      provider: resolved.provider,
      model: resolved.model,
      usingRealAdapter: resolved.usingRealAdapter,
      appliedFixes: [],
      groundingManifest,
      stages: buildStageArtifacts(null, maxRetries + 1, [singleFailureCode]),
      confirmability: { status: 'failed', reasons: [singleFailureCode] },
      repairs,
      requestedModel: resolved.model,
      responseModel,
      effectiveStrategy,
      failure: {
        stage: 'charter_scope',
        reasonCode: singleFailureCode,
        errors: sanitizedSingleErrors,
      },
    })
    return {
      status: 'failed',
      draft: null,
      meta,
      consistency: 'failed',
      errorCode: singleFailureCode,
      stage: 'charter_scope',
      reasonCode: singleFailureCode,
      errors: lastErrors,
      retries: maxRetries,
    }
  }

  /** 分阶段生成；理解层、质量闭环、待确认项与上下文用量在各出口统一并入 meta。 */
  private async generateStaged(args: {
    options: GenerateDraftOptions & { rawTextProvider: DraftRawTextProvider }
    projectType: ProjectDraft['projectType']
    groundingManifest: ProjectDraftGroundingManifest
    overlay: DraftFactOverlay
    strategy: ProjectDraftStructuredStrategy
  }): Promise<GenerateDraftResult> {
    const extras: StagedExtras = {
      planUnderstanding: null,
      qualityLoop: null,
      reviewItems: [],
      usage: new ContextUsageLog(),
      decomposition: null,
      decisions: new DecisionLog(),
      traceOfNode: null,
      packageOfNode: null,
    }
    // 生成前在「能否如期完成」里用户确认的决定（已由控制器套用到截止日 / 团队 / 范围），记进决策记录。
    const agreed = args.options.context.feasibilityDecision
    if (agreed && agreed.kind !== 'as_is') {
      extras.decisions.add(
        agreed.summary,
        '生成前评估能否如期完成后由你确认',
        'user',
        'charter_scope',
      )
    }
    const result = await this.generateStagedCore({ ...args, extras })
    // 待确认与决策是给人看的：里面的 task-N / wbs-N 换成名称。
    const names = result.draft
      ? referenceNames(result.draft as unknown as Record<string, unknown>)
      : new Map<string, string>()
    // 能力编号（cap-N）换成能力名：审查意见常写「cap-4 预算」「cap-9 试运行」。
    for (const capability of extras.planUnderstanding?.capabilities ?? []) {
      names.set(capability.id, capability.name)
    }
    const readable = <
      T extends { detail?: string; title?: string; decision?: string; reason?: string },
    >(
      item: T,
    ): T => {
      const next = { ...item }
      for (const key of ['detail', 'title', 'decision', 'reason'] as const) {
        const value = next[key]
        if (typeof value === 'string')
          (next as Record<string, unknown>)[key] = humanizeInternalTerms(
            humanizeReferenceText(value, names),
          )
      }
      return next
    }
    extras.reviewItems = extras.reviewItems.map(readable)
    result.meta = {
      ...result.meta,
      ...(extras.planUnderstanding ? { planUnderstanding: extras.planUnderstanding } : {}),
      ...(extras.qualityLoop ? { qualityLoop: extras.qualityLoop } : {}),
      reviewItems: dedupeReviewItems([
        ...extras.reviewItems.filter((item) => item.severity === 'high'),
        ...understandingReviewItems(extras.planUnderstanding).map(readable),
        ...extras.reviewItems.filter((item) => item.severity !== 'high'),
      ]),
      contextUsage: extras.usage.list(),
      ...(extras.decomposition ? { decomposition: extras.decomposition } : {}),
      decisions: extras.decisions.list().map(readable),
    }
    return result
  }

  /**
   * 拆解层：按确认的能力地图逐项拆工作包（多候选 + 评审），由程序构建 WBS。
   * 能力少于 2 项或全部失败时返回 null，退回模型生成 WBS 骨架。
   */
  private async decompose(
    options: GenerateDraftOptions & { rawTextProvider: DraftRawTextProvider },
    extras: StagedExtras,
    aggregate: Record<string, unknown>,
    usage: ContextUsageLog,
  ): Promise<{
    wbs: Record<string, unknown>[]
    leafDetails: Record<
      string,
      {
        deliverable: string
        doneDefinition: string
        effortDays: number
        roleEffort?: Record<string, number>
      }
    >
    traceOfNode: Map<string, ProjectDraftTaskTrace>
    workPackages: ProjectDraftDecomposition['workPackages']
  } | null> {
    const understanding = options.context.planUnderstanding
    if (!understanding || understanding.capabilities.length < 2) return null
    const gates = stageGateTemplate(stageGateSignal(options.context)).gates.map((gate) => gate.name)
    const headcount = teamHeadcount(options.context)
    const workdays = scheduleConstraintsFor(options.context, aggregate).projectWorkdays
    // 可用人天 = 人数 × 工作日 × 0.65：会议、沟通、请假与依赖等待不可能 100% 投入
    // （实测按 0.8 做预算，资源平衡后仍延期 2–4 个月）。
    const capacityPersonDays =
      headcount && workdays > 0 ? Math.round(headcount * workdays * CAPACITY_FACTOR) : null
    const result = await decomposeCapabilities({
      context: options.context,
      understanding,
      usage,
      requiredStageGates: gates,
      capacityPersonDays,
      call: async ({ prompt, promptName, sentence }) => {
        const response = await options.rawTextProvider({
          prompt,
          strategy: 'prompt',
          attempt: 0,
          stageAttempt: 1,
          stage: 'wbs_tasks',
          promptName,
          sentence,
          onPhase: options.onPhase,
        })
        return typeof response === 'string' ? response : response.rawText
      },
    })
    if (!result) {
      extras.decisions.add(
        '拆解层未完成，改由模型直接生成 WBS 骨架',
        '有能力项的工作包候选全部解析失败',
        'system',
        'wbs_tasks',
      )
      return null
    }
    const addedGates = ensureStageGateWorkPackages(understanding, result.workPackages, gates)
    // 跨生成记忆：本组织历史上计划与实际（或用户转正时）的工期偏差，温和修正工作量估算（系数已限幅）。
    const history = options.context.planningMemory?.durationFactor
    if (history && Math.abs(history.factor - 1) >= 0.05) {
      scaleWorkPackageEffort(result.workPackages, history.factor)
      extras.decisions.add(
        `按本组织历史校准工作量（×${history.factor}）`,
        history.basis,
        'system',
        'wbs_tasks',
      )
    }
    // 按角色核对：团队总人天够不代表每个角色都够（实测 1 名产品经理 / 1 名测试是瓶颈）。
    const roster = contextTeamRoster(options.context)
    if (roster.length > 0 && workdays > 0) {
      const roleCapacity = new Map(
        roster.map((entry) => [
          entry.role,
          Math.round(entry.headcount * workdays * CAPACITY_FACTOR),
        ]),
      )
      const balance = await rebalanceRoleLoads({
        workPackages: result.workPackages,
        capacity: roleCapacity,
        usage,
        call: async ({ prompt, promptName, sentence }) => {
          const response = await options.rawTextProvider({
            prompt,
            strategy: 'prompt',
            attempt: 0,
            stageAttempt: 1,
            stage: 'wbs_tasks',
            promptName,
            sentence,
            onPhase: options.onPhase,
          })
          return typeof response === 'string' ? response : response.rawText
        },
      })
      if (balance.rebalanced) {
        extras.decisions.add(
          '按角色容量再平衡工作包',
          balance.overloaded.length === 0
            ? '改派 / 重估后各角色投入都在可用人天内'
            : `仍超载：${balance.overloaded.map((item) => `${item.role} ${item.load}/${item.capacity} 人天`).join('、')}`,
          'model',
          'wbs_tasks',
        )
      }
      if (balance.overloaded.length > 0) {
        extras.reviewItems.push({
          id: 'role-over-capacity',
          kind: 'decision_needed',
          severity: 'high',
          title: '部分角色的工作量超出工期内可用人天',
          detail:
            balance.overloaded
              .map((item) => `${item.role}：需 ${item.load} 人天，可用约 ${item.capacity} 人天`)
              .join('；') +
            (balance.advice
              ? `。建议：${balance.advice}`
              : '。请增加人手、延长工期或把部分内容放到二期。'),
          attemptedRepairs: 1,
        })
      }
    }
    // 工作包层级排期可行性：拆任务之前就把依赖等待与单点角色瓶颈处理掉。
    const plannedRoster = contextTeamRoster(options.context)
    if (plannedRoster.length > 0 && workdays > 0) {
      const headcountMap = new Map(plannedRoster.map((entry) => [entry.role, entry.headcount]))
      const feasibility = await repairWorkPackageFeasibility({
        workPackages: result.workPackages,
        headcount: headcountMap,
        workdays,
        usage,
        call: async ({ prompt, promptName, sentence }) => {
          const response = await options.rawTextProvider({
            prompt,
            strategy: 'prompt',
            attempt: 0,
            stageAttempt: 1,
            stage: 'wbs_tasks',
            promptName,
            sentence,
            onPhase: options.onPhase,
          })
          return typeof response === 'string' ? response : response.rawText
        },
      })
      extras.decisions.add(
        feasibility.before.lateWorkdays === 0
          ? `工作包计划可行：约 ${feasibility.before.totalWorkdays} 个工作日完成（可用 ${workdays} 个）`
          : `工作包计划调整 ${feasibility.rounds} 轮：延期 ${feasibility.before.lateWorkdays} → ${feasibility.after.lateWorkdays} 个工作日`,
        '拆任务之前按工作包依赖与各角色人数由程序排期，只保留真正缩短延期的调整',
        feasibility.rounds > 0 ? 'model' : 'system',
        'wbs_tasks',
      )
      // 工作包层级的延期只作为决策记录：它比任务层排期保守（单包同角色最多 2 人、整包串行），
      // 是否延期以最终的任务层排期为准，避免「待你确认」里出现与最终计划矛盾的数字。
    }
    const { wbs, nodeOfPackage, nodeOfCapability } = buildWbsFromDecomposition(
      understanding,
      result.workPackages,
    )
    const capabilityName = new Map(understanding.capabilities.map((item) => [item.id, item.name]))
    const leafDetails: Record<
      string,
      {
        deliverable: string
        doneDefinition: string
        effortDays: number
        roleEffort?: Record<string, number>
      }
    > = {}
    const traceOfNode = new Map<string, ProjectDraftTaskTrace>()
    const workPackages: ProjectDraftDecomposition['workPackages'] = []
    for (const pkg of result.workPackages) {
      const nodeId = nodeOfPackage.get(pkg.id)
      if (!nodeId) continue
      leafDetails[nodeId] = {
        deliverable: pkg.deliverable,
        doneDefinition: pkg.doneDefinition,
        effortDays: pkg.effortDays,
        ...(pkg.roleEffort ? { roleEffort: pkg.roleEffort } : {}),
      }
      traceOfNode.set(nodeId, {
        capabilityId: pkg.capabilityId,
        capabilityName: capabilityName.get(pkg.capabilityId) ?? pkg.capabilityId,
        workPackageId: pkg.id,
        workPackageName: pkg.name,
      })
      workPackages.push({ ...pkg, wbsNodeId: nodeId })
    }
    extras.packageOfNode = new Map([...nodeOfPackage.entries()].map(([pkg, node]) => [node, pkg]))
    if (plannedRoster.length > 0 && workdays > 0) {
      const plan = scheduleWorkPackages({
        workPackages: result.workPackages,
        headcount: new Map(plannedRoster.map((entry) => [entry.role, entry.headcount])),
        workdays,
      })
      const nameOf = new Map(result.workPackages.map((pkg) => [pkg.id, pkg.name]))
      aggregate[WORK_PACKAGE_PLAN_KEY] = result.workPackages.map((pkg) => ({
        workPackage: pkg.name,
        wbs: nodeOfPackage.get(pkg.id),
        window: [plan.start.get(pkg.id), plan.end.get(pkg.id)],
        after: pkg.dependsOn.map((dep) => nameOf.get(dep) ?? dep),
      }))
    }
    extras.decomposition = {
      capabilities: understanding.capabilities
        .filter((item) => nodeOfCapability.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.name,
          wbsNodeId: nodeOfCapability.get(item.id)!,
        })),
      workPackages,
      candidateReviews: result.reviews,
    }
    for (const review of result.reviews) {
      const count = result.workPackages.filter(
        (pkg) => pkg.capabilityId === review.capabilityId,
      ).length
      extras.decisions.add(
        `「${capabilityName.get(review.capabilityId) ?? review.capabilityId}」拆成 ${count} 个工作包`,
        `${review.candidates} 份候选评审：${review.verdict}`,
        'model',
        'wbs_tasks',
      )
    }
    if (capacityPersonDays) {
      const planned = result.workPackages.reduce((sum, pkg) => sum + pkg.effortDays, 0)
      extras.decisions.add(
        `工作量预算 ${capacityPersonDays} 人天（${headcount} 人 × ${workdays} 个工作日 × ${CAPACITY_FACTOR}），拆解合计 ${planned} 人天`,
        '按团队可用人天控制拆解规模，避免计划远超团队能力',
        'system',
        'wbs_tasks',
      )
    }
    if (result.overBudget.length > 0) {
      const names = new Map(understanding.capabilities.map((item) => [item.id, item.name]))
      extras.reviewItems.push({
        id: 'scope-over-budget',
        kind: 'decision_needed',
        severity: 'high',
        title: '范围超出团队在工期内的工作量',
        detail: `${result.overBudget
          .map(
            (item) =>
              `「${names.get(item.capabilityId) ?? item.capabilityId}」约需 ${item.requested} 人天，预算 ${item.budget} 人天`,
          )
          .join('；')}。已按预算压缩估算；如需完整范围，请增加人手、延长工期或把部分内容放到二期。`,
        attemptedRepairs: 1,
      })
    }
    if (addedGates.length > 0) {
      extras.decisions.add(
        `补齐阶段门工作包：${addedGates.join('、')}`,
        '行业必备阶段门在拆解结果中缺失，由程序补到测试 / 上线类能力下',
        'system',
        'wbs_tasks',
      )
    }
    void aggregate
    return { wbs, leafDetails, traceOfNode, workPackages }
  }

  private async generateStagedCore(args: {
    options: GenerateDraftOptions & { rawTextProvider: DraftRawTextProvider }
    projectType: ProjectDraft['projectType']
    groundingManifest: ProjectDraftGroundingManifest
    overlay: DraftFactOverlay
    strategy: ProjectDraftStructuredStrategy
    extras: StagedExtras
  }): Promise<GenerateDraftResult> {
    const { projectType, groundingManifest, overlay, strategy, extras } = args
    const resolved = args.options.resolved
    const gate = new DraftStageToolGate()
    const resume = args.options.resume ?? null
    const contextUsage = extras.usage
    const understandingFixes: string[] = []

    // 理解层：用户在就绪页确认过的直接用；续跑复用上次产出；否则先生成（起草 + 自我审查）。
    // 失败不阻断生成，只是后续调用没有能力地图可依。
    let planUnderstanding: ProjectPlanUnderstanding | null =
      args.options.context.planUnderstanding ?? resume?.planUnderstanding ?? null
    if (!planUnderstanding) {
      try {
        planUnderstanding = await generatePlanUnderstanding({
          context: args.options.context,
          call: async ({ prompt, promptName, sentence }) => {
            const result = await args.options.rawTextProvider({
              prompt,
              strategy: 'prompt',
              attempt: 0,
              stageAttempt: 1,
              stage: 'charter_scope',
              promptName,
              sentence,
              onPhase: args.options.onPhase,
            })
            return typeof result === 'string' ? result : result.rawText
          },
        })
        understandingFixes.push('plan_understanding_generated')
      } catch {
        understandingFixes.push('plan_understanding_failed')
      }
    }
    extras.planUnderstanding = planUnderstanding
    recordContextDecisions(extras.decisions, args.options.context, planUnderstanding)
    const options = {
      ...args.options,
      context: planUnderstanding
        ? { ...args.options.context, planUnderstanding }
        : args.options.context,
    }
    const startedAt = Date.now() - (resume?.spentMs ?? 0)
    const budget = resolveDraftGenerationBudget()
    let totalChars = resume?.spentChars ?? 0
    let responseModel = resolved.model
    let effectiveStrategy = strategy
    let finalDraft: ProjectDraft | null = null
    let finalQualityIssues: DraftValidationIssue[] = []
    let firstTokenEmitted = false
    const repairs: ProjectDraftRepairEnvelope[] = []
    const stageCheckpoints: ProjectDraftStageCheckpoint[] = []
    const artifacts: ProjectDraftStageArtifact[] = []
    const aggregate: Record<string, unknown> = {
      schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
      projectType,
    }
    const appliedFixes: string[] = [...understandingFixes]
    extras.decisions.attach(aggregate)
    const stageContext = {
      manifestHash: groundingManifest.hash,
      provider: resolved.provider,
      model: resolved.model,
      strategy,
    }

    // 断点恢复：只复用上下文/版本/provider 一致的已验证阶段，其余从失败阶段继续。
    if (resume) {
      for (const definition of DRAFT_STAGE_CATALOG) {
        const checkpoint = resume.completedStages.find(
          (stage) =>
            stage.stage === definition.stage && isStageCheckpointReusable(stage, stageContext),
        )
        if (!checkpoint?.artifact) continue
        stageCheckpoints.push(checkpoint)
        artifacts.push({
          stage: definition.stage,
          status: 'completed',
          contextScope: [...definition.contextScope],
          allowedTools: gate.resolve(definition),
          artifactHash: checkpoint.artifactHash,
          attemptCount: checkpoint.attemptCount,
          errorCodes: [...checkpoint.errorCodes],
        })
        Object.assign(aggregate, checkpoint.artifact)
        appliedFixes.push('resume_stage_checkpoint')
      }
    }

    const maxStageRetries = Math.min(
      MAX_STAGE_REPAIR_ATTEMPTS,
      Math.max(0, options.maxRetries ?? 1),
    )

    const persistCheckpoint = async () => {
      const checkpoint = buildPipelineCheckpoint({
        manifestHash: groundingManifest.hash,
        completedStages: stageCheckpoints,
        spentMs: Date.now() - startedAt,
        spentChars: totalChars,
        planUnderstanding,
      })
      await options.onCheckpoint?.(checkpoint)
    }

    for (const definition of DRAFT_STAGE_CATALOG) {
      if (artifacts.some((artifact) => artifact.stage === definition.stage)) continue

      const stageStartChars = totalChars
      // 恢复同一失败阶段时继承该阶段已消耗预算，避免重试获得额外时间。
      const resumedStageSpentMs =
        resume?.failedStage?.stage === definition.stage ? (resume.failedStage.spentMs ?? 0) : 0
      const stageStartedMs = Date.now() - resumedStageSpentMs
      // 每次尝试都是全新对话：修复只在「本阶段原始 prompt」上附加最近一次的失败明细，不层层叠加。
      const basePrompt = stagePrompt(
        definition,
        groundingManifest,
        aggregate,
        options.context,
        contextUsage,
      )
      let prompt = basePrompt
      let stageErrors: DraftSchemaError[] = []
      let missingFactIds: string[] = []
      let stageCompleted = false
      let attemptCount = 0
      let parseRetries = 0
      let providerRetries = 0
      let schemaRepairs = 0
      let groundingRepairs = 0
      let stageGateRepairUsed = false
      let criticalPathRepairUsed = false
      let parseErrorKinds: string[] = []
      const granularity =
        definition.stage === 'wbs_tasks' ? stageGranularityTarget(options.context, aggregate) : null
      const preset =
        definition.stage === 'wbs_tasks'
          ? await this.decompose(options, extras, aggregate, contextUsage)
          : null
      if (preset) appliedFixes.push(`work_packages:${preset.workPackages.length}`)
      const chunked =
        granularity !== null &&
        (preset !== null || granularity.minTasks >= CHUNKED_WBS_TASKS_MIN_TASKS)
      const chunkCache = createChunkedWbsTasksCache()
      // 拆分模式一次尝试就包含骨架 + 全部批次，体量约为单次路径的两倍。
      const stageCharLimit = budget.stageCharLimits[definition.stage] * (chunked ? 2 : 1)

      for (;;) {
        if (attemptCount > 0) {
          options.onAttemptFailed?.({
            stage: definition.stage,
            attempt: attemptCount,
            errors: stageErrors
              .slice(0, 8)
              .map((error) => `${error.path}: ${error.message.slice(0, 160)}`),
            stageChars: totalChars - stageStartChars,
            elapsedMs: Date.now() - stageStartedMs,
          })
        }
        const elapsedGlobal = Date.now() - startedAt
        const remainingGlobal = budget.maxGenerationWallMs - elapsedGlobal
        const minimumNeeded =
          MIN_ATTEMPT_BUDGET_MS[definition.stage] +
          (definition.stage === 'reconcile_review' ? 0 : budget.reservedFinalReviewBudgetMs)
        const stageElapsed = Date.now() - stageStartedMs
        const stageCharsUsed = totalChars - stageStartChars
        const exhausted: DraftBudgetExhaustion | null =
          remainingGlobal < minimumNeeded
            ? 'global_time'
            : stageElapsed > budget.stageTimeLimitsMs[definition.stage]
              ? 'stage_time'
              : stageCharsUsed > stageCharLimit
                ? 'stage_output'
                : totalChars > budget.maxTotalResponseChars
                  ? 'total_output'
                  : null
        if (exhausted) {
          // 保留上一次尝试的真实失败原因：否则预算耗尽会盖掉「为什么需要重试」，无从排查。
          stageErrors = [
            {
              path: '(root)',
              message: `GENERATION_BUDGET_EXHAUSTED: ${DRAFT_BUDGET_EXHAUSTION_LABELS[exhausted]}`,
            },
            ...stageErrors.slice(0, 5),
          ]
          break
        }

        // 大型草案不让模型整份重写：输出会超过单次 max_tokens 被截断、反复修复直到耗尽预算。
        // 直接走下方「阶段产物聚合」兜底（仍经 schema + 语义 grounding 校验）。
        // 复核不再让模型整份重写（撑爆上下文、冲掉确定性后处理）：改为质量闭环——
        // 按分支批判 → 单点修复 → 复查，修完后重新排期；修不掉的进入待确认清单。
        if (definition.stage === 'reconcile_review' && attemptCount === 0) {
          const beforeQuality = clone(aggregate)
          options.onPhase?.('validating', totalChars, repairs.length)
          const quality = await runQualityLoop({
            aggregate,
            context: options.context,
            usage: contextUsage,
            call: async ({ prompt: qualityPrompt, promptName, sentence }) => {
              const result = await options.rawTextProvider({
                prompt: qualityPrompt,
                strategy: 'prompt',
                attempt: repairs.length,
                stageAttempt: 1,
                stage: 'reconcile_review',
                promptName,
                sentence,
                onPhase: options.onPhase,
              })
              if (typeof result === 'string') return result
              responseModel = result.responseModel?.trim() || responseModel
              return result.rawText
            },
            afterRound: () => {
              normalizeRepairedAggregate(aggregate, projectType)
            },
            scheduleLimitWorkdays: scheduleConstraintsFor(options.context, aggregate)
              .projectWorkdays,
          })
          extras.qualityLoop = quality.loop
          extras.reviewItems = quality.reviewItems
          if (quality.loop.rounds > 0) {
            extras.decisions.add(
              `质量闭环修复 ${quality.loop.repairedTasks} 个任务、补充 ${quality.loop.addedDependencies} 条依赖`,
              `执行视角审查发现 ${quality.loop.issuesBefore} 个问题，${quality.loop.rounds} 轮单点修复后剩 ${quality.loop.issuesAfter} 个`,
              'model',
              'reconcile_review',
            )
          }
          // 质量闭环补的任务、拆分会推高工作量：先按工作包预算校准，并把闭环补的跨包依赖对齐工作包计划，
          // 再做工期修复（实测顺序反了时，延期提示是在校准前算的，与最终排期对不上）。
          recordCalibration(aggregate, extras, appliedFixes, 'reconcile_review')
          if (extras.traceOfNode) annotateTaskTrace(aggregate, extras.traceOfNode)
          recordDependencyAlignment(aggregate, extras, appliedFixes, 'reconcile_review')
          // 工期修复：按期是「可直接使用」的前提。只保留真正缩短延期的修改。
          const scheduleFix = await runScheduleRepair({
            aggregate,
            context: options.context,
            usage: contextUsage,
            evaluate: () => evaluateSchedule(aggregate, options.context),
            call: async ({ prompt: schedulePrompt, promptName, sentence }) => {
              const result = await options.rawTextProvider({
                prompt: schedulePrompt,
                strategy: 'prompt',
                attempt: repairs.length,
                stageAttempt: 1,
                stage: 'reconcile_review',
                promptName,
                sentence,
                onPhase: options.onPhase,
              })
              return typeof result === 'string' ? result : result.rawText
            },
          })
          if (scheduleFix.rounds > 0) {
            extras.decisions.add(
              `工期修复：延期 ${scheduleFix.lateBefore} → ${scheduleFix.lateAfter} 个工作日`,
              scheduleFix.advice ??
                '删除非真实约束的依赖、改为搭接或改派有余量的角色，只保留真正缩短工期的修改',
              'model',
              'reconcile_review',
            )
            appliedFixes.push(`schedule_repair:${scheduleFix.lateBefore}->${scheduleFix.lateAfter}`)
            normalizeRepairedAggregate(aggregate, projectType)
          }
          const humanized = humanizeTaskReferences(aggregate)
          if (humanized > 0) appliedFixes.push(`task_references_humanized:${humanized}`)
          const finalCycles = breakDependencyCycles(aggregate)
          if (finalCycles > 0) appliedFixes.push(`dependency_cycles_broken:${finalCycles}`)
          appliedFixes.push(
            `quality_loop:${quality.loop.issuesBefore}->${quality.loop.issuesAfter}`,
            ...applyTraceabilityLinks(aggregate, projectType),
            ...applyResourcePlan(
              aggregate,
              contextTeamRoster(options.context),
              projectType,
              draftCalendarFor(options.context, aggregate),
              projectStartFor(options.context, aggregate),
              teamSizingFor(options.context),
            ),
            ...applyGroundingFacts(aggregate, groundingManifest, projectType),
          )
          // 延期结论以最终排期为准（最终资源平衡可能按工期估算加人，比修复时的评估更乐观或更悲观）。
          const finalEvaluation = evaluateSchedule(aggregate, options.context)
          const finalLate = finalEvaluation?.lateWorkdays ?? scheduleFix.lateAfter
          if (!finalEvaluation) {
            extras.reviewItems = [
              {
                id: 'schedule-unavailable',
                kind: 'unresolved_issue',
                severity: 'high',
                title: '排期未能计算',
                detail: '任务依赖或日期数据异常，程序无法按依赖与人数排期；导入前请检查任务依赖。',
                attemptedRepairs: 1,
              },
              ...extras.reviewItems,
            ]
          } else if (finalLate > 0) {
            extras.reviewItems = [
              {
                id: 'schedule-late',
                kind: 'decision_needed',
                severity: 'high',
                title: `计划晚于截止日约 ${finalLate} 个工作日`,
                detail:
                  (scheduleFix.rounds > 0
                    ? `已自动调整 ${scheduleFix.rounds} 轮（延期 ${scheduleFix.lateBefore} → ${finalLate} 个工作日），在不删减范围的前提下无法再缩短。`
                    : '按当前团队人数与任务先后约束排期后晚于截止日。') +
                  (scheduleFix.advice
                    ? `建议：${scheduleFix.advice}`
                    : '请决定增加人手、缩减首期范围或调整截止日。'),
                attemptedRepairs: scheduleFix.rounds,
              },
              ...extras.reviewItems,
            ]
          } else {
            extras.decisions.add(
              '最终排期按期完成',
              '按确认的开工日、工作日历、依赖与各角色人数排定后不晚于截止日',
              'system',
              'reconcile_review',
            )
          }
          // 闭环的修补不得让草案结构失效：失效则整体退回闭环前的产物（问题仍记在待确认清单）。
          if (!validateProjectDraft(normalizeLooseDraft(aggregate, projectType).value).ok) {
            for (const key of Object.keys(aggregate)) delete aggregate[key]
            Object.assign(aggregate, beforeQuality)
            appliedFixes.push('quality_loop_rejected_invalid_shape')
          }
          stageErrors = [{ path: '(root)', message: 'RECONCILE_SKIPPED_LARGE_DRAFT' }]
          break
        }

        if (attemptCount > 0) {
          const category = classifyStageErrors(stageErrors, missingFactIds)
          if (category === 'provider') {
            if (providerRetries >= Math.min(maxStageRetries, MAX_STAGE_PROVIDER_RETRIES)) break
            providerRetries += 1
            // provider 瞬时失败不消耗定向修复预算，直接重试。
          } else if (category === 'parse') {
            if (
              parseRetries >= Math.min(maxStageRetries, MAX_STAGE_PARSE_RETRIES) ||
              repairs.length >= maxStageRetries ||
              repairs.length >= MAX_TOTAL_REPAIR_ATTEMPTS
            ) {
              break
            }
            parseRetries += 1
            const envelope = repairEnvelope({
              stage: definition.stage,
              attempt: repairs.length + 1,
              errors: stageErrors,
              missingFactIds,
              previousFingerprint: hashArtifact({
                stage: definition.stage,
                manifestHash: groundingManifest.hash,
                artifacts: artifacts.map((artifact) => artifact.artifactHash),
              }),
              remainingAttempts: maxStageRetries - schemaRepairs - groundingRepairs,
              parseErrorKinds,
            })
            repairs.push(envelope)
            prompt = promptWithRepair(basePrompt, envelope, stageErrors)
            options.onPhase?.('retrying', totalChars, repairs.length)
          } else if (category === 'grounding') {
            if (
              groundingRepairs >= maxStageRetries ||
              repairs.length >= MAX_TOTAL_REPAIR_ATTEMPTS
            ) {
              break
            }
            groundingRepairs += 1
            const envelope = repairEnvelope({
              stage: definition.stage,
              attempt: repairs.length + 1,
              errors: stageErrors,
              missingFactIds,
              previousFingerprint: hashArtifact({
                stage: definition.stage,
                manifestHash: groundingManifest.hash,
                artifacts: artifacts.map((artifact) => artifact.artifactHash),
              }),
              remainingAttempts: maxStageRetries - schemaRepairs - groundingRepairs,
            })
            repairs.push(envelope)
            prompt = promptWithRepair(basePrompt, envelope, stageErrors)
            options.onPhase?.('retrying', totalChars, repairs.length)
          } else {
            if (schemaRepairs >= maxStageRetries || repairs.length >= MAX_TOTAL_REPAIR_ATTEMPTS) {
              break
            }
            schemaRepairs += 1
            const envelope = repairEnvelope({
              stage: definition.stage,
              attempt: repairs.length + 1,
              errors: stageErrors,
              missingFactIds,
              previousFingerprint: hashArtifact({
                stage: definition.stage,
                manifestHash: groundingManifest.hash,
                artifacts: artifacts.map((artifact) => artifact.artifactHash),
              }),
              remainingAttempts: maxStageRetries - schemaRepairs - groundingRepairs,
            })
            repairs.push(envelope)
            prompt = promptWithRepair(basePrompt, envelope, stageErrors)
            options.onPhase?.('retrying', totalChars, repairs.length)
          }
        }

        attemptCount += 1
        options.onPhase?.('adapter_ready', totalChars, repairs.length)
        let rawText = ''
        const charsBeforeAttempt = totalChars
        const onChunk = (chunk: string) => {
          totalChars += chunk.length
          if (!firstTokenEmitted && chunk.length > 0) {
            firstTokenEmitted = true
            options.onPhase?.('first_token', totalChars, repairs.length)
          }
          options.onPhase?.('receiving', totalChars, repairs.length)
          options.onChunk?.(chunk)
        }
        try {
          if (granularity && chunked) {
            // 大型项目：WBS 骨架 + 分支并行生成任务，避免单次超长请求被中转层断流。
            rawText = await generateWbsTasksChunked({
              groundingFacts: scopedGroundingFacts(definition, groundingManifest),
              priorArtifacts: aggregate,
              target: granularity,
              // provider/解析类失败不是内容问题，不注入修复明细（缓存已保留成功部分）。
              repairErrors:
                attemptCount > 1 && classifyStageErrors(stageErrors, missingFactIds) !== 'provider'
                  ? stageErrors.slice(0, 20)
                  : [],
              cache: chunkCache,
              onChunk,
              teamRoster: contextTeamRoster(options.context),
              workCalendar: stageCalendarFacts(definition.stage, options.context, aggregate),
              requiredStageGates: stageGateTemplate(stageGateSignal(options.context)).gates.map(
                (stageGate) => stageGate.name,
              ),
              spine: buildSpine({ context: options.context, aggregate }),
              capabilityMap: options.context.planUnderstanding?.capabilities,
              ...(preset ? { presetWbs: preset.wbs, leafDetails: preset.leafDetails } : {}),
              call: async ({
                prompt: subPrompt,
                sentence,
                maxOutputTokens,
                onChunk: sub,
                attempt: subAttempt,
                promptName,
              }) => {
                const result = await options.rawTextProvider({
                  stageAttempt: subAttempt,
                  promptName,
                  prompt: subPrompt,
                  // 子请求只含局部结构，走 prompt 策略，整体结构仍由合并后的阶段校验把关。
                  strategy: 'prompt',
                  attempt: repairs.length,
                  stage: definition.stage,
                  sentence,
                  maxOutputTokens,
                  onChunk: sub,
                  onPhase: options.onPhase,
                })
                if (typeof result === 'string') return result
                responseModel = result.responseModel?.trim() || responseModel
                return result.rawText
              },
            })
            if (!appliedFixes.includes('wbs_tasks_chunked_generation')) {
              appliedFixes.push('wbs_tasks_chunked_generation')
            }
          } else {
            // 排期阶段输出紧凑数组格式，不受原生 JSON Schema 约束，一律走 prompt 策略。
            const compactStage = definition.stage === 'schedule_dependencies'
            const providerResult = await options.rawTextProvider({
              prompt,
              strategy: compactStage ? 'prompt' : strategy,
              jsonSchema: compactStage
                ? undefined
                : definition.stage === 'reconcile_review'
                  ? draftJsonSchemaForStrategy(strategy)
                  : stageJsonSchemaForStrategy(definition.stage as StageArtifactStage, strategy),
              attempt: repairs.length,
              stageAttempt: attemptCount,
              promptName: `draft.${definition.stage}`,
              stage: definition.stage,
              sentence: '生成项目草案阶段：' + definition.stage,
              onChunk,
              onPhase: options.onPhase,
            })
            if (typeof providerResult === 'string') {
              rawText = providerResult
            } else {
              rawText = providerResult.rawText
              responseModel = providerResult.responseModel?.trim() || responseModel
              effectiveStrategy = providerResult.effectiveStrategy ?? effectiveStrategy
            }
          }
        } catch (error) {
          // 带上 adapter 的错误类型（仅枚举名，不含原始报文），否则 token 截断 / 断流 / 超时无从区分。
          stageErrors = [
            {
              path: '(root)',
              message: `MODEL_PROVIDER_CALL_FAILED: ${providerErrorKind(error)}`,
            },
          ]
          continue
        }
        if (totalChars === charsBeforeAttempt) totalChars += rawText.length

        options.onPhase?.('parsing', totalChars, repairs.length)
        const parsed = tryParseJson(rawText)
        // 排期阶段一次输出数百条依赖，JSON 偶发格式错误；依赖逐条完整时抢救，
        // 缺失的甘特预览由任务与依赖确定性推导（质量优先：写到一半的依赖不接受，照常重试）。
        const salvagedSchedule =
          (!parsed.ok || !isPlainObject(parsed.value)) &&
          definition.stage === 'schedule_dependencies'
            ? salvageScheduleOutput(rawText, aggregate)
            : null
        if (!salvagedSchedule && (!parsed.ok || !isPlainObject(parsed.value))) {
          const parseKind = parsed.ok ? 'not_object' : (parsed.errorKind ?? 'malformed_json')
          const failureKind = classifyJsonFailure(rawText)
          parseErrorKinds = [...new Set([...parseErrorKinds, failureKind])].slice(0, 5)
          stageErrors = [{ path: '(root)', message: 'JSON_PARSE_FAILED:' + parseKind }]
          continue
        }
        if (salvagedSchedule) appliedFixes.push('schedule_dependencies_salvaged')
        const parsedObject = (salvagedSchedule ?? parsed.value) as Record<string, unknown>
        // 结尾补括号后能解析、但甘特预览没写出来：依赖齐全时同样由任务与依赖确定性推导，不为它重跑。
        if (
          definition.stage === 'schedule_dependencies' &&
          !salvagedSchedule &&
          Array.isArray(parsedObject.dependencies) &&
          !isPlainObject(parsedObject.ganttPreview)
        ) {
          // 紧凑依赖 ["前置","后继","FS",0] 先展开并编号，甘特预览由任务与依赖确定性推导。
          parsedObject.dependencies = parsedObject.dependencies
            .map(expandCompactDependency)
            .map((dependency, index) =>
              isPlainObject(dependency) && typeof dependency.id !== 'string'
                ? { ...dependency, id: `dep-${index + 1}` }
                : dependency,
            )
          const derived = deriveGanttPreview(
            (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(isPlainObject),
            (parsedObject.dependencies as unknown[]).filter(isPlainObject),
            Array.isArray(aggregate.wbs) ? aggregate.wbs : [],
          )
          if (derived) {
            parsedObject.ganttPreview = derived
            appliedFixes.push('gantt_preview_derived')
          }
        }

        if (definition.stage !== 'reconcile_review') {
          const missingFields = definition.outputFields.filter((field) => !(field in parsedObject))
          if (missingFields.length > 0) {
            stageErrors = missingFields.map((field) => ({
              path: field,
              message: 'STAGE_OUTPUT_FIELD_MISSING',
            }))
            continue
          }
          const extracted = Object.fromEntries(
            definition.outputFields.map((field) => [field, parsedObject[field]]),
          )
          for (const optionalField of definition.optionalOutputFields ?? []) {
            if (optionalField in parsedObject)
              extracted[optionalField] = parsedObject[optionalField]
          }
          // 阶段质量门：结构 + 跨阶段引用完整性当场校验，不合格就地重试。
          const check = checkStageArtifact(definition, extracted, aggregate, projectType)
          if (!check.ok) {
            stageErrors = check.errors.slice(0, 20)
            continue
          }
          // 依赖链过长：模型把本该并行的子系统首尾串联（实测最长链 274 个工作日 vs 项目 130 个），
          // 资源平衡严格执行依赖后整体延期 8 个月。用一次修复预算把最长链列给模型要求拆开；
          // 预算不足或已修过一次则放行，由计划体检如实展示延期与按期概率。
          if (
            definition.stage === 'schedule_dependencies' &&
            !criticalPathRepairUsed &&
            repairs.length < maxStageRetries &&
            repairs.length < MAX_TOTAL_REPAIR_ATTEMPTS
          ) {
            const limit = scheduleConstraintsFor(options.context, aggregate).projectWorkdays
            const tasks = (Array.isArray(aggregate.tasks) ? aggregate.tasks : []).filter(
              isPlainObject,
            )
            const deps = (
              Array.isArray(check.normalized.dependencies) ? check.normalized.dependencies : []
            ).filter(isPlainObject)
            const chain = longestChainWorkdays(tasks, deps)
            if (limit > 0 && chain && chain.workdays > limit * 1.1) {
              criticalPathRepairUsed = true
              appliedFixes.push(`critical_path_repair:${chain.workdays}/${limit}`)
              const names = new Map(
                tasks.map((task) => [
                  String(task.id),
                  String((task.name as { value?: unknown } | undefined)?.value ?? task.id),
                ]),
              )
              const preview = chain.taskIds
                .slice(0, 16)
                .map((id) => `${id}「${names.get(id) ?? id}」`)
                .join('→')
              stageErrors = [
                {
                  path: 'dependencies',
                  message:
                    `SCHEDULE_CRITICAL_PATH_TOO_LONG: 依赖最长链 ${chain.workdays} 个工作日，超过项目可用 ${limit} 个工作日。` +
                    `最长链（前 16 个）：${preview}。请删除不同子系统之间不必要的首尾串联依赖，只保留真实先后约束，使最长链不超过 ${limit} 个工作日。`,
                },
              ]
              continue
            }
          }
          // 行业阶段门：大型项目（分批生成）缺失时用一次修复预算要求补齐；预算不足或已修过一次则放行。
          // 小项目不为阶段门整段重跑，缺口由计划体检如实展示。
          if (
            definition.stage === 'wbs_tasks' &&
            chunked &&
            !preset &&
            !stageGateRepairUsed &&
            repairs.length < maxStageRetries &&
            repairs.length < MAX_TOTAL_REPAIR_ATTEMPTS
          ) {
            const gates = evaluateStageGates(check.normalized, stageGateSignal(options.context))
            if (gates.missing.length > 0) {
              stageGateRepairUsed = true
              appliedFixes.push(`stage_gate_repair:${gates.missing.length}`)
              stageErrors = gates.missing.map((name) => ({
                path: 'wbs',
                message: `STAGE_GATE_MISSING: 缺少行业必备阶段「${name}」，需在 WBS 中补充该阶段及其任务`,
              }))
              continue
            }
          }
          Object.assign(aggregate, check.normalized)
          appliedFixes.push(...check.appliedFixes)
          if (definition.stage === 'charter_scope') {
            appliedFixes.push(...anchorCharterDates(aggregate, options.context))
          }
          if (definition.stage === 'wbs_tasks' && preset) {
            extras.traceOfNode = preset.traceOfNode
            const traced = annotateTaskTrace(aggregate, preset.traceOfNode)
            if (traced > 0) appliedFixes.push(`task_trace:${traced}`)
            recordCalibration(aggregate, extras, appliedFixes, 'wbs_tasks')
          }
          if (definition.stage === 'schedule_dependencies') {
            recordDependencyAlignment(aggregate, extras, appliedFixes, definition.stage)
            const scheduled = scheduleTasksNow(aggregate, options.context)
            appliedFixes.push(...scheduled)
            if (scheduled.includes('early_schedule_applied')) {
              extras.decisions.add(
                '任务日期由程序排定',
                '按确认的开工日、中国工作日历（含调休）、任务依赖与各角色人数计算，不采用模型给的日期',
                'system',
                definition.stage,
              )
            }
          }
          if (definition.stage === 'resources_risks_acceptance') {
            appliedFixes.push(...applyTraceabilityLinks(aggregate, projectType))
            appliedFixes.push(
              ...applyResourcePlan(
                aggregate,
                contextTeamRoster(options.context),
                projectType,
                draftCalendarFor(options.context, aggregate),
                projectStartFor(options.context, aggregate),
                teamSizingFor(options.context),
              ),
            )
          }
          const artifactHash = hashArtifact(check.normalized)
          artifacts.push({
            stage: definition.stage,
            status: 'completed',
            contextScope: [...definition.contextScope],
            allowedTools: new DraftStageToolGate().resolve(definition),
            artifactHash,
            attemptCount,
            errorCodes: [],
          })
          stageCheckpoints.push({
            version: '1.0',
            stage: definition.stage,
            status: 'completed',
            artifact: check.normalized,
            artifactHash,
            manifestHash: groundingManifest.hash,
            catalogVersion: DRAFT_STAGE_CATALOG_VERSION,
            guideVersion: DRAFT_STAGE_GUIDE_VERSION,
            schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
            provider: resolved.provider,
            model: resolved.model,
            strategy,
            attemptCount,
            errorCodes: [],
            spentMs: Date.now() - stageStartedMs,
            parseErrorKinds: [...parseErrorKinds],
            validationResult: { ok: true, errors: [] },
          })
          await persistCheckpoint()
          stageCompleted = true
          break
        }

        options.onPhase?.('validating', totalChars, repairs.length)
        const normalized = normalizeLooseDraft(
          carryOptionalArtifacts(parsedObject, aggregate),
          projectType,
        )
        const validated = validateProjectDraft(normalized.value)
        if (!validated.ok) {
          stageErrors = validated.errors.slice(0, 20)
          continue
        }
        const overlaid = applyOverlay(validated.value, overlay)
        const finalValidation = validateProjectDraft(overlaid)
        if (!finalValidation.ok) {
          stageErrors = finalValidation.errors.slice(0, 20)
          continue
        }
        // 复核是模型整份重写：名册对齐、资源平衡、追溯补链等确定性后处理必须在复核之后重新套用，
        // 否则会被模型原值覆盖回去（实测：小草案复核把 DBA 2 人改回 1 人）。
        const replanned = clone(overlaid) as unknown as Record<string, unknown>
        appliedFixes.push(
          ...applyTraceabilityLinks(replanned, projectType),
          ...applyResourcePlan(
            replanned,
            contextTeamRoster(options.context),
            projectType,
            draftCalendarFor(options.context, replanned),
            projectStartFor(options.context, replanned),
            teamSizingFor(options.context),
          ),
        )
        const withFacts = replanned as unknown as ProjectDraft
        // 复核输出统一确定性吸附到工作日（防模型重写阶段产物时把休息日带回）。
        const snappedFinal = snapDraftDatesToWorkingDays(
          withFacts as unknown as Record<string, unknown>,
          draftCalendarFor(options.context, withFacts as unknown as Record<string, unknown>)
            .calendar,
        )
        let finalCandidate = withFacts
        if (snappedFinal.changed) {
          finalCandidate = {
            ...withFacts,
            tasks: snappedFinal.tasks as ProjectDraft['tasks'],
            ganttPreview: snappedFinal.ganttPreview as ProjectDraft['ganttPreview'],
          }
          const revalidated = validateProjectDraft(finalCandidate)
          if (!revalidated.ok) {
            stageErrors = revalidated.errors.slice(0, 20)
            continue
          }
          appliedFixes.push('reconcile_calendar_snap')
        }
        const semantic = validateSemanticGrounding(finalCandidate, groundingManifest)
        if (!semantic.valid) {
          finalDraft = finalCandidate
          finalQualityIssues = semantic.blocking
          missingFactIds = semantic.missingFactIds
          stageErrors = semantic.blocking.map((issue) => ({
            path: issue.path ?? '(root)',
            message: issue.ruleId + ':' + issue.message,
          }))
          continue
        }
        finalDraft = finalCandidate
        const reconcileHash = hashArtifact({
          draft: finalCandidate,
          prior: artifacts.map((item) => item.artifactHash),
        })
        artifacts.push({
          stage: definition.stage,
          status: 'completed',
          contextScope: [...definition.contextScope],
          allowedTools: gate.resolve(definition),
          artifactHash: reconcileHash,
          attemptCount,
          errorCodes: [],
        })
        stageCheckpoints.push({
          version: '1.0',
          stage: definition.stage,
          status: 'completed',
          artifact: { draft: finalCandidate },
          artifactHash: reconcileHash,
          manifestHash: groundingManifest.hash,
          catalogVersion: DRAFT_STAGE_CATALOG_VERSION,
          guideVersion: DRAFT_STAGE_GUIDE_VERSION,
          schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
          provider: resolved.provider,
          model: resolved.model,
          strategy,
          attemptCount,
          errorCodes: [],
          spentMs: Date.now() - stageStartedMs,
          parseErrorKinds: [...parseErrorKinds],
          validationResult: { ok: true, errors: [] },
        })
        await persistCheckpoint()
        stageCompleted = true
        break
      }

      if (!stageCompleted) {
        const errorCode = stageErrors[0]?.message ?? 'STAGE_GENERATION_FAILED'
        const failureCode = generationFailureCode(stageErrors)
        stageCheckpoints.push({
          version: '1.0',
          stage: definition.stage,
          status: 'failed',
          artifact: null,
          artifactHash: null,
          manifestHash: groundingManifest.hash,
          catalogVersion: DRAFT_STAGE_CATALOG_VERSION,
          guideVersion: DRAFT_STAGE_GUIDE_VERSION,
          schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
          provider: resolved.provider,
          model: resolved.model,
          strategy,
          attemptCount,
          errorCodes: stageErrors.map((error) => error.message).slice(0, 10),
          spentMs: Date.now() - stageStartedMs,
          parseErrorKinds: [...parseErrorKinds],
          validationResult: { ok: false, errors: stageErrors.slice(0, 20) },
        })
        await persistCheckpoint()
        const stages = failedStageArtifacts(artifacts, definition.stage, attemptCount, errorCode)
        if (definition.stage === 'reconcile_review' && finalDraft) {
          const meta = this.buildMeta({
            draft: finalDraft,
            projectType,
            strategy,
            consistency: 'repairable',
            fallbackUsed: false,
            provider: resolved.provider,
            model: resolved.model,
            usingRealAdapter: resolved.usingRealAdapter,
            appliedFixes: [...new Set([...appliedFixes])],
            groundingManifest,
            stages,
            confirmability: { status: 'review_blocked', reasons: ['GROUNDING_VALIDATION_FAILED'] },
            repairs,
            requestedModel: resolved.model,
            responseModel,
            effectiveStrategy,
          })
          return {
            status: 'completed',
            draft: finalDraft,
            meta,
            consistency: 'repairable',
            retries: repairs.length,
            qualityIssues: finalQualityIssues,
          }
        }
        // reconcile_review 复核失败的最后兜底：前四阶段产物均已通过阶段质量门。
        if (definition.stage === 'reconcile_review') {
          const aggregateNormalized = normalizeLooseDraft(aggregate, projectType)
          const aggregateValidation = validateProjectDraft(aggregateNormalized.value)
          if (aggregateValidation.ok) {
            const withFacts = applyOverlay(aggregateValidation.value, overlay)
            const reval = validateProjectDraft(withFacts)
            const candidate = reval.ok ? withFacts : aggregateValidation.value
            const semantic = validateSemanticGrounding(candidate, groundingManifest)
            const providerVerified = resolved.source === 'user' && resolved.usingRealAdapter
            // 大草案主动跳过模型整份复核是设计路径（聚合产物已过阶段质量门 + 下方语义 grounding），
            // 复核阶段记为完成；只有模型复核真实失败后的兜底才记失败并阻断确认。
            const skippedByDesign = stageErrors[0]?.message === 'RECONCILE_SKIPPED_LARGE_DRAFT'
            const fallbackStages = stages.map((stage) =>
              stage.stage === 'reconcile_review'
                ? {
                    ...stage,
                    status: skippedByDesign ? ('completed' as const) : stage.status,
                    artifactHash: skippedByDesign ? hashArtifact(aggregate) : stage.artifactHash,
                    errorCodes: [...stage.errorCodes, 'RECONCILE_FALLBACK_TO_AGGREGATE'],
                  }
                : stage,
            )
            if (semantic.valid) {
              const fallbackMeta = this.buildMeta({
                draft: candidate,
                projectType,
                strategy,
                consistency: 'repairable',
                fallbackUsed: !providerVerified,
                provider: resolved.provider,
                model: resolved.model,
                usingRealAdapter: resolved.usingRealAdapter,
                appliedFixes: [
                  ...new Set([...appliedFixes, 'reconcile_fallback_to_stage_aggregate']),
                ],
                groundingManifest,
                stages: fallbackStages,
                confirmability: providerVerified
                  ? { status: 'confirmable', reasons: [] }
                  : { status: 'review_blocked', reasons: ['PROVIDER_OR_FALLBACK_NOT_VERIFIED'] },
                repairs,
                requestedModel: resolved.model,
                responseModel,
                effectiveStrategy,
              })
              return {
                status: 'completed',
                draft: candidate,
                meta: fallbackMeta,
                consistency: 'repairable',
                retries: repairs.length,
              }
            }
            const blockedMeta = this.buildMeta({
              draft: candidate,
              projectType,
              strategy,
              consistency: 'repairable',
              fallbackUsed: !providerVerified,
              provider: resolved.provider,
              model: resolved.model,
              usingRealAdapter: resolved.usingRealAdapter,
              appliedFixes: [
                ...new Set([...appliedFixes, 'reconcile_fallback_to_stage_aggregate']),
              ],
              groundingManifest,
              stages: fallbackStages,
              confirmability: {
                status: 'review_blocked',
                reasons: ['GROUNDING_VALIDATION_FAILED'],
              },
              repairs,
              requestedModel: resolved.model,
              responseModel,
              effectiveStrategy,
            })
            return {
              status: 'completed',
              draft: candidate,
              meta: blockedMeta,
              consistency: 'repairable',
              retries: repairs.length,
              qualityIssues: semantic.blocking,
            }
          }
        }
        const sanitizedStageErrors = sanitizeDraftErrors(stageErrors, failureCode)
        const meta = this.buildMeta({
          draft: null,
          projectType,
          strategy,
          consistency: 'failed',
          fallbackUsed: resolved.source !== 'user',
          provider: resolved.provider,
          model: resolved.model,
          usingRealAdapter: resolved.usingRealAdapter,
          appliedFixes: [...new Set(appliedFixes)],
          groundingManifest,
          stages,
          confirmability: { status: 'failed', reasons: [failureCode] },
          repairs,
          requestedModel: resolved.model,
          responseModel,
          effectiveStrategy,
          failure: {
            stage: definition.stage,
            reasonCode: failureCode,
            errors: sanitizedStageErrors,
          },
        })
        return {
          status: 'failed',
          draft: null,
          meta,
          consistency: 'failed',
          errorCode: failureCode,
          stage: definition.stage,
          reasonCode: failureCode,
          errors: stageErrors,
          retries: repairs.length,
        }
      }
    }

    if (!finalDraft) {
      // 恢复路径：全部阶段已通过 checkpoint 复用，无需再调模型。
      const aggregateNormalized = normalizeLooseDraft(aggregate, projectType)
      const aggregateValidation = validateProjectDraft(aggregateNormalized.value)
      if (aggregateValidation.ok) {
        finalDraft = applyOverlay(aggregateValidation.value, overlay)
      }
    }
    if (!finalDraft) throw new Error('STAGE_PIPELINE_INVARIANT_VIOLATION')
    const providerVerified = resolved.source === 'user' && resolved.usingRealAdapter
    const meta = this.buildMeta({
      draft: finalDraft,
      projectType,
      strategy,
      consistency: appliedFixes.length > 0 ? 'repairable' : 'strict',
      fallbackUsed: !providerVerified,
      provider: resolved.provider,
      model: resolved.model,
      usingRealAdapter: resolved.usingRealAdapter,
      appliedFixes: [...new Set(appliedFixes)],
      groundingManifest,
      stages: artifacts,
      confirmability: providerVerified
        ? { status: 'confirmable', reasons: [] }
        : { status: 'review_blocked', reasons: ['PROVIDER_OR_FALLBACK_NOT_VERIFIED'] },
      repairs,
      requestedModel: resolved.model,
      responseModel,
      effectiveStrategy,
    })
    return {
      status: 'completed',
      draft: finalDraft,
      meta,
      consistency: appliedFixes.length > 0 ? 'repairable' : 'strict',
      retries: repairs.length,
    }
  }
  private buildMeta(args: {
    draft: ProjectDraft | null
    projectType: ProjectDraft['projectType']
    strategy: ProjectDraftStructuredStrategy
    consistency: ProjectDraftConsistency
    fallbackUsed: boolean
    provider: string
    model: string
    usingRealAdapter: boolean
    appliedFixes: string[]
    groundingManifest: ProjectDraftGroundingManifest
    stages: ProjectDraftStageArtifact[]
    confirmability: NonNullable<ProjectDraftMeta['confirmability']>
    repairs: ProjectDraftRepairEnvelope[]
    requestedModel?: string
    responseModel?: string
    effectiveStrategy?: ProjectDraftStructuredStrategy
    failure?: {
      stage?: ProjectDraftGenerationStage
      reasonCode?: string
      errors?: ProjectDraftFailureError[]
    }
  }): ProjectDraftMeta {
    return {
      schemaVersion: PROJECT_DRAFT_SCHEMA_VERSION,
      projectType: args.projectType,
      structuredStrategy: args.strategy,
      consistency: args.consistency,
      fallbackUsed: args.fallbackUsed,
      provider: args.provider,
      model: args.model,
      usingRealAdapter: args.usingRealAdapter,
      appliedFixes: args.appliedFixes,
      moduleCounts: args.draft ? countModules(args.draft) : EMPTY_COUNTS,
      groundingManifest: args.groundingManifest,
      stages: args.stages,
      confirmability: args.confirmability,
      provenance: {
        requestedStrategy: args.strategy,
        effectiveStrategy: args.effectiveStrategy ?? args.strategy,
        requestedModel: args.requestedModel ?? args.model,
        responseModel: args.responseModel ?? args.model,
        provider: args.provider,
        fallbackUsed: args.fallbackUsed,
      },
      repairs: args.repairs,
      failure: args.failure,
    }
  }
}
