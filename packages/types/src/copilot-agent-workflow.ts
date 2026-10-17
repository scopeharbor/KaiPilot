/**
 * @aiproj/types — V3 Copilot Agent Workflow Orchestration 契约
 * v3-copilot-agent-workflow-orchestration
 *
 * 纯类型 + 确定性纯函数。零外部依赖。
 *
 * 核心裁决（本契约承载）：
 * - D1：只读步骤可连续执行，变更类步骤逐个停确认点（红线 2）
 * - D2：复用 Compiler run 状态机，不新建
 * - D3：回放确定性——输入 + 步骤定义 → 同一轨迹；模型只写叙述
 * - D4：预算与限流每步各判一次
 * - D5：失败不回滚已确认变更
 * - D6：轨迹记录只存引用与状态
 * - D7：最大步数与最长时长有硬上限
 */

// ===========================================================================
// 步骤类型
// ===========================================================================

export const ORCHESTRATION_STEP_KINDS = ['readonly', 'mutation'] as const
export type OrchestrationStepKind = (typeof ORCHESTRATION_STEP_KINDS)[number]

export function isOrchestrationStepKind(v: unknown): v is OrchestrationStepKind {
  return typeof v === 'string' && (ORCHESTRATION_STEP_KINDS as readonly string[]).includes(v)
}

// ===========================================================================
// 步骤状态
// ===========================================================================

export const ORCHESTRATION_STEP_STATES = [
  'pending',
  'running',
  'completed',
  'failed',
  'paused',
  'cancelled',
] as const
export type OrchestrationStepState = (typeof ORCHESTRATION_STEP_STATES)[number]

export function isOrchestrationStepState(v: unknown): v is OrchestrationStepState {
  return typeof v === 'string' && (ORCHESTRATION_STEP_STATES as readonly string[]).includes(v)
}

// ===========================================================================
// 编排状态（复用 Compiler run 状态机）
// ===========================================================================

export const ORCHESTRATION_STATES = [
  'pending',
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'needs_human_review',
] as const
export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number]

export function isOrchestrationState(v: unknown): v is OrchestrationState {
  return typeof v === 'string' && (ORCHESTRATION_STATES as readonly string[]).includes(v)
}

// ===========================================================================
// 编排步骤定义
// ===========================================================================

export interface OrchestrationStepDefinition {
  /** 步骤唯一 ID（编排内唯一） */
  stepId: string
  /** 步骤类型：readonly / mutation */
  kind: OrchestrationStepKind
  /** 步骤标题（界面展示用） */
  title: string
  /** 步骤描述：此步骤将做什么 */
  description: string
  /** 步骤将变更的目标实体列表（mutation 步骤必填，用于确认点展示） */
  targets?: string[]
  /** 步骤依赖的前置步骤 ID 列表 */
  dependsOn?: string[]
}

// ===========================================================================
// 编排定义（完整编排的步骤清单）
// ===========================================================================

export interface OrchestrationDefinition {
  /** 编排 ID */
  orchestrationId: string
  /** 编排名称 */
  name: string
  /** 步骤定义列表（按执行顺序排列） */
  steps: OrchestrationStepDefinition[]
  /** 创建编排的会话 ID */
  sessionId: string
  /** 创建编排的用户 ID */
  userId: number
  /** 所属组织 ID */
  organizationId: number
}

// ===========================================================================
// 轨迹记录（D6：只存引用与状态）
// ===========================================================================

export interface OrchestrationStepTrace {
  /** 步骤 ID（对应 OrchestrationStepDefinition.stepId） */
  stepId: string
  /** 步骤当前状态 */
  status: OrchestrationStepState
  /** 开始时间（ISO 8601） */
  startedAt?: string
  /** 完成时间（ISO 8601） */
  completedAt?: string
  /** 耗时（毫秒） */
  durationMs?: number
  /** 产出引用（artifact ID，不存正文） */
  artifactRef?: string
  /** 错误信息（失败时） */
  error?: string
}

export interface OrchestrationTrace {
  /** 编排 ID */
  orchestrationId: string
  /** 编排当前状态 */
  status: OrchestrationState
  /** 步骤轨迹列表 */
  steps: OrchestrationStepTrace[]
  /** 创建时间（ISO 8601） */
  createdAt: string
  /** 最后更新时间（ISO 8601） */
  updatedAt: string
}

// ===========================================================================
// 禁存约束（D6）
// ===========================================================================

/** 轨迹记录中禁止出现的字段名模式 */
export const TRACE_FORBIDDEN_FIELDS = [
  'prompt',
  'modelOutput',
  'model_output',
  'fullOutput',
  'full_output',
  'token',
  'secret',
  'apiKey',
  'api_key',
  'authorization',
] as const

/** 禁存检测：检查轨迹对象是否包含禁止字段 */
export function traceContainsForbiddenFields(trace: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const key of Object.keys(trace)) {
    const lower = key.toLowerCase()
    for (const forbidden of TRACE_FORBIDDEN_FIELDS) {
      if (lower === forbidden.toLowerCase() || lower.includes(forbidden.toLowerCase())) {
        found.push(key)
      }
    }
  }
  return found
}

/** 检查值中是否包含敏感标记（sk-、token: 等） */
export function containsWorkflowSensitiveMarkers(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/,
    /token:\s*\S+/i,
    /api[_-]?key:\s*\S+/i,
    /secret:\s*\S+/i,
    /password:\s*\S+/i,
  ]
  return patterns.some((p) => p.test(value))
}

// ===========================================================================
// 常量（D7：最大步数与最长时长）
// ===========================================================================

/** 编排最大步数上限（默认值，组织可下调） */
export const DEFAULT_MAX_STEPS = 20

/** 编排最长时长上限（毫秒，默认值，组织可下调） */
export const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000 // 30 分钟

/** 编排 run_type 枚举值 */
export const ORCHESTRATION_RUN_TYPE = 'copilot_orchestration' as const
export const COMPILER_RUN_TYPE = 'compiler' as const

// ===========================================================================
// Run 类型扩展
// ===========================================================================

export const COMPILER_RUN_TYPES = ['compiler', 'copilot_orchestration'] as const
export type CompilerRunType = (typeof COMPILER_RUN_TYPES)[number]

export function isCompilerRunType(v: unknown): v is CompilerRunType {
  return typeof v === 'string' && (COMPILER_RUN_TYPES as readonly string[]).includes(v)
}

// ===========================================================================
// 确认点（变更步骤确认）
// ===========================================================================

export interface OrchestrationStepConfirmation {
  /** 步骤 ID */
  stepId: string
  /** 用户决策：confirm / reject / modify */
  decision: 'confirm' | 'reject' | 'modify'
  /** 用户备注（modify 时必填） */
  note?: string
}

// ===========================================================================
// 上限配置（组织可调）
// ===========================================================================

export interface OrchestrationCeilingConfig {
  /** 最大步数（null 使用默认值 DEFAULT_MAX_STEPS） */
  maxSteps: number | null
  /** 最长时长毫秒（null 使用默认值 DEFAULT_MAX_DURATION_MS） */
  maxDurationMs: number | null
}

/** 验证上调被拒：新值不能大于声明上限 */
export function isCeilingRaiseAttempt(
  current: OrchestrationCeilingConfig,
  proposed: OrchestrationCeilingConfig,
): boolean {
  const currentMaxSteps = current.maxSteps ?? DEFAULT_MAX_STEPS
  const proposedMaxSteps = proposed.maxSteps ?? DEFAULT_MAX_STEPS
  const currentMaxDuration = current.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const proposedMaxDuration = proposed.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  return proposedMaxSteps > currentMaxSteps || proposedMaxDuration > currentMaxDuration
}

// ===========================================================================
// 编排运行结果
// ===========================================================================

export interface OrchestrationRunResult {
  /** 编排 ID */
  orchestrationId: string
  /** 是否全部完成 */
  completed: boolean
  /** 当前状态 */
  status: OrchestrationState
  /** 已完成步骤数 */
  completedSteps: number
  /** 总步骤数 */
  totalSteps: number
  /** 失败步骤 ID（如有） */
  failedStepId?: string
  /** 错误信息（如有） */
  error?: string
  /** 是否暂停等待用户决策 */
  awaitingDecision?: boolean
}
