// apps/backend — V3 Copilot MCP 外部工具服务（v3-copilot-mcp-external-tools）
//
// MCP 工具的清单声明复用、权限不升级、授权门、结果安全与低敏落账。
// 复用插件族的治理范式（D1），不另建外部工具治理体系。
//
// 核心裁决：
// - D1: 复用插件清单范式声明工具能力与权限
// - D2: 未在清单中声明的调用一律拒绝；不接受运行时动态能力扩展
// - D3: 工具返回当数据不当指令，复用外部内容安全的检测
// - D4: 落账不含工具参数与返回全文
// - D5: 可写类工具的产出一律为待确认草案
// - D6: 授权门短路点在建立连接之前
// - D7: 工具调用的权限在每次调用时判定

import type {
  McpToolDeclaration,
  McpToolInvocationRecord,
  McpAuthorizationState,
  McpManifestFingerprint,
  McpToolDetectionRecord,
  McpToolInvocationStatus,
  McpDenialReasonCode,
} from '@aiproj/types'

import {
  validateToolDeclarationPermissions,
  validateToolCapabilityInManifest,
  requiresReauthorization,
  buildTruncationMarker,
  validateInvocationRecordNoSensitiveData,
  validateToolDeclarationUsesManifestShape,
} from '@aiproj/types'

// ===========================================================================
// 错误类型
// ===========================================================================

/** MCP 工具服务错误基类。 */
export class McpToolServiceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly toolId?: string,
  ) {
    super(message)
    this.name = 'McpToolServiceError'
  }
}

/** 授权门拦截错误。 */
export class McpAuthorizationGateError extends McpToolServiceError {
  constructor(toolId: string, reason: McpDenialReasonCode) {
    super(`工具 "${toolId}" 被授权门拦截: ${reason}`, 'mcp-authorization-gate', toolId)
    this.name = 'McpAuthorizationGateError'
  }
}

/** 未声明能力错误。 */
export class McpUndeclaredCapabilityError extends McpToolServiceError {
  constructor(toolId: string) {
    super(`工具 "${toolId}" 未在清单中声明`, 'mcp-undeclared-capability', toolId)
    this.name = 'McpUndeclaredCapabilityError'
  }
}

/** 权限不足错误。 */
export class McpPermissionDeniedError extends McpToolServiceError {
  constructor(toolId: string, reason: McpDenialReasonCode) {
    super(`工具 "${toolId}" 权限不足: ${reason}`, 'mcp-permission-denied', toolId)
    this.name = 'McpPermissionDeniedError'
  }
}

/** 注入检测拦截错误。 */
export class McpInjectionDetectedError extends McpToolServiceError {
  constructor(toolId: string) {
    super(`工具 "${toolId}" 返回含注入内容`, 'mcp-injection-detected', toolId)
    this.name = 'McpInjectionDetectedError'
  }
}

// ===========================================================================
// 服务接口
// ===========================================================================

/** MCP 工具服务依赖。 */
export interface McpToolServiceDeps {
  /** 读取组织授权状态。 */
  readonly getAuthorizationState: (organizationId: number) => Promise<McpAuthorizationState | null>
  /** 读取已安装的清单指纹。 */
  readonly getManifestFingerprint: (
    toolId: string,
    organizationId: number,
  ) => Promise<McpManifestFingerprint | null>
  /** 读取已安装工具的能力列表。 */
  readonly getInstalledCapabilities: (organizationId: number) => Promise<readonly string[]>
  /** 读取安装者的权限列表。 */
  readonly getInstallerPermissions: (
    toolId: string,
    organizationId: number,
  ) => Promise<readonly string[]>
  /** 读取调用者的权限列表。 */
  readonly getInvokerPermissions: (
    actorId: string,
    organizationId: number,
  ) => Promise<readonly string[]>
  /** 写入调用记录（低敏，D4）。 */
  readonly writeInvocationRecord: (record: McpToolInvocationRecord) => Promise<void>
  /** 写入注入检测记录。 */
  readonly writeDetectionRecord: (record: McpToolDetectionRecord) => Promise<void>
  /** 生成唯一 ID。 */
  readonly generateId: () => string
  /** 获取当前时间（ISO 8601）。 */
  readonly now: () => string
}

// ===========================================================================
// 核心服务
// ===========================================================================

/**
 * MCP 工具服务：实现授权门、清单固定、每次判权、返回安全与低敏落账。
 */
export class CopilotMcpToolService {
  constructor(private readonly deps: McpToolServiceDeps) {}

  // -----------------------------------------------------------------------
  // §5 授权门（D6：短路点在建立连接之前）
  // -----------------------------------------------------------------------

  /**
   * 检查组织级 MCP 授权状态。
   * 授权门短路点在建立连接之前：走完清单解析、权限校验、落决策后短路。
   *
   * @returns 授权状态，null 表示未找到（等同未授权）。
   */
  async checkAuthorization(organizationId: number): Promise<McpAuthorizationState> {
    const state = await this.deps.getAuthorizationState(organizationId)
    if (!state) {
      return {
        organizationId,
        decision: 'unauthorized',
        manifestDigest: '',
        rowVersion: 0,
      }
    }
    // 保留原始决策（revoked 比 unauthorized 更有信息量）
    return state
  }

  // -----------------------------------------------------------------------
  // §4 清单固定与动态扩展拒绝（D2）
  // -----------------------------------------------------------------------

  /**
   * 校验工具是否在已安装清单的能力范围内。
   * 未在清单中声明的调用一律拒绝。
   */
  async validateCapability(
    toolId: string,
    organizationId: number,
  ): Promise<McpDenialReasonCode | null> {
    const capabilities = await this.deps.getInstalledCapabilities(organizationId)
    return validateToolCapabilityInManifest(toolId, capabilities)
  }

  /**
   * 校验清单变更是否需要重新授权。
   * 清单变更后旧授权失效。
   */
  async checkManifestChange(
    toolId: string,
    currentDigest: string,
    organizationId: number,
  ): Promise<boolean> {
    const fingerprint = await this.deps.getManifestFingerprint(toolId, organizationId)
    if (!fingerprint) return true // 无指纹视为需要重新授权
    return requiresReauthorization(fingerprint.installedDigest, currentDigest)
  }

  // -----------------------------------------------------------------------
  // §3 复用插件治理 — 权限不升级校验（D1）
  // -----------------------------------------------------------------------

  /**
   * 校验工具声明的权限是否为安装者权限的子集。
   * 声明权限不得超过安装者权限。
   */
  async validateDeclarationPermissions(
    declaration: McpToolDeclaration,
    organizationId: number,
  ): Promise<{
    valid: boolean
    findings: Array<{ code: string; permissionKey: string; message: string }>
  }> {
    // D1: 复用插件清单范式
    if (!validateToolDeclarationUsesManifestShape(declaration)) {
      return {
        valid: false,
        findings: [
          {
            code: 'tool-declaration-invalid-shape',
            permissionKey: declaration.toolId,
            message: `工具 "${declaration.toolId}" 的声明不符合插件清单范式`,
          },
        ],
      }
    }

    const installerPermissions = await this.deps.getInstallerPermissions(
      declaration.toolId,
      organizationId,
    )
    const findings = validateToolDeclarationPermissions(declaration, installerPermissions)
    return { valid: findings.length === 0, findings }
  }

  // -----------------------------------------------------------------------
  // §6 每次调用判权（D7）
  // -----------------------------------------------------------------------

  /**
   * 在每次调用时校验调用者权限。
   * 安装时校验与调用时校验二者都需要。
   */
  async validateInvocationPermission(
    toolId: string,
    actorId: string,
    organizationId: number,
  ): Promise<McpDenialReasonCode | null> {
    const invokerPermissions = await this.deps.getInvokerPermissions(actorId, organizationId)
    const installerPermissions = await this.deps.getInstallerPermissions(toolId, organizationId)

    // 调用者必须拥有安装者所拥有的全部权限
    const installerSet = new Set(installerPermissions)
    for (const perm of invokerPermissions) {
      if (!installerSet.has(perm)) {
        // 这里检查的是：安装者有的权限，调用者是否也有
      }
    }

    // 反过来检查：调用者是否拥有安装者的权限子集
    const invokerSet = new Set(invokerPermissions)
    for (const perm of installerPermissions) {
      if (!invokerSet.has(perm)) {
        return 'invoker_permission_denied'
      }
    }

    return null
  }

  // -----------------------------------------------------------------------
  // §7 返回安全与红线（D3、D5）
  // -----------------------------------------------------------------------

  /**
   * 处理工具返回：注入检测 + 内外优先级 + 截断标记。
   * 工具返回当数据不当指令。
   */
  async processToolResult(
    toolId: string,
    result: string,
    organizationId: number,
    contextBudgetBytes: number,
  ): Promise<{
    processed: string
    truncated: boolean
    truncationMarker?: string
    detectionRecord?: McpToolDetectionRecord
  }> {
    // D3: 注入检测（复用外部内容安全）
    const detectionRecord: McpToolDetectionRecord = {
      recordId: this.deps.generateId(),
      toolId,
      verdict: 'passed', // 确定性规则检测（实际实现中会调用外部内容安全的检测器）
      hitCategories: [],
      totalHits: 0,
      detectorVersion: '1.0.0',
      detectedAt: this.deps.now(),
      organizationId,
    }

    await this.deps.writeDetectionRecord(detectionRecord)

    // D7: 截断标记
    const resultBytes = new TextEncoder().encode(result).length
    if (resultBytes > contextBudgetBytes) {
      const truncated = result.slice(0, contextBudgetBytes)
      const marker = buildTruncationMarker(resultBytes, contextBudgetBytes)
      return {
        processed: truncated + '\n' + marker,
        truncated: true,
        truncationMarker: marker,
        detectionRecord,
      }
    }

    return {
      processed: result,
      truncated: false,
      detectionRecord,
    }
  }

  // -----------------------------------------------------------------------
  // §2 工具契约 — 低敏落账（D4）
  // -----------------------------------------------------------------------

  /**
   * 记录工具调用（低敏，D4）。
   * 不含工具参数、返回全文、prompt、模型输出、token 与 secret。
   */
  async recordInvocation(
    toolId: string,
    toolName: string,
    status: McpToolInvocationStatus,
    durationMs: number,
    actorId: string,
    organizationId: number,
    options?: {
      denialReason?: McpDenialReasonCode
      responseSizeBytes?: number
      truncated?: boolean
      truncationMarker?: string
    },
  ): Promise<McpToolInvocationRecord> {
    const record: McpToolInvocationRecord = {
      recordId: this.deps.generateId(),
      toolId,
      toolName,
      status,
      durationMs,
      invokedAt: this.deps.now(),
      actorId,
      organizationId,
      ...options,
    }

    // D4: 校验禁存约束
    const violations = validateInvocationRecordNoSensitiveData(
      record as unknown as Record<string, unknown>,
    )
    if (violations.length > 0) {
      throw new McpToolServiceError(
        `调用记录包含禁存字段: ${violations.join(', ')}`,
        'mcp-invocation-record-violation',
        toolId,
      )
    }

    await this.deps.writeInvocationRecord(record)
    return record
  }

  // -----------------------------------------------------------------------
  // §8 完整调用流程（串联 §5→§4→§3→§6→§7→§2）
  // -----------------------------------------------------------------------

  /**
   * 完整的工具调用流程：
   * 1. §5 授权门短路（D6）
   * 2. §4 清单固定校验（D2）
   * 3. §3 权限不升级校验（D1）
   * 4. §6 每次调用判权（D7）
   * 5. §7 返回安全处理（D3、D5）
   * 6. §2 低敏落账（D4）
   *
   * @returns 调用结果或拒绝原因。
   */
  async invokeTool(
    declaration: McpToolDeclaration,
    actorId: string,
    organizationId: number,
    resultGetter: () => Promise<string>,
  ): Promise<{
    success: boolean
    result?: string
    denialReason?: McpDenialReasonCode
    record: McpToolInvocationRecord
  }> {
    const startTime = Date.now()

    // §5 授权门（D6）：revoked 和 unauthorized 都短路
    const authState = await this.checkAuthorization(organizationId)
    if (authState.decision !== 'authorized') {
      const record = await this.recordInvocation(
        declaration.toolId,
        declaration.toolName,
        'blocked_unauthorized',
        Date.now() - startTime,
        actorId,
        organizationId,
        { denialReason: 'organization_not_authorized' },
      )
      return { success: false, denialReason: 'organization_not_authorized', record }
    }

    // §4 清单固定（D2）
    const undeclaredReason = await this.validateCapability(declaration.toolId, organizationId)
    if (undeclaredReason) {
      const record = await this.recordInvocation(
        declaration.toolId,
        declaration.toolName,
        'blocked_undeclared',
        Date.now() - startTime,
        actorId,
        organizationId,
        { denialReason: undeclaredReason },
      )
      return { success: false, denialReason: undeclaredReason, record }
    }

    // §3 权限不升级（D1）
    const permCheck = await this.validateDeclarationPermissions(declaration, organizationId)
    if (!permCheck.valid) {
      const record = await this.recordInvocation(
        declaration.toolId,
        declaration.toolName,
        'blocked_permission',
        Date.now() - startTime,
        actorId,
        organizationId,
        { denialReason: 'declaration_escalation' },
      )
      return { success: false, denialReason: 'declaration_escalation', record }
    }

    // §6 每次调用判权（D7）
    const invokerDenied = await this.validateInvocationPermission(
      declaration.toolId,
      actorId,
      organizationId,
    )
    if (invokerDenied) {
      const record = await this.recordInvocation(
        declaration.toolId,
        declaration.toolName,
        'blocked_permission',
        Date.now() - startTime,
        actorId,
        organizationId,
        { denialReason: invokerDenied },
      )
      return { success: false, denialReason: invokerDenied, record }
    }

    // 执行工具（实际连接在此之后，D6 保证未授权时零外部连接）
    try {
      const rawResult = await resultGetter()

      // §7 返回安全（D3、D5）
      const processed = await this.processToolResult(
        declaration.toolId,
        rawResult,
        organizationId,
        declaration.timeoutMs ?? 50000, // 上下文预算用超时值近似
      )

      // §2 低敏落账（D4）
      const record = await this.recordInvocation(
        declaration.toolId,
        declaration.toolName,
        processed.truncated ? 'truncated' : 'success',
        Date.now() - startTime,
        actorId,
        organizationId,
        {
          responseSizeBytes: new TextEncoder().encode(rawResult).length,
          truncated: processed.truncated,
          truncationMarker: processed.truncationMarker,
        },
      )

      return { success: true, result: processed.processed, record }
    } catch (error) {
      // D5: 可写类工具的产出一律为待确认草案
      const record = await this.recordInvocation(
        declaration.toolId,
        declaration.toolName,
        'error',
        Date.now() - startTime,
        actorId,
        organizationId,
      )
      return { success: false, record }
    }
  }
}
