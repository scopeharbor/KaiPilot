/**
 * TRIZ-PM Phase Integration — 共享契约与确定性纯函数引擎（前后端共享）
 *
 * V3 TRIZ Phase 3 / P1: 把已授权的 TRIZ 来源映射到项目管理阶段，形成阶段级审查快照。
 *
 * 设计决策：
 * - D2: 固定五类 PM 阶段 taxonomy，确定性映射（AI 不参与主逻辑）
 * - D8: 契约在 packages/types，后端做授权/收集/持久化/API envelope，前端消费 DTO 不重写规则
 * - 所有纯函数零运行时依赖，无 AIGateway 调用
 * - stableId 使用格式 `phaserun_{projectId}_{timestamp}_{rand}` / `phasesnap_{runId}_{phaseId}_{hash}`
 */

// ─── Taxonomy ────────────────────────────────────────────────────────────

/** PM 阶段分类（固定五类，D2）。 */
export const PM_PHASE_IDS = [
  'initiation',
  'planning',
  'execution',
  'monitoring',
  'change_control',
] as const

export type PmPhaseId = (typeof PM_PHASE_IDS)[number]

export const PM_PHASE_LABELS: Record<PmPhaseId, string> = {
  initiation: '启动',
  planning: '规划',
  execution: '执行',
  monitoring: '监控',
  change_control: '变更管理',
}

export const PM_PHASE_ORDER: Record<PmPhaseId, number> = {
  initiation: 0,
  planning: 1,
  execution: 2,
  monitoring: 3,
  change_control: 4,
}

/** 来源种类 taxonomy。 */
export const PM_SOURCE_KINDS = [
  'project_metadata',
  'project_status',
  'task_summary',
  'wbs_summary',
  'milestone_summary',
  'dependency_summary',
  'risk_summary',
  'resource_summary',
  'change_request_summary',
  'contradiction_ref',
  'matrix_ref',
  'technical_analyzer_ref',
  'physical_analyzer_ref',
  'ifr_ref',
  'function_analysis_ref',
  'resource_analysis_ref',
  'evolution_trend_ref',
  'workbench_ref',
  'decision_ref',
  'draft_readiness_ref',
  'clarification_ref',
  'user_phase_notes',
] as const

export type PmSourceKind = (typeof PM_SOURCE_KINDS)[number]

/** Readiness 状态枚举 */
export const PHASE_READINESS_STATES = [
  'ready',
  'needs_review',
  'blocked_stale',
  'insufficient_evidence',
  'requires_human_confirmation',
] as const

export type PhaseReadinessState = (typeof PHASE_READINESS_STATES)[number]

/** Warning codes */
export const PHASE_WARNING_CODES = [
  'SOURCE_UNAVAILABLE',
  'SOURCE_STALE',
  'SOURCE_PERMISSION_DENIED',
  'MISSING_CRITICAL_CATEGORY',
  'UNRESOLVED_DECISIONS',
  'HIGH_SEVERITY_WARNING',
  'METHODOLOGY_MISMATCH',
  'GUARDED_ADAPTER_FALLBACK',
] as const

export type PhaseWarningCode = (typeof PHASE_WARNING_CODES)[number]

/** 推荐审查动作类型 */
export const PHASE_ACTION_KINDS = [
  'review_contradiction',
  'review_matrix',
  'review_technical_analysis',
  'review_physical_analysis',
  'review_ifr',
  'review_function_analysis',
  'review_resource_analysis',
  'review_evolution_trend',
  'open_workbench',
  'open_decision_center',
  'open_draft_review',
  'request_clarification',
  'review_risk',
  'review_change',
  'record_review',
] as const

export type PhaseActionKind = (typeof PHASE_ACTION_KINDS)[number]

/** 分析运行状态 */
export const PHASE_RUN_STATUSES = ['pending', 'running', 'completed', 'failed'] as const
export type PhaseRunStatus = (typeof PHASE_RUN_STATUSES)[number]

/** 审查动作状态 */
export const PHASE_ACTION_STATUSES = [
  'open',
  'reviewed',
  'handoff_initiated',
  'handoff_blocked',
] as const
export type PhaseActionStatus = (typeof PHASE_ACTION_STATUSES)[number]

/** Handoff 目标类型 */
export const PHASE_HANDOFF_TARGETS = [
  'workbench',
  'decision_center',
  'draft_layer',
  'clarification',
  'risk_review',
  'change_review',
] as const

export type PhaseHandoffTarget = (typeof PHASE_HANDOFF_TARGETS)[number]

// ─── Core DTOs ────────────────────────────────────────────────────────────

/** 低敏来源引用 */
export interface PmSourceRef {
  /** 来源种类 */
  sourceKind: PmSourceKind
  /** 稳定的来源标识（如 contradiction id, decision id） */
  sourceId: string
  /** 低敏标题（可能被脱敏为空字符串） */
  title: string
  /** 来源内容哈希 */
  sourceHash: string
  /** 是否能被当前用户导航到 */
  hasNavigation: boolean
  /** 脱敏原因（为空表示未被脱敏） */
  redactionReason?: string
  /** 来源状态标签 */
  statusLabel?: string
  /** 来源时间戳 */
  sourceTimestamp?: string
}

/** 缺口诊断 */
export interface PhaseGapDiagnostic {
  /** 缺口所在种类 */
  missingSourceKind: PmSourceKind
  /** 严重度: low | medium | high */
  severity: 'low' | 'medium' | 'high'
  /** 可读的缺口描述 */
  description: string
  /** 推荐的填补动作 */
  recommendedAction: PhaseActionKind
  /** 是否必须人工审查 */
  requiresUserConfirmation: boolean
  /** 预览标识，不可直接执行 */
  previewOnly: boolean
}

/** 阶段推荐审查项 */
export interface PhaseRecommendation {
  /** 稳定推荐 ID */
  recommendationId: string
  /** 动作类型 */
  actionKind: PhaseActionKind
  /** 标题 */
  title: string
  /** 描述 */
  description: string
  /** 关联的 source refs */
  sourceRefs: PmSourceRef[]
  /** 是否可以 handoff */
  handoffEligible: boolean
  /** handoff 目标列表 */
  handoffTargets: PhaseHandoffTarget[]
  /** 优先级: 1(最高)~5(最低) */
  priority: number
  /** 是否必须人工确认 */
  requiresUserConfirmation: boolean
  /** 预览标识 */
  previewOnly: boolean
}

/** 阶段快照 */
export interface PhaseSnapshot {
  /** 稳定 phase snapshot id */
  snapshotId: string
  /** 所属 run id */
  runId: string
  /** 阶段标识 */
  phaseId: PmPhaseId
  /** 阶段标签 */
  phaseLabel: string
  /** 各来源 refs */
  sourceRefs: PmSourceRef[]
  /** 来源 hash 集合 */
  sourceHashes: Record<string, string>
  /** readiness 状态 */
  readiness: PhaseReadinessState
  /** 缺口诊断列表 */
  gaps: PhaseGapDiagnostic[]
  /** 推荐审查动作 */
  recommendations: PhaseRecommendation[]
  /** warning 列表 */
  warnings: PhaseWarning[]
  /** 是否 stale */
  stale: boolean
  /** 审查元数据 */
  reviewMetadata?: PhaseReviewMetadata
  /** 方法论提示 */
  methodologyHint?: string
}

/** Warning 条目 */
export interface PhaseWarning {
  /** 警告代码 */
  code: PhaseWarningCode
  /** 警告消息 */
  message: string
  /** 严重度 */
  severity: 'low' | 'medium' | 'high'
  /** 关联的 source kind */
  sourceKind?: PmSourceKind
  /** 关联的 source id */
  sourceId?: string
}

/** 人工审查元数据 */
export interface PhaseReviewMetadata {
  /** 是否已审查 */
  reviewed: boolean
  /** 审查者 id */
  reviewedBy?: number
  /** 审查时间 */
  reviewedAt?: string
  /** 审查备注 */
  reviewNotes?: string
}

/** 分析运行 DTO */
export interface PhaseIntegrationRun {
  /** 运行标识 */
  runId: string
  /** 项目 ID */
  projectId: number
  /** 组织 ID */
  organizationId: number
  /** 触发者 ID */
  actorId: number
  /** 运行状态 */
  status: PhaseRunStatus
  /** 输入签名（幂等键） */
  inputSignature: string
  /** 输出哈希 */
  outputHash: string
  /** 阶段快照列表 */
  phases: PhaseSnapshot[]
  /** 聚合 warning 列表 */
  warningSummary: PhaseWarning[]
  /** 成本摘要 */
  costSummary?: PhaseAiCostSummary
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

/** 运行列表项 DTO（精简版） */
export interface PhaseIntegrationRunListItem {
  runId: string
  status: PhaseRunStatus
  phaseIds: PmPhaseId[]
  warningCount: number
  blockedPhaseCount: number
  stalePhaseCount: number
  costSummary?: PhaseAiCostSummary
  createdAt: string
  updatedAt: string
}

/** AI 成本摘要 */
export interface PhaseAiCostSummary {
  /** 总 token 数 */
  totalTokens?: number
  /** 总调用次数 */
  totalCalls?: number
  /** 总延迟 ms */
  totalLatencyMs?: number
  /** provider ID */
  providerId?: string
  /** model ID */
  modelId?: string
  /** 是否降级（AI 未调用即为 fallback） */
  isFallback: boolean
  /** 降级原因 */
  degradedReason?: string
}

/** AI 解释 DTO */
export interface PhaseAiExplanation {
  /** 解释文本 */
  text: string
  /** 是否降级 */
  isFallback: boolean
  /** 降级原因 */
  degradedReason?: string
  /** 来源 refs */
  sourceRefs: PmSourceRef[]
  /** 校验元数据 */
  validationMetadata?: PhaseAiValidationMetadata
  /** 成本摘要 */
  costSummary: PhaseAiCostSummary
}

/** AI 校验元数据 */
export interface PhaseAiValidationMetadata {
  /** 结构化输出校验是否通过 */
  structureValid: boolean
  /** 反幻觉校验是否通过 */
  antiHallucinationValid: boolean
  /** 预算是否批准 */
  budgetApproved: boolean
  /** 校验警告 */
  warnings?: string[]
}

/** Handoff 预览负载 */
export interface PhaseHandoffPreview {
  /** 预览标识符 */
  previewId: string
  /** 目标类型 */
  target: PhaseHandoffTarget
  /** 跑 run id */
  runId: string
  /** 阶段 id */
  phaseId: PmPhaseId
  /** 关联的推荐 id */
  recommendationId: string
  /** 源 refs */
  sourceRefs: PmSourceRef[]
  /** 源 hashes */
  sourceHashes: Record<string, string>
  /** warning 列表 */
  warnings: PhaseWarning[]
  /** 触发者 id */
  actorId: number
  /** 组织 id */
  organizationId: number
  /** 项目 id */
  projectId: number
  /** 幂等 key */
  idempotencyKey: string
  /** 预览专用标识 */
  previewOnly: true
  /** 是否必须人工确认 */
  requiresUserConfirmation: boolean
  /** 候选元数据 (target-specific) */
  candidateMetadata?: Record<string, unknown>
}

/** 审计元数据 */
export interface PhaseIntegrationAuditMetadata {
  actor: number
  organization: number
  project: number
  runId?: string
  phaseId?: PmPhaseId
  recommendationIds?: string[]
  sourceKindCounts?: Record<string, number>
  warningCodes?: PhaseWarningCode[]
  hashRefs?: string[]
  status?: string
  costRefs?: Partial<PhaseAiCostSummary>
}

// ─── DTOs for API ─────────────────────────────────────────────────────────

export interface CreatePhaseIntegrationRunRequest {
  /** 可选的用户上下文备注 */
  userNotes?: string
  /** 可选的强制范围限制 */
  scopeFilter?: PmSourceKind[]
}

export interface CreatePhaseIntegrationRunResponse {
  data: PhaseIntegrationRun
}

export interface ListPhaseIntegrationRunsResponse {
  data: PhaseIntegrationRunListItem[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface GetPhaseIntegrationRunResponse {
  data: PhaseIntegrationRun
}

export interface ListPhasesResponse {
  data: PhaseSnapshot[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

export interface GetPhaseDetailResponse {
  data: PhaseSnapshot
}

export interface ReviewPhaseRequest {
  phaseId: PmPhaseId
  reviewNotes?: string
}

export interface ReviewPhaseResponse {
  data: PhaseSnapshot
}

export interface ExplainPhaseRequest {
  phaseId: PmPhaseId
}

export interface ExplainPhaseResponse {
  data: PhaseAiExplanation
}

export interface PmPhaseHandoffPreviewRequest {
  phaseId: PmPhaseId
  recommendationId: string
  target: PhaseHandoffTarget
}

export interface PmPhaseHandoffPreviewResponse {
  data: PhaseHandoffPreview
}

// ─── Pure Helpers ─────────────────────────────────────────────────────────

/**
 * 生成稳定的 run id。
 * 格式: `phaserun_{projectId}_{timestamp}_{rand8}`
 */
export function generatePhaseRunId(projectId: number, rand?: string): string {
  const ts = Date.now()
  const r = rand ?? Math.random().toString(36).slice(2, 10)
  return `phaserun_${projectId}_${ts}_${r}`
}

/**
 * 生成稳定的 snapshot id。
 * 格式: `phasesnap_{runId}_{phaseId}_{hash8}`
 */
export function generatePhaseSnapshotId(runId: string, phaseId: PmPhaseId, hash?: string): string {
  const h = hash ?? simpleHash8(`${runId}:${phaseId}`)
  return `phasesnap_${runId}_${phaseId}_${h}`
}

/**
 * 生成推荐 ID。
 */
export function generateRecommendationId(runId: string, phaseId: PmPhaseId, index: number): string {
  return `phaserec_${runId}_${phaseId}_${index}`
}

/**
 * 生成幂等 key。
 */
export function computePhaseRunIdempotencyKey(projectId: number, sourceHashPrefix: string): string {
  return `pmphase_${projectId}_${simpleHash8(sourceHashPrefix)}`
}

/**
 * 生成 handoff 幂等 key。
 */
export function computePhaseHandoffIdempotencyKey(
  runId: string,
  phaseId: PmPhaseId,
  recommendationId: string,
  target: PhaseHandoffTarget,
): string {
  return `pmphase_handoff_${runId}_${phaseId}_${recommendationId}_${target}`
}

/**
 * 确定性输出哈希。
 */
export function computePhaseRunOutputHash(snapshots: PhaseSnapshot[]): string {
  const payload = snapshots
    .map(
      (s) =>
        `${s.snapshotId}|${s.phaseId}|${s.readiness}|${s.stale ? 1 : 0}|${s.recommendations.length}`,
    )
    .join('\n')
  return simpleHash8(payload)
}

/**
 * 简单 8 字符 FNV-1a 哈希。
 */
export function simpleHash8(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}

/**
 * 来源映射 key：把 source kind + id 拼成稳定标识。
 */
export function buildSourceMappingKey(kind: PmSourceKind, sourceId: string): string {
  return `${kind}:${sourceId}`
}

// ─── Phase Ordering ──────────────────────────────────────────────────────

/**
 * 判断阶段 A 是否在阶段 B 之前或相同。
 */
export function isPhaseBeforeOrEqual(a: PmPhaseId, b: PmPhaseId): boolean {
  return PM_PHASE_ORDER[a] <= PM_PHASE_ORDER[b]
}

/**
 * 获取下一个阶段（无则返回 null）。
 */
export function nextPhase(phaseId: PmPhaseId): PmPhaseId | null {
  const idx = PM_PHASE_IDS.indexOf(phaseId)
  if (idx < 0 || idx >= PM_PHASE_IDS.length - 1) return null
  return PM_PHASE_IDS[idx + 1]! as PmPhaseId
}

/**
 * 获取上一个阶段（无则返回 null）。
 */
export function prevPhase(phaseId: PmPhaseId): PmPhaseId | null {
  const idx = PM_PHASE_IDS.indexOf(phaseId)
  if (idx <= 0) return null
  return PM_PHASE_IDS[idx - 1]! as PmPhaseId
}

/**
 * 阶段到目标阶段的有效跳转列表。
 */
const VALID_PHASE_TRANSITIONS: Record<PmPhaseId, PmPhaseId[]> = {
  initiation: ['planning'],
  planning: ['initiation', 'execution'],
  execution: ['planning', 'monitoring'],
  monitoring: ['execution', 'change_control'],
  change_control: ['monitoring'],
}

/** 阶段跳转是否有效（用于 UI 显示，不触发数据变更） */
export function isValidPhaseTransition(from: PmPhaseId, to: PmPhaseId): boolean {
  return (VALID_PHASE_TRANSITIONS[from] ?? []).includes(to)
}

// ─── TRIZ-to-Phase Mapping ─────────────────────────────────────────────────

/**
 * 确定性 TRIZ 来源阶段映射表。
 * 返回该来源种类在哪些 PM 阶段中应被关注（主要阶段优先排序）。
 */
export function trizSourceToPrimaryPhases(kind: PmSourceKind): PmPhaseId[] {
  const mapping: Record<string, PmPhaseId[]> = {
    project_metadata: ['initiation'],
    project_status: ['initiation', 'monitoring', 'change_control'],
    task_summary: ['planning', 'execution', 'monitoring'],
    wbs_summary: ['planning', 'execution'],
    milestone_summary: ['planning', 'monitoring'],
    dependency_summary: ['planning', 'monitoring', 'change_control'],
    risk_summary: ['initiation', 'planning', 'execution', 'monitoring', 'change_control'],
    resource_summary: ['planning', 'execution'],
    change_request_summary: ['monitoring', 'change_control'],
    contradiction_ref: ['initiation', 'planning', 'execution'],
    matrix_ref: ['initiation', 'planning'],
    technical_analyzer_ref: ['planning', 'execution'],
    physical_analyzer_ref: ['planning', 'execution'],
    ifr_ref: ['initiation', 'planning'],
    function_analysis_ref: ['planning', 'execution'],
    resource_analysis_ref: ['planning', 'execution'],
    evolution_trend_ref: ['planning', 'monitoring'],
    workbench_ref: ['planning', 'execution', 'monitoring'],
    decision_ref: ['initiation', 'planning', 'execution', 'monitoring', 'change_control'],
    draft_readiness_ref: ['planning', 'execution', 'monitoring', 'change_control'],
    clarification_ref: ['initiation', 'planning', 'execution', 'monitoring'],
    user_phase_notes: ['initiation', 'planning', 'execution', 'monitoring', 'change_control'],
  }
  return (mapping[kind] as PmPhaseId[]) ?? []
}

/**
 * 获取阶段期望的关键来源类别。
 */
export function criticalSourcesForPhase(phaseId: PmPhaseId): PmSourceKind[] {
  const critical: Record<PmPhaseId, PmSourceKind[]> = {
    initiation: [
      'project_metadata',
      'project_status',
      'contradiction_ref',
      'ifr_ref',
      'risk_summary',
    ],
    planning: [
      'task_summary',
      'wbs_summary',
      'milestone_summary',
      'dependency_summary',
      'resource_summary',
      'risk_summary',
      'technical_analyzer_ref',
      'physical_analyzer_ref',
      'resource_analysis_ref',
      'function_analysis_ref',
    ],
    execution: [
      'task_summary',
      'wbs_summary',
      'risk_summary',
      'resource_summary',
      'workbench_ref',
      'decision_ref',
    ],
    monitoring: [
      'project_status',
      'dependency_summary',
      'risk_summary',
      'change_request_summary',
      'evolution_trend_ref',
      'milestone_summary',
    ],
    change_control: [
      'change_request_summary',
      'draft_readiness_ref',
      'risk_summary',
      'decision_ref',
      'dependency_summary',
    ],
  }
  return critical[phaseId] ?? []
}

/**
 * 获取阶段推荐的 TRIZ 工具。
 */
export function recommendedTrizToolsForPhase(phaseId: PmPhaseId): PhaseActionKind[] {
  const recs: Record<PmPhaseId, PhaseActionKind[]> = {
    initiation: [
      'review_contradiction',
      'review_matrix',
      'review_ifr',
      'open_decision_center',
      'request_clarification',
    ],
    planning: [
      'review_technical_analysis',
      'review_physical_analysis',
      'review_function_analysis',
      'review_resource_analysis',
      'review_evolution_trend',
      'open_workbench',
      'open_decision_center',
      'open_draft_review',
    ],
    execution: [
      'review_contradiction',
      'open_workbench',
      'open_decision_center',
      'open_draft_review',
    ],
    monitoring: ['review_evolution_trend', 'review_risk', 'review_change', 'open_decision_center'],
    change_control: ['review_change', 'review_risk', 'open_draft_review', 'open_decision_center'],
  }
  return recs[phaseId] ?? []
}

// ─── Readiness ────────────────────────────────────────────────────────────

/**
 * 计算 readiness 状态。
 * 优先级：blocked_stale > insufficient_evidence > requires_human_confirmation > needs_review > ready
 */
export function computeReadiness(
  sourceFreshness: number, // 0~1，新鲜来源比例
  unresolvedDecisionCount: number,
  staleCount: number,
  missingCriticalCount: number,
  warningSeverityMax: 'low' | 'medium' | 'high',
  handoffAvailable: boolean, // 是否有可用 handoff (reserved for future use)
  requiresHumanConfirmation: boolean,
): PhaseReadinessState {
  if (staleCount > 0) return 'blocked_stale'
  if (missingCriticalCount >= 2) return 'insufficient_evidence'
  if (requiresHumanConfirmation) return 'requires_human_confirmation'
  if (sourceFreshness < 0.5 || unresolvedDecisionCount > 3 || warningSeverityMax === 'high') {
    return 'needs_review'
  }
  // handoffAvailable 仅作为额外信号，不影响 readiness 自身
  void handoffAvailable
  return 'ready'
}

/**
 * 聚合来源新鲜度分数
 */
export function computeSourceFreshness(
  totalSources: number,
  staleOrMissingSources: number,
): number {
  if (totalSources === 0) return 0
  return Math.max(0, 1 - staleOrMissingSources / totalSources)
}

// ─── Stale Detection ──────────────────────────────────────────────────────

/**
 * 检测单个来源是否 stale（当前 hash 与快照 hash 不一致）。
 */
export function isSourceStale(currentHash: string, snapshottedHash: string): boolean {
  return currentHash !== '' && snapshottedHash !== '' && currentHash !== snapshottedHash
}

/**
 * 从快照中找出所有 stale 来源。
 */
export function detectStaleSources(
  currentHashes: Record<string, string>,
  snapshottedHashes: Record<string, string>,
): string[] {
  const staleKeys: string[] = []
  for (const key of Object.keys(snapshottedHashes)) {
    if (isSourceStale(currentHashes[key] ?? '', snapshottedHashes[key] ?? '')) {
      staleKeys.push(key)
    }
  }
  return staleKeys
}

/**
 * 判断整个阶段是否 stale。
 */
export function isPhaseStale(
  currentHashes: Record<string, string>,
  snapshottedHashes: Record<string, string>,
): boolean {
  return detectStaleSources(currentHashes, snapshottedHashes).length > 0
}

// ─── Warning Aggregation ──────────────────────────────────────────────────

/** Warning 严重度排序权重 */
const WARNING_SEVERITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

/**
 * 按严重度排序 warnings（high 在前）。
 */
export function sortPhaseWarningsBySeverity(warnings: PhaseWarning[]): PhaseWarning[] {
  return [...warnings].sort(
    (a, b) =>
      (WARNING_SEVERITY_ORDER[a.severity] ?? 99) - (WARNING_SEVERITY_ORDER[b.severity] ?? 99),
  )
}

/**
 * 聚合多个来源的 warning 列表并排重。
 */
export function aggregatePhaseWarnings(...warningLists: PhaseWarning[][]): PhaseWarning[] {
  const seen = new Set<string>()
  const result: PhaseWarning[] = []
  for (const list of warningLists) {
    for (const w of list) {
      const key = `${w.code}:${w.sourceKind ?? ''}:${w.sourceId ?? ''}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push(w)
      }
    }
  }
  return sortPhaseWarningsBySeverity(result)
}

/**
 * 聚合 warning 严重度最高级别。
 */
export function maxWarningSeverity(warnings: PhaseWarning[]): 'low' | 'medium' | 'high' {
  if (warnings.length === 0) return 'low'
  for (const w of warnings) {
    if (w.severity === 'high') return 'high'
  }
  for (const w of warnings) {
    if (w.severity === 'medium') return 'medium'
  }
  return 'low'
}

// ─── Redaction ────────────────────────────────────────────────────────────

/**
 * 根据权限掩码脱敏 source ref。
 * 不可访问的 source 不返回 title、navigation ref，以避免信息泄露。
 */
export function redactSourceRef(ref: PmSourceRef, hasPermission: boolean): PmSourceRef {
  if (hasPermission) return ref
  return {
    ...ref,
    title: '',
    hasNavigation: false,
    redactionReason: 'SOURCE_PERMISSION_DENIED',
    statusLabel: undefined,
  }
}

/**
 * 批量脱敏 source refs。
 */
export function redactSourceRefs(
  refs: PmSourceRef[],
  permissionMap: Record<string, boolean>,
): PmSourceRef[] {
  return refs.map((ref) =>
    redactSourceRef(
      ref,
      permissionMap[buildSourceMappingKey(ref.sourceKind, ref.sourceId)] ?? false,
    ),
  )
}

/**
 * 从快照中移除不可见的推荐和缺口。
 */
export function redactPhaseSnapshot(
  snapshot: PhaseSnapshot,
  permissionMap: Record<string, boolean>,
): PhaseSnapshot {
  return {
    ...snapshot,
    sourceRefs: redactSourceRefs(snapshot.sourceRefs, permissionMap),
    recommendations: snapshot.recommendations.filter((rec) =>
      rec.sourceRefs.some(
        (r) => permissionMap[buildSourceMappingKey(r.sourceKind, r.sourceId)] ?? false,
      ),
    ),
    // gaps 按 missingSourceKind 脱敏
    gaps: snapshot.gaps.filter((g) => {
      const key = buildSourceMappingKey(g.missingSourceKind, '')
      return permissionMap[key] !== false
    }),
  }
}

// ─── Enum Guards ──────────────────────────────────────────────────────────

export function isPmPhaseId(value: string): value is PmPhaseId {
  return (PM_PHASE_IDS as readonly string[]).includes(value)
}

export function isPmSourceKind(value: string): value is PmSourceKind {
  return (PM_SOURCE_KINDS as readonly string[]).includes(value)
}

export function isPhaseReadinessState(value: string): value is PhaseReadinessState {
  return (PHASE_READINESS_STATES as readonly string[]).includes(value)
}

export function isPhaseWarningCode(value: string): value is PhaseWarningCode {
  return (PHASE_WARNING_CODES as readonly string[]).includes(value)
}

export function isPhaseActionKind(value: string): value is PhaseActionKind {
  return (PHASE_ACTION_KINDS as readonly string[]).includes(value)
}

export function isPhaseHandoffTarget(value: string): value is PhaseHandoffTarget {
  return (PHASE_HANDOFF_TARGETS as readonly string[]).includes(value)
}

export function isPhaseRunStatus(value: string): value is PhaseRunStatus {
  return (PHASE_RUN_STATUSES as readonly string[]).includes(value)
}

// ─── Validation ───────────────────────────────────────────────────────────

/**
 * 校验 handoff preview 输入有效性
 */
export function validatePhaseHandoffInput(input: {
  phaseId: string
  recommendationId: string
  target: string
}): PhaseWarning[] {
  const warnings: PhaseWarning[] = []
  if (!isPmPhaseId(input.phaseId)) {
    warnings.push({
      code: 'SOURCE_UNAVAILABLE',
      message: `无效的阶段 ID: ${input.phaseId}`,
      severity: 'high',
    })
  }
  if (typeof input.recommendationId !== 'string' || input.recommendationId.length === 0) {
    warnings.push({
      code: 'MISSING_CRITICAL_CATEGORY',
      message: '缺少推荐 ID',
      severity: 'high',
    })
  }
  if (!isPhaseHandoffTarget(input.target)) {
    warnings.push({
      code: 'SOURCE_UNAVAILABLE',
      message: `无效的 handoff 目标: ${input.target}`,
      severity: 'high',
    })
  }
  return warnings
}

/**
 * 按优先级排序推荐（1 最高）。
 */
export function sortPhaseRecommendations(recs: PhaseRecommendation[]): PhaseRecommendation[] {
  return [...recs].sort((a, b) => a.priority - b.priority)
}

// ─── Fixture Builders ─────────────────────────────────────────────────────

export function buildPmSourceRef(overrides?: Partial<PmSourceRef>): PmSourceRef {
  return {
    sourceKind: 'contradiction_ref',
    sourceId: 'src-1',
    title: '测试矛盾',
    sourceHash: 'abc12345',
    hasNavigation: true,
    statusLabel: 'active',
    sourceTimestamp: new Date().toISOString(),
    ...overrides,
  }
}

export function buildPhaseGap(overrides?: Partial<PhaseGapDiagnostic>): PhaseGapDiagnostic {
  return {
    missingSourceKind: 'risk_summary',
    severity: 'medium',
    description: '缺少风险摘要',
    recommendedAction: 'review_risk',
    requiresUserConfirmation: true,
    previewOnly: true,
    ...overrides,
  }
}

export function buildPhaseRecommendation(
  overrides?: Partial<PhaseRecommendation>,
): PhaseRecommendation {
  return {
    recommendationId: 'phaserec_run1_planning_0',
    actionKind: 'review_technical_analysis',
    title: '审查技术矛盾分析',
    description: '建议审查规划阶段的技术矛盾分析结果',
    sourceRefs: [buildPmSourceRef()],
    handoffEligible: true,
    handoffTargets: ['workbench', 'decision_center'],
    priority: 2,
    requiresUserConfirmation: true,
    previewOnly: true,
    ...overrides,
  }
}

export function buildPhaseWarning(overrides?: Partial<PhaseWarning>): PhaseWarning {
  return {
    code: 'SOURCE_STALE',
    message: '来源数据已过期',
    severity: 'medium',
    ...overrides,
  }
}

export function buildPhaseSnapshot(
  phaseId: PmPhaseId,
  overrides?: Partial<PhaseSnapshot>,
): PhaseSnapshot {
  return {
    snapshotId: generatePhaseSnapshotId('run-1', phaseId),
    runId: 'run-1',
    phaseId,
    phaseLabel: PM_PHASE_LABELS[phaseId],
    sourceRefs: [],
    sourceHashes: {},
    readiness: 'insufficient_evidence',
    gaps: [],
    recommendations: [],
    warnings: [],
    stale: false,
    ...overrides,
  }
}

export function buildCompletePhaseIntegrationRun(
  overrides?: Partial<PhaseIntegrationRun>,
): PhaseIntegrationRun {
  const runId = overrides?.runId ?? generatePhaseRunId(1)
  const phases = PM_PHASE_IDS.map((pid) => {
    const refs: PmSourceRef[] = [
      buildPmSourceRef({ sourceKind: 'project_metadata', sourceId: `proj-${pid}` }),
    ]
    const recommendations = recommendedTrizToolsForPhase(pid).map((ak, i) =>
      buildPhaseRecommendation({
        recommendationId: generateRecommendationId(runId, pid, i),
        actionKind: ak,
        title: `${PM_PHASE_LABELS[pid]} - ${ak}`,
      }),
    )
    return buildPhaseSnapshot(pid, {
      runId,
      sourceRefs: refs,
      sourceHashes: Object.fromEntries(
        refs.map((r) => [buildSourceMappingKey(r.sourceKind, r.sourceId), r.sourceHash]),
      ),
      readiness: 'ready',
      recommendations: sortPhaseRecommendations(recommendations),
      gaps: [],
      warnings: [],
      stale: false,
    })
  })

  return {
    runId,
    projectId: 1,
    organizationId: 1,
    actorId: 1,
    status: 'completed',
    inputSignature: computePhaseRunIdempotencyKey(1, 'test'),
    outputHash: computePhaseRunOutputHash(phases),
    phases,
    warningSummary: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildSparsePhaseIntegrationRun(
  overrides?: Partial<PhaseIntegrationRun>,
): PhaseIntegrationRun {
  const runId = overrides?.runId ?? generatePhaseRunId(2)
  const phases = PM_PHASE_IDS.map((pid) =>
    buildPhaseSnapshot(pid, {
      runId,
      readiness: 'insufficient_evidence',
      warnings: [
        buildPhaseWarning({
          code: 'SOURCE_UNAVAILABLE',
          message: `${PM_PHASE_LABELS[pid]} 阶段数据不足`,
          severity: 'high',
        }),
      ],
      gaps: [
        buildPhaseGap({
          missingSourceKind: criticalSourcesForPhase(pid)[0] ?? 'risk_summary',
          severity: 'high',
          description: `${PM_PHASE_LABELS[pid]} 阶段缺少关键来源`,
        }),
      ],
    }),
  )

  return {
    runId,
    projectId: 1,
    organizationId: 1,
    actorId: 0,
    status: 'completed',
    inputSignature: computePhaseRunIdempotencyKey(2, 'sparse'),
    outputHash: computePhaseRunOutputHash(phases),
    phases,
    warningSummary: phases.flatMap((p) => p.warnings),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildStalePhaseIntegrationRun(
  overrides?: Partial<PhaseIntegrationRun>,
): PhaseIntegrationRun {
  const runId = overrides?.runId ?? generatePhaseRunId(3)
  const phases = PM_PHASE_IDS.map((pid) => {
    const refs: PmSourceRef[] = [
      buildPmSourceRef({
        sourceKind: 'risk_summary',
        sourceId: `risk-${pid}`,
        sourceHash: 'old_hash_00',
      }),
    ]
    return buildPhaseSnapshot(pid, {
      runId,
      sourceRefs: refs,
      sourceHashes: Object.fromEntries(
        refs.map((r) => [buildSourceMappingKey(r.sourceKind, r.sourceId), r.sourceHash]),
      ),
      readiness: 'blocked_stale',
      stale: true,
      warnings: [
        buildPhaseWarning({
          code: 'SOURCE_STALE',
          message: `${PM_PHASE_LABELS[pid]} 阶段存在过期数据`,
          severity: 'high',
          sourceKind: 'risk_summary',
          sourceId: `risk-${pid}`,
        }),
      ],
    })
  })

  return {
    runId,
    projectId: 1,
    organizationId: 1,
    actorId: 0,
    status: 'completed',
    inputSignature: computePhaseRunIdempotencyKey(3, 'stale'),
    outputHash: computePhaseRunOutputHash(phases),
    phases,
    warningSummary: phases.flatMap((p) => p.warnings),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

export function buildPermissionRestrictedPhaseIntegrationRun(
  overrides?: Partial<PhaseIntegrationRun>,
): PhaseIntegrationRun {
  const runId = overrides?.runId ?? generatePhaseRunId(4)
  const hiddenRefs: PmSourceRef[] = [
    {
      sourceKind: 'contradiction_ref',
      sourceId: 'hidden-contra-1',
      title: '机密矛盾数据',
      sourceHash: 'hidden_h1',
      hasNavigation: false,
      redactionReason: 'SOURCE_PERMISSION_DENIED',
    },
    {
      sourceKind: 'resource_analysis_ref',
      sourceId: 'hidden-res-1',
      title: '机密资源分析',
      sourceHash: 'hidden_h2',
      hasNavigation: false,
      redactionReason: 'SOURCE_PERMISSION_DENIED',
    },
  ]
  const visibleRefs: PmSourceRef[] = [
    buildPmSourceRef({
      sourceKind: 'project_metadata',
      sourceId: 'vis-proj-1',
      title: '公开项目数据',
    }),
  ]
  const phases = PM_PHASE_IDS.map((pid) =>
    buildPhaseSnapshot(pid, {
      runId,
      sourceRefs: [...visibleRefs, ...hiddenRefs],
      sourceHashes: Object.fromEntries(
        [...visibleRefs, ...hiddenRefs].map((r) => [
          buildSourceMappingKey(r.sourceKind, r.sourceId),
          r.sourceHash,
        ]),
      ),
      readiness: 'needs_review',
      warnings: [
        buildPhaseWarning({
          code: 'SOURCE_PERMISSION_DENIED',
          message: `${hiddenRefs.length} 个来源因权限不足已被隐藏`,
          severity: 'medium',
        }),
      ],
    }),
  )

  return {
    runId,
    projectId: 1,
    organizationId: 1,
    actorId: 0,
    status: 'completed',
    inputSignature: computePhaseRunIdempotencyKey(4, 'restricted'),
    outputHash: computePhaseRunOutputHash(phases),
    phases,
    warningSummary: phases.flatMap((p) => p.warnings),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

/**
 * 大输入性能探针：1000 source refs + 500 recommendations。
 */
export function buildLargePhaseIntegrationPacket(): {
  run: PhaseIntegrationRun
  sourceRefCount: number
  recommendationCount: number
} {
  const runId = generatePhaseRunId(999)
  const phases: PhaseSnapshot[] = []

  for (const pid of PM_PHASE_IDS) {
    const refs: PmSourceRef[] = []
    const hashes: Record<string, string> = {}
    // 200 source refs per phase = 1000 total
    for (let i = 0; i < 200; i++) {
      const kind: PmSourceKind = PM_SOURCE_KINDS[i % PM_SOURCE_KINDS.length]!
      const sid = `perf-src-${pid}-${i}`
      const hash = simpleHash8(`${pid}:${i}:${Date.now()}`)
      refs.push({
        sourceKind: kind,
        sourceId: sid,
        title: `性能测试来源 ${pid} #${i}`,
        sourceHash: hash,
        hasNavigation: true,
        sourceTimestamp: new Date().toISOString(),
      } as PmSourceRef)
      hashes[buildSourceMappingKey(kind, sid)] = hash
    }
    // 100 recommendations per phase = 500 total
    const recs: PhaseRecommendation[] = []
    for (let j = 0; j < 100; j++) {
      recs.push({
        recommendationId: generateRecommendationId(runId, pid, j),
        actionKind: PHASE_ACTION_KINDS[j % PHASE_ACTION_KINDS.length] as PhaseActionKind,
        title: `性能测试推荐 ${pid} #${j}`,
        description: `这是自动化生成的性能探针推荐`,
        sourceRefs: refs.slice(0, 3),
        handoffEligible: j % 2 === 0,
        handoffTargets: j % 2 === 0 ? ['workbench', 'decision_center'] : [],
        priority: (j % 5) + 1,
        requiresUserConfirmation: true,
        previewOnly: true,
      })
    }
    phases.push(
      buildPhaseSnapshot(pid, {
        runId,
        sourceRefs: refs,
        sourceHashes: hashes,
        readiness: 'needs_review',
        recommendations: sortPhaseRecommendations(recs),
        stale: false,
      }),
    )
  }

  return {
    run: {
      runId,
      projectId: 999,
      organizationId: 1,
      actorId: 1,
      status: 'completed',
      inputSignature: computePhaseRunIdempotencyKey(999, 'perf'),
      outputHash: computePhaseRunOutputHash(phases),
      phases,
      warningSummary: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    sourceRefCount: 1000,
    recommendationCount: 500,
  }
}

/** No-AI deterministic behavior: 所有映射和计算函数不调用外部 API，零副作用 */
export const PHASE_INTEGRATION_NO_AI_CONTRACT = {
  /** 映射和纯函数不调用 AIGateway */
  noAIGatewayCall: true,
  /** 所有计算函数为纯函数 */
  allPureFunctions: true,
  /** 零运行时副作用 */
  zeroSideEffects: true,
} as const
