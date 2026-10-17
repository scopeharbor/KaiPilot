/**
 * v3-copilot-custom-agent-authoring — 自建 Copilot 助手共享契约。
 *
 * 设计约束（D1-D7）：
 * - 权限交集（D1）：助手有效权限 = 创建者权限 ∩ 使用者权限
 * - 工具集子集（D2）：必须是 COPILOT_DESTINATION_REGISTRY 的子集
 * - 结构化定义（D3）：不含 prompt 全文、模型输出、token、secret
 * - 同一注入路径（D4）：自建 Skill 与内置 Skill 走同一路径
 * - 两级作用域（D5）：个人 / 组织
 * - 版本化（D6）：修改产生新版本，旧版本保留
 * - Scope 不越界（D7）：不得超出创建者可及范围
 *
 * 本模块是纯类型 + 确定性纯函数，零运行时依赖。
 */

import type { CopilotDestination } from './copilot-shared-contracts.js'

// ===========================================================================
// 枚举 — 助手可见性作用域（D5）
// ===========================================================================

/** 助手作用域：个人 = 只有创建者可用；组织 = 可被组织内他人使用（需 RBAC 授权 + 评测门禁）。 */
export const AGENT_SCOPES = ['personal', 'organization'] as const
export type AgentScope = (typeof AGENT_SCOPES)[number]

// ===========================================================================
// 枚举 — 口吻档位（D3）
// ===========================================================================

/** 口吻档位：枚举而非自由文本，防止 prompt 注入面。 */
export const AGENT_TONE_LEVELS = ['concise', 'standard', 'detailed'] as const
export type AgentToneLevel = (typeof AGENT_TONE_LEVELS)[number]

/** 口吻档位的人读标签。 */
export const AGENT_TONE_LEVEL_LABELS: Record<AgentToneLevel, string> = {
  concise: '简洁',
  standard: '标准',
  detailed: '详尽',
}

// ===========================================================================
// 类型 — Skill 引用
// ===========================================================================

/** 助手中绑定的 Skill 引用（指向 compiler_skills 表的 skillKey + version）。 */
export interface AgentSkillRef {
  /** Skill 的唯一标识（compiler_skills.skill_key）。 */
  readonly skillKey: string
  /** Skill 版本（compiler_skills.version）。 */
  readonly version: string
  /** 激活优先级（数字越小优先级越高；多 Skill 绑定时决定激活顺序）。 */
  readonly priority: number
}

// ===========================================================================
// 类型 — 上下文 Scope 声明
// ===========================================================================

/** 助手声明的上下文作用域。 */
export interface AgentContextScope {
  /**
   * 作用域类型：global / organization / project / portfolio / entity。
   * 声明不得超出创建者可及范围（D7），运行时按权限交集二次裁剪。
   */
  readonly scopeType: 'global' | 'organization' | 'project' | 'portfolio' | 'entity'

  /** 当 scopeType 为 project 时，绑定的项目 ID 列表。为空则表示"所有可见项目"。 */
  readonly projectIds?: readonly number[]

  /** 当 scopeType 为 portfolio 时，绑定的组合 ID 列表。 */
  readonly portfolioIds?: readonly number[]
}

// ===========================================================================
// 类型 — 工具集声明
// ===========================================================================

/** 助手声明的可用工具集（COPILOT_DESTINATION_REGISTRY 的子集）。 */
export type AgentToolSet = readonly CopilotDestination[]

// ===========================================================================
// 主类型 — 助手定义
// ===========================================================================

/** 助手定义的生命周期状态。 */
export const AGENT_DEFINITION_STATUSES = ['draft', 'active', 'archived'] as const
export type AgentDefinitionStatus = (typeof AGENT_DEFINITION_STATUSES)[number]

/**
 * 自建 Copilot 助手定义（版本化）。
 *
 * 结构化配置，不含 prompt 全文、模型输出、token 或 secret（D3）。
 * 每次修改产生新版本，旧版本保留（D6）。
 */
export interface CopilotAgentDefinition {
  /** 唯一标识符（跨版本不变）。 */
  readonly id: number

  /** 助手标识符（跨版本不变，类似 compiler_skills.skill_key）。 */
  readonly agentKey: string

  /** 版本号（每次修改递增）。 */
  readonly version: number

  /** 助手名称。 */
  readonly name: string

  /** 助手描述。 */
  readonly description: string

  /** 可见性作用域（D5）。 */
  readonly scope: AgentScope

  /** 绑定的 Skill 引用集合（可多个，按 priority 排序）。 */
  readonly skillRefs: readonly AgentSkillRef[]

  /** 声明的可用工具集（COPILOT_DESTINATION_REGISTRY 子集，D2）。 */
  readonly toolSet: AgentToolSet

  /** 上下文作用域声明（D7）。 */
  readonly contextScope: AgentContextScope

  /** 口吻档位（枚举，D3）。 */
  readonly toneLevel: AgentToneLevel

  /** 生命周期状态。 */
  readonly status: AgentDefinitionStatus

  /** 组织 ID（组织隔离，红线 3）。 */
  readonly organizationId: number

  /** 创建者用户 ID。 */
  readonly createdBy: number

  /** 评测门禁状态（组织助手需过门禁才能开放，D5）。 */
  readonly evalGateStatus: 'pending' | 'passed' | 'failed' | 'not_required'

  /** 创建时间（ISO 8601）。 */
  readonly createdAt: string

  /** 最后更新时间（ISO 8601）。 */
  readonly updatedAt: string
}

// ===========================================================================
// 类型 — 助手定义创建输入
// ===========================================================================

/**
 * 创建助手定义的输入（不含 id, version, status, createdAt, updatedAt, evalGateStatus）。
 * 创建时版本固定为 1，状态固定为 draft。
 */
export interface CreateAgentDefinitionInput {
  readonly agentKey: string
  readonly name: string
  readonly description: string
  readonly scope: AgentScope
  readonly skillRefs: readonly AgentSkillRef[]
  readonly toolSet: AgentToolSet
  readonly contextScope: AgentContextScope
  readonly toneLevel: AgentToneLevel
  readonly organizationId: number
  readonly createdBy: number
}

// ===========================================================================
// 类型 — 助手定义更新输入
// ===========================================================================

/**
 * 更新助手定义的输入（D6：更新 = 创建新版本，不允许原地修改）。
 * 语义上与 CreateAgentDefinitionInput 相同，但操作语义是"基于当前版本创建新版本"。
 */
export type UpdateAgentDefinitionInput = Omit<CreateAgentDefinitionInput, 'agentKey'>

// ===========================================================================
// 类型 — 运行时有效权限
// ===========================================================================

/**
 * 助手运行时的有效权限（D1：创建者权限 ∩ 使用者权限）。
 * 不是持久化字段，而是运行时计算结果。
 */
export interface AgentEffectivePermissions {
  /** 创建者的权限集合。 */
  readonly authorPermissions: readonly string[]
  /** 使用者的权限集合。 */
  readonly userPermissions: readonly string[]
  /** 有效权限 = 交集。 */
  readonly effectivePermissions: readonly string[]
}

// ===========================================================================
// 纯函数 — 校验与工具
// ===========================================================================

/**
 * 校验工具集是否为 COPILOT_DESTINATION_REGISTRY 的子集。
 * 返回被拒绝的未知 destination 列表（空 = 全部合法）。
 */
export function validateAgentToolSet<T extends string>(
  toolSet: readonly T[],
  validDestinations: readonly string[],
): T[] {
  const validSet = new Set(validDestinations)
  return toolSet.filter((t) => !validSet.has(t))
}

/**
 * 计算有效权限（D1：交集）。
 * 任一侧缺失即缺席，不取并集也不取创建者权限。
 */
export function computeEffectivePermissions(
  authorPermissions: readonly string[],
  userPermissions: readonly string[],
): string[] {
  const userSet = new Set(userPermissions)
  return authorPermissions.filter((p) => userSet.has(p))
}

/**
 * 校验 scope 声明是否超出创建者可及范围（D7）。
 * 简化版：检查 scopeType 是否在允许范围内。
 * 完整版需要查询创建者的实际权限，由后端 Service 层实现。
 */
export function validateAgentScopeDeclaration(
  scope: AgentContextScope,
  allowedScopeTypes: readonly string[],
): boolean {
  return allowedScopeTypes.includes(scope.scopeType)
}

/**
 * 校验定义是否包含敏感内容（D3：禁存边界）。
 * 检查是否有 prompt 全文、token、secret 等字段。
 * 返回发现的敏感字段名列表（空 = 安全）。
 */
export function detectSensitiveFields(definition: Record<string, unknown>): string[] {
  const sensitiveKeys = [
    'prompt',
    'systemPrompt',
    'systemPromptText',
    'modelOutput',
    'token',
    'secret',
    'apiKey',
    'authorization',
    'password',
    'accessToken',
    'refreshToken',
  ]
  return sensitiveKeys.filter((key) => {
    const value = definition[key]
    return value !== undefined && value !== null && value !== ''
  })
}

/**
 * 校验口吻是否为合法枚举值（D3）。
 */
export function isValidToneLevel(value: string): value is AgentToneLevel {
  return (AGENT_TONE_LEVELS as readonly string[]).includes(value)
}

/**
 * 校验作用域是否为合法枚举值（D5）。
 */
export function isValidAgentScope(value: string): value is AgentScope {
  return (AGENT_SCOPES as readonly string[]).includes(value)
}
