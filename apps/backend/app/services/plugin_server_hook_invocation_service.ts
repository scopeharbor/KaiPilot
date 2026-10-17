/**
 * v3-compiler-hook-plugin-pilot —— PluginServerHookInvocationService（W4b 宿主调用边界）。
 *
 * 职责：
 * 1. preflight（复用既有 Policy 链）先于回调执行；
 * 2. 回调返回后 schema 校验；
 * 3. 回调失败/超时（契约层常量上限）按来源跳过并计数降级；
 * 4. 提案登记与确认执行（摘要绑定校验）。
 */
import { inject } from '@adonisjs/core'
import RbacPolicy from '#policies/rbac_policy'
import type User from '#models/user'
import OrganizationMember from '#models/organization_member'
import AuditService from '#services/audit_service'
import { isPermission } from '#rbac'
import {
  bucketDuration,
  computeProposalSummary,
  normalizeHealthReasonCode,
  validateProposalSummaryBinding,
  PLUGIN_ACTION_SCHEMA_VERSION,
  isPluginActionKind,
  validatePluginActionProposal,
  type PluginRuntimeHealthOutcome,
  type PluginServerHookQueryRequest,
  type PluginServerHookQueryResult,
  type PluginServerHookProposalRequest,
  type PluginServerHookProposalResult,
  type PluginServerHookCallbackHandle,
  type PluginServerHookDegradationCount,
  type PluginServerHookProposalConfirmRequest,
  type PluginServerHookProposalConfirmResult,
} from '@aiproj/types'
import { PluginActionBoundaryService } from '#services/plugin_action_boundary/boundary_service'

/** 超时上限（毫秒） */
const CALLBACK_TIMEOUT_MS = 5000

/** 单次宿主 run 的只读 hook 调用上限；调用方仅可进一步收紧。 */
export const DEFAULT_SERVER_HOOK_CALL_QUOTA = 1000

/** 回调句柄注册表（进程内确定性函数句柄） */
const callbackRegistry = new Map<
  PluginServerHookCallbackHandle,
  (
    request: PluginServerHookQueryRequest | PluginServerHookProposalRequest,
  ) => Promise<PluginServerHookQueryResult | PluginServerHookProposalResult>
>()

/** 注册回调句柄（供 pilot 插件等注册确定性回调） */
export function registerServerHookCallback(
  handle: PluginServerHookCallbackHandle,
  callback: (
    request: PluginServerHookQueryRequest | PluginServerHookProposalRequest,
  ) => Promise<PluginServerHookQueryResult | PluginServerHookProposalResult>,
): void {
  callbackRegistry.set(handle, callback)
}

/** 注销回调句柄 */
export function unregisterServerHookCallback(handle: PluginServerHookCallbackHandle): void {
  callbackRegistry.delete(handle)
}

/** 获取回调句柄（测试用） */
export function getServerHookCallback(
  handle: PluginServerHookCallbackHandle,
):
  | ((
      request: PluginServerHookQueryRequest | PluginServerHookProposalRequest,
    ) => Promise<PluginServerHookQueryResult | PluginServerHookProposalResult>)
  | undefined {
  return callbackRegistry.get(handle)
}

/** 降级计数存储（按 runId） */
const degradationCounters = new Map<string, PluginServerHookDegradationCount>()

/** 获取或创建降级计数 */
function getDegradationCount(runId: string): PluginServerHookDegradationCount {
  if (!degradationCounters.has(runId)) {
    degradationCounters.set(runId, {
      totalAttempts: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      skipped: 0,
    })
  }
  return degradationCounters.get(runId)!
}

/** 清除降级计数（run 结束时调用） */
export function clearDegradationCounters(runId: string): void {
  degradationCounters.delete(runId)
}

/**
 * v3-plugin-runtime-health-diagnostics — 健康事件宿主 wrapper（低敏、observe-only 可审计）。
 * - 仅记录桶化延迟、outcome、reasonCode 与 circuit 信号，不持久化 payload/stack/secret
 * - 健康写失败不得影响主流程（best-effort + unknown 回退）
 * - 未启用/无 recorder 时静默跳过
 */
async function recordHealthBestEffort(input: {
  organizationId: number
  installationId: number
  pluginId: string
  contributionKey?: string | null
  seamKey?: string | null
  outcome: PluginRuntimeHealthOutcome
  reasonCode?: string | null
  quotaKind?: 'cpu' | 'memory' | 'call' | 'none' | null
  latencyMs?: number | null
  invocationId: string
}): Promise<void> {
  try {
    // 动态导入避免 cycle；无 recorder 时静默
    const mod = await import('#services/plugin_runtime_health/health_event_recorder').catch(
      () => null,
    )
    const Recorder = mod?.default
    if (!Recorder) return
    // Adonis container 可能未绑定时直接构造 fallback
    let recorder: InstanceType<typeof Recorder>
    try {
      const { default: app } = await import('@adonisjs/core/services/app')
      recorder = app?.container?.make ? await app.container.make(Recorder) : new Recorder()
    } catch {
      recorder = new Recorder()
    }
    const durationBucket = bucketDuration(input.latencyMs ?? null)
    void durationBucket
    const normalizedReason = normalizeHealthReasonCode(input.reasonCode ?? input.outcome)
    void normalizedReason
    await recorder.record({
      organizationId: input.organizationId,
      installationId: input.installationId,
      pluginId: input.pluginId,
      contributionKey: input.contributionKey ?? null,
      seamKey: input.seamKey ?? null,
      outcome: input.outcome,
      reasonCode: normalizedReason,
      quotaKind: input.quotaKind ?? 'none',
      latencyMs: input.latencyMs ?? null,
      invocationId: input.invocationId,
    })
  } catch {
    // 健康写失败静默，不影响主流程
  }
}

/** 获取降级计数快照 */
export function getDegradationCountSnapshot(
  runId: string,
): PluginServerHookDegradationCount | undefined {
  return degradationCounters.get(runId)
}

@inject()
export default class PluginServerHookInvocationService {
  constructor(
    private rbacPolicy: RbacPolicy,
    private _auditService: AuditService,
    private actionBoundary?: PluginActionBoundaryService,
  ) {
    // 保留 _auditService 用于后续审计接线
    void this._auditService
  } // 审计接线占位（task 2.4）——后续接线时取消注释
  // private async _audit(
  //   event: string,
  //   organizationId: number,
  //   projectId: number | undefined,
  //   userId: number,
  //   metadata: Record<string, unknown>,
  // ): Promise<void> {
  //   await this._auditService.log({
  //     event,
  //     userId,
  //     organizationId,
  //     projectId: projectId ?? null,
  //     metadata,
  //   })
  // }

  /**
   * 执行 preflight 判定（组织匹配 + RBAC + 可见性过滤）。
   * 注意：实际 RBAC 判定复用既有 Policy 链，此处简化调用。
   */
  async preflight(
    user: User,
    requiredPermissions: string[],
    organizationId: number,
  ): Promise<{
    allowed: boolean
    reasonCode?: string
    reasonMessage?: string
  }> {
    // 组织匹配：`User` 模型没有 organizationId 字段（用户可属多个组织），
    // 原实现以不安全类型转换读取 `user.organizationId`，恒为 undefined → 任何请求都被误判
    // organization_mismatch。组织归属的唯一合法来源是成员表/所有者记录，
    // 统一走 `OrganizationMember.belongsToOrganization`（仓库唯一出处语义）。
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, user.id)
    if (!belongs) {
      return {
        allowed: false,
        reasonCode: 'organization_mismatch',
        reasonMessage: 'Request organization does not match hook organization',
      }
    }

    // RBAC 判定（复用既有 Policy 链）
    for (const permission of requiredPermissions) {
      if (!isPermission(permission)) {
        return {
          allowed: false,
          reasonCode: 'unknown_permission',
          reasonMessage: 'Hook requested an unknown permission',
        }
      }
      const allowed = await this.rbacPolicy.allows(user, permission, {
        organizationId,
        projectId: undefined, // 可见性过滤由宿主完成
      })
      if (!allowed) {
        return {
          allowed: false,
          reasonCode: 'missing_permissions',
          reasonMessage: `Missing required permission: ${permission}`,
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 调用 query 回调（带超时与降级计数 + 健康事件 wrapper）。
   */
  async invokeQueryCallback(
    request: PluginServerHookQueryRequest,
    runId: string,
    callbackHandle: string,
    maxCallsPerRun: number = DEFAULT_SERVER_HOOK_CALL_QUOTA,
  ): Promise<{ result?: PluginServerHookQueryResult; error?: string }> {
    const degradation = getDegradationCount(runId)
    const effectiveQuota = Math.max(
      1,
      Math.min(DEFAULT_SERVER_HOOK_CALL_QUOTA, Math.floor(maxCallsPerRun)),
    )
    if (degradation.totalAttempts >= effectiveQuota) {
      degradation.totalAttempts++
      degradation.failures++
      degradation.skipped++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-query.readonly-provider',
        outcome: 'quota_exceeded',
        reasonCode: 'call_quota',
        quotaKind: 'call',
        latencyMs: 0,
        invocationId: `${runId}:${callbackHandle}:quota`,
      })
      return { error: 'Server hook call quota exceeded' }
    }
    degradation.totalAttempts++
    const startedAt = Date.now()

    const callback = callbackRegistry.get(callbackHandle)
    if (!callback) {
      degradation.failures++
      degradation.skipped++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-query.readonly-provider',
        outcome: 'crash',
        reasonCode: 'crash',
        latencyMs: Date.now() - startedAt,
        invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
      })
      return { error: `Callback not found for handle: ${callbackHandle}` }
    }

    // 超时包装
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Callback timeout')), CALLBACK_TIMEOUT_MS),
    )

    try {
      const result = (await Promise.race([
        callback(request),
        timeoutPromise,
      ])) as PluginServerHookQueryResult

      // Schema 校验（简化：检查 advisory 标志）
      if (result.advisory !== true) {
        degradation.failures++
        degradation.skipped++
        await recordHealthBestEffort({
          organizationId: request.context.organizationId,
          installationId: 0,
          pluginId: request.pluginId ?? 'unknown',
          contributionKey: request.contributionKey ?? null,
          seamKey: request.seamKey ?? 'server-query.readonly-provider',
          outcome: 'crash',
          reasonCode: 'crash',
          latencyMs: Date.now() - startedAt,
          invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
        })
        return { error: 'Query result must have advisory: true' }
      }

      degradation.successes++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-query.readonly-provider',
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
        invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
      })
      return { result }
    } catch (error) {
      const errorMsg = (error as Error).message
      if (errorMsg === 'Callback timeout') {
        degradation.timeouts++
        degradation.skipped++
        await recordHealthBestEffort({
          organizationId: request.context.organizationId,
          installationId: 0,
          pluginId: request.pluginId ?? 'unknown',
          contributionKey: request.contributionKey ?? null,
          seamKey: request.seamKey ?? 'server-query.readonly-provider',
          outcome: 'timeout',
          reasonCode: 'timeout',
          latencyMs: Date.now() - startedAt,
          invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
        })
        return { error: 'Callback timeout' }
      }
      degradation.failures++
      degradation.skipped++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-query.readonly-provider',
        outcome: 'crash',
        reasonCode: 'crash',
        latencyMs: Date.now() - startedAt,
        invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
      })
      return { error: errorMsg }
    }
  }

  /**
   * 调用 proposal 回调（带超时与降级计数 + 健康事件 wrapper）。
   */
  async invokeProposalCallback(
    request: PluginServerHookProposalRequest,
    runId: string,
    callbackHandle: string,
  ): Promise<{ result?: PluginServerHookProposalResult; error?: string }> {
    const degradation = getDegradationCount(runId)
    degradation.totalAttempts++
    const startedAt = Date.now()

    const callback = callbackRegistry.get(callbackHandle)
    if (!callback) {
      degradation.failures++
      degradation.skipped++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-command-proposal.proposal-only',
        outcome: 'crash',
        reasonCode: 'crash',
        latencyMs: Date.now() - startedAt,
        invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
      })
      return { error: `Callback not found for handle: ${callbackHandle}` }
    }

    // 超时包装
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Callback timeout')), CALLBACK_TIMEOUT_MS),
    )

    try {
      const result = (await Promise.race([
        callback(request),
        timeoutPromise,
      ])) as PluginServerHookProposalResult

      // Schema 校验（简化：检查 summary 存在）
      if (!result.summary || typeof result.summary !== 'string') {
        degradation.failures++
        degradation.skipped++
        await recordHealthBestEffort({
          organizationId: request.context.organizationId,
          installationId: 0,
          pluginId: request.pluginId ?? 'unknown',
          contributionKey: request.contributionKey ?? null,
          seamKey: request.seamKey ?? 'server-command-proposal.proposal-only',
          outcome: 'crash',
          reasonCode: 'crash',
          latencyMs: Date.now() - startedAt,
          invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
        })
        return { error: 'Proposal result must have a summary string' }
      }

      degradation.successes++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-command-proposal.proposal-only',
        outcome: 'success',
        latencyMs: Date.now() - startedAt,
        invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
      })
      return { result }
    } catch (error) {
      const errorMsg = (error as Error).message
      if (errorMsg === 'Callback timeout') {
        degradation.timeouts++
        degradation.skipped++
        await recordHealthBestEffort({
          organizationId: request.context.organizationId,
          installationId: 0,
          pluginId: request.pluginId ?? 'unknown',
          contributionKey: request.contributionKey ?? null,
          seamKey: request.seamKey ?? 'server-command-proposal.proposal-only',
          outcome: 'timeout',
          reasonCode: 'timeout',
          latencyMs: Date.now() - startedAt,
          invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
        })
        return { error: 'Callback timeout' }
      }
      degradation.failures++
      degradation.skipped++
      await recordHealthBestEffort({
        organizationId: request.context.organizationId,
        installationId: 0,
        pluginId: request.pluginId ?? 'unknown',
        contributionKey: request.contributionKey ?? null,
        seamKey: request.seamKey ?? 'server-command-proposal.proposal-only',
        outcome: 'crash',
        reasonCode: 'crash',
        latencyMs: Date.now() - startedAt,
        invocationId: `${runId}:${callbackHandle}:${Date.now()}`,
      })
      return { error: errorMsg }
    }
  }

  /**
   * 提案登记（摘要绑定校验）。
   */
  registerProposal(proposalResult: PluginServerHookProposalResult): {
    registered: boolean
    error?: string
  } {
    // 提案摘要绑定校验（确定性 hash）
    const summary = computeProposalSummary(proposalResult.proposal)
    if (proposalResult.summary !== summary) {
      return { registered: false, error: 'Proposal summary mismatch' }
    }
    // 实际登记到既有提案通道（此处简化）
    return { registered: true }
  }

  /**
   * 提案确认执行 —— v3-plugin-action-preview-boundary 统一切换（旧直执旁路已移除）。
   *
   * 摘要匹配不再产生任何正式执行。合法路径只有两条：
   * - 载荷声明了宿主登记的 action kind 且调用方提供 scope → 转换为统一边界 envelope
   *   幂等登记进 PluginActionBoundaryService，返回 accepted:false + preview-required +
   *   proposalUid；真正执行只能走 boundary 的 preview → handle → confirm 链；
   * - 其余情况（摘要失配 / 无 adapter kind / 无 scope）→ accepted:false fail-closed，
   *   提案保持 advisory。
   */
  async confirmProposal(
    request: PluginServerHookProposalConfirmRequest,
    proposalPayload: Record<string, unknown>,
    scope?: { organizationId: number; projectId?: number | null },
  ): Promise<PluginServerHookProposalConfirmResult & { proposalUid?: string }> {
    // 绑定摘要校验（不变）
    const { valid, expectedSummary } = validateProposalSummaryBinding(
      request.proposalSummary,
      proposalPayload,
    )
    if (!valid) {
      return {
        accepted: false,
        reason: `Proposal summary mismatch. Expected: ${expectedSummary}`,
      }
    }

    const converted = this.#convertToBoundaryEnvelope(request, proposalPayload, scope)
    if (!converted || !this.actionBoundary) {
      return {
        accepted: false,
        reason:
          'unified-boundary-required: direct execution removed; write-capable contributions must pass plugin-action preview/confirm',
      }
    }

    try {
      const registered = await this.actionBoundary.registerProposal({
        organizationId: converted.organizationId,
        projectId: converted.projectId ?? null,
        proposal: converted.envelope,
        proposedBy: request.confirmedBy,
      })
      return {
        accepted: false,
        reason: 'preview-required: confirm via plugin-action boundary (preview → handle → confirm)',
        proposalUid: registered.proposalUid,
      }
    } catch (error) {
      return {
        accepted: false,
        reason: `boundary-registration-blocked: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 把 server hook 提案载荷转换为统一边界 envelope。
   * 仅当载荷显式声明宿主登记的 actionKind 且提供 scope 时可转换；其余返回 null（阻断）。
   * contentDigest 取确定性提案摘要，作为确认前来源新鲜度重校验的锚点。
   */
  #convertToBoundaryEnvelope(
    request: PluginServerHookProposalConfirmRequest,
    proposalPayload: Record<string, unknown>,
    scope?: { organizationId: number; projectId?: number | null },
  ): {
    organizationId: number
    projectId: number | null
    envelope: import('@aiproj/types').PluginActionProposal
  } | null {
    if (!scope || typeof scope.organizationId !== 'number' || scope.organizationId <= 0) {
      return null
    }
    const kind = proposalPayload['actionKind']
    if (typeof kind !== 'string' || !isPluginActionKind(kind)) {
      return null
    }
    const { actionKind: omittedActionKind, ...inputRest } = proposalPayload
    void omittedActionKind
    const envelope = {
      schemaVersion: PLUGIN_ACTION_SCHEMA_VERSION,
      actionKind: kind,
      scope: {
        organizationId: scope.organizationId,
        projectId: scope.projectId ?? null,
      },
      inputPayload: inputRest as Record<string, unknown>,
      sourceRefs: [
        {
          surface: 'server-hook' as const,
          pluginId: request.pluginId,
          pluginVersion:
            typeof proposalPayload['pluginVersion'] === 'string'
              ? proposalPayload['pluginVersion']
              : '0.0.0',
          installationId: null,
          contributionKey: request.contributionKey,
          contentDigest: request.proposalSummary,
          capturedAt: new Date().toISOString(),
        },
      ],
    }
    const check = validatePluginActionProposal(envelope)
    if (!check.valid) {
      return null
    }
    return { organizationId: scope.organizationId, projectId: scope.projectId ?? null, envelope }
  }
}
