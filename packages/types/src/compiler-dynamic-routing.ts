/**
 * compiler-dynamic-routing —— Compiler 动态路由类型（V2.5 W3 P1 增强）。
 *
 * 定义路由规则注册表、场景分类、RoutingDecision 审计证据等共享类型。
 * 零运行时依赖。
 *
 * @aiproj/types 零依赖约束：不导入 zod / adonisjs / compiler-spec。
 */

// ── 场景分类 ───────────────────────────────────────────────────

/**
 * Compiler routing scenario kinds。
 * 首批受控场景；未来可通过 versioned fixture 扩展。
 */
export const COMPILER_SCENARIO_KINDS = [
  'default_plan',
  'lightweight_draft',
  'deterministic_validation',
  'artifact_review',
  'incompatible_rule',
] as const

export type CompilerScenarioKind = (typeof COMPILER_SCENARIO_KINDS)[number]

// ── Routing Reason Codes ───────────────────────────────────────

export const ROUTING_REASON_CODES = [
  // Success / matched
  'ROUTE_MATCHED',
  'ROUTE_DEFAULT_PLAN',
  // Failure / rejection
  'ROUTE_UNKNOWN_STAGE',
  'ROUTE_MISSING_HANDLER',
  'ROUTE_DEPENDENCY_VIOLATION',
  'ROUTE_CONTRACT_MISMATCH',
  'ROUTE_CYCLE_DETECTED',
  'ROUTE_EMPTY_PATH',
  // Diagnostic
  'ROUTE_DRIFT_DETECTED',
  'ROUTE_FALLBACK',
  'ROUTE_INCOMPATIBLE_RULE',
] as const

export type RoutingReasonCode = (typeof ROUTING_REASON_CODES)[number]

// ── Routing Rule ───────────────────────────────────────────────

export interface RoutingRuleVersion {
  major: number
  minor: number
}

export interface ContractVersionRange {
  min: string
  max: string
}

export interface CompilerScenarioCapability {
  requiresBlueprintType?: string
  requiresMode?: string
}

export interface RoutingRule {
  /** 规则唯一标识。 */
  id: string
  /** 规则版本。 */
  version: RoutingRuleVersion
  /** 兼容的契约版本范围。 */
  compatibleContracts: ContractVersionRange
  /** 适用的场景类型。 */
  scenarioKinds: CompilerScenarioKind[]
  /** 能力要求。 */
  capabilities?: CompilerScenarioCapability
  /** 允许选择的 stage id 列表。 */
  allowedStageIds: string[]
  /** 允许跳过的 stage id 列表。 */
  allowedSkippedStageIds: string[]
  /** 选择后的 reason code。 */
  reasonCode: RoutingReasonCode
  /** 是否为默认 fallback 规则。 */
  isDefault?: boolean
}

// ── Router Input / Context ─────────────────────────────────────

export interface RoutingInput {
  /** 运行上下文中的场景类型。 */
  scenarioKind: CompilerScenarioKind
  /** 候选 execution plan 中的 stage id 列表。 */
  candidateStageIds: string[]
  /** 当前 handler registry 中可用的 stage id 列表。 */
  availableHandlerStageIds: string[]
  /** 当前契约版本。 */
  contractVersion: string
  /** run ID（用于 resume/replay 绑定）。 */
  runId: number
}

// ── Routing Decision ───────────────────────────────────────────

export interface RoutingDecision {
  /** 输入签名（确定性哈希）。 */
  inputHash: string
  /** 规则版本（匹配的规则版本，default_plan 时为 null）。 */
  ruleVersion: RoutingRuleVersion | null
  /** 规则 ID（匹配的规则 ID，default_plan 时为 null）。 */
  ruleId: string | null
  /** 场景类型。 */
  scenarioKind: CompilerScenarioKind
  /** 选中的 stage id 列表（按执行顺序）。 */
  selectedStageIds: string[]
  /** 跳过的 stage id 列表。 */
  skippedStageIds: string[]
  /** 选中 stage 数量（用于 progress/observability）。 */
  selectedStageCount: number
  /** 原始候选 stage 数量。 */
  originalStageCount: number
  /** Reason code。 */
  reasonCode: RoutingReasonCode
  /** 是否为默认 fallback path。 */
  isFallback: boolean
  /** run ID（用于绑定 resume/replay）。 */
  runId: number
  /** 决策创建时间。 */
  createdAt: string
  /** 运行/项目/actor refs（用于审计，仅储存数字 ID）。 */
  auditRefs?: {
    runId: number
    actorUserId?: number
    organizationId?: number
  }
}

// ── Registry Snapshot ──────────────────────────────────────────

export interface RoutingRegistrySnapshot {
  version: string
  rules: RoutingRule[]
  ruleCount: number
}

// ── Planner Result ─────────────────────────────────────────────

export interface PlannerResult {
  decision: RoutingDecision
  valid: boolean
  errors: string[]
}

// ── Drift Diagnostic ───────────────────────────────────────────

export interface RouteDriftDiagnostic {
  runId: number
  originalRuleVersion: RoutingRuleVersion | null
  currentRegistryVersion: string
  drifts: string[]
  detectedAt: string
}

// ── 负面 fixture 检测 ──────────────────────────────────────────

/**
 * 检查 routing decision 中是否含有敏感字段。
 * 用于负面 fixture 验证。
 */
export function routingDecisionContainsSensitiveFields(decision: RoutingDecision): {
  found: boolean
  fieldPath?: string
} {
  const json = JSON.stringify(decision)
  const sensitivePatterns = [
    'prompt',
    'rawOutput',
    'artifactBody',
    'contextPacket',
    'secret',
    'token',
    'authorization',
    'apiKey',
  ]
  for (const pattern of sensitivePatterns) {
    if (json.toLowerCase().includes(pattern.toLowerCase())) {
      return { found: true, fieldPath: pattern }
    }
  }
  return { found: false }
}

// ── 管理 UI DTO（v2-5-compiler-dynamic-routing-management-ui） ──
//
// 仅低敏 refs/enums/counts。MUST NOT 包含 prompt、model output、artifact 正文、
// Context Packet 正文、secret、token、authorization 或跨组织数据。
// 响应 DTO 经 routingResponseContainsSensitiveFields() 守卫后再返回。

/**
 * 注册表快照只读投影（切片 A）。
 * 仅暴露 registry 版本、规则低敏字段与计数；规则正文不含 prompt/output/secret。
 */
export interface RoutingRegistrySnapshotView {
  version: string
  rules: RoutingRuleView[]
  ruleCount: number
}

/**
 * 规则只读投影。
 * 复用 RoutingRule 的低敏字段集合，但显式排除 capabilities 之外的任意扩展。
 */
export interface RoutingRuleView {
  id: string
  version: RoutingRuleVersion
  compatibleContracts: ContractVersionRange
  scenarioKinds: CompilerScenarioKind[]
  allowedStageIds: string[]
  allowedSkippedStageIds: string[]
  reasonCode: RoutingReasonCode
  isDefault: boolean
  enabled: boolean
  /** 来源：代码默认规则或本组织持久化规则。 */
  source: 'code_default' | 'org_persisted'
}

/**
 * per-run 路由决策摘要响应（切片 A）。
 * 复用 serializeDecisionSummary 字段 + drift diagnostics；均为低敏。
 */
export interface RoutingDecisionSummaryView {
  hasDecision: boolean
  decision: SerializedDecisionSummary | null
  drift: RouteDriftDiagnostic[]
}

/**
 * serializeDecisionSummary 的稳定结构类型（与 decision_service 输出对齐）。
 */
export interface SerializedDecisionSummary {
  inputHash: string
  ruleVersion: RoutingRuleVersion | null
  ruleId: string | null
  scenarioKind: CompilerScenarioKind
  selectedStageCount: number
  originalStageCount: number
  reasonCode: RoutingReasonCode
  isFallback: boolean
  runId: number
  createdAt: string
  selectedStageIds: string[]
  skippedStageIds: string[]
}

/**
 * 路由模拟请求（切片 C，只读 dry-run）。
 * 输入仅含 scenario kind、候选 stage、可用 handler、契约版本——不含敏感 payload。
 */
export interface RoutingSimulateRequest {
  scenarioKind: CompilerScenarioKind
  candidateStageIds: string[]
  availableHandlerStageIds: string[]
  contractVersion: string
  dependencies: { stageId: string; dependsOn: string[] }[]
}

/**
 * 路由模拟响应（切片 C）。
 * 预测决策摘要 + valid/errors；明确标注为模拟诊断而非真实执行。
 */
export interface RoutingSimulateResponse {
  simulated: true
  decision: SerializedDecisionSummary
  valid: boolean
  errors: string[]
  /** 始终为 true：模拟不创建 run、不写库、不调真实模型。 */
  noSideEffect: true
}

/**
 * 规则编排请求（切片 B，受控写流）。
 * 写动作必须经 Validator + Policy + preview/diff + 显式确认 + 审计。
 */
export interface RoutingRuleAuthoringRequest {
  id: string
  version: RoutingRuleVersion
  compatibleContracts: ContractVersionRange
  scenarioKinds: CompilerScenarioKind[]
  allowedStageIds: string[]
  allowedSkippedStageIds: string[]
  reasonCode: RoutingReasonCode
  isDefault?: boolean
  enabled: boolean
}

/**
 * 规则编排预览/差异响应（切片 B，确认前不落库）。
 */
export interface RoutingRulePreviewResponse {
  /** 旧规则（编辑/停用时存在；新增时为 null）。 */
  before: RoutingRuleView | null
  /** 应用后的新规则投影。 */
  after: RoutingRuleView
  /** 受影响的 scenario kinds。 */
  affectedScenarioKinds: CompilerScenarioKind[]
  /** 受影响的 stage ids（被选择或被跳过的并集）。 */
  affectedStageIds: string[]
  /** 确认 token；携带此 token 的二次请求才落库。 */
  confirmToken: string
  /** 始终为 true：预览不落库。 */
  previewOnly: true
}

/**
 * 规则编排确认请求（切片 B，携带 confirmToken 才落库）。
 */
export interface RoutingRuleConfirmRequest {
  confirmToken: string
}

/**
 * 规则编排落库结果（切片 B）。
 */
export interface RoutingRuleCommittedView {
  committed: true
  rule: RoutingRuleView
  auditEvent: string
}

// ── 管理 UI DTO 敏感字段守卫 ──

/**
 * 敏感字段名集合（lowercase）。
 * 命中字段名即视为敏感——不论其值。`confirmToken` 属合法操作凭证（一次性确认令牌），
 * 非 bearer/refresh/API key，不在此列；守卫按精确字段名匹配，避免把字段值里
 * 恰好含 "token" 子串的低敏数据误判为敏感。
 */
const RESPONSE_SENSITIVE_FIELD_NAMES = new Set([
  'prompt',
  'rawoutput',
  'artifactbody',
  'contextpacket',
  'secret',
  'token',
  'authorization',
  'apikey',
  'api_key',
  'password',
])

function payloadContainsSensitiveFields(payload: unknown): {
  found: boolean
  fieldPath?: string
} {
  if (payload === null || payload === undefined) return { found: false }
  if (typeof payload === 'string') return { found: false }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const r = payloadContainsSensitiveFields(item)
      if (r.found) return r
    }
    return { found: false }
  }
  if (typeof payload === 'object') {
    for (const [key, val] of Object.entries(payload as Record<string, unknown>)) {
      if (RESPONSE_SENSITIVE_FIELD_NAMES.has(key.toLowerCase())) {
        return { found: true, fieldPath: key }
      }
      const nested = payloadContainsSensitiveFields(val)
      if (nested.found) return nested
    }
  }
  return { found: false }
}

/**
 * 检查管理 UI 响应/请求 DTO 是否含有敏感字段。
 * 按字段名精确匹配（lowercase），避免把含 "token" 子串的字段值误判。
 */
export function routingResponseContainsSensitiveFields(payload: unknown): {
  found: boolean
  fieldPath?: string
} {
  return payloadContainsSensitiveFields(payload)
}

// ── 输入哈希 ───────────────────────────────────────────────────

/**
 * 为 routing input 生成确定性哈希。
 * 用于验证相同输入产生相同 decision。
 */
export function computeRoutingInputHash(input: RoutingInput): string {
  const raw = JSON.stringify({
    scenarioKind: input.scenarioKind,
    candidateStageIds: input.candidateStageIds.sort(),
    availableHandlerStageIds: input.availableHandlerStageIds.sort(),
    contractVersion: input.contractVersion,
  })
  let hash = 0
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i)
    hash |= 0
  }
  return `routing_${Math.abs(hash).toString(36)}`
}
