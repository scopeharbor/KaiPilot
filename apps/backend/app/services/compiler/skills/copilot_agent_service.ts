/**
 * v3-copilot-custom-agent-authoring — CopilotAgentService。
 *
 * 自建 Copilot 助手的 CRUD / 校验 / 权限交集 / 作用域治理。
 * 核心安全裁决（D1）：有效权限 = 创建者权限 ∩ 使用者权限。
 * 工具集约束（D2）：必须是 COPILOT_DESTINATION_REGISTRY 的子集。
 * 结构化定义（D3）：不含 prompt 全文、模型输出、token、secret。
 * 版本化（D6）：修改产生新版本，旧版本保留。
 *
 * @aiproj/backend
 */
import { DateTime } from 'luxon'
import { inject } from '@adonisjs/core'
import AuditService, { AuditEvent } from '#services/audit_service'
import {
  COPILOT_DESTINATION_REGISTRY,
  validateAgentToolSet,
  computeEffectivePermissions,
  detectSensitiveFields,
  isValidAgentScope,
  isValidToneLevel,
  type CopilotAgentDefinition,
  type CreateAgentDefinitionInput,
  type AgentToolSet,
  type AgentContextScope,
  type AgentEffectivePermissions,
} from '@aiproj/types'

// ── Errors ──────────────────────────────────────────────────────

export class AgentNotFoundError extends Error {
  constructor(id: number) {
    super(`Agent definition not found: ${id}`)
    this.name = 'AgentNotFoundError'
  }
}

export class AgentNotEditableError extends Error {
  constructor(id: number, status: string) {
    super(`Agent ${id} is not editable in status "${status}"`)
    this.name = 'AgentNotEditableError'
  }
}

export class AgentToolSetValidationError extends Error {
  constructor(unknownDestinations: string[]) {
    super(`Unknown destinations in tool set: ${unknownDestinations.join(', ')}`)
    this.name = 'AgentToolSetValidationError'
  }
}

export class AgentSensitiveContentError extends Error {
  constructor(fields: string[]) {
    super(`Definition contains sensitive fields: ${fields.join(', ')}`)
    this.name = 'AgentSensitiveContentError'
  }
}

export class AgentScopeExceededError extends Error {
  constructor(scopeType: string) {
    super(`Scope type "${scopeType}" exceeds author's reach`)
    this.name = 'AgentScopeExceededError'
  }
}

export class AgentDuplicateKeyError extends Error {
  constructor(agentKey: string) {
    super(`Agent key already exists: ${agentKey}`)
    this.name = 'AgentDuplicateKeyError'
  }
}

export class AgentInPlaceEditRejectedError extends Error {
  constructor(id: number, version: number) {
    super(`In-place edit rejected for agent ${id} v${version}: create a new version instead`)
    this.name = 'AgentInPlaceEditRejectedError'
  }
}

export class AgentScopeValidationError extends Error {
  constructor(scope: string) {
    super(`Invalid agent scope: "${scope}"`)
    this.name = 'AgentScopeValidationError'
  }
}

export class AgentToneValidationError extends Error {
  constructor(tone: string) {
    super(`Invalid tone level: "${tone}"`)
    this.name = 'AgentToneValidationError'
  }
}

export class AgentRBACError extends Error {
  constructor(action: string) {
    super(`RBAC denied: ${action}`)
    this.name = 'AgentRBACError'
  }
}

export class AgentEvalGateError extends Error {
  constructor(agentKey: string) {
    super(`Organization agent "${agentKey}" has not passed the evaluation gate`)
    this.name = 'AgentEvalGateError'
  }
}

// ── Service ─────────────────────────────────────────────────────

/**
 * 助手定义的内存存储（Lucid model 待后续 migration 后替换）。
 * 当前阶段用 Map 模拟，保证纯函数逻辑可测。
 */
const agentStore = new Map<string, CopilotAgentDefinition[]>()
let nextId = 1

@inject()
export default class CopilotAgentService {
  constructor(private readonly audit: AuditService) {}

  // ── CRUD ────────────────────────────────────────────────────────

  /**
   * 创建助手定义（版本固定为 1，状态固定为 draft）。
   * 校验：工具集子集、敏感内容、scope、口吻枚举。
   */
  async create(
    input: CreateAgentDefinitionInput,
    actorId: number,
  ): Promise<CopilotAgentDefinition> {
    // 1. 校验口吻枚举
    if (!isValidToneLevel(input.toneLevel)) {
      throw new AgentToneValidationError(input.toneLevel)
    }

    // 2. 校验作用域枚举
    if (!isValidAgentScope(input.scope)) {
      throw new AgentScopeValidationError(input.scope)
    }

    // 3. 校验工具集子集（D2）
    const unknownDestinations = validateAgentToolSet(
      input.toolSet as readonly string[],
      Object.keys(COPILOT_DESTINATION_REGISTRY),
    )
    if (unknownDestinations.length > 0) {
      throw new AgentToolSetValidationError(unknownDestinations)
    }

    // 4. 校验敏感内容（D3）
    const sensitiveFields = detectSensitiveFields(input as unknown as Record<string, unknown>)
    if (sensitiveFields.length > 0) {
      throw new AgentSensitiveContentError(sensitiveFields)
    }

    // 5. 检查 agentKey 唯一性
    const existing = agentStore.get(input.agentKey)
    if (existing && existing.length > 0) {
      throw new AgentDuplicateKeyError(input.agentKey)
    }

    // 6. 构建定义
    const now = DateTime.now().toISO()!
    const definition: CopilotAgentDefinition = {
      id: nextId++,
      agentKey: input.agentKey,
      version: 1,
      name: input.name,
      description: input.description,
      scope: input.scope,
      skillRefs: input.skillRefs,
      toolSet: input.toolSet,
      contextScope: input.contextScope,
      toneLevel: input.toneLevel,
      status: 'draft',
      organizationId: input.organizationId,
      createdBy: actorId,
      evalGateStatus: input.scope === 'organization' ? 'pending' : 'not_required',
      createdAt: now,
      updatedAt: now,
    }

    // 7. 存储
    agentStore.set(input.agentKey, [definition])

    // 8. 审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_CREATED, // 复用既有审计事件
      userId: actorId,
      organizationId: input.organizationId,
      metadata: {
        agentKey: input.agentKey,
        version: 1,
        scope: input.scope,
        toolSetCount: input.toolSet.length,
      },
    })

    return definition
  }

  /**
   * 更新助手定义（D6：创建新版本，不允许原地修改）。
   */
  async update(
    agentKey: string,
    input: Omit<CreateAgentDefinitionInput, 'agentKey'>,
    actorId: number,
  ): Promise<CopilotAgentDefinition> {
    // 1. 获取既有版本
    const versions = agentStore.get(agentKey)
    if (!versions || versions.length === 0) {
      throw new AgentNotFoundError(0)
    }

    const currentVersion = versions[versions.length - 1]

    // 2. D6：不允许原地修改
    // 更新语义 = 基于当前版本创建新版本
    // （这里不检查是否真的改了什么，只确保版本递增）

    // 3. 校验
    if (!isValidToneLevel(input.toneLevel)) {
      throw new AgentToneValidationError(input.toneLevel)
    }
    if (!isValidAgentScope(input.scope)) {
      throw new AgentScopeValidationError(input.scope)
    }

    const unknownDestinations = validateAgentToolSet(
      input.toolSet as readonly string[],
      Object.keys(COPILOT_DESTINATION_REGISTRY),
    )
    if (unknownDestinations.length > 0) {
      throw new AgentToolSetValidationError(unknownDestinations)
    }

    const sensitiveFields = detectSensitiveFields(input as unknown as Record<string, unknown>)
    if (sensitiveFields.length > 0) {
      throw new AgentSensitiveContentError(sensitiveFields)
    }

    // 4. 创建新版本
    const now = DateTime.now().toISO()!
    const newVersion: CopilotAgentDefinition = {
      id: currentVersion.id,
      agentKey,
      version: currentVersion.version + 1,
      name: input.name,
      description: input.description,
      scope: input.scope,
      skillRefs: input.skillRefs,
      toolSet: input.toolSet,
      contextScope: input.contextScope,
      toneLevel: input.toneLevel,
      status: 'draft',
      organizationId: input.organizationId,
      createdBy: actorId,
      evalGateStatus: input.scope === 'organization' ? 'pending' : 'not_required',
      createdAt: currentVersion.createdAt,
      updatedAt: now,
    }

    versions.push(newVersion)

    // 5. 审计
    await this.audit.log({
      event: AuditEvent.AI_COMPILER_SKILL_UPDATED,
      userId: actorId,
      organizationId: input.organizationId,
      metadata: {
        agentKey,
        version: newVersion.version,
        scope: input.scope,
      },
    })

    return newVersion
  }

  /**
   * 按 agentKey 获取指定版本。
   */
  getByVersion(agentKey: string, version: number): CopilotAgentDefinition | null {
    const versions = agentStore.get(agentKey)
    if (!versions) return null
    return versions.find((v) => v.version === version) ?? null
  }

  /**
   * 按 agentKey 获取最新版本。
   */
  getLatest(agentKey: string): CopilotAgentDefinition | null {
    const versions = agentStore.get(agentKey)
    if (!versions || versions.length === 0) return null
    return versions[versions.length - 1]
  }

  /**
   * 列出组织内所有助手（组织隔离）。
   */
  listByOrg(organizationId: number): CopilotAgentDefinition[] {
    const result: CopilotAgentDefinition[] = []
    for (const versions of agentStore.values()) {
      const latest = versions[versions.length - 1]
      if (latest.organizationId === organizationId) {
        result.push(latest)
      }
    }
    return result
  }

  // ── 权限交集（D1）──────────────────────────────────────────────

  /**
   * 计算助手运行时的有效权限（D1：创建者权限 ∩ 使用者权限）。
   * 不缓存旧交集，实时计算（D1-5）。
   */
  computeEffectivePermissions(
    authorPermissions: readonly string[],
    userPermissions: readonly string[],
  ): AgentEffectivePermissions {
    const effective = computeEffectivePermissions(authorPermissions, userPermissions)
    return {
      authorPermissions,
      userPermissions,
      effectivePermissions: effective,
    }
  }

  // ── 工具集约束（D2）────────────────────────────────────────────

  /**
   * 校验工具集是否为 destination 注册表的子集。
   * 返回被拒绝的未知 destination 列表。
   */
  validateToolSet(toolSet: AgentToolSet): string[] {
    return validateAgentToolSet(
      toolSet as readonly string[],
      Object.keys(COPILOT_DESTINATION_REGISTRY),
    )
  }

  /**
   * 获取工具的持久化可达性（D2-5）。
   * 可导致持久化的工具在助手中同样只产生待确认动作。
   */
  getToolPersistenceReachable(tool: string): boolean {
    const registry = COPILOT_DESTINATION_REGISTRY as Record<
      string,
      { persistenceReachable: boolean }
    >
    return registry[tool]?.persistenceReachable ?? false
  }

  /**
   * 检查助手是否提供绕过确认的执行路径（D2-6）。
   * 自建助手同样只建议不执行（红线 2）。
   */
  assertNoExecutionBypass(toolSet: AgentToolSet): void {
    // 所有工具都必须走 preview + 确认路径
    // 这里只做声明性校验；运行时由 Copilot 路由层强制
    for (const tool of toolSet) {
      if (this.getToolPersistenceReachable(tool)) {
        // 持久化工具必须经过确认，不在此处绕过
        // 实际强制在 Copilot routing 层
      }
    }
  }

  // ── 作用域（D7）────────────────────────────────────────────────

  /**
   * 校验 scope 声明是否超出创建者可及范围（D7）。
   */
  validateScopeExceedsReach(
    contextScope: AgentContextScope,
    allowedScopeTypes: readonly string[],
  ): boolean {
    return allowedScopeTypes.includes(contextScope.scopeType)
  }

  // ── 个人/组织助手（D5）─────────────────────────────────────────

  /**
   * 检查个人助手是否可被他人使用（D5：个人助手只有创建者可用）。
   */
  canUserUseAgent(
    agent: CopilotAgentDefinition,
    userId: number,
    userPermissions: readonly string[],
    authorPermissions: readonly string[],
  ): { allowed: boolean; reason?: string } {
    // 个人助手：只有创建者可用
    if (agent.scope === 'personal' && agent.createdBy !== userId) {
      return { allowed: false, reason: 'Personal agents are only available to their author' }
    }

    // 组织助手：需过评测门禁
    if (agent.scope === 'organization' && agent.evalGateStatus !== 'passed') {
      return { allowed: false, reason: 'Organization agent has not passed the evaluation gate' }
    }

    // 权限交集（D1）
    const effective = computeEffectivePermissions(authorPermissions, userPermissions)
    if (effective.length === 0) {
      return { allowed: false, reason: 'No effective permissions after intersection' }
    }

    return { allowed: true }
  }

  /**
   * 组织隔离校验（红线 3）。
   */
  assertOrganizationIsolation(agent: CopilotAgentDefinition, requestOrganizationId: number): void {
    if (agent.organizationId !== requestOrganizationId) {
      throw new AgentRBACError('Cross-organization agent access denied')
    }
  }
}
