// @aiproj/types — V3 多项目依赖管理共享契约（前后端共享）
// v3-multi-project-dependency-model / D1–D7
//
// 零运行时依赖：不导入 AdonisJS、React、数据库客户端、AI SDK、
// chart 库、Redis、VectorDB、网络客户端或外部服务。
// 仅依赖 TypeScript 类型系统与标准库。

// ---------------------------------------------------------------------------
// §1. 核心枚举与常量
// ---------------------------------------------------------------------------

/** 端点类型：依赖可以连接项目、里程碑、任务或手工外部引用 */
export const ENDPOINT_TYPES = ['project', 'milestone', 'task', 'external'] as const
export type MultiProjectEndpointType = (typeof ENDPOINT_TYPES)[number]

/** 依赖类型：FS/SS/FF/SF，复用项目内依赖语义 */
export const DEPENDENCY_TYPES = ['fs', 'ss', 'ff', 'sf'] as const
export type MultiProjectDependencyType = (typeof DEPENDENCY_TYPES)[number]

/** 依赖类别：交付物/里程碑/技术/资源/外部 */
export const DEPENDENCY_CATEGORIES = [
  'deliverable',
  'milestone',
  'technical',
  'resource',
  'external',
] as const
export type MultiProjectDependencyCategory = (typeof DEPENDENCY_CATEGORIES)[number]

/** 依赖强度 */
export const DEPENDENCY_STRENGTHS = ['hard', 'soft', 'advisory'] as const
export type MultiProjectDependencyStrength = (typeof DEPENDENCY_STRENGTHS)[number]

/** 依赖生命周期状态 */
export const DEPENDENCY_STATUSES = [
  'draft',
  'active',
  'at_risk',
  'blocked',
  'resolved',
  'archived',
] as const
export type MultiProjectDependencyStatus = (typeof DEPENDENCY_STATUSES)[number]

/** 依赖风险等级 */
export const DEPENDENCY_RISK_LEVELS = ['critical', 'high', 'medium', 'low', 'none'] as const
export type MultiProjectDependencyRiskLevel = (typeof DEPENDENCY_RISK_LEVELS)[number]

/** 来源模式：如何创建这条依赖 */
export const SOURCE_MODES = ['manual', 'rule_suggestion', 'ai_suggestion'] as const
export type MultiProjectDependencySourceMode = (typeof SOURCE_MODES)[number]

/** 操作类型（用于预览/确认流程） */
export const WRITE_OPERATIONS = ['create', 'update', 'archive', 'restore', 'delete'] as const
export type MultiProjectWriteOperation = (typeof WRITE_OPERATIONS)[number]

// ---------------------------------------------------------------------------
// §2. 端点引用
// ---------------------------------------------------------------------------

/** 端点引用：provider 或 consumer 可以是项目/里程碑/任务/外部引用 */
export interface MultiProjectEndpointRef {
  /** 端点类型 */
  endpointType: MultiProjectEndpointType
  /** 项目 ID（endpointType !== 'external' 时必填） */
  projectId: number | null
  /** 项目名称（脱敏后可能为 null） */
  projectName: string | null
  /** 里程碑 ID（endpointType === 'milestone' 时必填） */
  milestoneId: number | null
  /** 里程碑名称（脱敏后可能为 null） */
  milestoneName: string | null
  /** 任务 ID（endpointType === 'task' 时必填） */
  taskId: number | null
  /** 任务名称（脱敏后可能为 null） */
  taskName: string | null
  /** 外部引用标签（endpointType === 'external' 时使用，低敏） */
  externalLabel: string | null
  /** 外部引用标识（手工维护的唯一键，endpointType === 'external' 时必填） */
  externalKey: string | null
  /** 该端点是否已脱敏（权限不足时标记） */
  redacted: boolean
  /** 脱敏原因码 */
  redactionReason: string | null
}

/** 端点摘要（列表/预览中使用的紧凑版本） */
export interface MultiProjectEndpointSummary {
  endpointType: MultiProjectEndpointType
  projectId: number | null
  projectName: string | null
  taskId: number | null
  taskName: string | null
  milestoneId: number | null
  milestoneName: string | null
  externalLabel: string | null
  redacted: boolean
  redactionReason?: string | null
}

// ---------------------------------------------------------------------------
// §3. 依赖事实
// ---------------------------------------------------------------------------

/** 跨项目依赖事实 */
export interface MultiProjectDependency {
  id: number
  organizationId: number

  /** provider 端点（上游/前置） */
  providerEndpoint: MultiProjectEndpointRef
  /** consumer 端点（下游/后继） */
  consumerEndpoint: MultiProjectEndpointRef

  /** 依赖类别 */
  category: MultiProjectDependencyCategory
  /** 依赖类型 FS/SS/FF/SF */
  type: MultiProjectDependencyType
  /** 提前/滞后天数 */
  lagDays: number
  /** 依赖强度 */
  strength: MultiProjectDependencyStrength
  /** 缓冲天数（consumer 侧用于吸收延迟） */
  bufferDays: number
  /** 生命周期状态 */
  status: MultiProjectDependencyStatus
  /** 风险等级 */
  riskLevel: MultiProjectDependencyRiskLevel

  /** 负责人用户 ID */
  ownerUserId: number | null
  /** 来源模式 */
  sourceMode: MultiProjectDependencySourceMode
  /** 来源建议 ID（rule_suggestion / ai_suggestion 时引用） */
  sourceSuggestionId: number | null
  /** 低敏证据引用 */
  evidenceRefs: MultiProjectEvidenceRef[]

  /** 新鲜度签名（端点状态变更时更新） */
  freshnessSignature: string
  /** 最后新鲜度检查时间 */
  freshnessCheckedAt: string | null
  /** 新鲜度状态 */
  freshnessStatus: 'fresh' | 'stale' | 'unknown'

  /** 确认哈希（最后一次确认的预览哈希） */
  confirmationHash: string | null
  /** 幂等键 */
  idempotencyKey: string | null

  createdAt: string
  updatedAt: string | null
  archivedAt: string | null
}

/** 低敏证据引用 */
export interface MultiProjectEvidenceRef {
  /** 证据类型 */
  type: 'milestone_ref' | 'deliverable_label' | 'resource_signal' | 'manual_note' | 'ai_rationale'
  /** 低敏摘要文本 */
  summary: string
  /** 证据新鲜度 */
  freshness: 'fresh' | 'stale' | 'unknown'
}

// ---------------------------------------------------------------------------
// §4. 依赖列表与分页
// ---------------------------------------------------------------------------

/** 依赖列表筛选参数 */
export interface MultiProjectDependencyFilters {
  /** 项目 ID 范围（提供方或消费方，OR 逻辑） */
  projectIds?: number[]
  /** 端点类型筛选 */
  endpointType?: MultiProjectEndpointType
  /** 依赖类别 */
  category?: MultiProjectDependencyCategory
  /** 依赖类型 */
  type?: MultiProjectDependencyType
  /** 状态筛选 */
  status?: MultiProjectDependencyStatus[]
  /** 风险等级 */
  riskLevel?: MultiProjectDependencyRiskLevel
  /** 来源模式 */
  sourceMode?: MultiProjectDependencySourceMode
  /** 新鲜度筛选 */
  freshness?: 'fresh' | 'stale'
  /** 日期窗口：起始 */
  dateFrom?: string
  /** 日期窗口：结束 */
  dateTo?: string
  /** 搜索文本（端点名称/外部标签） */
  search?: string
}

/** 排序字段 */
export const DEPENDENCY_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'status',
  'riskLevel',
  'category',
  'freshnessCheckedAt',
] as const
export type MultiProjectDependencySortField = (typeof DEPENDENCY_SORT_FIELDS)[number]

/** 列表查询参数 */
export interface MultiProjectDependencyListQuery {
  /** 筛选条件 */
  filters: MultiProjectDependencyFilters
  /** 排序，格式：字段前缀 + 升序，- 降序 */
  sort?: string
  /** 页码（1-based） */
  page: number
  /** 每页条数 */
  perPage: number
}

/** 分页元数据 */
export interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

/** 依赖列表响应 */
export interface MultiProjectDependencyListResponse {
  data: MultiProjectDependency[]
  meta: PaginationMeta
}

/** 标准 API 响应信封 */
export interface ApiEnvelope<T> {
  data: T
  meta?: PaginationMeta
}

/** 标准 API 错误信封 */
export interface ApiErrorEnvelope {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ---------------------------------------------------------------------------
// §5. 预览与确认
// ---------------------------------------------------------------------------

/** 依赖差异（预览时展示的变更内容） */
export interface MultiProjectDependencyDiff {
  /** 操作类型 */
  operation: MultiProjectWriteOperation
  /** 当前值（create 时为 null） */
  before: Partial<MultiProjectDependency> | null
  /** 拟变更值 */
  after: Partial<MultiProjectDependency>
  /** 变更的字段列表 */
  changedFields: string[]
}

/** 预览快照 */
export interface MultiProjectDependencyPreview {
  /** 预览 ID（服务端生成） */
  previewId: string
  /** 操作类型 */
  operation: MultiProjectWriteOperation

  /** provider 端点摘要 */
  providerEndpoint: MultiProjectEndpointSummary
  /** consumer 端点摘要 */
  consumerEndpoint: MultiProjectEndpointSummary

  /** 权限指纹 */
  permissionFingerprint: string
  /** 差异 */
  diff: MultiProjectDependencyDiff

  /** 重复检测：是否已存在相同键的活跃依赖 */
  duplicateCheck: {
    isDuplicate: boolean
    existingId: number | null
    message: string | null
  }
  /** 循环检测 */
  cycleCheck: {
    wouldCreateCycle: boolean
    message: string | null
  }
  /** 生命周期校验 */
  lifecycleCheck: {
    isValid: boolean
    message: string | null
  }
  /** 自依赖检测 */
  selfDependencyCheck: {
    isSelfDependency: boolean
    message: string | null
  }

  /** 来源新鲜度签名 */
  freshnessSignature: string
  /** 警告码列表 */
  warningCodes: MultiProjectWarningCode[]

  /** 确认哈希 */
  confirmationHash: string
  /** 预览过期时间（ISO 8601） */
  expiresAt: string
  /** 幂等键 */
  idempotencyKey: string
  /** 幂等指引 */
  idempotencyGuidance: string
}

/** 确认请求 */
export interface MultiProjectConfirmationRequest {
  /** 预览 ID */
  previewId: string
  /** 确认哈希（必须匹配预览中的值） */
  confirmationHash: string
  /** 幂等键 */
  idempotencyKey: string
}

/** 确认响应 */
export interface MultiProjectConfirmationResponse {
  data: MultiProjectDependency
  /** 是否为幂等重放 */
  idempotentReplay: boolean
}

// ---------------------------------------------------------------------------
// §6. 图谱
// ---------------------------------------------------------------------------

/** 图谱查询参数 */
export interface MultiProjectGraphQuery {
  /** 项目范围（限定边集） */
  projectIds: number[]
  /** 端点类型筛选 */
  endpointType?: MultiProjectEndpointType
  /** 类别筛选 */
  category?: MultiProjectDependencyCategory
  /** 状态筛选 */
  status?: MultiProjectDependencyStatus[]
  /** 风险等级 */
  riskLevel?: MultiProjectDependencyRiskLevel
  /** 遍历深度上限 */
  maxDepth: number
  /** 节点数上限 */
  nodeLimit: number
  /** 边数上限 */
  edgeLimit: number
  /** 新鲜度阈值 */
  freshnessThreshold?: 'fresh' | 'stale' | 'all'
}

/** 图谱节点 */
export interface MultiProjectGraphNode {
  /** 节点 ID（端点哈希） */
  nodeId: string
  /** 端点摘要 */
  endpoint: MultiProjectEndpointSummary
  /** 节点标签 */
  label: string
  /** 是否已脱敏 */
  redacted: boolean
  /** 脱敏原因 */
  redactionReason: string | null
  /** 关联的依赖数量 */
  dependencyCount: number
  /** 风险摘要 */
  riskSummary: {
    critical: number
    high: number
    medium: number
    low: number
  }
  /** 安全的下钻引用（需二次授权） */
  drillDownRef: MultiProjectDrillDownRef | null
}

/** 图谱边 */
export interface MultiProjectGraphEdge {
  /** 边 ID（依赖 ID） */
  edgeId: number
  /** 源节点 ID */
  sourceNodeId: string
  /** 目标节点 ID */
  targetNodeId: string
  /** 依赖类别 */
  category: MultiProjectDependencyCategory
  /** 依赖类型 */
  type: MultiProjectDependencyType
  /** 状态 */
  status: MultiProjectDependencyStatus
  /** 风险等级 */
  riskLevel: MultiProjectDependencyRiskLevel
  /** 缓冲天数 */
  bufferDays: number
  /** 延迟天数 */
  lagDays: number
  /** 新鲜度 */
  freshness: 'fresh' | 'stale' | 'unknown'
  /** 安全的下钻引用 */
  drillDownRef: MultiProjectDrillDownRef
  /** 警告码 */
  warningCodes: MultiProjectWarningCode[]
}

/** 图谱响应 */
export interface MultiProjectGraphResponse {
  nodes: MultiProjectGraphNode[]
  edges: MultiProjectGraphEdge[]
  /** 可见节点数（不含脱敏占位） */
  visibleNodeCount: number
  /** 脱敏占位节点数 */
  redactedNodeCount: number
  /** 可见边数 */
  visibleEdgeCount: number
  /** 是否因深度/节点/边限制被截断 */
  truncated: boolean
  /** 截断原因 */
  truncationReason: string | null
  /** 聚合警告码 */
  warningCodes: MultiProjectWarningCode[]
  /** 新鲜度元数据 */
  freshnessMeta: {
    checkedAt: string
    staleCount: number
    freshCount: number
  }
}

// ---------------------------------------------------------------------------
// §7. 影响分析
// ---------------------------------------------------------------------------

/** 影响分析输入 */
export interface MultiProjectImpactAnalysisInput {
  /** 分析起点类型 */
  sourceType: 'endpoint' | 'hypothetical'
  /** 起点端点（sourceType === 'endpoint' 时） */
  sourceEndpoint?: MultiProjectEndpointRef
  /** 假设延迟天数（sourceType === 'hypothetical' 时） */
  hypotheticalDelayDays?: number
  /** 假设延迟描述 */
  hypotheticalDescription?: string

  /** 分析深度上限 */
  maxDepth: number
  /** 边数上限 */
  edgeLimit: number
  /** 是否包含项目内 task_dependencies 作为局部上下文 */
  includeLocalContext: boolean
  /** 项目范围限定 */
  projectIds?: number[]
}

/** 受影响端点 */
export interface MultiProjectAffectedEndpoint {
  /** 端点摘要 */
  endpoint: MultiProjectEndpointSummary
  /** 传播路径深度（从起点算起的跳数） */
  pathDepth: number
  /** 传播的延迟天数 */
  propagatedDelayDays: number
  /** 吸收的缓冲天数 */
  absorbedBufferDays: number
  /** 净延迟天数（propagated - absorbed，非负） */
  netDelayDays: number
  /** 影响类型 */
  impactType: 'direct' | 'indirect'
  /** 是否被缓冲完全吸收 */
  delayAbsorbed: boolean
  /** 是否被阻塞 */
  blocked: boolean
  /** 风险等级 */
  riskLevel: MultiProjectDependencyRiskLevel
  /** 是否脱敏 */
  redacted: boolean
  /** 阻塞链（起点到该端点的依赖 ID 列表） */
  blockingChain: number[]
  /** 证据引用 */
  evidenceRefs: MultiProjectEvidenceRef[]
}

/** 影响分析响应 */
export interface MultiProjectImpactAnalysisResponse {
  /** 分析起点 */
  source: {
    type: 'endpoint' | 'hypothetical'
    endpoint: MultiProjectEndpointSummary | null
    hypotheticalDelayDays: number | null
    description: string | null
  }
  /** 直接受影响端点 */
  directAffected: MultiProjectAffectedEndpoint[]
  /** 间接受影响端点 */
  indirectAffected: MultiProjectAffectedEndpoint[]
  /** 脱敏的受影响端点数量 */
  redactedAffectedCount: number
  /** 分析的边总数 */
  totalEdgesAnalyzed: number
  /** 是否因深度/边限制被截断 */
  truncated: boolean
  /** 置信度/数据质量警告 */
  warnings: MultiProjectWarningCode[]
  /** 分析时间戳 */
  analyzedAt: string
  /** 标记：仅分析/咨询，不自动应用 */
  advisoryOnly: true
  /** 低敏证据 */
  evidenceSummary: string | null
}

// ---------------------------------------------------------------------------
// §8. 建议
// ---------------------------------------------------------------------------

/** 建议类型 */
export const SUGGESTION_TYPES = ['rule', 'ai'] as const
export type MultiProjectSuggestionType = (typeof SUGGESTION_TYPES)[number]

/** 建议状态 */
export const SUGGESTION_STATUSES = ['pending', 'accepted', 'dismissed', 'expired'] as const
export type MultiProjectSuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

/** 建议置信度档位 */
export const SUGGESTION_CONFIDENCE_BANDS = ['high', 'medium', 'low'] as const
export type MultiProjectSuggestionConfidence = (typeof SUGGESTION_CONFIDENCE_BANDS)[number]

/** 规则建议来源 */
export const RULE_SUGGESTION_SOURCES = [
  'milestone_reference',
  'deliverable_label_match',
  'resource_contention',
  'stale_dependency',
  'missing_dependency',
] as const
export type RuleSuggestionSource = (typeof RULE_SUGGESTION_SOURCES)[number]

/** 依赖建议 */
export interface MultiProjectDependencySuggestion {
  /** 建议 ID */
  id: number
  /** 建议类型 */
  suggestionType: MultiProjectSuggestionType
  /** 建议来源（规则建议的具体来源） */
  ruleSource: RuleSuggestionSource | null
  /** 建议状态 */
  status: MultiProjectSuggestionStatus
  /** 置信度 */
  confidence: MultiProjectSuggestionConfidence
  /** 建议的 provider 端点 */
  suggestedProvider: MultiProjectEndpointSummary
  /** 建议的 consumer 端点 */
  suggestedConsumer: MultiProjectEndpointSummary
  /** 建议的依赖类别 */
  suggestedCategory: MultiProjectDependencyCategory
  /** 建议的依赖类型 */
  suggestedType: MultiProjectDependencyType
  /** 建议理由 */
  rationale: string
  /** 证据引用 */
  evidenceRefs: MultiProjectEvidenceRef[]
  /** 来源新鲜度 */
  sourceFreshness: 'fresh' | 'stale' | 'unknown'
  /** 警告码 */
  warningCodes: MultiProjectWarningCode[]
  /** 预览就绪的草稿输入（为 null 时不可直接预览） */
  previewDraftInput: MultiProjectPreviewDraftInput | null
  /** 脱敏状态 */
  redacted: boolean
  /** 标记：仅咨询 */
  advisoryOnly: true
  /** 标记：需要确认 */
  confirmationRequired: true
  /** 标记：未应用 */
  applied: false
  createdAt: string
  expiresAt: string | null
}

/** 预览就绪的草稿输入 */
export interface MultiProjectPreviewDraftInput {
  providerEndpoint: MultiProjectEndpointRef
  consumerEndpoint: MultiProjectEndpointRef
  category: MultiProjectDependencyCategory
  type: MultiProjectDependencyType
  lagDays: number
  strength: MultiProjectDependencyStrength
  bufferDays: number
  riskLevel: MultiProjectDependencyRiskLevel
  sourceMode: MultiProjectDependencySourceMode
  sourceSuggestionId: number | null
  evidenceRefs: MultiProjectEvidenceRef[]
}

/** 建议列表响应 */
export interface MultiProjectSuggestionListResponse {
  data: MultiProjectDependencySuggestion[]
  meta: PaginationMeta
}

// ---------------------------------------------------------------------------
// §9. 下钻引用
// ---------------------------------------------------------------------------

/** 安全的下钻引用（需二次授权） */
export interface MultiProjectDrillDownRef {
  /** 引用类型 */
  refType: 'dependency' | 'project' | 'milestone' | 'task' | 'evidence'
  /** 目标 ID */
  targetId: number
  /** 不透明授权令牌 */
  opaqueToken: string
  /** 引用过期时间 */
  expiresAt: string
}

/** 下钻请求 */
export interface MultiProjectDrillDownRequest {
  /** 不透明授权令牌 */
  opaqueToken: string
  /** 引用类型 */
  refType: string
  /** 目标 ID */
  targetId: number
}

/** 下钻响应 */
export interface MultiProjectDrillDownResponse {
  data: {
    refType: string
    targetId: number
    /** 目标详情（根据 refType 不同而不同） */
    detail: Record<string, unknown>
    /** 权限检查通过 */
    authorized: boolean
    /** 脱敏标记 */
    redacted: boolean
  }
}

// ---------------------------------------------------------------------------
// §10. 警告码
// ---------------------------------------------------------------------------

/** 多项目依赖警告码（封闭枚举） */
export const WARNING_CODES = [
  'ENDPOINT_REDACTED',
  'ENDPOINT_STALE',
  'ENDPOINT_DELETED',
  'ENDPOINT_HIDDEN',
  'PROJECT_RESTRICTED',
  'DIMENSION_REDACTED',
  'DEPENDENCY_STALE',
  'DEPENDENCY_CYCLE_BLOCKED',
  'DEPENDENCY_DUPLICATE_BLOCKED',
  'GRAPH_TRUNCATED_DEPTH',
  'GRAPH_TRUNCATED_NODES',
  'GRAPH_TRUNCATED_EDGES',
  'GRAPH_INTEGRITY_BLOCKED',
  'IMPACT_TRUNCATED',
  'IMPACT_HIDDEN_AFFECTED',
  'IMPACT_STALE_SOURCE',
  'PREVIEW_STALE',
  'PREVIEW_EXPIRED',
  'PERMISSION_CHANGED',
  'AI_UNAVAILABLE',
  'AI_MALFORMED_OUTPUT',
  'AI_MODEL_NOT_CONFIGURED',
  'LOCAL_CONTEXT_UNAVAILABLE',
  'FEATURE_FLAG_DISABLED',
  'EXTERNAL_REFERENCE_BOUNDS',
] as const
export type MultiProjectWarningCode = (typeof WARNING_CODES)[number]

// ---------------------------------------------------------------------------
// §11. 审计
// ---------------------------------------------------------------------------

/** 多项目依赖审计事件常量 */
export const MULTI_PROJECT_DEPENDENCY_AUDIT_EVENTS = {
  // 读取
  DEPENDENCY_LIST_READ: 'DEPENDENCY_LIST_READ',
  DEPENDENCY_DETAIL_READ: 'DEPENDENCY_DETAIL_READ',
  DEPENDENCY_GRAPH_READ: 'DEPENDENCY_GRAPH_READ',
  DEPENDENCY_IMPACT_READ: 'DEPENDENCY_IMPACT_READ',
  // 写入
  DEPENDENCY_PREVIEWED: 'DEPENDENCY_PREVIEWED',
  DEPENDENCY_CONFIRMED: 'DEPENDENCY_CONFIRMED',
  DEPENDENCY_UPDATED: 'DEPENDENCY_UPDATED',
  DEPENDENCY_ARCHIVED: 'DEPENDENCY_ARCHIVED',
  DEPENDENCY_RESTORED: 'DEPENDENCY_RESTORED',
  DEPENDENCY_CONFIRMATION_FAILED: 'DEPENDENCY_CONFIRMATION_FAILED',
  // 建议
  DEPENDENCY_SUGGESTION_READ: 'DEPENDENCY_SUGGESTION_READ',
  DEPENDENCY_SUGGESTION_AI_REQUESTED: 'DEPENDENCY_SUGGESTION_AI_REQUESTED',
  // 下钻
  DEPENDENCY_DRILL_DOWN: 'DEPENDENCY_DRILL_DOWN',
} as const
export type MultiProjectDependencyAuditEvent =
  (typeof MULTI_PROJECT_DEPENDENCY_AUDIT_EVENTS)[keyof typeof MULTI_PROJECT_DEPENDENCY_AUDIT_EVENTS]

/** 审计事件元数据构建器输入 */
export interface MultiProjectDependencyAuditMeta {
  actorId: number
  organizationId: number
  event: MultiProjectDependencyAuditEvent
  /** 可见项目 ID 列表的哈希 */
  visibleProjectIdsHash: string | null
  /** 依赖 ID */
  dependencyId: number | null
  /** 依赖 ID 哈希 */
  dependencyIdHash: string | null
  /** 查询哈希 */
  queryHash: string | null
  /** 确认哈希 */
  confirmationHash: string | null
  /** 幂等键哈希 */
  idempotencyKeyHash: string | null
  /** 新鲜度哈希 */
  freshnessHash: string | null
  /** 警告码 */
  warningCodes: MultiProjectWarningCode[]
  /** 操作 */
  operation: MultiProjectWriteOperation | null
  /** 状态转换 from → to */
  statusTransition: { from: string | null; to: string } | null
  /** 请求 ID */
  requestId: string | null
  /** 时间戳 */
  timestamp: string
}

// ---------------------------------------------------------------------------
// §12. 纯函数：查询规范化
// ---------------------------------------------------------------------------

/**
 * 规范化列表查询参数，补全默认值并剔除越界值。
 * 零运行时依赖。
 */
export function normalizeListQuery(
  raw: Partial<MultiProjectDependencyListQuery>,
): MultiProjectDependencyListQuery {
  const filters: MultiProjectDependencyFilters = {
    projectIds: raw.filters?.projectIds ?? undefined,
    endpointType: raw.filters?.endpointType ?? undefined,
    category: raw.filters?.category ?? undefined,
    type: raw.filters?.type ?? undefined,
    status: raw.filters?.status ?? undefined,
    riskLevel: raw.filters?.riskLevel ?? undefined,
    sourceMode: raw.filters?.sourceMode ?? undefined,
    freshness: raw.filters?.freshness ?? undefined,
    dateFrom: raw.filters?.dateFrom ?? undefined,
    dateTo: raw.filters?.dateTo ?? undefined,
    search: raw.filters?.search ?? undefined,
  }

  const page = Math.max(1, raw.page ?? 1)
  const perPage = Math.min(100, Math.max(1, raw.perPage ?? 20))

  return {
    filters,
    sort: raw.sort ?? '-createdAt',
    page,
    perPage,
  }
}

/**
 * 规范化图谱查询参数，强制深度/节点/边上限。
 */
export function normalizeGraphQuery(
  raw: Partial<MultiProjectGraphQuery>,
  defaults: { maxDepth: number; nodeLimit: number; edgeLimit: number },
): MultiProjectGraphQuery {
  return {
    projectIds: raw.projectIds ?? [],
    endpointType: raw.endpointType,
    category: raw.category,
    status: raw.status,
    riskLevel: raw.riskLevel,
    maxDepth: Math.min(defaults.maxDepth, raw.maxDepth ?? defaults.maxDepth),
    nodeLimit: Math.min(defaults.nodeLimit, raw.nodeLimit ?? defaults.nodeLimit),
    edgeLimit: Math.min(defaults.edgeLimit, raw.edgeLimit ?? defaults.edgeLimit),
    freshnessThreshold: raw.freshnessThreshold ?? 'all',
  }
}

// ---------------------------------------------------------------------------
// §13. 纯函数：稳定哈希
// ---------------------------------------------------------------------------

/**
 * 简单稳定哈希（FNV-1a 风格，用于预览/确认/查询哈希）。
 * 不依赖 crypto，确定性输出。
 */
export function stableHash(input: string): string {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 为依赖生成规范化键（用于重复检测）。
 */
export function buildDependencyKey(
  provider: MultiProjectEndpointRef,
  consumer: MultiProjectEndpointRef,
  type: MultiProjectDependencyType,
  category: MultiProjectDependencyCategory,
): string {
  const normalized = JSON.stringify({
    provider: endpointStableKey(provider),
    consumer: endpointStableKey(consumer),
    type,
    category,
  })
  return stableHash(normalized)
}

/** 端点稳定键（字段按字母序） */
function endpointStableKey(ref: MultiProjectEndpointRef): object {
  return {
    endpointType: ref.endpointType,
    externalKey: ref.externalKey,
    milestoneId: ref.milestoneId,
    projectId: ref.projectId,
    taskId: ref.taskId,
  }
}

// ---------------------------------------------------------------------------
// §14. 纯函数：生命周期转换校验
// ---------------------------------------------------------------------------

/** 允许的生命周期状态转换 */
const VALID_TRANSITIONS: Record<MultiProjectDependencyStatus, MultiProjectDependencyStatus[]> = {
  draft: ['active', 'archived'],
  active: ['at_risk', 'blocked', 'resolved', 'archived'],
  at_risk: ['active', 'blocked', 'resolved', 'archived'],
  blocked: ['active', 'at_risk', 'resolved', 'archived'],
  resolved: ['active', 'archived'],
  archived: ['active'], // 恢复
}

/**
 * 校验生命周期转换是否合法。
 */
export function isValidLifecycleTransition(
  from: MultiProjectDependencyStatus,
  to: MultiProjectDependencyStatus,
): boolean {
  const allowed = VALID_TRANSITIONS[from]
  return allowed !== undefined && allowed.includes(to)
}

// ---------------------------------------------------------------------------
// §15. 纯函数：警告码分类
// ---------------------------------------------------------------------------

/** 警告严重度 */
export type WarningSeverity = 'info' | 'warning' | 'blocker'

/**
 * 将警告码分类为严重度。
 */
export function classifyWarning(code: MultiProjectWarningCode): WarningSeverity {
  switch (code) {
    case 'DEPENDENCY_CYCLE_BLOCKED':
    case 'DEPENDENCY_DUPLICATE_BLOCKED':
    case 'GRAPH_INTEGRITY_BLOCKED':
    case 'PREVIEW_EXPIRED':
    case 'PERMISSION_CHANGED':
      return 'blocker'
    case 'ENDPOINT_REDACTED':
    case 'ENDPOINT_STALE':
    case 'ENDPOINT_DELETED':
    case 'ENDPOINT_HIDDEN':
    case 'PROJECT_RESTRICTED':
    case 'DIMENSION_REDACTED':
    case 'DEPENDENCY_STALE':
    case 'IMPACT_HIDDEN_AFFECTED':
    case 'IMPACT_STALE_SOURCE':
    case 'PREVIEW_STALE':
    case 'AI_MALFORMED_OUTPUT':
    case 'FEATURE_FLAG_DISABLED':
    case 'LOCAL_CONTEXT_UNAVAILABLE':
      return 'warning'
    case 'GRAPH_TRUNCATED_DEPTH':
    case 'GRAPH_TRUNCATED_NODES':
    case 'GRAPH_TRUNCATED_EDGES':
    case 'IMPACT_TRUNCATED':
    case 'AI_UNAVAILABLE':
    case 'AI_MODEL_NOT_CONFIGURED':
    case 'EXTERNAL_REFERENCE_BOUNDS':
      return 'info'
    default: {
      // 编译时穷举检查：如果新增了 WARNING_CODE 但未在此处理，TypeScript 会报错
      const _exhaustive: never = code
      void _exhaustive
      return 'info'
    }
  }
}

/**
 * 按严重度排序警告码（blocker > warning > info）。
 */
export function sortWarningsBySeverity(
  codes: MultiProjectWarningCode[],
): MultiProjectWarningCode[] {
  const order: Record<WarningSeverity, number> = { blocker: 0, warning: 1, info: 2 }
  return [...codes].sort((a, b) => order[classifyWarning(a)] - order[classifyWarning(b)])
}

// ---------------------------------------------------------------------------
// §16. 纯函数：脱敏标记构建
// ---------------------------------------------------------------------------

/**
 * 构建脱敏端点引用。
 */
export function buildRedactedEndpoint(
  reason: string,
  endpointType: MultiProjectEndpointType = 'project',
): MultiProjectEndpointRef {
  return {
    endpointType,
    projectId: null,
    projectName: null,
    milestoneId: null,
    milestoneName: null,
    taskId: null,
    taskName: null,
    externalLabel: null,
    externalKey: null,
    redacted: true,
    redactionReason: reason,
  }
}

/**
 * 构建脱敏端点摘要。
 */
export function buildRedactedEndpointSummary(
  reason: string,
  endpointType: MultiProjectEndpointType = 'project',
): MultiProjectEndpointSummary {
  return {
    endpointType,
    projectId: null,
    projectName: null,
    taskId: null,
    taskName: null,
    milestoneId: null,
    milestoneName: null,
    externalLabel: null,
    redacted: true,
    redactionReason: reason,
  }
}

// ---------------------------------------------------------------------------
// §17. 纯函数：端点键生成
// ---------------------------------------------------------------------------

/**
 * 生成端点唯一标识字符串（用于图谱节点 ID）。
 */
export function buildEndpointNodeId(
  ref: MultiProjectEndpointRef | MultiProjectEndpointSummary,
): string {
  const parts: string[] = [ref.endpointType]
  if (ref.projectId !== null && ref.projectId !== undefined) parts.push(`p${ref.projectId}`)
  if ('milestoneId' in ref && ref.milestoneId !== null && ref.milestoneId !== undefined)
    parts.push(`m${ref.milestoneId}`)
  if ('taskId' in ref && ref.taskId !== null && ref.taskId !== undefined)
    parts.push(`t${ref.taskId}`)
  if ('externalKey' in ref && ref.externalKey) parts.push(`x${ref.externalKey}`)
  return parts.join(':')
}
