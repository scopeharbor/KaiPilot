/**
 * compiler-config-management —— Compiler 配置档案共享类型（V2.5 W3 P1 增强）。
 *
 * 定义组织级、版本化的 Compiler Config Profile 实体与 effective config / preview 差异 DTO。
 * 统一承载三类运行态配置：featureToggles / budgetPolicies / cachePolicy。
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs / @aiproj/compiler-spec。`@aiproj/compiler-spec`
 * 反向依赖 `@aiproj/types`（且依赖 zod），故本包不得再依赖它——否则形成循环依赖并把 zod 拖进零依赖
 * 契约包。因此 `BudgetPolicy`/`BudgetPolicyInput` 在此以**结构等价的纯类型镜像**定义（对齐
 * compiler-spec `budgetPolicySchema` 的 `z.infer`/`z.input`）；运行时 schema 校验仍由后端 validator
 * 委托 compiler-spec 的 `budgetPolicySchema`（design D3/D8）。字段/枚举须与该 schema 保持一致。
 *
 * 低敏红线：所有 DTO 只含开关名/枚举/数值上限/scope/版本/hash，
 * 禁止承载 prompt、完整用户输入、模型输出、artifact 正文、Context Packet 正文、API Key 或跨组织数据。
 */

// ── budgetPolicies 纯类型镜像（zod-free，保持 @aiproj/types 零依赖红线）──────────
//
// 权威运行时 schema：@aiproj/compiler-spec `budgetPolicySchema`。此处镜像其 z.infer/z.input，
// 用于前后端共享 DTO 的静态类型；结构与 compiler-spec 保持一致，后端仍以该 zod schema 做运行时校验。

/** 预算策略作用域（对齐 compiler-spec budgetScopeSchema）。 */
export type BudgetPolicyScope =
  'organization' | 'user' | 'project' | 'compiler_run' | 'stage_type' | 'stage_id' | 'model_tier'

/** 软预算超限操作（对齐 compiler-spec softLimitActionSchema）。 */
export type BudgetSoftLimitAction = 'warn' | 'require_review' | 'continue'

/** 硬预算超限操作（对齐 compiler-spec hardLimitActionSchema）。 */
export type BudgetHardLimitAction = 'block' | 'block_stage' | 'block_run'

/** 预算策略适用的 Stage 类型。 */
export type BudgetApplicableStageType = 'llm' | 'hybrid' | 'deterministic' | 'gate' | 'meta'

/** 无默认值的公共字段（BudgetPolicy 与 BudgetPolicyInput 共享）。 */
interface BudgetPolicyCommonFields {
  name: string
  scope: BudgetPolicyScope
  scopeValue: string
  softLimit?: number
  hardLimit?: number
  softLimitTokens?: number
  hardLimitTokens?: number
  window?: string
  applicableStageTypes?: BudgetApplicableStageType[]
  applicableStageIds?: string[]
  applicableModelTiers?: string[]
}

/** 预算策略（对齐 budgetPolicySchema 的 z.infer——带默认值字段在输出中已填充）。 */
export interface BudgetPolicy extends BudgetPolicyCommonFields {
  enabled: boolean
  currency: string
  onSoftLimit: BudgetSoftLimitAction
  onHardLimit: BudgetHardLimitAction
  priority: number
}

/** 预算策略输入（对齐 z.input——带默认值字段在输入时可选）。 */
export interface BudgetPolicyInput extends BudgetPolicyCommonFields {
  enabled?: boolean
  currency?: string
  onSoftLimit?: BudgetSoftLimitAction
  onHardLimit?: BudgetHardLimitAction
  priority?: number
}

// ── featureToggles allowlist ──────────────────────────────────

/**
 * 受治理的 feature toggle 名单（首期）。
 * 路由开关不纳入（归 compiler-dynamic-routing-management-ui，design Open Questions）。
 */
export const COMPILER_CONFIG_FEATURE_TOGGLES = ['stageCacheEnabled'] as const

export type CompilerConfigFeatureToggle = (typeof COMPILER_CONFIG_FEATURE_TOGGLES)[number]

export type CompilerFeatureToggles = Partial<Record<CompilerConfigFeatureToggle, boolean>>

// ── cachePolicy ───────────────────────────────────────────────

/**
 * 缓存 store 偏好枚举。与 stage-cache-wiring 的 resolveCacheStore 对齐：
 * 不强制引入新 store，仅表达偏好（缺省由运行时解析）。
 */
export const COMPILER_CACHE_STORE_KINDS = ['memory', 'redis', 'auto'] as const

export type CompilerCacheStoreKind = (typeof COMPILER_CACHE_STORE_KINDS)[number]

/**
 * cachePolicy 配置子段。
 * `policyVersion` 与 `stage_cache_fingerprint.STAGE_CACHE_POLICY_VERSION` 对齐（design Open Questions）。
 */
export interface CompilerCachePolicy {
  /** 缓存策略版本（与 STAGE_CACHE_POLICY_VERSION 对齐，缺省回落运行时常量）。 */
  policyVersion?: string
  /** TTL 秒数（缺省回落 StageCacheService 默认 3600）。 */
  ttlSeconds?: number
  /** store 偏好（缺省回落 resolveCacheStore 解析）。 */
  storeKind?: CompilerCacheStoreKind
}

// ── Config Profile 实体 ───────────────────────────────────────

/**
 * Compiler Config Profile —— 组织级、版本化配置档案。
 * 三类运行态配置的规范化载体。低敏：无 prompt/output/secret。
 */
export interface CompilerConfigProfile {
  /** 组织 ID（隔离键）。 */
  organizationId: number
  /** 单调递增版本号。 */
  version: number
  /** 是否为当前生效版本。 */
  isActive: boolean
  /** 运行时开关（allowlist 约束）。 */
  featureToggles: CompilerFeatureToggles
  /** 预算策略集（复用 @aiproj/compiler-spec BudgetPolicy）。 */
  budgetPolicies: BudgetPolicy[]
  /** 缓存策略选择。 */
  cachePolicy: CompilerCachePolicy
  /** 创建人。 */
  createdBy: number
  /** 创建时间（ISO）。 */
  createdAt: string
}

/**
 * 写入用 Config Profile 输入（budgetPolicies 用 input 类型，允许缺省字段）。
 */
export interface CompilerConfigProfileInput {
  featureToggles?: CompilerFeatureToggles
  budgetPolicies?: BudgetPolicyInput[]
  cachePolicy?: CompilerCachePolicy
}

// ── effective config（解析结果）──────────────────────────────

/**
 * 生效配置 —— 组织 active profile 覆盖合并系统默认后的解析结果（design D4）。
 * 低敏：仅开关值、解析后的预算策略名/scope/上限、缓存策略版本/TTL/store 偏好、来源标识。
 */
export interface CompilerEffectiveConfig {
  organizationId: number
  /** 解析来源版本（无 profile 时为 null 表示回落 env/系统默认）。 */
  sourceVersion: number | null
  /** 解析来源：profile | env_default | system_default。 */
  source: 'profile' | 'env_default' | 'system_default'
  featureToggles: CompilerFeatureToggles
  /** 解析后预算策略名列表（仅名，不含完整策略体以保持低敏）。 */
  budgetPolicyNames: string[]
  /** 生效缓存策略版本。 */
  cachePolicyVersion: string
  /** 生效 TTL。 */
  cacheTtlSeconds: number
  /** 生效 store 偏好。 */
  cacheStoreKind: CompilerCacheStoreKind | 'auto'
}

// ── preview / 差异 DTO ────────────────────────────────────────

/**
 * 单字段差异项。
 */
export interface CompilerConfigDiffEntry {
  /** 配置路径（如 featureToggles.stageCacheEnabled）。 */
  path: string
  /** 旧值摘要（低敏：布尔/数值/枚举/名称，不含完整策略体）。 */
  before: string | number | boolean | null
  /** 新值摘要。 */
  after: string | number | boolean | null
  /** 变更类型。 */
  change: 'added' | 'removed' | 'modified'
}

/**
 * preview 响应 —— 对配置改动候选返回校验结果 + 差异 + 解析影响预览。
 * 只读、无副作用：不写库、不执行任何 run。
 */
export interface CompilerConfigPreviewResponse {
  /** 校验是否通过。 */
  valid: boolean
  /** 校验错误（valid=false 时）。 */
  validationErrors: string[]
  /** 与当前生效配置的差异。 */
  diff: CompilerConfigDiffEntry[]
  /** 解析影响预览（低敏摘要）。 */
  impactPreview: {
    /** 预测生效 featureToggles。 */
    featureToggles: CompilerFeatureToggles
    /** 预测预算策略名列表。 */
    budgetPolicyNames: string[]
    /** 预测缓存策略版本。 */
    cachePolicyVersion: string
  }
  /** 候选将产生的新版本号（若落库）。 */
  prospectiveVersion: number
}

// ── 原始 profile + 版本历史视图 ───────────────────────────────

/**
 * 原始 profile 快照视图（低敏，用于 GET /config/profile）。
 */
export interface CompilerConfigProfileView {
  version: number
  isActive: boolean
  featureToggles: CompilerFeatureToggles
  budgetPolicyNames: string[]
  cachePolicy: CompilerCachePolicy
  createdBy: number
  createdAt: string
}

/**
 * profile + 版本历史响应。
 */
export interface CompilerConfigProfileHistoryResponse {
  organizationId: number
  activeVersion: number | null
  current: CompilerConfigProfileView | null
  history: CompilerConfigProfileView[]
}

// ── 写入请求 DTO ──────────────────────────────────────────────

/**
 * 创建/新版本配置请求（POST /config）。
 * `confirm` 为显式确认参数（design D6：需显式确认才落库）。
 */
export interface CompilerConfigCreateRequest {
  featureToggles?: CompilerFeatureToggles
  budgetPolicies?: BudgetPolicyInput[]
  cachePolicy?: CompilerCachePolicy
  /** 显式确认落库（必须为 true 才写入）。 */
  confirm: boolean
}

/**
 * 启用/停用版本请求（PATCH /config/activate）。
 */
export interface CompilerConfigActivateRequest {
  version: number
  /** true=启用为 active，false=停用（回落 env/系统默认）。 */
  active: boolean
  /** 显式确认。 */
  confirm: boolean
}

/**
 * 写入结果视图。
 */
export interface CompilerConfigCommittedView {
  version: number
  isActive: boolean
  featureToggles: CompilerFeatureToggles
  budgetPolicyNames: string[]
  cachePolicy: CompilerCachePolicy
}

// ── 低敏守卫 ──────────────────────────────────────────────────

const SENSITIVE_FIELD_NAMES = new Set([
  'prompt',
  'content',
  'payload',
  'secret',
  'apikey',
  'api_key',
  'token',
  'authorization',
  'modeloutput',
  'model_output',
  'artifact',
])

/**
 * 检测配置候选是否含敏感字段名（低敏守卫）。
 * 仅做键名启发式扫描，不深读值。
 */
export function compilerConfigContainsSensitiveFields(value: unknown): {
  found: boolean
  fieldPath: string
} {
  const scan = (v: unknown, path: string): { found: boolean; fieldPath: string } => {
    if (v !== null && typeof v === 'object') {
      for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
        const currentPath = path ? `${path}.${key}` : key
        if (SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
          return { found: true, fieldPath: currentPath }
        }
        const nested = scan(val, currentPath)
        if (nested.found) return nested
      }
    }
    return { found: false, fieldPath: '' }
  }
  return scan(value, '')
}
