/**
 * triz-skill-layer-integration —— V3 TRIZ × Skill System 集成层共享契约。
 *
 * 定义 TRIZ Skill Layer 的 profile/manifest、Stage 绑定、确定性 destination routing、
 * Registry/Activation/Injection 消费适配、预览/交接边界、低敏审计和质量门禁的
 * 共享 DTO、枚举、纯函数和 fixtures。
 *
 * 红线：
 * - 消费但不重建 Skill/Activation 类型，通过 import 引用
 * - 所有纯函数零运行时依赖（不调 Date.now()/Math.random()，不发起 HTTP/DB/AI 调用）
 * - 所有 DTO 仅含低敏摘要，不存完整 prompt/模型输出/证据正文/token/secret
 * - AI 只建议不自动执行
 *
 * @aiproj/types 零依赖约束
 */
import { createHash } from 'node:crypto'
import type { Skill } from './compiler-skill.js'

// ─────────────────────────────────────────────────────────────────────────────
// 枚举常量
// ─────────────────────────────────────────────────────────────────────────────

/** TRIZ Skill destination keys — 覆盖全部已支持和预期的 TRIZ 工具 */
export const TRIZ_SKILL_DESTINATION_KEYS = [
  'contradiction_discovery',
  'contradiction_matrix',
  'technical_contradiction_analyzer',
  'physical_contradiction_analyzer',
  'ifr_visualization',
  'function_analysis_diagram',
  'resource_analyzer',
  'evolution_trend_analysis',
  'ai_triz_assistant',
  'innovation_workbench',
  'recommendation_rationale',
  'decision_center',
  'draft_preview_handoff',
] as const

export type TrizSkillDestinationKey = (typeof TRIZ_SKILL_DESTINATION_KEYS)[number]

export function isTrizSkillDestinationKey(value: string): value is TrizSkillDestinationKey {
  return (TRIZ_SKILL_DESTINATION_KEYS as readonly string[]).includes(value)
}

/** Logical stage keys — 稳定逻辑阶段分类，映射 PRD §8.12 Stage 1-7 */
export const LOGICAL_STAGE_KEYS = [
  'requirements_parsing',
  'contradiction_detection',
  'solution_design',
  'architecture_definition',
  'task_execution',
  'monitoring_review',
  'change_management',
] as const

export type LogicalStageKey = (typeof LOGICAL_STAGE_KEYS)[number]

export function isLogicalStageKey(value: string): value is LogicalStageKey {
  return (LOGICAL_STAGE_KEYS as readonly string[]).includes(value)
}

/** Availability states for a TRIZ Skill destination */
export const TRIZ_SKILL_AVAILABILITY_STATES = [
  'available',
  'advisory',
  'unavailable',
  'feature_off',
  'stale',
  'permission_denied',
  'missing_module',
] as const

export type TrizSkillAvailabilityState = (typeof TRIZ_SKILL_AVAILABILITY_STATES)[number]

export function isTrizSkillAvailabilityState(value: string): value is TrizSkillAvailabilityState {
  return (TRIZ_SKILL_AVAILABILITY_STATES as readonly string[]).includes(value)
}

/** Review action types — all are review-only, no auto-execution */
export const TRIZ_SKILL_LAYER_ACTION_TYPES = [
  'view_evidence',
  'open_review',
  'generate_preview',
  'add_to_solution_basket',
  'record_review',
  'refresh_sources',
  'navigate_to_module',
  'request_clarification',
] as const

export type TrizSkillLayerActionType = (typeof TRIZ_SKILL_LAYER_ACTION_TYPES)[number]

/** TRIZ Skill Layer warning codes */
export const TRIZ_SKILL_LAYER_WARNING_CODES = [
  'TRIZ_SL_MISSING_SOURCE',
  'TRIZ_SL_STALE_SOURCE_HASH',
  'TRIZ_SL_INACCESSIBLE_TARGET',
  'TRIZ_SL_PERMISSION_DENIED',
  'TRIZ_SL_FEATURE_OFF',
  'TRIZ_SL_ADAPTER_UNAVAILABLE',
  'TRIZ_SL_MISSING_MODULE',
  'TRIZ_SL_GUARDED_ADAPTER',
  'TRIZ_SL_UNKNOWN_STAGE',
  'TRIZ_SL_L3_EXCLUDED',
  'TRIZ_SL_SOURCE_HASH_MISMATCH',
  'TRIZ_SL_INSUFFICIENT_PERMISSIONS',
  'TRIZ_SL_NO_REGISTRY_SKILL',
  'TRIZ_SL_EVAL_ONLY',
] as const

export type TrizSkillLayerWarningCode = (typeof TRIZ_SKILL_LAYER_WARNING_CODES)[number]

/** Audit event type constants for TRIZ Skill Layer */
export const TRIZ_SKILL_LAYER_AUDIT_EVENTS = [
  'TRIZ_SKILL_LAYER_SUMMARY_READ',
  'TRIZ_SKILL_LAYER_DESTINATIONS_READ',
  'TRIZ_SKILL_LAYER_ROUTE_PREVIEW',
  'TRIZ_SKILL_LAYER_HANDOFF_PREVIEW',
  'TRIZ_SKILL_LAYER_STALE_BLOCKED',
  'TRIZ_SKILL_LAYER_ADAPTER_UNAVAILABLE',
  'TRIZ_SKILL_LAYER_FEATURE_OFF',
  'TRIZ_SKILL_LAYER_PERMISSION_DENIED',
] as const

export type TrizSkillLayerAuditEvent = (typeof TRIZ_SKILL_LAYER_AUDIT_EVENTS)[number]

/** Feature flag constant */
export const TRIZ_SKILL_LAYER_FEATURE_FLAG = 'triz_skill_layer' as const

/** 来源引用种类 */
export const TRIZ_SKILL_LAYER_SOURCE_KINDS = [
  'contradiction',
  'compiler_artifact',
  'matrix',
  'technical_analysis',
  'physical_analysis',
  'ifr_snapshot',
  'function_analysis',
  'resource_analysis',
  'evolution_trend',
  'ai_triz_assistant',
  'workbench',
  'rationale',
  'decision_log',
  'draft',
  'skill_registry',
  'skill_activation',
] as const

export type TrizSkillLayerSourceKind = (typeof TRIZ_SKILL_LAYER_SOURCE_KINDS)[number]

// ─────────────────────────────────────────────────────────────────────────────
// 核心 DTO
// ─────────────────────────────────────────────────────────────────────────────

/** 来源引用（低敏：仅含 ref/hash/kind/warning） */
export interface TrizSkillSourceRef {
  /** 来源种类 */
  kind: TrizSkillLayerSourceKind
  /** 低敏导航引用（如 route path、module key），不含完整 URL 路径参数 */
  navigationRef: string | null
  /** 来源 hash（SHA-256 前 16 hex），或空字符串（不可用或权限不足） */
  sourceHash: string
  /** 来源是否为 stale（hash 不匹配当前状态） */
  stale: boolean
  /** 来源时间戳 ISO 8601，或 null */
  sourceTimestamp: string | null
  /** 附加的低敏警告码 */
  warningCodes: TrizSkillLayerWarningCode[]
}

/** 单个来源适配器返回的摘要 */
export interface TrizSkillSourceSummary {
  /** 适配器标识，匹配 destination key */
  adapterKey: TrizSkillDestinationKey
  /** 可用性状态 */
  availability: TrizSkillAvailabilityState
  /** 低敏来源引用列表 */
  sourceRefs: TrizSkillSourceRef[]
  /** 来源总数标签（如 "3 contradictions, 2 analyses"），权限不足时为空 */
  label: string
  /** 是否包含任何 stale 来源 */
  hasStaleSources: boolean
  /** 警告码聚合 */
  warnings: TrizSkillLayerWarningCode[]
}

/** TRIZ Skill profile — 从 Registry Skill 投影而来 */
export interface TrizSkillProfile {
  /** 来自 Registry 的 skillKey */
  skillKey: string
  /** 目标 destination key */
  destinationKey: TrizSkillDestinationKey
  /** Skill 版本（来自 Registry） */
  version: string
  /** Skill 生命周期状态（来自 Registry） */
  lifecycleStatus: string
  /** 可用性状态 */
  availability: TrizSkillAvailabilityState
  /** 人类可读名称 */
  name: string
  /** 简短描述 */
  description: string
  /** Stage 绑定列表 */
  stageBindings: LogicalStageKey[]
  /** 需要的权限列表 */
  requiredPermissions: string[]
  /** 关联的 feature flag refs */
  featureFlags: string[]
  /** 知识可用性标记 */
  knowledgeAvailability: boolean
  /** 来源引用政策 */
  sourceRefPolicy: 'low_sensitivity_only' | 'guarded' | 'unavailable'
  /** 是否从 Registry 的 active Skill 投影而来 */
  fromRegistry: boolean
  /** Eval 状态标记 */
  isEval: boolean
  /** 警告码列表 */
  warnings: TrizSkillLayerWarningCode[]
}

/** Stage 绑定条目 */
export interface TrizStageBindingEntry {
  /** 逻辑阶段 key */
  stage: LogicalStageKey
  /** 该阶段推荐的 destination keys（按优先级降序） */
  recommendedDestinations: TrizSkillDestinationKey[]
  /** 绑定置信度 (0-1) */
  confidence: number
  /** 警告码 */
  warnings: TrizSkillLayerWarningCode[]
}

/** 激活摘要（消费自现有 Activation，不创建新记录） */
export interface TrizActivationSummary {
  /** 激活的 Skill key 列表 */
  activeSkillKeys: string[]
  /** 建议的 Skill key 列表 */
  advisorySkillKeys: string[]
  /** 激活证据 refs（低敏：仅 hash/status） */
  activationEvidenceRefs: TrizSkillSourceRef[]
  /** 是否有有效激活 */
  hasActiveActivations: boolean
}

/** 权限摘要 */
export interface TrizPermissionSummary {
  /** 用户拥有的 TRIZ 权限 */
  grantedPermissions: string[]
  /** 缺少的权限 */
  missingPermissions: string[]
  /** 能否查看 Skill Layer */
  canViewSummary: boolean
  /** 能否查看 destinations */
  canViewDestinations: boolean
  /** 能否请求 route preview */
  canRoutePreview: boolean
  /** 能否请求 handoff preview */
  canHandoffPreview: boolean
  /** 权限拒绝的 warning 码 */
  denialWarnings: TrizSkillLayerWarningCode[]
}

/** 路由决策 — 单个 destination 的评分和元数据 */
export interface TrizRouteDecision {
  /** 目标 destination key */
  destinationKey: TrizSkillDestinationKey
  /** 关联的 skill key */
  skillKey: string | null
  /** 置信度 (0-1) */
  confidence: number
  /** 确定性评分 (0-100) */
  deterministicScore: number
  /** 排序顺序（越小越靠前） */
  order: number
  /** 需要的权限 */
  requiredPermissions: string[]
  /** 低敏来源引用 */
  sourceRefs: TrizSkillSourceRef[]
  /** 来源是否 stale */
  stale: boolean
  /** 警告码 */
  warnings: TrizSkillLayerWarningCode[]
  /** 唯一 action id */
  actionId: string
  /** 幂等 key */
  idempotencyKey: string
  /** 审核导向动作类型 */
  actionType: TrizSkillLayerActionType
  /** 是否需要用户确认（即使 action 只看不写，预览也需要确认状态） */
  requiresUserConfirmation: boolean
}

/** 路由预览请求 */
export interface TrizRoutePreviewRequest {
  /** 逻辑阶段或实际 stage id */
  stageHint?: string
  /** 用户意图描述（自由文本，不保存原文） */
  userIntent?: string
  /** 用户选择关注的 source ref hashes */
  selectedSourceHashes?: string[]
  /** 幂等 key */
  idempotencyKey: string
  /** 当前已知的来源 hash（用于 stale 检测） */
  currentSourceHashes?: Record<string, string>
}

/** 路由预览响应 */
export interface TrizRoutePreviewResponse {
  /** 按优先级排序的路由决策列表 */
  routes: TrizRouteDecision[]
  /** 聚合警告 */
  warnings: TrizSkillLayerWarningCode[]
  /** 幂等 key（与请求一致） */
  idempotencyKey: string
  /** 路由生成时间戳 */
  generatedAt: string
}

/** 交接预览请求 */
export interface TrizHandoffPreviewRequest {
  /** 目标 destination key */
  destinationKey: TrizSkillDestinationKey
  /** action id（来自路由决策） */
  actionId: string
  /** 幂等 key */
  idempotencyKey: string
  /** 当前已知的来源 hash（用于 stale 检测） */
  currentSourceHashes?: Record<string, string>
  /** 预览场景 */
  previewContext?: 'route' | 'direct' | 'from_assistant'
}

/** 交接预览响应 */
export interface TrizHandoffPreviewResponse {
  /** 目标 destination key */
  destinationKey: TrizSkillDestinationKey
  /** 目标模块名称（如 "Technical Contradiction Analyzer"） */
  targetModule: string
  /** 低敏来源引用 */
  sourceRefs: TrizSkillSourceRef[]
  /** 来源 hash 列表 */
  sourceHashes: Record<string, string>
  /** 当前 hash 验证是否通过 */
  hashValidationPassed: boolean
  /** 是否 stale */
  stale: boolean
  /** 需要的权限 */
  requiredPermissions: string[]
  /** 操作者 id */
  actorId: number | null
  /** 组织 id */
  organizationId: number | null
  /** 项目 id */
  projectId: number | null
  /** 幂等 key */
  idempotencyKey: string
  /** 标记为仅预览 */
  previewOnly: boolean
  /** 需要人工审查 */
  requiresUserConfirmation: boolean
  /** 警告码 */
  warnings: TrizSkillLayerWarningCode[]
  /** 是否可以导航到目标模块 */
  canNavigate: boolean
}

/** Skill Layer Summary 总响应 */
export interface TrizSkillLayerSummary {
  /** 可用的 TRIZ Skill profiles */
  profiles: TrizSkillProfile[]
  /** 不可用的 destination keys */
  unavailableDestinations: TrizSkillDestinationKey[]
  /** 激活摘要 */
  activationSummary: TrizActivationSummary
  /** Stage 绑定映射 */
  stageBindings: TrizStageBindingEntry[]
  /** 来源摘要 */
  sourceSummaries: TrizSkillSourceSummary[]
  /** 权限摘要 */
  permissionSummary: TrizPermissionSummary
  /** 功能开关状态 */
  featureFlagEnabled: boolean
  /** 审计 refs（低敏） */
  auditRefs: string[]
}

/** Destinations 列表筛选器 */
export interface TrizSkillLayerDestinationFilters {
  /** 按逻辑阶段过滤 */
  stage?: LogicalStageKey
  /** 按可用性状态过滤 */
  availability?: TrizSkillAvailabilityState
  /** 按 destination key 过滤 */
  destinationKey?: TrizSkillDestinationKey
}

/** Destinations 列表查询参数 */
export interface TrizSkillLayerDestinationsQuery {
  /** 筛选器 */
  filters?: TrizSkillLayerDestinationFilters
  /** 排序字段 */
  sort?: string
  /** 页码 */
  page?: number
  /** 每页条数 */
  perPage?: number
}

/** 单个 destination 的详细条目 */
export interface TrizSkillDestinationEntry {
  /** destination key */
  destinationKey: TrizSkillDestinationKey
  /** 关联 profile */
  profile: TrizSkillProfile | null
  /** Stage 绑定 */
  stageBindings: LogicalStageKey[]
  /** 可用性 */
  availability: TrizSkillAvailabilityState
  /** 来源摘要 */
  sourceSummary: TrizSkillSourceSummary | null
  /** 警告码 */
  warnings: TrizSkillLayerWarningCode[]
}

/** API 列表响应 */
export interface TrizSkillLayerDestinationsResponse {
  data: TrizSkillDestinationEntry[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

/** 可暴露给 Command Palette / AI-TRIZ Assistant 的导航元数据 */
export interface TrizSkillLayerNavigationMetadata {
  /** destination key */
  destinationKey: TrizSkillDestinationKey
  /** 模块路由路径（相对） */
  routePath: string
  /** 显示标签 */
  label: string
  /** 可用性状态 */
  availability: TrizSkillAvailabilityState
  /** 需要的权限 */
  requiredPermissions: string[]
  /** 图标标识 */
  iconRef: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Idempotency & Hash
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 归一化幂等 key。
 * 截断过长输入，移除不可打印字符，trim 空白。
 */
export function normalizeTrizSkillLayerIdempotencyKey(raw: string): string {
  const cleaned = raw.replace(/[^\x20-\x7E]/g, '').trim()
  return cleaned.slice(0, 256)
}

/**
 * 计算低敏 source hash（SHA-256 前 16 hex chars）。
 * 输入为可确定性序列化的字段。
 */
export function computeTrizSkillLayerSourceHash(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

/**
 * 计算路由决策的 action id = SHA-256(destinationKey + stage + skillKey + idempotencyKey 前 8 hex)
 */
export function computeTrizRouteActionId(
  destinationKey: TrizSkillDestinationKey,
  stageHint: string,
  skillKey: string | null,
  idempotencyKey: string,
): string {
  return createHash('sha256')
    .update(`${destinationKey}|${stageHint}|${skillKey ?? ''}|${idempotencyKey}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * 比较两个 source hash 是否匹配。
 */
export function compareTrizSkillLayerSourceHash(a: string, b: string): boolean {
  return a === b
}

/**
 * 检测 source ref 是否为 stale（hash 不匹配或缺少 hash）。
 */
export function isTrizSourceRefStale(
  ref: TrizSkillSourceRef,
  currentHashes?: Record<string, string>,
): boolean {
  if (ref.stale) return true
  if (!currentHashes) return false
  const currentHash = currentHashes[ref.kind]
  if (currentHash === undefined) return true
  return !compareTrizSkillLayerSourceHash(ref.sourceHash, currentHash)
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Destination Catalog
// ─────────────────────────────────────────────────────────────────────────────

/** 所有 TRIZ destination 的无状态定义 */
export interface TrizDestinationCatalogEntry {
  destinationKey: TrizSkillDestinationKey
  name: string
  description: string
  defaultStageBindings: LogicalStageKey[]
  defaultRequiredPermissions: string[]
}

/** 构建完整的 destination catalog */
export function buildTrizDestinationCatalog(): TrizDestinationCatalogEntry[] {
  return [
    {
      destinationKey: 'contradiction_discovery',
      name: '矛盾发现',
      description: '识别项目中技术矛盾与物理矛盾的候选参数对',
      defaultStageBindings: ['requirements_parsing', 'contradiction_detection'],
      defaultRequiredPermissions: ['triz_contradiction:view'],
    },
    {
      destinationKey: 'contradiction_matrix',
      name: '矛盾矩阵',
      description: '39×39 工程参数矩阵与 40 发明原则映射',
      defaultStageBindings: ['contradiction_detection', 'solution_design'],
      defaultRequiredPermissions: ['triz_contradiction_matrix:view'],
    },
    {
      destinationKey: 'technical_contradiction_analyzer',
      name: '技术矛盾分析器',
      description: '技术矛盾分析运行：改善一个参数的同时另一个参数恶化',
      defaultStageBindings: ['contradiction_detection', 'solution_design'],
      defaultRequiredPermissions: ['triz_technical_contradiction_analysis:view'],
    },
    {
      destinationKey: 'physical_contradiction_analyzer',
      name: '物理矛盾分析器',
      description: '物理矛盾分析运行：同一属性在不同条件下要求相反状态',
      defaultStageBindings: ['contradiction_detection', 'task_execution'],
      defaultRequiredPermissions: ['triz_physical_contradiction_analysis:view'],
    },
    {
      destinationKey: 'ifr_visualization',
      name: 'IFR 可视化',
      description: '最终理想解（IFR）可视化与理想度评分',
      defaultStageBindings: ['solution_design'],
      defaultRequiredPermissions: ['triz_ifr:view'],
    },
    {
      destinationKey: 'function_analysis_diagram',
      name: '功能分析图',
      description: '组件-功能关系图与问题候选',
      defaultStageBindings: ['architecture_definition'],
      defaultRequiredPermissions: ['triz_function_analysis:view'],
    },
    {
      destinationKey: 'resource_analyzer',
      name: '资源分析器',
      description: 'TRIZ 资源九分类与未利用机会识别',
      defaultStageBindings: ['architecture_definition', 'task_execution'],
      defaultRequiredPermissions: ['triz_resource_analyzer:view'],
    },
    {
      destinationKey: 'evolution_trend_analysis',
      name: '进化趋势分析',
      description: '八大进化趋势确定性评分与风险预警候选',
      defaultStageBindings: ['monitoring_review'],
      defaultRequiredPermissions: ['triz_evolution_trend_analysis:view'],
    },
    {
      destinationKey: 'ai_triz_assistant',
      name: 'AI-TRIZ 助手',
      description: '项目级 TRIZ 会话式引导层：Context Packet、工具路由、缺口诊断',
      defaultStageBindings: LOGICAL_STAGE_KEYS as unknown as LogicalStageKey[],
      defaultRequiredPermissions: ['triz_ai_assistant:view'],
    },
    {
      destinationKey: 'innovation_workbench',
      name: '创新工作台',
      description: '方案创建/比较/评审与 Draft/Decision/Workbench 交接',
      defaultStageBindings: ['solution_design', 'architecture_definition'],
      defaultRequiredPermissions: ['triz_innovation_workbench:view'],
    },
    {
      destinationKey: 'recommendation_rationale',
      name: '推荐理由',
      description: 'TRIZ 推荐理由的查看、反馈与 Reason Drafting',
      defaultStageBindings: ['solution_design', 'change_management'],
      defaultRequiredPermissions: ['triz_rationale:view'],
    },
    {
      destinationKey: 'decision_center',
      name: '决策中心',
      description: '聚合矛盾/Compiler 分析/理由/工作台/Draft 阻断的派生 read model',
      defaultStageBindings: ['contradiction_detection', 'change_management'],
      defaultRequiredPermissions: ['triz_decision_center:view'],
    },
    {
      destinationKey: 'draft_preview_handoff',
      name: 'Draft 预览交接',
      description: 'TRIZ 结果进入 Draft Layer 的 Preview/Diff/dry-run/explicit-confirm 通道',
      defaultStageBindings: LOGICAL_STAGE_KEYS as unknown as LogicalStageKey[],
      defaultRequiredPermissions: ['draft:review'],
    },
  ]
}

/** 验证 destination catalog 完整性：返回缺失或不一致的 key */
export function validateTrizDestinationCatalog(catalog: TrizDestinationCatalogEntry[]): {
  valid: boolean
  missingKeys: TrizSkillDestinationKey[]
  duplicateKeys: TrizSkillDestinationKey[]
} {
  const keys = catalog.map((e) => e.destinationKey)
  const missingKeys = TRIZ_SKILL_DESTINATION_KEYS.filter((k) => !keys.includes(k))
  const seen = new Set<TrizSkillDestinationKey>()
  const duplicateKeys: TrizSkillDestinationKey[] = []
  for (const k of keys) {
    if (seen.has(k)) duplicateKeys.push(k)
    seen.add(k)
  }
  return {
    valid: missingKeys.length === 0 && duplicateKeys.length === 0,
    missingKeys,
    duplicateKeys,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Stage Binding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 确定性阶段绑定：为给定逻辑阶段和目的地目录产生推荐
 */
export function computeStageBinding(
  stage: LogicalStageKey,
  catalog: TrizDestinationCatalogEntry[],
  availableDestinationKeys: Set<TrizSkillDestinationKey>,
  permissions: Set<string>,
  _featureFlags: Set<string>,
): TrizStageBindingEntry {
  const recommendedDestinations: TrizSkillDestinationKey[] = []
  const warnings: TrizSkillLayerWarningCode[] = []

  for (const entry of catalog) {
    if (!entry.defaultStageBindings.includes(stage)) continue
    if (!availableDestinationKeys.has(entry.destinationKey)) {
      warnings.push('TRIZ_SL_ADAPTER_UNAVAILABLE')
      continue
    }
    const hasPermission = entry.defaultRequiredPermissions.every((p) => permissions.has(p))
    if (!hasPermission) {
      warnings.push('TRIZ_SL_PERMISSION_DENIED')
      continue
    }
    recommendedDestinations.push(entry.destinationKey)
  }

  // 稳定性排序：按 destination key 字典序（因为 catalog 中的 defaultStageBindings 顺序是定义时的，保持顺序即可）
  // 这里保留它们在 catalog 中被添加的先后（已按优先级定义）

  return {
    stage,
    recommendedDestinations,
    confidence: recommendedDestinations.length > 0 ? 0.85 : 0.1,
    warnings,
  }
}

/**
 * 确定性所有 7 个逻辑阶段的绑定
 */
export function computeAllStageBindings(
  catalog: TrizDestinationCatalogEntry[],
  availableDestinationKeys: Set<TrizSkillDestinationKey>,
  permissions: Set<string>,
  featureFlags: Set<string>,
): TrizStageBindingEntry[] {
  return LOGICAL_STAGE_KEYS.map((stage) =>
    computeStageBinding(stage, catalog, availableDestinationKeys, permissions, featureFlags),
  )
}

/**
 * 将未知的实际 stage id 映射到 logical stage key（best-effort）
 */
export function mapActualStageToLogical(actualStageId: string): {
  logical: LogicalStageKey | null
  warning: TrizSkillLayerWarningCode | null
} {
  const lower = actualStageId.toLowerCase()
  const mappings: [string, LogicalStageKey][] = [
    ['intent', 'requirements_parsing'],
    ['requirement', 'requirements_parsing'],
    ['parsing', 'requirements_parsing'],
    ['clarification', 'requirements_parsing'],
    ['contradiction', 'contradiction_detection'],
    ['detection', 'contradiction_detection'],
    ['design', 'solution_design'],
    ['solution', 'solution_design'],
    ['architecture', 'architecture_definition'],
    ['definition', 'architecture_definition'],
    ['task', 'task_execution'],
    ['execution', 'task_execution'],
    ['monitoring', 'monitoring_review'],
    ['review', 'monitoring_review'],
    ['change', 'change_management'],
    ['management', 'change_management'],
  ]

  for (const [keyword, logical] of mappings) {
    if (lower.includes(keyword)) return { logical, warning: null }
  }
  return { logical: null, warning: 'TRIZ_SL_UNKNOWN_STAGE' }
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Route Scoring & Ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 路由稳定性排序比较器：
 * 1. deterministicScore 降序
 * 2. destinationKey 字典序
 */
export function compareTrizRouteDecisions(a: TrizRouteDecision, b: TrizRouteDecision): number {
  if (a.deterministicScore !== b.deterministicScore) {
    return b.deterministicScore - a.deterministicScore
  }
  return a.destinationKey.localeCompare(b.destinationKey)
}

/**
 * 对路由决策列表稳定排序（不修改原数组）
 */
export function sortTrizRouteDecisions(routes: TrizRouteDecision[]): TrizRouteDecision[] {
  return [...routes].sort(compareTrizRouteDecisions)
}

/**
 * 聚合路由决策中的警告码（去重）
 */
export function aggregateTrizRouteWarnings(
  routes: TrizRouteDecision[],
): TrizSkillLayerWarningCode[] {
  const seen = new Set<TrizSkillLayerWarningCode>()
  for (const r of routes) {
    for (const w of r.warnings) {
      seen.add(w)
    }
  }
  return [...seen].sort()
}

/**
 * 聚合路由置信度（取平均）
 */
export function aggregateTrizRouteConfidence(routes: TrizRouteDecision[]): number {
  if (routes.length === 0) return 0
  const sum = routes.reduce((acc, r) => acc + r.confidence, 0)
  return Math.round((sum / routes.length) * 100) / 100
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Redaction & L3 Guards
// ─────────────────────────────────────────────────────────────────────────────

/** 敏感字段名模式（不区分大小写） */
export const TRIZ_SKILL_LAYER_SENSITIVE_FIELD_PATTERNS = [
  /^prompt$/i,
  /prompt$/i,
  /^model[_-]?output$/i,
  /completion/i,
  /^token$/i,
  /^secret$/i,
  /authorization/i,
  /^raw[_-]?payload$/i,
  /^raw[_-]?evidence$/i,
  /^full[_-]?path$/i,
  /api[_-]?key/i,
]

/**
 * 检查字段名是否为敏感字段（需要脱敏或拒绝）
 */
export function isTrizSkillLayerSensitiveField(fieldName: string): boolean {
  return TRIZ_SKILL_LAYER_SENSITIVE_FIELD_PATTERNS.some((p) => p.test(fieldName))
}

/**
 * L3 知识层级排除守卫：
 * 如果 source ref 标记为 layer=L3（合成知识，非生产），在非 eval 上下文中应排除
 */
export function isL3Excluded(layer: string | undefined, context: 'production' | 'eval'): boolean {
  return layer === 'L3' && context === 'production'
}

/**
 * 脱敏 source ref：如果不可访问，返回仅含 generic warning 的副本
 */
export function redactInaccessibleSourceRef(ref: TrizSkillSourceRef): TrizSkillSourceRef {
  return {
    kind: ref.kind,
    navigationRef: null,
    sourceHash: '',
    stale: true,
    sourceTimestamp: null,
    warningCodes: ['TRIZ_SL_INACCESSIBLE_TARGET'],
  }
}

/**
 * 脱敏 profile：返回仅含可暴露字段的副本
 */
export function redactTrizSkillProfile(profile: TrizSkillProfile): TrizSkillProfile {
  if (profile.availability === 'permission_denied') {
    return {
      ...profile,
      name: '',
      description: '',
      requiredPermissions: [],
      featureFlags: [],
      warnings: ['TRIZ_SL_PERMISSION_DENIED'],
    }
  }
  return profile
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Profile Building Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从 Registry Skill 构建 TRIZ Skill Profile
 */
export function buildTrizSkillProfileFromRegistrySkill(
  skill: Skill,
  destinationKey: TrizSkillDestinationKey,
  catalog: TrizDestinationCatalogEntry[],
): TrizSkillProfile {
  const catalogEntry = catalog.find((e) => e.destinationKey === destinationKey)
  const isActive = skill.status === 'active'
  const isEval = skill.status === 'eval'
  const availability: TrizSkillAvailabilityState = isActive
    ? 'available'
    : isEval
      ? 'advisory'
      : 'unavailable'

  return {
    skillKey: skill.skillKey,
    destinationKey,
    version: skill.version,
    lifecycleStatus: skill.status,
    availability,
    name: skill.name,
    description: skill.description,
    stageBindings: catalogEntry?.defaultStageBindings ?? [],
    requiredPermissions: catalogEntry?.defaultRequiredPermissions ?? [],
    featureFlags: [],
    knowledgeAvailability: !!skill.knowledge && Object.keys(skill.knowledge).length > 0,
    sourceRefPolicy: isActive ? 'low_sensitivity_only' : isEval ? 'guarded' : 'unavailable',
    fromRegistry: true,
    isEval,
    warnings: isEval ? ['TRIZ_SL_EVAL_ONLY'] : [],
  }
}

/**
 * 为 registry 中不存在的 destination 构建 unavailable profile
 */
export function buildUnavailableTrizSkillProfile(
  destinationKey: TrizSkillDestinationKey,
  reason: TrizSkillLayerWarningCode,
  catalog: TrizDestinationCatalogEntry[],
): TrizSkillProfile {
  const catalogEntry = catalog.find((e) => e.destinationKey === destinationKey)
  return {
    skillKey: `unavailable:${destinationKey}`,
    destinationKey,
    version: '0.0.0',
    lifecycleStatus: 'unavailable',
    availability: reason === 'TRIZ_SL_PERMISSION_DENIED' ? 'permission_denied' : 'unavailable',
    name: catalogEntry?.name ?? destinationKey,
    description: catalogEntry?.description ?? '',
    stageBindings: catalogEntry?.defaultStageBindings ?? [],
    requiredPermissions: catalogEntry?.defaultRequiredPermissions ?? [],
    featureFlags: [],
    knowledgeAvailability: false,
    sourceRefPolicy: 'unavailable',
    fromRegistry: false,
    isEval: false,
    warnings: [reason],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯函数：Handoff Preview Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 验证交接预览的 stale 状态。
 * 如果当前 source hash 不匹配，返回 blocked。
 */
export function validateHandoffStaleState(
  sourceHashes: Record<string, string>,
  currentSourceHashes?: Record<string, string>,
): { valid: boolean; stale: boolean; warnings: TrizSkillLayerWarningCode[] } {
  if (!currentSourceHashes) {
    return { valid: true, stale: false, warnings: [] }
  }
  const warnings: TrizSkillLayerWarningCode[] = []
  let stale = false
  for (const [kind, hash] of Object.entries(sourceHashes)) {
    const current = currentSourceHashes[kind]
    if (current === undefined || !compareTrizSkillLayerSourceHash(hash, current)) {
      stale = true
      warnings.push('TRIZ_SL_STALE_SOURCE_HASH')
      break
    }
  }
  return { valid: !stale, stale, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/** 创建最小可用的 TRIZ Skill Profile fixture */
export function fixtureTrizSkillProfile(
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return {
    skillKey: 'org/triz-contradiction-discovery-v1',
    destinationKey: 'contradiction_discovery',
    version: '1.0.0',
    lifecycleStatus: 'active',
    availability: 'available',
    name: '矛盾发现',
    description: '识别项目中的技术矛盾和物理矛盾候选',
    stageBindings: ['requirements_parsing', 'contradiction_detection'],
    requiredPermissions: ['triz_contradiction:view'],
    featureFlags: [],
    knowledgeAvailability: true,
    sourceRefPolicy: 'low_sensitivity_only',
    fromRegistry: true,
    isEval: false,
    warnings: [],
    ...overrides,
  }
}

/** 创建 advisory 状态的 fixture */
export function fixtureAdvisoryTrizSkillProfile(
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return fixtureTrizSkillProfile({
    availability: 'advisory',
    lifecycleStatus: 'eval',
    isEval: true,
    warnings: ['TRIZ_SL_EVAL_ONLY'],
    ...overrides,
  })
}

/** 创建 unavailable 状态的 fixture */
export function fixtureUnavailableTrizSkillProfile(
  destinationKey: TrizSkillDestinationKey = 'evolution_trend_analysis',
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return fixtureTrizSkillProfile({
    skillKey: `unavailable:${destinationKey}`,
    destinationKey,
    availability: 'unavailable',
    lifecycleStatus: 'unavailable',
    fromRegistry: false,
    knowledgeAvailability: false,
    sourceRefPolicy: 'unavailable',
    warnings: ['TRIZ_SL_MISSING_MODULE'],
    ...overrides,
  })
}

/** 创建 feature-off 状态的 fixture */
export function fixtureFeatureOffTrizSkillProfile(
  destinationKey: TrizSkillDestinationKey = 'contradiction_discovery',
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return fixtureTrizSkillProfile({
    destinationKey,
    availability: 'feature_off',
    warnings: ['TRIZ_SL_FEATURE_OFF'],
    ...overrides,
  })
}

/** 创建 stale 状态的 fixture */
export function fixtureStaleTrizSkillProfile(
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return fixtureTrizSkillProfile({
    availability: 'stale',
    warnings: ['TRIZ_SL_STALE_SOURCE_HASH'],
    ...overrides,
  })
}

/** 创建 permission-denied 状态的 fixture */
export function fixturePermissionDeniedTrizSkillProfile(
  destinationKey: TrizSkillDestinationKey = 'contradiction_discovery',
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return fixtureTrizSkillProfile({
    destinationKey,
    availability: 'permission_denied',
    name: '',
    description: '',
    requiredPermissions: [],
    knowledgeAvailability: false,
    sourceRefPolicy: 'unavailable',
    warnings: ['TRIZ_SL_PERMISSION_DENIED'],
    ...overrides,
  })
}

/** 创建 missing-module 状态的 fixture */
export function fixtureMissingModuleTrizSkillProfile(
  destinationKey: TrizSkillDestinationKey = 'evolution_trend_analysis',
  overrides: Partial<TrizSkillProfile> = {},
): TrizSkillProfile {
  return fixtureUnavailableTrizSkillProfile(destinationKey, {
    warnings: ['TRIZ_SL_MISSING_MODULE'],
    ...overrides,
  })
}

/** 创建低敏 source ref fixture */
export function fixtureTrizSkillSourceRef(
  overrides: Partial<TrizSkillSourceRef> = {},
): TrizSkillSourceRef {
  return {
    kind: 'contradiction',
    navigationRef: '/projects/1/triz/contradictions',
    sourceHash: 'a1b2c3d4e5f6a7b8',
    stale: false,
    sourceTimestamp: '2026-08-01T00:00:00.000Z',
    warningCodes: [],
    ...overrides,
  }
}

/** 创建 TrizStageBindingEntry fixture */
export function fixtureStageBindingEntry(
  overrides: Partial<TrizStageBindingEntry> = {},
): TrizStageBindingEntry {
  return {
    stage: 'requirements_parsing',
    recommendedDestinations: ['contradiction_discovery'],
    confidence: 0.85,
    warnings: [],
    ...overrides,
  }
}

/** 创建 TrizRouteDecision fixture */
export function fixtureTrizRouteDecision(
  overrides: Partial<TrizRouteDecision> = {},
): TrizRouteDecision {
  return {
    destinationKey: 'contradiction_discovery',
    skillKey: 'org/triz-contradiction-discovery-v1',
    confidence: 0.85,
    deterministicScore: 90,
    order: 0,
    requiredPermissions: ['triz_contradiction:view'],
    sourceRefs: [],
    stale: false,
    warnings: [],
    actionId: 'a1b2c3d4e5f6a7b8',
    idempotencyKey: 'triz-sl-route-001',
    actionType: 'open_review',
    requiresUserConfirmation: false,
    ...overrides,
  }
}

/** 创建 TrizSkillLayerSummary fixture */
export function fixtureTrizSkillLayerSummary(
  overrides: Partial<TrizSkillLayerSummary> = {},
): TrizSkillLayerSummary {
  return {
    profiles: [fixtureTrizSkillProfile()],
    unavailableDestinations: [],
    activationSummary: {
      activeSkillKeys: [],
      advisorySkillKeys: [],
      activationEvidenceRefs: [],
      hasActiveActivations: false,
    },
    stageBindings: [fixtureStageBindingEntry()],
    sourceSummaries: [],
    permissionSummary: {
      grantedPermissions: [],
      missingPermissions: [],
      canViewSummary: true,
      canViewDestinations: true,
      canRoutePreview: true,
      canHandoffPreview: true,
      denialWarnings: [],
    },
    featureFlagEnabled: true,
    auditRefs: [],
    ...overrides,
  }
}

/** 创建 TrizHandoffPreviewResponse fixture */
export function fixtureTrizHandoffPreviewResponse(
  overrides: Partial<TrizHandoffPreviewResponse> = {},
): TrizHandoffPreviewResponse {
  return {
    destinationKey: 'contradiction_discovery',
    targetModule: 'Contradiction Discovery',
    sourceRefs: [],
    sourceHashes: {},
    hashValidationPassed: true,
    stale: false,
    requiredPermissions: ['triz_contradiction:view'],
    actorId: 1,
    organizationId: 1,
    projectId: 1,
    idempotencyKey: 'triz-sl-handoff-001',
    previewOnly: true,
    requiresUserConfirmation: true,
    warnings: [],
    canNavigate: true,
    ...overrides,
  }
}

/** 创建 TrizRoutePreviewResponse fixture */
export function fixtureTrizRoutePreviewResponse(
  overrides: Partial<TrizRoutePreviewResponse> = {},
): TrizRoutePreviewResponse {
  return {
    routes: [fixtureTrizRouteDecision()],
    warnings: [],
    idempotencyKey: 'triz-sl-route-001',
    generatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

/** 创建 TrizSkillLayerNavigationMetadata fixture */
export function fixtureNavigationMetadata(
  overrides: Partial<TrizSkillLayerNavigationMetadata> = {},
): TrizSkillLayerNavigationMetadata {
  return {
    destinationKey: 'contradiction_discovery',
    routePath: '/projects/:id/triz/contradictions',
    label: '矛盾发现',
    availability: 'available',
    requiredPermissions: ['triz_contradiction:view'],
    iconRef: 'search',
    ...overrides,
  }
}

/** 创建完整 catalog fixture */
export function fixtureFullCatalog(): TrizDestinationCatalogEntry[] {
  return buildTrizDestinationCatalog()
}

/**
 * 构建默认导航元数据列表（供 Command Palette 等消费）
 */
export function buildTrizSkillLayerNavigationMetadataList(
  profiles: TrizSkillProfile[],
  catalog: TrizDestinationCatalogEntry[],
): TrizSkillLayerNavigationMetadata[] {
  const routePathMap: Record<TrizSkillDestinationKey, string> = {
    contradiction_discovery: '/projects/:id/triz/contradictions',
    contradiction_matrix: '/projects/:id/triz/contradiction-matrix',
    technical_contradiction_analyzer: '/projects/:id/triz/technical-contradiction',
    physical_contradiction_analyzer: '/projects/:id/triz/physical-contradiction',
    ifr_visualization: '/projects/:id/triz/ifr',
    function_analysis_diagram: '/projects/:id/triz/function-analysis',
    resource_analyzer: '/projects/:id/triz/resource-analyzer',
    evolution_trend_analysis: '/projects/:id/triz/evolution-trends',
    ai_triz_assistant: '/projects/:id/triz/assistant',
    innovation_workbench: '/projects/:id/triz/workbench',
    recommendation_rationale: '/projects/:id/triz/rationale',
    decision_center: '/projects/:id/triz/decision-center',
    draft_preview_handoff: '/projects/:id/draft',
  }

  const iconRefMap: Record<TrizSkillDestinationKey, string> = {
    contradiction_discovery: 'search',
    contradiction_matrix: 'grid',
    technical_contradiction_analyzer: 'wrench',
    physical_contradiction_analyzer: 'scale',
    ifr_visualization: 'target',
    function_analysis_diagram: 'git-branch',
    resource_analyzer: 'database',
    evolution_trend_analysis: 'trending-up',
    ai_triz_assistant: 'bot',
    innovation_workbench: 'lightbulb',
    recommendation_rationale: 'file-text',
    decision_center: 'check-square',
    draft_preview_handoff: 'edit',
  }

  const profileMap = new Map(profiles.map((p) => [p.destinationKey, p]))

  return catalog.map((entry) => {
    const profile = profileMap.get(entry.destinationKey)
    return {
      destinationKey: entry.destinationKey,
      routePath: routePathMap[entry.destinationKey] ?? `/projects/:id/triz`,
      label: entry.name,
      availability: profile?.availability ?? 'unavailable',
      requiredPermissions: entry.defaultRequiredPermissions,
      iconRef: iconRefMap[entry.destinationKey] ?? 'zap',
    }
  })
}
