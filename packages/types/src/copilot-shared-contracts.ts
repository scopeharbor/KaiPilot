// @aiproj/types — V3 Copilot 共享契约（前后端共享）
// v3-copilot-shared-contracts — Copilot 编排层唯一共享类型地基
//
// 依赖轻量约束：本模块是纯类型 + 确定性纯函数，只允许依赖同包 `triz-contradiction.js`
// 的 `deterministicHash`（同为纯 TS 零依赖）。禁止依赖 AdonisJS、React、数据库客户端、
// HTTP 客户端、外部网络、容器、provider 凭证或真实模型 SDK。
//
// 设计要点（泛化自 `ai-triz-assistant` 已验证形状，见同 change observation-and-inventory.md）：
// - 确定性优先：意图 → 上下文 → 路由决策 → 待确认动作，AI 只写可选叙述且可降级
// - 五档 scope（global/organization/project/portfolio/entity），每档声明必填归属与合格来源；
//   global 会话禁止携带 project/org 私有数据源
// - 六类顶层意图（query/analysis/generation/mutation/instruction/meta）；
//   变更类（mutation/instruction）与可持久化生成类意图必须落到 preview 动作
// - `requiresUserConfirmation` 为必填，由 destination × 操作类型派生（helper），
//   可导致持久化的 destination 上 preview/review-entry/handoff-candidate 恒为 true
// - 上下文包必须携带「本次合格知识层清单」而非裸布尔：清单含 L3（合成评测知识）即拒绝
// - 持久化只允许有界低敏摘要：prompt/system instructions/模型输出全文/tool args/
//   检索正文/原始载荷/token/secret/apiKey/Authorization 一律不得落库
// - 成本字段命名与统一账本 `gen_ai.*` 对齐字段一致（本 change 未落地前以 fixture 对照，
//   见 COPILOT_LEDGER_ALIGNED_FIELD_NAMES）
//
// 导出按关注点分组（3.12）：session / context / routing / action / assumption / cost / audit / helpers。

import { deterministicHash } from './triz-contradiction.js'

// ---------------------------------------------------------------------------
// 导出分组（P1：按关注点分组的导出结构声明）
// ---------------------------------------------------------------------------

export const COPILOT_CONTRACT_EXPORT_GROUPS = [
  'session',
  'context',
  'routing',
  'action',
  'assumption',
  'cost',
  'audit',
  'helpers',
] as const
export type CopilotContractExportGroup = (typeof COPILOT_CONTRACT_EXPORT_GROUPS)[number]

// ===========================================================================
// 枚举 — Scope（2.2）
// ===========================================================================

export const COPILOT_SCOPES = ['global', 'organization', 'project', 'portfolio', 'entity'] as const
export type CopilotScope = (typeof COPILOT_SCOPES)[number]

/** 每档 scope 的必填归属字段（attribution 上必须存在这些 key）。 */
export const COPILOT_SCOPE_REQUIRED_ATTRIBUTIONS: Record<CopilotScope, readonly string[]> = {
  global: [],
  organization: ['organizationId'],
  project: ['organizationId', 'projectId'],
  portfolio: ['organizationId', 'portfolioId'],
  entity: ['organizationId', 'entityType', 'entityId'],
}

export const COPILOT_ENTITY_TYPES = [
  'task',
  'risk',
  'milestone',
  'wbs_node',
  'document',
  'other',
] as const
export type CopilotEntityType = (typeof COPILOT_ENTITY_TYPES)[number]

// ===========================================================================
// 枚举 — 顶层意图分类（2.3）
// ===========================================================================

export const COPILOT_INTENT_CLASSES = [
  'query',
  'analysis',
  'generation',
  'mutation',
  'instruction',
  'meta',
] as const
export type CopilotIntentClass = (typeof COPILOT_INTENT_CLASSES)[number]

/** 变更类意图：必须解析为 preview/review-entry/handoff-candidate 且要求确认。 */
export const COPILOT_MUTATION_INTENT_CLASSES = ['mutation', 'instruction'] as const

export interface CopilotIntentClassRule {
  readonly persistenceReachable: boolean
  readonly requiresUserConfirmation: boolean
  readonly allowedActionTypes: readonly CopilotActionType[]
}

export const COPILOT_INTENT_CLASS_RULES: Record<CopilotIntentClass, CopilotIntentClassRule> = {
  query: {
    persistenceReachable: false,
    requiresUserConfirmation: false,
    allowedActionTypes: ['navigation', 'explanation', 'clarification'],
  },
  analysis: {
    persistenceReachable: false,
    requiresUserConfirmation: false,
    allowedActionTypes: ['navigation', 'explanation', 'clarification'],
  },
  generation: {
    persistenceReachable: true,
    requiresUserConfirmation: true,
    allowedActionTypes: ['explanation', 'preview', 'review-entry', 'handoff-candidate'],
  },
  mutation: {
    persistenceReachable: true,
    requiresUserConfirmation: true,
    allowedActionTypes: ['preview', 'review-entry', 'handoff-candidate'],
  },
  instruction: {
    persistenceReachable: true,
    requiresUserConfirmation: true,
    allowedActionTypes: ['preview', 'review-entry', 'handoff-candidate'],
  },
  meta: {
    persistenceReachable: false,
    requiresUserConfirmation: false,
    allowedActionTypes: ['navigation', 'explanation'],
  },
}

// ===========================================================================
// 枚举 — Destination 注册表（2.4 / 2.5）
// ===========================================================================

export const COPILOT_DESTINATIONS = [
  'project_creation',
  'ai_draft_generation',
  'draft_layer',
  'clarification_cards',
  'risk_suggestions',
  'prediction',
  'recommendation',
  'weekly_monthly_report',
  'health_diagnosis',
  'gantt_what_if',
  'triz_contradiction_matrix',
  'triz_technical_contradiction',
  'triz_physical_contradiction',
  'triz_ifr_visualization',
  'triz_function_analysis',
  'triz_resource_analyzer',
  'triz_evolution_trend',
  'triz_recommendation_rationale',
  'triz_innovation_workbench',
  'triz_decision_center',
  'pmo_priority',
  'knowledge_base',
  'skill_registry',
  'compiler',
  'ocr_document',
  'resource_forecasting',
  'advanced_search',
  'general_qa',
  'external_retrieval',
  'help_and_terminology',
] as const
export type CopilotDestination = (typeof COPILOT_DESTINATIONS)[number]

export interface CopilotDestinationMetadata {
  /** owner capability：已归档 capability 的稳定标识，或规划中的 owner（copilot-core / 计划 change）。 */
  readonly ownerCapability: string
  /** 路由到该 destination 所需的最低权限集合。 */
  readonly requiredPermissions: readonly string[]
  /** 路由到该 destination 是否可导致正式项目数据持久化（经 preview + 显式确认后）。 */
  readonly persistenceReachable: boolean
  readonly label: string
}

export const COPILOT_DESTINATION_REGISTRY: Record<CopilotDestination, CopilotDestinationMetadata> =
  {
    project_creation: {
      ownerCapability: 'ai-intent-and-clarification',
      requiredPermissions: ['ai:trigger', 'project:create'],
      persistenceReachable: true,
      label: '创建项目',
    },
    ai_draft_generation: {
      ownerCapability: 'ai-draft-generation',
      requiredPermissions: ['ai:trigger', 'project:update'],
      persistenceReachable: true,
      label: 'AI 草案生成',
    },
    draft_layer: {
      ownerCapability: 'ai-draft-layer-preview-diff-apply',
      requiredPermissions: ['project:update', 'ai:trigger'],
      persistenceReachable: true,
      label: '草案层 Preview/Diff/Apply',
    },
    clarification_cards: {
      ownerCapability: 'ai-intent-and-clarification',
      requiredPermissions: ['ai:trigger'],
      persistenceReachable: false,
      label: '澄清卡片',
    },
    risk_suggestions: {
      ownerCapability: 'risk-ai-suggestions',
      requiredPermissions: ['risk:read', 'risk:update'],
      persistenceReachable: true,
      label: '风险建议',
    },
    prediction: {
      ownerCapability: 'ai-risk-progress-prediction',
      requiredPermissions: ['project:read', 'ai:trigger'],
      persistenceReachable: false,
      label: '进度与风险预测',
    },
    recommendation: {
      ownerCapability: 'ai-smart-recommendations',
      requiredPermissions: ['project:read', 'ai:trigger'],
      persistenceReachable: false,
      label: '智能推荐',
    },
    weekly_monthly_report: {
      ownerCapability: 'ai-weekly-monthly-reports',
      requiredPermissions: ['project:read', 'ai:trigger'],
      persistenceReachable: true,
      label: '周报 / 月报',
    },
    health_diagnosis: {
      ownerCapability: 'ai-project-health-diagnosis',
      requiredPermissions: ['project:read'],
      persistenceReachable: false,
      label: '项目健康诊断',
    },
    gantt_what_if: {
      ownerCapability: 'gantt-what-if-local-session',
      requiredPermissions: ['project:read'],
      persistenceReachable: false,
      label: '甘特 What-if',
    },
    triz_contradiction_matrix: {
      ownerCapability: 'triz-contradiction-matrix-ui',
      requiredPermissions: ['triz:read'],
      persistenceReachable: false,
      label: '矛盾矩阵',
    },
    triz_technical_contradiction: {
      ownerCapability: 'triz-technical-contradiction-analyzer',
      requiredPermissions: ['triz:read', 'ai:trigger'],
      persistenceReachable: false,
      label: '技术矛盾分析器',
    },
    triz_physical_contradiction: {
      ownerCapability: 'triz-physical-contradiction-analyzer',
      requiredPermissions: ['triz:read', 'ai:trigger'],
      persistenceReachable: false,
      label: '物理矛盾分析器',
    },
    triz_ifr_visualization: {
      ownerCapability: 'triz-ifr-visualization',
      requiredPermissions: ['triz:read'],
      persistenceReachable: false,
      label: 'IFR 可视化',
    },
    triz_function_analysis: {
      ownerCapability: 'triz-function-analysis-diagram',
      requiredPermissions: ['triz:read'],
      persistenceReachable: false,
      label: '功能分析图',
    },
    triz_resource_analyzer: {
      ownerCapability: 'triz-resource-analyzer',
      requiredPermissions: ['triz:read'],
      persistenceReachable: false,
      label: '资源分析器',
    },
    triz_evolution_trend: {
      ownerCapability: 'triz-evolution-trend-analysis',
      requiredPermissions: ['triz:read', 'ai:trigger'],
      persistenceReachable: false,
      label: '进化趋势分析',
    },
    triz_recommendation_rationale: {
      ownerCapability: 'triz-recommendation-rationale-ui',
      requiredPermissions: ['triz:read'],
      persistenceReachable: false,
      label: '推荐理由',
    },
    triz_innovation_workbench: {
      ownerCapability: 'triz-innovation-workbench',
      requiredPermissions: ['triz:read', 'triz:update'],
      persistenceReachable: true,
      label: '创新工作台',
    },
    triz_decision_center: {
      ownerCapability: 'triz-decision-center',
      requiredPermissions: ['triz:read', 'triz:update'],
      persistenceReachable: true,
      label: '决策中心',
    },
    pmo_priority: {
      ownerCapability: 'pmo-ai-priority-recommendations',
      requiredPermissions: ['pmo:read', 'ai:trigger'],
      persistenceReachable: false,
      label: 'PMO 优先级',
    },
    knowledge_base: {
      ownerCapability: 'four-layer-knowledge-base',
      requiredPermissions: ['knowledge:read'],
      persistenceReachable: false,
      label: '四层知识底座',
    },
    skill_registry: {
      ownerCapability: 'compiler-skill-registry',
      requiredPermissions: ['skill:read'],
      persistenceReachable: false,
      label: 'Skill Registry',
    },
    compiler: {
      ownerCapability: 'project-compiler-foundation',
      requiredPermissions: ['compiler:read', 'compiler:run'],
      persistenceReachable: true,
      label: 'Compiler 编排',
    },
    ocr_document: {
      ownerCapability: 'ocr-document-upload-flow',
      requiredPermissions: ['ocr:read', 'ocr:update'],
      persistenceReachable: true,
      label: 'OCR 文档',
    },
    resource_forecasting: {
      ownerCapability: 'resource-demand-forecasting',
      requiredPermissions: ['project:read', 'ai:trigger'],
      persistenceReachable: false,
      label: '资源预测',
    },
    advanced_search: {
      ownerCapability: 'advanced-search',
      requiredPermissions: ['project:read', 'search:read'],
      persistenceReachable: false,
      label: '高级搜索',
    },
    general_qa: {
      ownerCapability: 'copilot-core',
      requiredPermissions: ['ai:trigger'],
      persistenceReachable: false,
      label: '通用问答',
    },
    external_retrieval: {
      ownerCapability: 'copilot-external-content-safety',
      requiredPermissions: ['ai:trigger', 'external:read'],
      persistenceReachable: false,
      label: '外部检索',
    },
    help_and_terminology: {
      ownerCapability: 'copilot-core',
      requiredPermissions: ['project:read'],
      persistenceReachable: false,
      label: '帮助与术语',
    },
  }

// ===========================================================================
// 枚举 — 动作类型（2.7）
// ===========================================================================

export const COPILOT_ACTION_TYPES = [
  'navigation',
  'explanation',
  'clarification',
  'preview',
  'review-entry',
  'handoff-candidate',
] as const
export type CopilotActionType = (typeof COPILOT_ACTION_TYPES)[number]

/** 可导致持久化的动作类型（preview / review-entry / handoff-candidate）。 */
export const COPILOT_PERSISTENCE_CAPABLE_ACTION_TYPES: readonly CopilotActionType[] = [
  'preview',
  'review-entry',
  'handoff-candidate',
]

// ===========================================================================
// 枚举 — 告警码（2.8）
// ===========================================================================

export const COPILOT_WARNING_CODES = [
  // 任务 2.8 必盖的九类
  'BUDGET_EXCEEDED',
  'PERMISSION_DENIED',
  'PROVIDER_ERROR',
  'INVALID_OUTPUT',
  'HALLUCINATION_DETECTED',
  'CONTEXT_TRUNCATED',
  'SOURCE_STALE',
  'EXTERNAL_CONTENT_REJECTED',
  'RETRIEVAL_ZERO_RESULTS',
  // 继承自 TRIZ 词汇（对等约束）
  'SOURCE_UNAVAILABLE',
  'SOURCE_PERMISSION_DENIED',
  'MISSING_INFORMATION',
  'AMBIGUOUS_INTENT',
  'DESTINATION_UNAVAILABLE',
  'AI_FALLBACK',
  'STALE_ACTION_BLOCKED',
  'FEATURE_FLAG_DISABLED',
  'CROSS_ORGANIZATION_BLOCKED',
  'INACCESSIBLE_TARGET',
  // v3-copilot-live-submission-channel：观察层降级（落账失败不阻断回合）
  'ROUTING_LEDGER_DEGRADED',
  // v3-ai-context-and-retrieval-observability：上下文观测写入失败降级
  'OBSERVATION_WRITE_FAILED',
  // v3-copilot-dlp-and-watermark-integration：DLP 检查相关告警
  'DLP_UNAVAILABLE',
  'DLP_REDACTED',
] as const
export type CopilotWarningCode = (typeof COPILOT_WARNING_CODES)[number]

// ===========================================================================
// 枚举 — 降级原因与置信度档位（2.9）
// ===========================================================================

export const COPILOT_DEGRADED_REASONS = [
  'budget_exceeded',
  'provider_error',
  'hallucination_detected',
  'permission_denied',
  'feature_flag_disabled',
  'invalid_output',
  'timeout',
  'context_truncated',
  'external_content_rejected',
  'dlp_blocked',
  'dlp_unavailable',
] as const
export type CopilotDegradedReason = (typeof COPILOT_DEGRADED_REASONS)[number]

export const COPILOT_CONFIDENCE_BANDS = ['high', 'medium', 'low', 'fallback'] as const
export type CopilotConfidenceBand = (typeof COPILOT_CONFIDENCE_BANDS)[number]

// ===========================================================================
// 枚举 — 来源类型 / 会话状态 / 消息角色 / 知识层（2.10）
// ===========================================================================

export const COPILOT_SOURCE_KINDS = [
  // 项目域
  'project_facts',
  'task',
  'wbs_node',
  'dependency',
  'resource_assignment',
  'risk',
  'milestone',
  'schedule',
  'scope_document',
  'project_field',
  'document',
  // AI 中间产物
  'draft_layer_change',
  'clarification_card',
  'risk_suggestion',
  'prediction_snapshot',
  'recommendation',
  'weekly_report',
  'monthly_report',
  'health_diagnosis',
  'gantt_whatif_session',
  // TRIZ / 组合 / 底座
  'triz_contradiction',
  'triz_analysis',
  'triz_workbench_scheme',
  'triz_decision_log',
  'pmo_portfolio',
  'knowledge_summary',
  'skill_summary',
  'compiler_artifact',
  'ocr_document',
  'resource_forecast',
  'search_result',
  'external_content',
  'help_article',
  'general_knowledge',
] as const
export type CopilotSourceKind = (typeof COPILOT_SOURCE_KINDS)[number]

export const COPILOT_SESSION_STATUSES = [
  'active',
  'completed',
  'completed_with_warnings',
  'failed',
  'archived',
] as const
export type CopilotSessionStatus = (typeof COPILOT_SESSION_STATUSES)[number]

export const COPILOT_MESSAGE_ROLES = ['user', 'assistant', 'system'] as const
export type CopilotMessageRole = (typeof COPILOT_MESSAGE_ROLES)[number]

/**
 * 四层知识底座 L1 规范 / L2 观察 / L3 合成（评测专用，禁止进入生产检索）/ L4 现实。
 * 与 `four-layer-knowledge-base` 的 KNOWLEDGE_LAYERS 对齐（本模块不导入该模块以保持依赖轻量）。
 */
export const COPILOT_KNOWLEDGE_TIERS = ['L1', 'L2', 'L3', 'L4'] as const
export type CopilotKnowledgeTier = (typeof COPILOT_KNOWLEDGE_TIERS)[number]

// ===========================================================================
// 枚举 — 持久化分类词汇（2.11）
// ===========================================================================

export const COPILOT_PERSISTENCE_CLASSES = ['persistable', 'transport-only'] as const
export type CopilotPersistenceClass = (typeof COPILOT_PERSISTENCE_CLASSES)[number]

/** 允许落库的低敏字段名（allowlist；未知字段一律 transport-only，安全默认）。 */
export const COPILOT_PERSISTABLE_FIELD_NAMES: readonly string[] = [
  // 标识符
  'sessionId',
  'messageId',
  'routeId',
  'actionId',
  'assumptionId',
  'organizationId',
  'projectId',
  'portfolioId',
  'entityType',
  'entityId',
  'userId',
  // 状态 / 摘要
  'status',
  'archived',
  'intentClass',
  'intentSummary',
  'messageSummary',
  'summary',
  'lowSensitivitySummary',
  'title',
  // 路由决策
  'destination',
  'confidence',
  'order',
  'reason',
  'parameterHints',
  // 动作元数据
  'actionType',
  'label',
  'description',
  'requiredPermissions',
  'requiresUserConfirmation',
  'isStale',
  'staleReason',
  'idempotencyKey',
  'handoffInput',
  // 来源引用与 hash
  'sourceRefs',
  'sourceHashes',
  'sourceRef',
  'sourceHash',
  'sourceKind',
  'sourceRefKinds',
  'sourceHashPrefixes',
  // 告警 / 降级
  'warnings',
  'warningCodes',
  'isFallback',
  'fallback',
  'fallbackState',
  'degradedReason',
  // 假设
  'statement',
  'source',
  'usedDefault',
  'needsConfirmation',
  'editable',
  // 澄清
  'question',
  'purpose',
  'quickOptions',
  // 成本（字段名与统一账本对齐，见 3.10）
  'conversationId',
  'operationName',
  'providerName',
  'requestModel',
  'responseModel',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheCreationTokens',
  'reasoningTokens',
  'timeToFirstChunkMs',
  'estimatedCost',
  'currency',
  'costStatus',
  'pricingSnapshotRef',
  'inputHash',
  'outputHash',
  'capability',
  'surface',
  'realAdapterFlag',
  'fallbackFlag',
  // 审计 / 时间戳
  'routeIds',
  'actionIds',
  'validateStatus',
  'validationStatus',
  'reviewRequired',
  'reviewStatus',
  'createdAt',
  'updatedAt',
  'lastUpdatedAt',
  'provider',
  'model',
]

// ===========================================================================
// 结构类型 — Session / Message（3.1 / 3.2）
// ===========================================================================

export interface CopilotSessionAttribution {
  readonly organizationId?: string
  readonly projectId?: string
  readonly portfolioId?: string
  readonly entityType?: CopilotEntityType
  readonly entityId?: string
}

export interface CopilotSession {
  readonly sessionId: string
  readonly scope: CopilotScope
  readonly attribution: CopilotSessionAttribution
  readonly status: CopilotSessionStatus
  readonly title: string
  readonly archived: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** 消息只携带有界低敏摘要与 source refs；禁止全文字段（README §3.2）。 */
export interface CopilotMessage {
  readonly messageId: string
  readonly sessionId: string
  readonly role: CopilotMessageRole
  readonly messageSummary: string
  readonly sourceRefs: readonly string[]
  readonly createdAt: string
}

// ===========================================================================
// 结构类型 — 上下文包（3.3 / 3.4）
// ===========================================================================

export interface CopilotSourceFreshness {
  readonly lastUpdatedAt: string
  readonly isStale: boolean
  readonly staleReason?: string
}

export interface CopilotSourceSummary {
  readonly sourceKind: CopilotSourceKind
  readonly sourceRef: string
  readonly sourceHash: string
  readonly lowSensitivitySummary: string
  readonly freshness: CopilotSourceFreshness
  readonly routeHints: readonly CopilotDestination[]
  readonly warnings: readonly CopilotWarningCode[]
}

export interface CopilotTruncationMarker {
  readonly truncated: boolean
  /** 超预算被省略的来源条数。 */
  readonly omittedSourceCount: number
  /** 超预算被省略的证据正文字数（正文不落包，只计数）。 */
  readonly omittedEvidenceCount: number
  readonly budgetBytes: number
  readonly warning?: string
}

export interface CopilotBudgetMetadata {
  readonly contextBytesUsed: number
  readonly contextBytesLimit: number
  readonly evidenceBytesUsed: number
  readonly evidenceBytesLimit: number
}

export interface CopilotContextPacket {
  readonly contextHash: string
  readonly scope: CopilotScope
  readonly sources: readonly CopilotSourceSummary[]
  /**
   * 本次上下文包合格的知识层清单（非裸布尔，命名排除依据）。
   * 含 L3（合成评测知识）→ validateCopilotContextPacket 拒绝。
   */
  readonly eligibleKnowledgeTiers: readonly CopilotKnowledgeTier[]
  readonly truncation: CopilotTruncationMarker
  readonly budget: CopilotBudgetMetadata
  readonly warnings: readonly CopilotWarningCode[]
  readonly sourceOrdering: readonly CopilotSourceKind[]
}

// ===========================================================================
// 结构类型 — 路由决策 / 推荐动作 / 导航引用 / 澄清提示（3.6 / 3.7 / 3.8）
// ===========================================================================

export interface CopilotRouteDecision {
  readonly routeId: string
  readonly destination: CopilotDestination
  readonly confidence: CopilotConfidenceBand
  readonly order: number
  readonly reason?: string
  readonly sourceRefs: readonly string[]
  readonly sourceHashes: readonly string[]
  readonly warnings: readonly CopilotWarningCode[]
  readonly parameterHints?: readonly string[]
}

export interface CopilotNavigationRef {
  readonly path: string
  readonly label: string
  readonly params?: Record<string, string>
}

export interface CopilotRecommendedAction {
  readonly actionId: string
  readonly destination: CopilotDestination
  readonly actionType: CopilotActionType
  readonly intentClass: CopilotIntentClass
  readonly label: string
  readonly description: string
  readonly sourceRefs: readonly string[]
  readonly sourceHashes: readonly string[]
  readonly requiredPermissions: readonly string[]
  /** 必填：由 deriveRequiresUserConfirmation 派生，调用方不可省略。 */
  readonly requiresUserConfirmation: boolean
  readonly isStale: boolean
  readonly staleReason?: string
  readonly idempotencyKey: string
  readonly lowSensitivitySummary: string
  readonly navigationRef?: CopilotNavigationRef
  readonly handoffInput?: Record<string, unknown>
}

export interface CopilotClarificationPrompt {
  readonly promptId: string
  readonly question: string
  readonly purpose: string
  readonly quickOptions?: readonly string[]
  readonly relatedIntentClass?: CopilotIntentClass
  readonly sourceRefs: readonly string[]
}

// ===========================================================================
// 结构类型 — 假设条目（3.9）
// ===========================================================================

export interface CopilotAssumptionEntry {
  readonly assumptionId: string
  readonly statement: string
  /** 来源：'default'（默认值替换）/ 'user-input' / 'derived'，与 ai_intent/catalog defaultMarker.source 对齐。 */
  readonly source: string
  /** 0–100 的置信度值（0–1 的旧值由调用方先行归一）。 */
  readonly confidence: number
  /** 用户未提供输入时是否使用了默认值。 */
  readonly usedDefault: boolean
  readonly needsConfirmation: boolean
  /** 用户可否逐条编辑本假设。 */
  readonly editable: boolean
}

// ===========================================================================
// 结构类型 — 成本摘要（3.10，字段名与统一账本 gen_ai.* 对齐）
// ===========================================================================

/**
 * 统一账本 gen_ai.* 对齐字段名集合（与 `unified-ai-invocation-ledger` 的
 * `LEDGER_STANDARD_ATTRIBUTE_KEYS` 对齐子集；落库用裸名，语义上对应 OTel GenAI semconv）。
 * 本模块不 import 账本模块（其依赖 node:crypto，会破坏前端可打包性），
 * 以 fixture 对照 + 测试断言集合相等（见 copilot-shared-contracts.test.ts 6.5）。
 */
export const COPILOT_LEDGER_ALIGNED_FIELD_NAMES = [
  'operation_name',
  'provider_name',
  'request_model',
  'response_model',
  'conversation_id',
  'time_to_first_chunk_ms',
  'usage_input_tokens',
  'usage_output_tokens',
  'usage_cache_read_input_tokens',
  'usage_cache_creation_input_tokens',
  'usage_reasoning_output_tokens',
] as const

/**
 * 本地扩展维度命名空间（与账本 `LEDGER_LOCAL_ATTRIBUTE_PREFIX`='aiproj_' 一致；
 * 本地维度不得伪装成 gen_ai.* 标准键）。
 */
export const COPILOT_COST_LOCAL_EXTENSION_NS = 'aiproj_'

export interface CopilotCostSummary {
  // ── gen_ai.* 对齐字段（ledger fixture 名称来源）──
  readonly conversationId?: string
  readonly operationName?: string
  readonly providerName: string
  readonly requestModel: string
  /** 与 requestModel 分离：provider 上报的更具体模型标识（静默版本漂移可检测）。 */
  readonly responseModel?: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheCreationTokens: number
  readonly reasoningTokens: number
  readonly timeToFirstChunkMs?: number
  // ── 本地扩展维度（copilot.local.*，不得用 gen_ai.* 键）──
  readonly capability?: string
  readonly surface?: string
  readonly realAdapterFlag: boolean
  readonly fallbackFlag: boolean
  readonly estimatedCost?: number
  readonly currency?: string
  readonly costStatus?: string
  readonly pricingSnapshotRef?: string
  readonly inputHash?: string
  readonly outputHash?: string
}

/** 成本字段的 ledger 属性名映射：对齐字段 → 账本标准裸名（对应 gen_ai.* 语义），本地维度 → aiproj_*. */
export function copilotCostSummaryLedgerAttributeName(field: keyof CopilotCostSummary): string {
  switch (field) {
    case 'operationName':
      return 'operation_name'
    case 'providerName':
      return 'provider_name'
    case 'requestModel':
      return 'request_model'
    case 'responseModel':
      return 'response_model'
    case 'conversationId':
      return 'conversation_id'
    case 'timeToFirstChunkMs':
      return 'time_to_first_chunk_ms'
    case 'inputTokens':
      return 'usage_input_tokens'
    case 'outputTokens':
      return 'usage_output_tokens'
    case 'cacheReadTokens':
      return 'usage_cache_read_input_tokens'
    case 'cacheCreationTokens':
      return 'usage_cache_creation_input_tokens'
    case 'reasoningTokens':
      return 'usage_reasoning_output_tokens'
    case 'capability':
      return 'aiproj_capability'
    case 'surface':
      return 'aiproj_surface'
    case 'realAdapterFlag':
      return 'aiproj_using_real_adapter'
    case 'fallbackFlag':
      return 'aiproj_fallback_used'
    case 'estimatedCost':
      return 'aiproj_estimated_cost'
    case 'currency':
      return 'aiproj_currency'
    case 'costStatus':
      return 'aiproj_cost_status'
    case 'pricingSnapshotRef':
      return 'aiproj_pricing_snapshot_id'
    case 'inputHash':
      return 'aiproj_input_hash'
    case 'outputHash':
      return 'aiproj_output_hash'
    default:
      return `${COPILOT_COST_LOCAL_EXTENSION_NS}${field}`
  }
}

/** 对齐字段名集合（测试/后续 ledger 对比用）。 */
export function copilotCostSummaryAlignedFieldNames(): readonly string[] {
  return [...COPILOT_LEDGER_ALIGNED_FIELD_NAMES]
}

// ===========================================================================
// 结构类型 — 审计引用 / fallback 元数据 / 叙述 / 响应（3.11）
// ===========================================================================

export interface CopilotAuditRefs {
  readonly sessionId?: string
  readonly routeIds: readonly string[]
  readonly actionIds: readonly string[]
  readonly sourceRefKinds: readonly CopilotSourceKind[]
  readonly sourceHashPrefixes: readonly string[]
  readonly warningCodes: readonly CopilotWarningCode[]
  readonly fallbackState: boolean
}

export interface CopilotFallbackMetadata {
  readonly isFallback: boolean
  readonly degradedReason?: CopilotDegradedReason
}

export interface CopilotNarration {
  readonly text: string
  readonly isFallback: boolean
  readonly degradedReason?: CopilotDegradedReason
  readonly provider?: string
  readonly model?: string
  readonly costSummary?: CopilotCostSummary
  readonly validationStatus: 'valid' | 'hallucination_rejected' | 'not_validated'
}

export interface CopilotResponse {
  readonly sessionId?: string
  readonly messageId: string
  readonly intentClass: CopilotIntentClass
  readonly routeDecisions: readonly CopilotRouteDecision[]
  readonly recommendedActions: readonly CopilotRecommendedAction[]
  readonly clarificationPrompts: readonly CopilotClarificationPrompt[]
  readonly narration?: CopilotNarration
  readonly warnings: readonly CopilotWarningCode[]
  readonly fallback: boolean
  readonly degradedReason?: CopilotDegradedReason
  readonly costSummary?: CopilotCostSummary
  readonly reviewRequired: boolean
  readonly auditRefs: CopilotAuditRefs
  readonly createdAt: string
}

// ===========================================================================
// Helpers — 稳定 ID 生成（4.1）
// ===========================================================================

const SESSION_PREFIX = 'cps'
const MSG_PREFIX = 'cpm'
const ROUTE_PREFIX = 'cpr'
const ACTION_PREFIX = 'cpa'
const PROMPT_PREFIX = 'cpp'
const ASSUMPTION_PREFIX = 'cpas'

function generatePrefixedId(prefix: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${ts}_${rand}`
}

export function generateCopilotSessionId(): string {
  return generatePrefixedId(SESSION_PREFIX)
}

export function generateCopilotMessageId(): string {
  return generatePrefixedId(MSG_PREFIX)
}

export function generateCopilotRouteDecisionId(): string {
  return generatePrefixedId(ROUTE_PREFIX)
}

export function generateCopilotActionId(): string {
  return generatePrefixedId(ACTION_PREFIX)
}

export function generateCopilotPromptId(): string {
  return generatePrefixedId(PROMPT_PREFIX)
}

export function generateCopilotAssumptionId(): string {
  return generatePrefixedId(ASSUMPTION_PREFIX)
}

// ===========================================================================
// Helpers — 稳定序列化 / 排序键 / hash（4.2）
// ===========================================================================

/**
 * 稳定序列化：递归对象键排序后 JSON 化。
 * 保证键顺序不同但内容等价的输入产出同一签名（spec Req1 场景）。
 * 命名带 copilot 前缀：通用名 stableSerialize 已存在于 performance-scale-fixtures。
 */
export function copilotStableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map((v) => copilotStableSerialize(v)).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const parts = keys.map((k) => `${k}:${copilotStableSerialize(record[k])}`)
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

export function computeCopilotSourceHash(summary: string, kind: string): string {
  return deterministicHash(`${kind}:${summary}`)
}

export function computeCopilotContextPacketHash(sources: readonly CopilotSourceSummary[]): string {
  const hashes = sources.map((s) => s.sourceHash).sort()
  return deterministicHash(hashes.join(','))
}

export function computeCopilotIdempotencyKey(
  input: string,
  sourceHashes: readonly string[],
  actorId: number,
): string {
  const sorted = [...sourceHashes].sort()
  const payload = `${input}|${sorted.join(',')}|${actorId}`
  return deterministicHash(payload)
}

export function computeCopilotOutputHash(params: {
  sessionId?: string
  intentClass: CopilotIntentClass
  routeIds: readonly string[]
  actionIds: readonly string[]
}): string {
  const routeIds = [...params.routeIds].sort().join(',')
  const actionIds = [...params.actionIds].sort().join(',')
  const payload = `${params.sessionId ?? ''}|${params.intentClass}|${routeIds}|${actionIds}`
  return deterministicHash(payload)
}

const COPILOT_CONFIDENCE_RANK: Record<CopilotConfidenceBand, number> = {
  high: 0,
  medium: 1,
  low: 2,
  fallback: 3,
}

export function computeCopilotStableSortKey(
  destination: CopilotDestination,
  confidence: CopilotConfidenceBand,
  order: number,
): string {
  const rank = COPILOT_CONFIDENCE_RANK[confidence]
  return `${String(rank).padStart(2, '0')}_${String(order).padStart(4, '0')}_${destination}`
}

export function compareCopilotRouteDecisions(
  a: CopilotRouteDecision,
  b: CopilotRouteDecision,
): number {
  const sortA = computeCopilotStableSortKey(a.destination, a.confidence, a.order)
  const sortB = computeCopilotStableSortKey(b.destination, b.confidence, b.order)
  return sortA.localeCompare(sortB)
}

// ===========================================================================
// Helpers — 意图分类规则（2.3 派生）
// ===========================================================================

export function copilotIntentClassAllowsActionType(
  intentClass: CopilotIntentClass,
  actionType: CopilotActionType,
): boolean {
  return COPILOT_INTENT_CLASS_RULES[intentClass].allowedActionTypes.includes(actionType)
}

export function copilotIntentClassRequiresConfirmation(intentClass: CopilotIntentClass): boolean {
  return COPILOT_INTENT_CLASS_RULES[intentClass].requiresUserConfirmation
}

// ===========================================================================
// Helpers — requiresUserConfirmation 派生（4.4）
// ===========================================================================

/**
 * 由 destination × 操作类型派生确认要求：
 * - navigation / explanation / clarification 永不需要确认（不产生持久化）；
 * - preview / review-entry / handoff-candidate 在 destination 可导致持久化时为 true。
 */
export function deriveRequiresUserConfirmation(
  destination: CopilotDestination,
  actionType: CopilotActionType,
): boolean {
  if (
    actionType === 'navigation' ||
    actionType === 'explanation' ||
    actionType === 'clarification'
  ) {
    return false
  }
  return COPILOT_DESTINATION_REGISTRY[destination].persistenceReachable
}

// ===========================================================================
// Helpers — scope 与合格来源映射（4.6）
// ===========================================================================

export const COPILOT_SCOPE_ELIGIBLE_SOURCE_KINDS: Record<
  CopilotScope,
  readonly CopilotSourceKind[]
> = {
  // 通用会话只允许无项目/组织私有数据的一般知识、帮助与外部内容
  global: ['general_knowledge', 'help_article', 'external_content'],
  organization: [
    'general_knowledge',
    'help_article',
    'external_content',
    'pmo_portfolio',
    'resource_forecast',
  ],
  project: [
    'project_facts',
    'task',
    'wbs_node',
    'dependency',
    'resource_assignment',
    'risk',
    'milestone',
    'schedule',
    'scope_document',
    'project_field',
    'draft_layer_change',
    'clarification_card',
    'risk_suggestion',
    'prediction_snapshot',
    'recommendation',
    'weekly_report',
    'monthly_report',
    'health_diagnosis',
    'gantt_whatif_session',
    'triz_contradiction',
    'triz_analysis',
    'triz_workbench_scheme',
    'triz_decision_log',
    'knowledge_summary',
    'skill_summary',
    'compiler_artifact',
    'ocr_document',
    'resource_forecast',
    'search_result',
    'general_knowledge',
    'help_article',
  ],
  portfolio: [
    'pmo_portfolio',
    'resource_forecast',
    'general_knowledge',
    'help_article',
    'external_content',
  ],
  // entity 会话只绑定该实体与授权父级（父级来源由上层授权判定注入）
  entity: [
    'task',
    'risk',
    'milestone',
    'wbs_node',
    'document',
    'general_knowledge',
    'help_article',
  ],
}

export function copilotScopeAcceptsSourceKind(
  scope: CopilotScope,
  sourceKind: CopilotSourceKind,
): boolean {
  return COPILOT_SCOPE_ELIGIBLE_SOURCE_KINDS[scope].includes(sourceKind)
}

export function validateCopilotScopeSources(
  scope: CopilotScope,
  sourceKinds: readonly CopilotSourceKind[],
): { valid: boolean; issues: string[] } {
  const issues: string[] = []
  for (const kind of sourceKinds) {
    if (!copilotScopeAcceptsSourceKind(scope, kind)) {
      issues.push(`scope ${scope} 不接受来源 ${kind}`)
    }
  }
  return { valid: issues.length === 0, issues }
}

/**
 * 验证 portfolio scope 的必填归属（组织 + 组合）。
 * 缺失任一归属时拒绝，不降级为其他 scope。
 */
export function validatePortfolioAttribution(attribution: Readonly<Record<string, unknown>>): {
  valid: boolean
  missing: string[]
} {
  const required = COPILOT_SCOPE_REQUIRED_ATTRIBUTIONS.portfolio
  const missing = required.filter((key) => !attribution[key])
  return { valid: missing.length === 0, missing }
}

// ===========================================================================
// Helpers — 置信度档位映射（4.8）
// ===========================================================================

export function mapCopilotConfidenceToBand(value?: number): CopilotConfidenceBand {
  if (value === undefined || value === null || Number.isNaN(value)) return 'fallback'
  if (value >= 80) return 'high'
  if (value >= 50) return 'medium'
  return 'low'
}

// ===========================================================================
// Helpers — 状态归一化（4.9，未知值不得被当作成功/已授权）
// ===========================================================================

export function normalizeCopilotSessionStatus(value: string): {
  status: CopilotSessionStatus
  unknown: boolean
} {
  if (isCopilotSessionStatus(value)) return { status: value, unknown: false }
  // 未知值归一为 failed（非成功态），并显式标记 unknown 供调用方审计
  return { status: 'failed', unknown: true }
}

export function normalizeCopilotMessageRole(value: string): {
  role: CopilotMessageRole
  unknown: boolean
} {
  if (isCopilotMessageRole(value)) return { role: value, unknown: false }
  return { role: 'system', unknown: true }
}

// ===========================================================================
// Helpers — 低敏 sanitizer（4.10）
// ===========================================================================

// 正文类敏感字段（prompt/systemInstructions/modelOutput/completion/messages/tool 参数与结果/检索正文/原始载荷）
const COPILOT_CONTENT_SENSITIVE_FIELD_PATTERNS = [
  /prompt/i,
  /systemInstructions/i,
  /systemPrompt/i,
  /modelOutput/i,
  /completion/i,
  // 只禁字面名为 messages 的消息内容字段；messageSummary/messageId 是可持久化低敏摘要/标识
  /^messages$/i,
  /toolArguments/i,
  /toolResults/i,
  /retrievalBody/i,
  /rawEvidence/i,
  /rawBody/i,
  /rawPayload/i,
  /fullText/i,
]

// 凭据类敏感字段（secret/token/apiKey/authorization/password/credential/私钥/证书/隐藏计数与名称）。
// token 匹配收紧：只命中认证类 token（accessToken/refreshToken/idToken/bearerToken/authToken/裸 token/tokens），
// 不命中 token 用量计数字段（inputTokens/outputTokens/cacheReadTokens/...，属可持久化的成本摘要）。
const COPILOT_CREDENTIAL_SENSITIVE_FIELD_PATTERNS = [
  /secret/i,
  /authorization/i,
  /authHeader/i,
  /apiKey/i,
  /password/i,
  /credential/i,
  /privateKey/i,
  /certificate/i,
  /^token$/i,
  /^tokens$/i,
  /accessToken/i,
  /refreshToken/i,
  /idToken/i,
  /bearerToken/i,
  /authToken/i,
  /hiddenCount/i,
  /hiddenId/i,
  /inaccessibleTitle/i,
  /sensitivePath/i,
]

const COPILOT_SENSITIVE_PATH_PATTERNS = [
  /^\/etc\//,
  /^C:\\Windows\\/i,
  /^\/home\/[^/]+\/\.(ssh|gnupg|aws|azure|config\/gcloud)/,
  /\\(\.ssh|\.gnupg|\.aws|\.azure|AppData)\\/i,
  /\/\.env$/,
  /\\\.env$/,
]

export function isCopilotFieldSensitive(fieldName: string): boolean {
  return (
    COPILOT_CONTENT_SENSITIVE_FIELD_PATTERNS.some((p) => p.test(fieldName)) ||
    COPILOT_CREDENTIAL_SENSITIVE_FIELD_PATTERNS.some((p) => p.test(fieldName))
  )
}

export function isCopilotPathSensitive(filePath: string): boolean {
  return COPILOT_SENSITIVE_PATH_PATTERNS.some((p) => p.test(filePath))
}

export function redactCopilotSensitiveFields<T extends Record<string, unknown>>(
  obj: T,
  fieldNames: readonly string[],
): { redacted: T; rejectedFields: string[] } {
  const rejected: string[] = []
  const redacted = { ...obj } as Record<string, unknown>
  for (const key of fieldNames) {
    if (isCopilotFieldSensitive(key)) {
      delete redacted[key]
      rejected.push(key)
    }
  }
  return { redacted: redacted as T, rejectedFields: rejected }
}

export function rejectCopilotSensitivePayload(fields: Record<string, unknown>): {
  safe: boolean
  rejectedKeys: string[]
} {
  const rejectedKeys: string[] = []
  for (const key of Object.keys(fields)) {
    if (isCopilotFieldSensitive(key)) {
      rejectedKeys.push(key)
    }
    const val = fields[key]
    if (typeof val === 'string' && isCopilotPathSensitive(val)) {
      rejectedKeys.push(key)
    }
  }
  return { safe: rejectedKeys.length === 0, rejectedKeys }
}

export function buildCopilotTruncationWarning(
  totalSources: number,
  includedSources: number,
  budgetBytes: number,
): string {
  return `上下文截断：共 ${totalSources} 个来源，仅纳入 ${includedSources} 个（预算 ${budgetBytes} 字节）`
}

// ===========================================================================
// Helpers — source hash 陈旧检测
// ===========================================================================

export function isCopilotSourceHashStale(
  currentHash: string,
  storedHashes: readonly string[],
): boolean {
  return !storedHashes.includes(currentHash)
}

export function detectStaleCopilotActions(
  actions: readonly CopilotRecommendedAction[],
  currentHashesByRef: ReadonlyMap<string, string>,
): CopilotRecommendedAction[] {
  return actions.map((action) => {
    const currentHashes = [...currentHashesByRef.values()]
    const isStale = action.sourceHashes.some((hash) => !currentHashes.includes(hash))
    return {
      ...action,
      isStale,
      staleReason: isStale ? '来源数据已变更，建议刷新后重新审查' : undefined,
    }
  })
}

// ===========================================================================
// Helpers — 持久化分类（4.12）
// ===========================================================================

export function classifyCopilotPersistence(
  fieldName: string,
  value?: unknown,
): { classification: CopilotPersistenceClass; reason: string } {
  if (isCopilotFieldSensitive(fieldName)) {
    return { classification: 'transport-only', reason: `字段名命中敏感模式：${fieldName}` }
  }
  if (typeof value === 'string' && isCopilotPathSensitive(value)) {
    return { classification: 'transport-only', reason: '值命中敏感路径模式' }
  }
  if (COPILOT_PERSISTABLE_FIELD_NAMES.includes(fieldName)) {
    return { classification: 'persistable', reason: 'allowlist 低敏字段' }
  }
  return { classification: 'transport-only', reason: '未知字段默认不落库' }
}

// ===========================================================================
// 验证函数 — 上下文包（含 L3 排除，3.5）
// ===========================================================================

export function validateCopilotContextPacket(packet: CopilotContextPacket): {
  valid: boolean
  issues: string[]
  warnings: string[]
} {
  const issues: string[] = []
  const warnings: string[] = []

  if (packet.eligibleKnowledgeTiers.includes('L3')) {
    issues.push('合格知识层清单包含 L3 合成评测知识，禁止进入生产上下文包')
  }

  if (packet.truncation.truncated) {
    if (packet.truncation.omittedSourceCount <= 0 && packet.truncation.omittedEvidenceCount <= 0) {
      issues.push('截断标记为 true 但省略计数为零，截断信息被静默丢弃')
    }
    warnings.push('上下文数据已截断')
  } else if (
    packet.truncation.omittedSourceCount > 0 ||
    packet.truncation.omittedEvidenceCount > 0
  ) {
    issues.push('截断标记为 false 但存在省略计数')
  }

  if (packet.sources.length === 0) {
    warnings.push('无可用来源数据')
  }

  const scopeCheck = validateCopilotScopeSources(
    packet.scope,
    packet.sources.map((s) => s.sourceKind),
  )
  issues.push(...scopeCheck.issues)

  return { valid: issues.length === 0, issues, warnings }
}

// ===========================================================================
// 验证函数 — 动作集确认义务（6.2 / 6.3）
// ===========================================================================

export function validateCopilotActionSet(actions: readonly CopilotRecommendedAction[]): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []
  for (const action of actions) {
    const derived = deriveRequiresUserConfirmation(action.destination, action.actionType)
    if (action.requiresUserConfirmation !== derived) {
      issues.push(
        `action ${action.actionId} 的 requiresUserConfirmation 与派生值不一致（${action.requiresUserConfirmation} !== ${derived}）`,
      )
    }
    if (!copilotIntentClassAllowsActionType(action.intentClass, action.actionType)) {
      issues.push(
        `action ${action.actionId} 的意图类 ${action.intentClass} 不允许动作类型 ${action.actionType}`,
      )
    }
    if (
      (COPILOT_MUTATION_INTENT_CLASSES as readonly string[]).includes(action.intentClass) &&
      !action.requiresUserConfirmation
    ) {
      issues.push(`变更类意图动作 ${action.actionId} 必须要求用户确认`)
    }
  }
  return { valid: issues.length === 0, issues }
}

// ===========================================================================
// 验证函数 — destination 注册表完整性（2.6）
// ===========================================================================

export function validateCopilotDestinationRegistry(): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []
  for (const destination of COPILOT_DESTINATIONS) {
    const meta = COPILOT_DESTINATION_REGISTRY[destination]
    if (!meta) {
      issues.push(`destination ${destination} 缺少注册元数据`)
      continue
    }
    if (!meta.ownerCapability || meta.ownerCapability.trim().length === 0) {
      issues.push(`destination ${destination} 缺少 owner capability`)
    }
    if (!meta.requiredPermissions || meta.requiredPermissions.length === 0) {
      issues.push(`destination ${destination} 缺少 required permissions`)
    }
    if (typeof meta.persistenceReachable !== 'boolean') {
      issues.push(`destination ${destination} 缺少 persistenceReachable 标记`)
    }
  }
  return { valid: issues.length === 0, issues }
}

// ===========================================================================
// 类型守卫
// ===========================================================================

export function isCopilotScope(v: string): v is CopilotScope {
  return (COPILOT_SCOPES as readonly string[]).includes(v)
}
export function isCopilotIntentClass(v: string): v is CopilotIntentClass {
  return (COPILOT_INTENT_CLASSES as readonly string[]).includes(v)
}
export function isCopilotDestination(v: string): v is CopilotDestination {
  return (COPILOT_DESTINATIONS as readonly string[]).includes(v)
}
export function isCopilotActionType(v: string): v is CopilotActionType {
  return (COPILOT_ACTION_TYPES as readonly string[]).includes(v)
}
export function isCopilotWarningCode(v: string): v is CopilotWarningCode {
  return (COPILOT_WARNING_CODES as readonly string[]).includes(v)
}
export function isCopilotDegradedReason(v: string): v is CopilotDegradedReason {
  return (COPILOT_DEGRADED_REASONS as readonly string[]).includes(v)
}
export function isCopilotConfidenceBand(v: string): v is CopilotConfidenceBand {
  return (COPILOT_CONFIDENCE_BANDS as readonly string[]).includes(v)
}
export function isCopilotSourceKind(v: string): v is CopilotSourceKind {
  return (COPILOT_SOURCE_KINDS as readonly string[]).includes(v)
}
export function isCopilotSessionStatus(v: string): v is CopilotSessionStatus {
  return (COPILOT_SESSION_STATUSES as readonly string[]).includes(v)
}
export function isCopilotMessageRole(v: string): v is CopilotMessageRole {
  return (COPILOT_MESSAGE_ROLES as readonly string[]).includes(v)
}
export function isCopilotKnowledgeTier(v: string): v is CopilotKnowledgeTier {
  return (COPILOT_KNOWLEDGE_TIERS as readonly string[]).includes(v)
}
export function isCopilotEntityType(v: string): v is CopilotEntityType {
  return (COPILOT_ENTITY_TYPES as readonly string[]).includes(v)
}
