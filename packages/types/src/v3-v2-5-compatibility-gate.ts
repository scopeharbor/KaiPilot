/**
 * v3-v2-5-compatibility-gate —— V3 对 V2.5 GA 的兼容治理门共享契约（纯类型与常量，零运行时依赖）。
 *
 * 本模块是前后端/脚本共享的纯 TypeScript 模块（同 @aiproj/types 其他模块），只定义
 * 类型、枚举常量与类型守卫；账本数据见 `v3-v2-5-compatibility-gate-ledger.ts`，
 * 规则引擎见 `v3-v2-5-compatibility-gate-rules.ts`。
 *
 * # 账本状态语义（D1，对应 observation-and-inventory.md §5.7）
 * - `verified-archived`：V2.5 已交付并归档的表面（GA P0 三主线与已交付 P1/Optional）。
 * - `archived-but-stub`：已归档但仅为脚手架/stub 的表面（当前唯一已知：`/api/v2` 适配器 501）。
 * - `conditional`：技术上可规划，但真实外部动作需用户明确授权（OAuth/Webhook/写回/Web Push/npm/真实模型评测）。
 * - `deferred`：明确不进入当前阶段（容器化/私有化部署、完整国际化、开放插件市场）。
 * - `rejected`：已被裁决拒绝的叙事/方案（如「首次并行化」、强制 PG/Redis/Kafka/微服务）。
 *
 * # 规则族（D3）
 * blocking finding 只覆盖明确违规：闭版 GA 重开、历史 PRD 当当前 mandate、隐藏基础设施前提、
 * 无缺陷证据的重建主张、未授权外部动作、AI/人工确认边界削弱、低敏输出违规。
 * warning 覆盖：证据陈旧、缺图谱 fallback 说明、模糊 PRD 引用。
 *
 * # 低敏纪律（红线）
 * finding 的 summary/evidenceRefs 绝不包含原始 prompt、模型输出、secret、token、
 * Authorization 头、provider 原始载荷、原始 XML 断言、完整日志、完整源码或跨租户数据。
 */

// =============================================================================
// 1. 账本状态与来源引用
// =============================================================================

/** V2.5 表面在兼容账本中的状态。 */
export const V25_SURFACE_STATUSES = [
  'verified-archived',
  'archived-but-stub',
  'conditional',
  'deferred',
  'rejected',
] as const
export type V25SurfaceStatus = (typeof V25_SURFACE_STATUSES)[number]

/** 状态机合法迁移：只能由独立授权的 OpenSpec change 显式推进；不支持的状态升级见 rules 模块。 */
export const V25_STATUS_LABELS: Record<V25SurfaceStatus, string> = {
  'verified-archived': '已交付并归档（GA 事实）',
  'archived-but-stub': '已归档但为脚手架/stub（归档 ≠ 已接通）',
  conditional: '授权门：真实外部动作需用户明确授权',
  deferred: '设计性延期：明确不进入当前阶段',
  rejected: '已裁决拒绝（历史建议，非事实）',
}

/** 证据来源类别（按 source priority 排序见 ledger 模块注释）。 */
export const COMPATIBILITY_SOURCE_KINDS = [
  'openspec-spec',
  'openspec-archive',
  'planning-doc',
  'source-file',
  'progress-note',
] as const
export type CompatibilitySourceKind = (typeof COMPATIBILITY_SOURCE_KINDS)[number]

/** 一条证据引用：低敏，仅路径 + 可选说明。 */
export interface CompatibilitySourceRef {
  kind: CompatibilitySourceKind
  /** 仓库相对路径，如 `openspec/specs/streaming-progress-contract/spec.md`。 */
  path: string
  /** 可选的低敏说明（如「§4.1 归档记录」）。 */
  note?: string
}

// =============================================================================
// 2. 账本条目
// =============================================================================

/** V3 对一个 V2.5 表面的合法消费方式。 */
export const V3_CONSUMPTION_MODES = [
  'reference-evidence',
  'consume-contract',
  'extend-surface',
  'no-touch',
] as const
export type V3ConsumptionMode = (typeof V3_CONSUMPTION_MODES)[number]

/** 一个 V2.5 兼容表面（GA P0 / P1 / Optional / 延期项的统一建模）。 */
export interface CompatibilitySurface {
  /** 稳定表面 ID，kebab-case，如 `ai-draft-live-sse-progress`。 */
  surfaceId: string
  label: string
  status: V25SurfaceStatus
  /** 证据引用：必须至少含一条 openspec-spec / openspec-archive / planning-doc。 */
  sourceRefs: CompatibilitySourceRef[]
  /** V3 允许的消费方式。 */
  allowedV3Consumption: V3ConsumptionMode[]
  /** 消费该表面时必须执行的验证（低敏描述，如「focused SSE 测试须全绿」）。 */
  requiredVerification: string[]
  notes?: string
}

/** 授权门条目（conditional/deferred 的外部动作边界）。 */
export interface AuthorizationGate {
  /** 稳定门 ID，如 `real-oauth-token-exchange`。 */
  gateId: string
  label: string
  status: Extract<V25SurfaceStatus, 'conditional' | 'deferred'>
  /** 解除该门所需的授权形式（低敏描述）。 */
  requiredAuthorization: string
  /** 未授权时的默认行为边界（如「停在 fixture/mock 可验证边界」）。 */
  defaultBoundary: string
  sourceRefs: CompatibilitySourceRef[]
}

/** API/运行时基线裁决条目（如 api-v1-only、sqlite-first、no-docker）。 */
export interface ApiRuntimeBaselineDecision {
  decisionId: string
  label: string
  /** 裁决内容（低敏陈述）。 */
  decision: string
  sourceRefs: CompatibilitySourceRef[]
}

/** 产品红线条目。 */
export interface ProductRedLine {
  redLineId: string
  label: string
  statement: string
  sourceRefs: CompatibilitySourceRef[]
}

/** 兼容账本整体。 */
export interface CompatibilityLedger {
  /** 账本结构版本（语义化 "major.minor"）。 */
  ledgerVersion: string
  /** 账本内容生成/刷新日期（ISO 日期，如 `2026-08-16`）。 */
  generatedAt: string
  surfaces: CompatibilitySurface[]
  authorizationGates: AuthorizationGate[]
  apiRuntimeDecisions: ApiRuntimeBaselineDecision[]
  redLines: ProductRedLine[]
}

// =============================================================================
// 3. 规则族与 finding
// =============================================================================

/** 兼容规则族。 */
export const COMPATIBILITY_RULE_FAMILIES = [
  'closed-ga-reopen',
  'historical-prd-mandate',
  'hidden-prerequisite',
  'unsupported-regression-claim',
  'source-priority',
  'observation-evidence',
  'external-action-boundary',
  'ai-manual-confirmation',
  'low-sensitive-output',
] as const
export type CompatibilityRuleFamily = (typeof COMPATIBILITY_RULE_FAMILIES)[number]

/** finding 严重度。blocking 阻断 apply/archive；warning 需记录；info 仅供参考。 */
export const COMPATIBILITY_FINDING_SEVERITIES = ['blocking', 'warning', 'info'] as const
export type CompatibilityFindingSeverity = (typeof COMPATIBILITY_FINDING_SEVERITIES)[number]

/**
 * 一条兼容 finding。确定性：同一账本 + 同一被检材料必须产出相同 ruleId/severity/subjectPath。
 * summary 必须低敏（见 `v3-v2-5-compatibility-gate-rules.ts` 的 sanitize helpers）。
 */
export interface CompatibilityFinding {
  /** 稳定规则 ID，如 `CG-EXT-001`。同一规则同一 subject 只产一条。 */
  ruleId: string
  family: CompatibilityRuleFamily
  severity: CompatibilityFindingSeverity
  /** 被检对象路径（仓库相对路径或 change 名）。 */
  subjectPath: string
  /** 支撑该 finding 的证据引用（低敏路径/小节）。 */
  evidenceRefs: string[]
  /** 低敏摘要：不含 prompt/模型输出/secret/token/原始载荷/完整日志/跨租户数据。 */
  summary: string
}

/** 账本自身完整性校验发现的问题（结构级，非被检 change 级）。 */
export interface LedgerValidationIssue {
  /** 问题类别，如 `duplicate-surface-id`、`missing-ga-p0`、`invalid-source-ref`。 */
  kind: string
  message: string
  surfaceId?: string
}

/** 一次兼容校验结果。 */
export interface CompatibilityValidationResult {
  /** 是否存在 blocking finding 的反向：true = 通过。 */
  ok: boolean
  findings: CompatibilityFinding[]
  blockingCount: number
  warningCount: number
  infoCount: number
  /** 被检对象清单（change 目录/文件路径）。 */
  checkedSubjects: string[]
}

// =============================================================================
// 4. 类型守卫与常量
// =============================================================================

/** 账本结构当前版本。 */
export const V25_COMPATIBILITY_LEDGER_VERSION = '1.0' as const

/** 敏感关键词（值级检测，供 sanitize/低敏校验复用；匹配一律大小写不敏感）。 */
export const COMPATIBILITY_SENSITIVE_KEYWORDS = [
  'prompt',
  'modeloutput',
  'model_output',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'bearer',
  'password',
  'privatekey',
  'private_key',
  'cookie',
  'x-api-key',
] as const

export function isV25SurfaceStatus(value: unknown): value is V25SurfaceStatus {
  return typeof value === 'string' && (V25_SURFACE_STATUSES as readonly string[]).includes(value)
}

export function isCompatibilitySourceKind(value: unknown): value is CompatibilitySourceKind {
  return (
    typeof value === 'string' && (COMPATIBILITY_SOURCE_KINDS as readonly string[]).includes(value)
  )
}

export function isV3ConsumptionMode(value: unknown): value is V3ConsumptionMode {
  return typeof value === 'string' && (V3_CONSUMPTION_MODES as readonly string[]).includes(value)
}

export function isCompatibilityRuleFamily(value: unknown): value is CompatibilityRuleFamily {
  return (
    typeof value === 'string' && (COMPATIBILITY_RULE_FAMILIES as readonly string[]).includes(value)
  )
}

export function isCompatibilityFindingSeverity(
  value: unknown,
): value is CompatibilityFindingSeverity {
  return (
    typeof value === 'string' &&
    (COMPATIBILITY_FINDING_SEVERITIES as readonly string[]).includes(value)
  )
}
