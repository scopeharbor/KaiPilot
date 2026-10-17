// @aiproj/types — V3 TRIZ 矛盾矩阵审查 UI 共享契约（前后端共享）
// v3-triz-contradiction-matrix-ui / design D1
//
// 设计要点（只读审查界面，advisory-only）：
// - 矩阵以项目域工程参数为行列，展示改善项 ↔ 恶化项到候选发明原理的映射。
// - 所有数据均来自已有矛盾快照、分析 artifact、rationale 和 Workbench source refs。
// - 矩阵自身不生成 AI 文案，不调用 AIGateway，不写正式业务数据。
// - 权限脱敏：缺权限时不泄露矛盾数量、参数名、hashes 或来源标题。
// - Handoff 只创建 Workbench 候选元数据或 Draft Layer review 输入，数据写回由下游链路负责。
// - 所有文案均为审查导向，禁止使用"自动解决/一键应用"等自动执行措辞。
//
// 隐私边界：本文件定义的类型不得携带完整证据正文、完整 AI 输出、敏感路径或未授权实体详情。

import {
  PROJECT_PARAMETER_KEYS,
  CONTRADICTION_SEVERITIES,
  CONTRADICTION_STATUSES,
  type ContradictionSeverity,
  type InventivePrincipleId,
  type ProjectParameterKey,
  deterministicHash,
} from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 枚举与常量
// ---------------------------------------------------------------------------

/** 矩阵排序字段 */
export const MATRIX_SORT_FIELDS = [
  'parameter_key',
  'severity',
  'confidence',
  'source_count',
  'stale',
] as const
export type MatrixSortField = (typeof MATRIX_SORT_FIELDS)[number]

/** 矩阵筛选器：矛盾类型 */
export const MATRIX_CONTRADICTION_TYPES = ['technical', 'physical', 'all'] as const
export type MatrixContradictionTypeFilter = (typeof MATRIX_CONTRADICTION_TYPES)[number]

/** 矩阵筛选器：状态 */
export const MATRIX_STATUS_FILTERS = ['all', ...CONTRADICTION_STATUSES] as const
export type MatrixStatusFilter = (typeof MATRIX_STATUS_FILTERS)[number]

/** 矩阵筛选器：来源类型 */
export const MATRIX_SOURCE_TYPE_FILTERS = [
  'all',
  'contradiction',
  'triz_analysis',
  'rationale',
  'workbench',
] as const
export type MatrixSourceTypeFilter = (typeof MATRIX_SOURCE_TYPE_FILTERS)[number]

/** 矩阵筛选器：摘要容器 */
export const MATRIX_SEVERITY_FILTERS = ['all', ...CONTRADICTION_SEVERITIES] as const
export type MatrixSeverityFilter = (typeof MATRIX_SEVERITY_FILTERS)[number]

/** 矩阵 stale 过滤器 */
export const MATRIX_STALE_FILTERS = ['all', 'stale_only', 'fresh_only'] as const
export type MatrixStaleFilter = (typeof MATRIX_STALE_FILTERS)[number]

/** 矩阵筛选器：排序方向 */
export const SORT_DIRECTIONS = ['asc', 'desc'] as const
export type SortDirection = (typeof SORT_DIRECTIONS)[number]

// ---------------------------------------------------------------------------
// 矩阵可用操作（仅审查导向标签）
// ---------------------------------------------------------------------------

/** 矩阵中单元格或物理矛盾的可用操作 */
export const MATRIX_AVAILABLE_ACTIONS = [
  'view_rationale',
  'add_to_workbench',
  'open_draft_review',
  'copy_ref',
] as const
export type MatrixAvailableAction = (typeof MATRIX_AVAILABLE_ACTIONS)[number]

// ---------------------------------------------------------------------------
// Source ref（低敏引用）
// ---------------------------------------------------------------------------

/** 矩阵 source ref 类型（与 InnovationSourceRef 互补不重复） */
export type MatrixSourceType = 'contradiction' | 'triz_analysis' | 'rationale' | 'workbench'

/**
 * 矩阵 source ref：只引用低敏字段。
 * 禁止包含完整证据正文、AI 输出或敏感路径。
 */
export interface MatrixSourceRef {
  sourceType: MatrixSourceType
  /** 引用 id：contradiction key / artifact id / rationale id / schemeId */
  ref: string
  /** stable hash（用于 stale 判定与幂等校验） */
  hash: string | null
  /** 低敏短标题 */
  title: string
  /** 关联严重度 */
  severity: ContradictionSeverity | null
  /** 是否过期 */
  stale: boolean
  /** 来源是否来自 AI */
  isAiGenerated: boolean
  /** 来源是否来自 fallback */
  isFallback: boolean
  /** 关联的 warning codes */
  warningCodes: string[]
}

// ---------------------------------------------------------------------------
// Warning 摘要
// ---------------------------------------------------------------------------

/**
 * 矩阵级 warning 摘要（低敏）。
 * 不含完整 warning 正文，只含 count + codes。
 */
export interface MatrixWarningSummary {
  total: number
  blocking: number
  warning: number
  info: number
  codes: string[]
}

// ---------------------------------------------------------------------------
// 矩阵单元状态 (cell state)
// ---------------------------------------------------------------------------

/**
 * 矩阵单元状态枚举：
 * - `has_sources`: 有授权来源且可见
 * - `empty`: 无已知矛盾
 * - `hidden`: 有来源但无权限查看
 * - `unavailable`: 来源数据不可用（服务异常或数据丢失）
 * - `stale`: 所有来源 hash 均已过期
 */
export const MATRIX_CELL_STATES = [
  'has_sources',
  'empty',
  'hidden',
  'unavailable',
  'stale',
] as const
export type MatrixCellState = (typeof MATRIX_CELL_STATES)[number]

// ---------------------------------------------------------------------------
// 参数轴
// ---------------------------------------------------------------------------

/** 参数轴描述（稳定排序，用于矩阵行列标签） */
export interface MatrixParameterAxis {
  parameterKey: ProjectParameterKey
  /** 中文参数名 */
  name: string
  /** 方向：improving 轴 或 worsening 轴 */
  direction: 'improving' | 'worsening'
  /** 该参数在对应方向上关联的可见 source 数量 */
  visibleSourceCount: number
  /** 该参数在对应方向上是否有 hidden 来源（不曝露 hidden 数量） */
  hasHiddenSources: boolean
}

// ---------------------------------------------------------------------------
// 技术矛盾矩阵单元
// ---------------------------------------------------------------------------

/**
 * 技术矛盾矩阵单元。
 * 改善项 always direction=improving 参数，恶化项 always direction=worsening 参数。
 */
export interface MatrixCell {
  /** 稳定 cell key（deterministic hash of improving_key + worsening_key + catalog_version） */
  cellKey: string
  improvingParameterKey: ProjectParameterKey
  worseningParameterKey: ProjectParameterKey
  /** 单元状态 */
  state: MatrixCellState
  /** 授权可见的来源 refs */
  sourceRefs: MatrixSourceRef[]
  /** 可见来源总数 */
  totalVisibleSources: number
  /** 是否有无权限来源（二进制，不泄数量） */
  hasHiddenSources: boolean
  /** 候选发明原理 refs（去重、稳定排序） */
  candidatePrincipleIds: InventivePrincipleId[]
  /** 综合严重度（所有来源的最高严重度） */
  severity: ContradictionSeverity | null
  /** 综合置信度范围（所有来源的置信度区间） */
  confidenceRange: { min: number; max: number } | null
  /** 综合 warning 摘要 */
  warningSummary: MatrixWarningSummary
  /** 是否全部来源都 stale */
  isStale: boolean
  /** 该单元格的可用操作 */
  availableActions: MatrixAvailableAction[]
}

// ---------------------------------------------------------------------------
// 物理矛盾条目
// ---------------------------------------------------------------------------

/** 物理矛盾表示（不与技术矛盾矩阵交叉，独立区域） */
export interface MatrixPhysicalTension {
  /** 稳定 key（deterministic hash of parameter_key + catalog_version） */
  tensionKey: string
  parameterKey: ProjectParameterKey
  /** 对立要求摘要（低敏） */
  opposingRequirements: string
  /** 状态 */
  state: MatrixCellState
  /** 授权可见的来源 refs */
  sourceRefs: MatrixSourceRef[]
  /** 候选发明原理 refs */
  candidatePrincipleIds: InventivePrincipleId[]
  /** 严重度 */
  severity: ContradictionSeverity | null
  /** 置信度 */
  confidence: number | null
  /** warning 摘要 */
  warningSummary: MatrixWarningSummary
  /** 是否 stale */
  isStale: boolean
  /** 可用操作 */
  availableActions: MatrixAvailableAction[]
}

// ---------------------------------------------------------------------------
// 目录元数据
// ---------------------------------------------------------------------------

/** 矩阵使用的工程参数目录摘要（不含完整参数正文，仅用于行列标签与排序） */
export interface MatrixCatalogMetadata {
  /** 目录版本（保证 matrix cell key 稳定） */
  version: string
  /** improving 轴参数列表（稳定排序） */
  parameters: MatrixParameterAxis[]
  /** 候选发明原理 ID 列表（排序，供前端展示原理名） */
  principleIds: InventivePrincipleId[]
  /** 来源规则集版本 */
  rulesetVersion: string
}

// ---------------------------------------------------------------------------
// 矩阵根 DTO
// ---------------------------------------------------------------------------

/** 前端筛选器表示（客户端态发送给 API） */
export interface MatrixFilters {
  contradictionType?: MatrixContradictionTypeFilter
  status?: MatrixStatusFilter
  severity?: MatrixSeverityFilter
  stale?: MatrixStaleFilter
  sourceType?: MatrixSourceTypeFilter
  parameterKey?: ProjectParameterKey | null
  principleId?: InventivePrincipleId | null
  warningCode?: string | null
  sort?: MatrixSortField
  sortDirection?: SortDirection
}

/**
 * TRIZ 矛盾矩阵 DTO（后端只读响应）。
 * 权限脱敏、可追溯、零副作用。
 */
export interface TrizContradictionMatrix {
  organizationId: number
  projectId: number
  /** 来源范围标识（用户传入的筛选与权限后 scope） */
  scope: {
    /** 该用户是否有 contradiction:view */
    hasViewPermission: boolean
    /** 该用户是否能访问 Workbench/Handoff */
    canAccessWorkbench: boolean
    /** 该用户是否能访问 Rationale */
    canAccessRationale: boolean
  }
  /** 目录元数据 */
  catalog: MatrixCatalogMetadata
  /** 技术矛盾矩阵单元（按 improving_param × worsening_param 排序） */
  cells: MatrixCell[]
  /** 物理矛盾列表（独立区域） */
  physicalTensions: MatrixPhysicalTension[]
  /** 综合 warning 摘要 */
  warningSummary: MatrixWarningSummary
  /** 活跃的筛选器（即用户请求的筛选器） */
  filters: MatrixFilters
  /** 计算时间（不参与 hash） */
  calculatedAt: string
  /** 0 模型调用、0 模型成本标记 */
  zeroModelCost: boolean
}

// ---------------------------------------------------------------------------
// 选中单元/物理矛盾的展示状态（前端局部状态）
// ---------------------------------------------------------------------------

/** 前端选中单元的展示表示（不包含完整源数据，仅用于 detail panel） */
export interface MatrixSelectedCell {
  cellKey: string
  improvingParameterKey: ProjectParameterKey
  worseningParameterKey: ProjectParameterKey
  /** 选中时间戳（用于 stale 超时提醒） */
  selectedAt: string
}

export interface MatrixSelectedTension {
  tensionKey: string
  parameterKey: ProjectParameterKey
  selectedAt: string
}

// ---------------------------------------------------------------------------
// Handoff input（交到 Workbench 或 Draft Layer）
// ---------------------------------------------------------------------------

/**
 * 矩阵 handoff 输入：将选中的单元格/物理矛盾作为候选输入交给 Workbench 或 Draft Layer。
 * 不修改正式项目数据。
 */
export interface MatrixHandoffInput {
  /** 交到哪 */
  target: 'workbench' | 'draft_review'
  organizationId: number
  projectId: number
  actorId: number
  /** 选中单元或物理矛盾 */
  selectedCells: string[] // cellKey[]
  selectedTensions: string[] // tensionKey[]
  /** 来源 refs 与 hash（用于幂等与 stale 校验） */
  sourceRefs: MatrixSourceRef[]
  sourceHashes: string[]
  /** 选中参数 keys */
  selectedParameterKeys: ProjectParameterKey[]
  /** 选中候选原理 IDs */
  selectedPrincipleIds: InventivePrincipleId[]
  /** 选中时的 warning summary（用于分析） */
  warningSummary: MatrixWarningSummary
  /** 幂等键（前端计算，后端校验） */
  idempotencyKey: string
  /** 可选备注 */
  note: string | null
}

/** Handoff 响应 */
export interface MatrixHandoffResponse {
  data: {
    status: 'created' | 'stale_blocked' | 'unavailable'
    /** Workbench scheme ref 或 Draft Layer session ref */
    targetRef: string | null
    /** 阻断原因 */
    blockedReason: string | null
    /** 原始输入中的 idempotencyKey */
    idempotencyKey: string
  }
}

// ---------------------------------------------------------------------------
// API DTO（请求/响应）
// ---------------------------------------------------------------------------

export interface GetMatrixRequest {
  params: {
    projectId: number
  }
  /** 查询筛选器 */
  query: MatrixFilters
}

export interface GetMatrixResponse {
  data: TrizContradictionMatrix
}

export interface MatrixHandoffRequest {
  params: {
    projectId: number
  }
  body: MatrixHandoffInput
}

// ---------------------------------------------------------------------------
// 纯函数：稳定 cell key / 排序 / warning 聚合 / stale 判定 / 脱敏
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<ContradictionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

const WARNING_SEVERITY_RANK: Record<string, number> = {
  blocking: 0,
  warning: 1,
  info: 2,
}

/**
 * 生成稳定矩阵 cell key：hash of `parameter_improving` + `parameter_worsening` + `catalog_version`。
 * 同一目录版本、同一参数对必然产生同一 key。
 */
export function computeMatrixCellKey(args: {
  improvingParameterKey: ProjectParameterKey
  worseningParameterKey: ProjectParameterKey
  catalogVersion: string
}): string {
  const stable = `${args.improvingParameterKey}:${args.worseningParameterKey}:${args.catalogVersion}`
  return `mxc-${deterministicHash(stable)}`
}

/**
 * 生成稳定物理矛盾 tension key：hash of `parameter_key` + `catalog_version`。
 */
export function computeTensionKey(args: {
  parameterKey: ProjectParameterKey
  catalogVersion: string
}): string {
  return `mxt-${deterministicHash(`${args.parameterKey}:${args.catalogVersion}`)}`
}

/**
 * 参数排序比较器：按参数目录定义顺序稳定排序。
 * @param keysOrder 有序参数 key 列表（通常来自 PROJECT_PARAMETER_KEYS）
 */
export function compareParameterKeys(
  a: ProjectParameterKey,
  b: ProjectParameterKey,
  keysOrder: readonly string[] = PROJECT_PARAMETER_KEYS,
): number {
  return keysOrder.indexOf(a) - keysOrder.indexOf(b)
}

/**
 * 严重度排序比较器：critical > high > medium > low。
 */
export function compareSeverity(a: ContradictionSeverity, b: ContradictionSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b]
}

/**
 * 按 source 类型 + 严重度稳定排序 source refs。
 */
export function sortMatrixSourceRefs(refs: MatrixSourceRef[]): MatrixSourceRef[] {
  return [...refs].sort((a, b) => {
    // stale 的排到最后
    if (a.stale !== b.stale) return a.stale ? 1 : -1
    // severity 降序
    if (a.severity && b.severity) {
      const sc = compareSeverity(a.severity, b.severity)
      if (sc !== 0) return sc
    }
    // sourceType 稳定排序
    const typeOrder = { contradiction: 0, triz_analysis: 1, rationale: 2, workbench: 3 }
    const to = (typeOrder[a.sourceType] ?? 99) - (typeOrder[b.sourceType] ?? 99)
    if (to !== 0) return to
    // 最后按 title 排序
    return a.title.localeCompare(b.title)
  })
}

/**
 * 聚合多个 refs 的 warning 为 MatrixWarningSummary。
 */
export function aggregateWarnings(refs: MatrixSourceRef[]): MatrixWarningSummary {
  const codes = new Set<string>()
  let blocking = 0
  let warn = 0
  let info = 0

  for (const ref of refs) {
    for (const code of ref.warningCodes) {
      codes.add(code)
      const rank = WARNING_SEVERITY_RANK[code] ?? 1
      if (rank === 0) blocking++
      else if (rank === 1) warn++
      else info++
    }
  }

  return {
    total: blocking + warn + info,
    blocking,
    warning: warn,
    info,
    codes: Array.from(codes).sort(),
  }
}

/**
 * 判定矩阵单元是否 stale：所有授权可见的来源 refs 均为 stale=true。
 */
export function isCellFullyStale(sourceRefs: MatrixSourceRef[]): boolean {
  if (sourceRefs.length === 0) return false
  return sourceRefs.every((ref) => ref.stale === true)
}

/**
 * 判定矩阵单元状态（根据 source refs 和权限信息）。
 */
export function resolveCellState(args: {
  visibleSourceCount: number
  hasHiddenSources: boolean
  isStale: boolean
  isUnavailable: boolean
}): MatrixCellState {
  if (args.isUnavailable) return 'unavailable'
  if (args.visibleSourceCount === 0 && args.hasHiddenSources) return 'hidden'
  if (args.visibleSourceCount === 0) return 'empty'
  if (args.isStale) return 'stale'
  return 'has_sources'
}

/**
 * 计算综合严重度：source refs 中的最高严重度。
 */
export function computeAggregateSeverity(refs: MatrixSourceRef[]): ContradictionSeverity | null {
  let result: ContradictionSeverity | null = null
  for (const ref of refs) {
    if (!ref.severity) continue
    if (!result || compareSeverity(ref.severity, result) < 0) {
      result = ref.severity
    }
  }
  return result
}

/**
 * 判定矩阵单元可用操作（基于权限 scope 与状态）。
 */
export function resolveAvailableActions(args: {
  state: MatrixCellState
  canAccessWorkbench: boolean
  canAccessRationale: boolean
  hasSourceRefs: boolean
}): MatrixAvailableAction[] {
  const actions: MatrixAvailableAction[] = []
  if (args.state === 'has_sources' || args.state === 'stale') {
    if (args.canAccessRationale) actions.push('view_rationale')
    actions.push('copy_ref')
  }
  if (
    (args.state === 'has_sources' || args.state === 'stale') &&
    args.canAccessWorkbench &&
    args.hasSourceRefs
  ) {
    actions.push('add_to_workbench')
  }
  if (args.state === 'has_sources' && args.canAccessWorkbench && args.hasSourceRefs) {
    actions.push('open_draft_review')
  }
  return actions
}

/**
 * 幂等键规范化：trim + 截断过长输入。
 */
export function normalizeIdempotencyKey(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length > 256) return trimmed.slice(0, 256)
  return trimmed
}

/**
 * 计算矩阵 handoff 幂等键：
 * md5(projectId + selectedCells sorted + selectedTensions sorted + sourceHashes sorted)
 */
export function computeMatrixHandoffIdempotencyKey(args: {
  projectId: number
  selectedCells: string[]
  selectedTensions: string[]
  sourceHashes: string[]
}): string {
  const stable = {
    p: args.projectId,
    c: [...args.selectedCells].sort(),
    t: [...args.selectedTensions].sort(),
    h: [...args.sourceHashes].sort(),
  }
  return `mx-hof-${deterministicHash(JSON.stringify(stable))}`
}

// ---------------------------------------------------------------------------
// 运行时辅助校验（轻量）
// ---------------------------------------------------------------------------

export function isMatrixCellState(v: string): v is MatrixCellState {
  return (MATRIX_CELL_STATES as readonly string[]).includes(v)
}

export function isMatrixAvailableAction(v: string): v is MatrixAvailableAction {
  return (MATRIX_AVAILABLE_ACTIONS as readonly string[]).includes(v)
}

export function isMatrixSortField(v: string): v is MatrixSortField {
  return (MATRIX_SORT_FIELDS as readonly string[]).includes(v)
}

/**
 * 校验 MatrixFilters 合法性（返回错误列表，空=通过）。
 */
export function validateMatrixFilters(filters: unknown): string[] {
  const errors: string[] = []
  if (!filters || typeof filters !== 'object') return ['filters must be an object']
  const f = filters as Record<string, unknown>
  if (f.contradictionType !== undefined && typeof f.contradictionType === 'string') {
    if (!(MATRIX_CONTRADICTION_TYPES as readonly string[]).includes(f.contradictionType)) {
      errors.push('contradictionType is invalid')
    }
  }
  if (f.status !== undefined && typeof f.status === 'string') {
    if (!(MATRIX_STATUS_FILTERS as readonly string[]).includes(f.status)) {
      errors.push('status is invalid')
    }
  }
  if (f.severity !== undefined && typeof f.severity === 'string') {
    if (!(MATRIX_SEVERITY_FILTERS as readonly string[]).includes(f.severity)) {
      errors.push('severity is invalid')
    }
  }
  if (f.stale !== undefined && typeof f.stale === 'string') {
    if (!(MATRIX_STALE_FILTERS as readonly string[]).includes(f.stale)) {
      errors.push('stale is invalid')
    }
  }
  if (f.sourceType !== undefined && typeof f.sourceType === 'string') {
    if (!(MATRIX_SOURCE_TYPE_FILTERS as readonly string[]).includes(f.sourceType)) {
      errors.push('sourceType is invalid')
    }
  }
  if (f.sort !== undefined && typeof f.sort === 'string') {
    if (!(MATRIX_SORT_FIELDS as readonly string[]).includes(f.sort)) {
      errors.push('sort is invalid')
    }
  }
  if (f.sortDirection !== undefined && typeof f.sortDirection === 'string') {
    if (!(SORT_DIRECTIONS as readonly string[]).includes(f.sortDirection)) {
      errors.push('sortDirection is invalid')
    }
  }
  return errors
}

/**
 * 校验 MatrixHandoffInput（返回错误列表）。
 */
export function validateMatrixHandoffInput(input: unknown): string[] {
  const errors: string[] = []
  if (!input || typeof input !== 'object') return ['handoff input must be an object']
  const i = input as Record<string, unknown>
  if (i.target !== 'workbench' && i.target !== 'draft_review') {
    errors.push('target must be workbench or draft_review')
  }
  if (typeof i.organizationId !== 'number') errors.push('organizationId is required')
  if (typeof i.projectId !== 'number') errors.push('projectId is required')
  if (typeof i.actorId !== 'number') errors.push('actorId is required')
  if (!Array.isArray(i.selectedCells)) errors.push('selectedCells must be an array')
  if (!Array.isArray(i.selectedTensions)) errors.push('selectedTensions must be an array')
  const cellsLen = Array.isArray(i.selectedCells) ? (i.selectedCells as unknown[]).length : 0
  const tensionsLen = Array.isArray(i.selectedTensions)
    ? (i.selectedTensions as unknown[]).length
    : 0
  if (cellsLen === 0 && tensionsLen === 0) {
    errors.push('at least one cell or tension must be selected')
  }
  if (typeof i.idempotencyKey !== 'string' || !i.idempotencyKey) {
    errors.push('idempotencyKey is required')
  }
  if (!Array.isArray(i.sourceRefs)) errors.push('sourceRefs must be an array')
  if (!Array.isArray(i.sourceHashes)) errors.push('sourceHashes must be an array')
  const forbidden = ['patch', 'mutations', 'sql', 'applyPlan', 'executablePatch']
  for (const f of forbidden) {
    if (f in i) errors.push(`forbidden executable field present: ${f}`)
  }
  return errors
}
