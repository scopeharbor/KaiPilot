/**
 * 新轨矛盾求解对话流前端 API 客户端（v3-triz-contradiction-copilot W5 · tasks 5.2）。
 *
 * 对接后端 W2 端点组（`apps/backend/start/routes.ts` 的
 * `/api/v1/projects/:projectId/triz-copilot/analyses` 组）：
 * - `POST /`           受理并求解（陈述 → 上下文包 → 映射 → Top 3 → 落低敏记录）；
 * - `GET  /`           列表（统一 `{ data, meta }` 信封）；
 * - `GET  /:id`        详情与依据；
 * - `POST /:id/override` 人工改判并重算（业务表零写入，只改本分析记录）。
 *
 * 信封范式对齐既有 `apiFetchEnvelope`（`{ data, meta }` / 错误 `{ error: { code, message } }`），
 * 不新造请求通道，也不修改任何既有 API 客户端文件。
 *
 * 落库（任务 / 风险 / 变更请求）**不经本模块**：写路径一律走既有 AI 工具编排层的两阶段
 * 确认（`lib/api/ai-tools.ts` 的 `execute` → `PREVIEW_REQUIRED` + `previewToken` → `confirm`），
 * 本节只提供目标类型 → 工具名的映射与差异预览 / 回执的解析断言（RL-01 零自动执行）。
 */
import { apiFetchEnvelope } from '@/lib/api-client'

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

export const trizCopilotAnalysesPath = (projectId: number) =>
  `/projects/${projectId}/triz-copilot/analyses`

export const trizCopilotParametersPath = (projectId: number) =>
  `/projects/${projectId}/triz-copilot/parameters`

// ---------------------------------------------------------------------------
// 枚举与基础形状（与后端 `triz_contradiction_mapping_service.ts` / `triz_solution_draft_service.ts` 对齐）
// ---------------------------------------------------------------------------

/** 结果路径闭集：模型推理（`ai`）/ 确定性规则（`rule`）。规则路径 MUST NOT 冒充模型推理。 */
export const TRIZ_MAPPING_PATHS = ['ai', 'rule'] as const
export type TrizMappingPath = (typeof TRIZ_MAPPING_PATHS)[number]

/** 矛盾类型闭集（管理矛盾 / 技术矛盾 / 物理矛盾）。 */
export const TRIZ_CONTRADICTION_TYPES = ['administrative', 'technical', 'physical'] as const
export type TrizContradictionType = (typeof TRIZ_CONTRADICTION_TYPES)[number]

/** 落库目标三类（spec「人工确认落库」第 4 条：三类之外不生成任何执行控件）。 */
export const TRIZ_INTERVENTION_TARGETS = ['task', 'risk', 'change_request'] as const
export type TrizInterventionTarget = (typeof TRIZ_INTERVENTION_TARGETS)[number]

/** 落库目标 → 写工具名（后端静态注册表 RL-14 白名单内的三个写工具）。 */
export const TRIZ_TARGET_TOOL_NAMES: Readonly<Record<TrizInterventionTarget, string>> = {
  task: 'create_task_from_intervention',
  risk: 'create_risk_from_intervention',
  change_request: 'create_change_request_from_intervention',
}

/** 落库目标 → 目标实体写权限码（前端物理阻断用的展示层判据，真正的门在服务端）。 */
export const TRIZ_TARGET_WRITE_PERMISSIONS: Readonly<Record<TrizInterventionTarget, string>> = {
  task: 'task:create',
  risk: 'risk:manage',
  change_request: 'change_request:create',
}

/** 落库目标中文名（选择器与回执文案单一来源）。 */
export const TRIZ_TARGET_LABELS: Readonly<Record<TrizInterventionTarget, string>> = {
  task: '项目任务',
  risk: '风险登记条目',
  change_request: '变更请求',
}

/** 参数引用（后端 `TrizParameterRef`）。 */
export interface TrizParameterRef {
  number: number
  /** 标准中文名（知识包溯源用语，含古典术语） */
  nameZh: string
  /** 现代管理语汇呈现名（用户可见文案一律用它） */
  displayName: string
  /** 面向 PM 的映射含义 */
  pmMeaning: string
}

/** 候选原则引用（含排序与知识包溯源；未进 Top 3 的编号同样在此列）。 */
export interface TrizCandidatePrincipleRef {
  rank: number
  number: number
  nameZh: string
  displayName: string
  definition: string
  source: string
}

/** 来源原则（方案卡展开解释用，全部字段回填自知识包）。 */
export interface TrizSolutionPrincipleRef {
  number: number
  nameZh: string
  nameEn: string
  displayName: string
  definition: string
  softwareExamples: string
  pmInterpretation: string
  source: string
}

/** 动作要点：文本 + 该动作落地的项目实体引用（白名单校验通过）。 */
export interface TrizSolutionActionPoint {
  text: string
  entityRefs: string[]
}

export interface TrizSolutionImpact {
  positive: string
  negative: string
}

export interface TrizSolutionRanking {
  principleStrength: number
  contextMatch: number
  executability: number
  score: number
}

/** Top 3 方案草案（后端 `TrizSolutionDraft` 的响应投影）。 */
export interface TrizSolutionDraft {
  index: number
  title: string
  principle: TrizSolutionPrincipleRef
  actionPoints: TrizSolutionActionPoint[]
  impact: TrizSolutionImpact
  preconditions: string[]
  entityRefs: string[]
  entityBinding: string
  ranking: TrizSolutionRanking
  toppedUp: boolean
  requiresHumanConfirmation: boolean
  persisted: boolean
}

/** 落库低敏投影（分析记录 `top_solutions`）。 */
export interface TrizSolutionLowSensitivityRecord {
  path: TrizMappingPath
  entityBinding: string
  solutions: Array<{
    index: number
    principleNumber: number
    title: string
    score: number
    entityRefs: string[]
  }>
  excludedPrincipleNumbers: number[]
  contextRefValidation: { accepted: number; rejected: number }
  qualityFlags: string[]
  knowledgePackVersion: string
}

/** 澄清状态（预算触顶时 `asked=false` + `exhausted=true`，仍返回中间成果）。 */
export interface TrizClarificationState {
  needed: boolean
  asked: boolean
  round: number
  maxRounds: number
  exhausted: boolean
  prompt: string | null
  reason: string | null
}

/** 自主权预算快照（澄清 ≤2 轮 / 度量 ≤5 次 / Token ≤4000）。 */
export interface TrizBudgetSnapshot {
  clarificationRounds: number
  metricReadCount: number
  tokenBudget: number
  estimatedTokens: number
  actualTokens: number | null
  state: 'within_budget' | 'exhausted'
  reason: string | null
}

/** 映射依据（受理响应顶层携带；改判响应需由分析记录派生，见 `resolveTrizMappingView`）。 */
export interface TrizMappingView {
  path: TrizMappingPath
  contradictionType: TrizContradictionType
  contradictionTypeLabel: string
  improvingParameter: TrizParameterRef | null
  worseningParameter: TrizParameterRef | null
  candidatePrinciples: TrizCandidatePrincipleRef[]
  confidence: number
  contextRefs: string[]
  sourceMappingIds: string[]
  sourceSections: string[]
  qualityFlags: string[]
  fallbackReasons: string[]
  needsClarification: boolean
}

/** 分析记录 DTO（后端 `TrizCopilotAnalysisDTO`）。 */
export interface TrizAnalysisDto {
  id: number
  organizationId: number
  projectId: number
  createdBy: number
  parentAnalysisId: number | null
  contradictionType: TrizContradictionType
  contradictionTypeLabel: string
  improvingParameter: TrizParameterRef | null
  worseningParameter: TrizParameterRef | null
  candidatePrinciples: TrizCandidatePrincipleRef[]
  path: TrizMappingPath
  confidence: number
  entityBinding: string
  contextRefs: string[]
  qualityFlags: string[]
  fallbackReasons: string[]
  knowledgePackVersion: string
  statement: { digest: string; length: number; truncated: boolean }
  topSolutions: TrizSolutionLowSensitivityRecord
  humanOverride: boolean
  overrideBy: number | null
  overrideAt: string | null
  budget: TrizBudgetSnapshot
  createdAt: string | null
  updatedAt: string | null
}

// ---------------------------------------------------------------------------
// 请求 / 响应
// ---------------------------------------------------------------------------

export interface TrizSolveInput {
  statement: string
  asOfDate?: string
  parentAnalysisId?: number
  /** 来源被动雷达信号 ID（v3-triz-copilot-followups B2；自由对话发起时不传）。 */
  sourceSignalId?: number
  forceRulePath?: boolean
  budget?: { clarificationRounds?: number; metricReads?: number; runTokens?: number }
}

export interface TrizOverrideInput {
  improvingParameter?: number
  worseningParameter?: number
  contradictionType?: TrizContradictionType
  reason?: string | null
}

/** 受理响应：分析记录 + 映射依据 + Top 3 + 澄清状态（+ 模型用量）。 */
export interface TrizSolveResult extends TrizAnalysisDto {
  mapping: TrizMappingView
  solutions: TrizSolutionDraft[]
  clarification: TrizClarificationState
  modelUsage: { providerCalls: number; provider: string | null; totalTokens: number }
}

export interface TrizSolveEnvelope {
  data: TrizSolveResult
}

/** 详情响应：分析记录 DTO。 */
export interface TrizAnalysisEnvelope {
  data: TrizAnalysisDto
}

/** 改判响应：分析记录 + 改动前后参数编号 + 重算后的 Top 3。 */
export interface TrizOverrideResult extends TrizAnalysisDto {
  change: {
    from: { improvingParameter: number | null; worseningParameter: number | null }
    to: { improvingParameter: number | null; worseningParameter: number | null }
  }
  solutions: TrizSolutionDraft[]
}

export interface TrizOverrideEnvelope {
  data: TrizOverrideResult
}

export interface TrizListEnvelope {
  data: TrizAnalysisDto[]
  meta: { total: number; page: number; perPage: number; totalPages: number }
}

export interface TrizListQuery {
  page?: number
  perPage?: number
  path?: TrizMappingPath
  humanOverride?: boolean
}

/** 知识包参数只读投影（39 项参数）。 */
export interface TrizParameterItem {
  number: number
  nameZh: string
  displayName: string
  pmMeaning: string
  category: string
}

export interface TrizParametersEnvelope {
  data: TrizParameterItem[]
}

// ---------------------------------------------------------------------------
// 落库差异预览 / 回执（AI 工具编排层的 `diff` 与 `commit` 投影）
// ---------------------------------------------------------------------------

/** 预览绑定实体（方案动作要点引用的白名单项目实体）。 */
export interface TrizInterventionBoundLink {
  ref: string
  kind: string
  id: number
  label: string | null
}

export interface TrizInterventionProvenance {
  source: string
  analysisId: number
  solutionIndex: number
  principleNumber: number
  knowledgePackVersion: string
  path: string
  confirmedByUserId: number
}

/** 落库差异预览：新建（只支持 create）对象的字段草案 + 挂接实体 + 来源标注。 */
export interface TrizInterventionDiff {
  target: TrizInterventionTarget
  operation: 'create'
  /** 新建对象的字段草案（task / risk / change_request 各自字段集合） */
  entity: Record<string, unknown>
  /** 挂接的项目实体（任务 / 里程碑 / 风险等） */
  links: TrizInterventionBoundLink[]
  /** 诚实披露附注（如「未绑定白名单实体的降级说明」） */
  notes: string[]
  provenance: TrizInterventionProvenance
}

/** 确认成功回执（来源可追溯：分析记录 ID / 方案序号 / 原则编号 / 落库实体 ID）。 */
export interface TrizInterventionReceipt {
  target: TrizInterventionTarget
  entityId: number
  analysisId: number
  solutionIndex: number
  principleNumber: number
  confirmedByUserId: number
}

// ---------------------------------------------------------------------------
// 解析器（零信任：结构不符一律降级，绝不抛错穿透到卡片层）
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isTrizMappingPath(value: unknown): value is TrizMappingPath {
  return typeof value === 'string' && (TRIZ_MAPPING_PATHS as readonly string[]).includes(value)
}

export function isTrizInterventionTarget(value: unknown): value is TrizInterventionTarget {
  return (
    typeof value === 'string' && (TRIZ_INTERVENTION_TARGETS as readonly string[]).includes(value)
  )
}

/** 该工具名是否属于本能力的三类落库写工具。 */
export function isTrizInterventionToolName(toolName: string): boolean {
  return Object.values(TRIZ_TARGET_TOOL_NAMES).includes(toolName)
}

/** 由工具名反查落库目标；非本能力写工具返回 null。 */
export function trizTargetForToolName(toolName: string): TrizInterventionTarget | null {
  for (const target of TRIZ_INTERVENTION_TARGETS) {
    if (TRIZ_TARGET_TOOL_NAMES[target] === toolName) return target
  }
  return null
}

/**
 * 映射依据派生：受理响应直接取顶层 `mapping`；改判 / 详情响应没有顶层 `mapping` 时，
 * 由分析记录的低敏字段重建**同形状**依据（参数 / 候选原则 / 路径 / 置信度 / 质量标记）。
 * 来源章节取候选原则自带的知识包溯源字段（RL-10 可追溯）。
 */
export function resolveTrizMappingView(
  analysis: TrizAnalysisDto,
  mapping?: TrizMappingView | null,
): TrizMappingView {
  if (mapping) return mapping
  const candidatePrinciples = Array.isArray(analysis.candidatePrinciples)
    ? analysis.candidatePrinciples
    : []
  const sourceSections: string[] = []
  for (const principle of candidatePrinciples) {
    if (typeof principle.source === 'string' && principle.source !== '') {
      if (!sourceSections.includes(principle.source)) sourceSections.push(principle.source)
    }
  }
  return {
    path: isTrizMappingPath(analysis.path) ? analysis.path : 'rule',
    contradictionType: analysis.contradictionType,
    contradictionTypeLabel: analysis.contradictionTypeLabel,
    improvingParameter: analysis.improvingParameter ?? null,
    worseningParameter: analysis.worseningParameter ?? null,
    candidatePrinciples,
    confidence: analysis.confidence,
    contextRefs: analysis.contextRefs ?? [],
    sourceMappingIds: [],
    sourceSections,
    qualityFlags: analysis.qualityFlags ?? [],
    fallbackReasons: analysis.fallbackReasons ?? [],
    needsClarification: candidatePrinciples.length === 0,
  }
}

/** 未进入 Top 3 的候选原则编号（映射依据抽屉按 spec 第 1 条必须展示）。 */
export function trizExcludedPrincipleNumbers(
  analysis: Pick<TrizAnalysisDto, 'candidatePrinciples' | 'topSolutions'>,
): number[] {
  const stored = analysis.topSolutions?.excludedPrincipleNumbers
  if (Array.isArray(stored)) return stored.map(Number).filter(Number.isFinite)
  const top = new Set(
    (analysis.topSolutions?.solutions ?? []).map((solution) => Number(solution.principleNumber)),
  )
  return (analysis.candidatePrinciples ?? [])
    .map((principle) => principle.number)
    .filter((number) => !top.has(number))
}

/** 差异预览解析：结构不符返回 null（调用方回落通用键值对呈现，不假成功）。 */
export function parseTrizInterventionDiff(value: unknown): TrizInterventionDiff | null {
  if (!isRecord(value)) return null
  const target = value.target
  if (!isTrizInterventionTarget(target)) return null
  const entity = isRecord(value.entity) ? value.entity : {}
  const links = Array.isArray(value.links)
    ? (value.links.filter((link) => isRecord(link)) as unknown as TrizInterventionBoundLink[])
    : []
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === 'string')
    : []
  const provenance = isRecord(value.provenance)
    ? (value.provenance as unknown as TrizInterventionProvenance)
    : null
  if (!provenance) return null
  return { target, operation: 'create', entity, links, notes, provenance }
}

/** 确认回执解析：缺来源字段返回 null（卡片层据此不渲染假回执）。 */
export function parseTrizInterventionReceipt(value: unknown): TrizInterventionReceipt | null {
  if (!isRecord(value)) return null
  const target = value.target
  const provenance = value.provenance
  if (!isTrizInterventionTarget(target) || !isRecord(provenance)) return null
  const entityId = Number(value.entityId)
  const solutionIndex = Number(provenance.solutionIndex)
  const principleNumber = Number(provenance.principleNumber)
  const analysisId = Number(provenance.analysisId)
  const confirmedByUserId = Number(provenance.confirmedByUserId)
  if (![entityId, solutionIndex, principleNumber, analysisId].every(Number.isFinite)) return null
  return {
    target,
    entityId,
    analysisId,
    solutionIndex,
    principleNumber,
    confirmedByUserId: Number.isFinite(confirmedByUserId) ? confirmedByUserId : 0,
  }
}

// ---------------------------------------------------------------------------
// API 函数
// ---------------------------------------------------------------------------

function toQueryString(query: TrizListQuery): string {
  const searchParams = new URLSearchParams()
  if (query.page) searchParams.set('page', String(query.page))
  if (query.perPage) searchParams.set('perPage', String(query.perPage))
  if (query.path) searchParams.set('path', query.path)
  if (query.humanOverride !== undefined)
    searchParams.set('humanOverride', String(query.humanOverride))
  const qs = searchParams.toString()
  return qs ? `?${qs}` : ''
}

export const trizCopilotApi = {
  /** 受理并求解（陈述只在本次请求存活，不落库原文）。 */
  solve: (projectId: number, input: TrizSolveInput) =>
    apiFetchEnvelope<TrizSolveEnvelope>(trizCopilotAnalysesPath(projectId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  /** 分析记录列表（统一信封；空态由调用方判定，不吞成假数据）。 */
  list: (projectId: number, query: TrizListQuery = {}) =>
    apiFetchEnvelope<TrizListEnvelope>(
      `${trizCopilotAnalysesPath(projectId)}${toQueryString(query)}`,
    ),

  /** 分析记录详情与依据。 */
  detail: (projectId: number, analysisId: number) =>
    apiFetchEnvelope<TrizAnalysisEnvelope>(`${trizCopilotAnalysesPath(projectId)}/${analysisId}`),

  /** 人工改判参数并重算（只改本分析记录，业务数据零变更）。 */
  override: (projectId: number, analysisId: number, input: TrizOverrideInput) =>
    apiFetchEnvelope<TrizOverrideEnvelope>(
      `${trizCopilotAnalysesPath(projectId)}/${analysisId}/override`,
      { method: 'POST', body: JSON.stringify(input) },
    ),

  /** 参数只读投影列表（39 项参数元数据，长缓存）。 */
  getParameters: (projectId: number) =>
    apiFetchEnvelope<TrizParametersEnvelope>(trizCopilotParametersPath(projectId)),
}
