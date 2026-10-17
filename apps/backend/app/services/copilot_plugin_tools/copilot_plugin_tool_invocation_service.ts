// apps/backend — V3 Copilot 插件工具调用 wrapper（v3-copilot-plugin-tool-contract）
//
// 每次调用统一执行：资格复核（快照/revision）→ security gate → scope → input schema
// → 预算 → 执行 → 结果按 side-effect class 受控 → 低敏 receipt（D4）。
//
// 核心裁决：
// - fail-closed：任何复核失败不执行、结果不接受
// - TOCTOU：路由后插件升级/停用/授权变化 → stale，丢弃在途结果
// - query→有界 sanitizer；advisory→draft；write→PluginActionProposal（零正式写入）
// - receipt 仅 identity/status/timing/budget/reference/truncation

import type {
  CopilotPluginToolSnapshot,
  CopilotPluginToolSnapshotRevisions,
  CopilotToolAdvisoryDraft,
  CopilotToolInvocationReceipt,
  CopilotToolInvocationStatus,
  CopilotToolQueryResultSanitized,
  CopilotToolRouteReceipt,
  CopilotPluginToolDenialReason,
} from '@aiproj/types'
import {
  buildAdvisoryToolDraft,
  buildCopilotToolActionProposal,
  isSnapshotFreshForInvocation,
  sanitizeQueryToolResult,
  validateToolReceiptNoSensitiveData,
} from '@aiproj/types'

import type { CopilotPluginToolSnapshotService } from './plugin_tool_snapshot_service.js'

/** 调用 wrapper 依赖（全部可注入）。 */
export interface CopilotPluginToolInvocationDeps {
  /** 快照服务（发现与复核共用同一投影）。 */
  readonly snapshotService: CopilotPluginToolSnapshotService
  /**
   * 宿主安全门（复用 plugin-security-gate 的运行时判定）。
   * 输入为低敏请求要素；宿主实现负责组装 trustedContext 与 seam catalog。
   */
  readonly runSecurityGate: (input: {
    organizationId: number
    actorId: string
    pluginId: string
    toolId: string
    sideEffectClass: string
    requiredPermissions: readonly string[]
    projectId?: number
  }) => Promise<{ allowed: boolean; reasonCodes: readonly string[] }>
  /** 已登记 action kinds（write 提案封闭集）。 */
  readonly knownActionKinds: readonly string[]
  /** 执行工具本体（宿主 adapter 回调；测试用 fixture）。错误以 kind 区分。 */
  readonly executeTool: (
    entry: { toolId: string; version: string; budget: { timeoutMs: number } },
    input: Record<string, unknown>,
  ) => Promise<string>
  /** 注册 write 动作提案（进入 v3-plugin-action-preview-boundary 待审通道）。 */
  readonly registerActionProposal: (proposal: unknown) => Promise<void>
  /** 写入低敏 route receipt。 */
  readonly writeRouteReceipt: (receipt: CopilotToolRouteReceipt) => Promise<void>
  /** 写入低敏 invocation receipt。 */
  readonly writeInvocationReceipt: (receipt: CopilotToolInvocationReceipt) => Promise<void>
  /** 生成唯一 ID。 */
  readonly generateId: () => string
  /** 当前时间（ISO 8601）。 */
  readonly now: () => string
}

/** 调用输入参数。 */
export interface InvokePluginToolParams {
  readonly organizationId: number
  readonly actorId: string
  readonly projectId?: number
  readonly toolId: string
  /** 路由时选定的工具 digest（存在则参与 stale 判定）。 */
  readonly routedToolDigest?: string
  /** 路由时的快照 digest（存在则参与 stale 判定）。 */
  readonly routedSnapshotDigest?: string
  /** 工具输入（将对照声明 schema 校验；write 类即提案的 bounded input）。 */
  readonly input: Record<string, unknown>
  /** write 类工具的目标 action kind（必须属于宿主封闭集）。 */
  readonly actionKind?: string
  /** 路由原因码（写入 route receipt）。 */
  readonly routeReasonCodes?: readonly string[]
}

/** 调用结果（三类边界之一 + 低敏 receipt）。 */
export interface PluginToolInvocationOutcome {
  readonly success: boolean
  readonly status: CopilotToolInvocationStatus
  readonly denialReason?: CopilotPluginToolDenialReason
  /** query 边界：有界 sanitizer 结果。 */
  readonly queryResult?: CopilotToolQueryResultSanitized
  /** advisory 边界：draft。 */
  readonly advisoryDraft?: CopilotToolAdvisoryDraft
  /** write 边界：已注册待审的提案 id（envelope 见 registerActionProposal 入参）。 */
  readonly registeredProposalDigest?: string
  /** 低敏 receipt（禁存约束校验通过后才落账）。 */
  readonly receipt: CopilotToolInvocationReceipt
}

/** 输入 schema 子集校验（与契约层封闭子集一致）。 */
function validateInputAgainstSchema(
  input: Record<string, unknown>,
  schema: {
    readonly required?: readonly string[]
    readonly properties: Readonly<Record<string, { type: string }>>
  },
): 'schema_invalid' | 'ok' {
  for (const name of schema.required ?? []) {
    if (!(name in input) || input[name] === undefined || input[name] === null) {
      return 'schema_invalid'
    }
  }
  for (const [name, def] of Object.entries(schema.properties)) {
    if (!(name in input)) continue
    const value = input[name]
    const t = def.type
    if (t === 'string' && typeof value !== 'string') return 'schema_invalid'
    if (t === 'number' && typeof value !== 'number') return 'schema_invalid'
    if (t === 'boolean' && typeof value !== 'boolean') return 'schema_invalid'
  }
  // 未声明字段拒绝（封闭子集）
  for (const key of Object.keys(input)) {
    if (!(key in schema.properties)) return 'schema_invalid'
  }
  return 'ok'
}

/**
 * Copilot 插件工具调用 wrapper。
 * 发现面由 snapshotService 保证；本类保证「每次调用前全量复核」与「结果边界」。
 */
export class CopilotPluginToolInvocationService {
  constructor(private readonly deps: CopilotPluginToolInvocationDeps) {}

  /** 记录路由 receipt（低敏；供核心路由器在选择插件候选后调用）。 */
  async recordRoute(params: {
    organizationId: number
    actorId: string
    reasonCodes: readonly string[]
    selectedToolId: string | null
    selectedToolVersion: string | null
    snapshotDigest: string
  }): Promise<CopilotToolRouteReceipt> {
    const receipt: CopilotToolRouteReceipt = {
      receiptId: this.deps.generateId(),
      organizationId: params.organizationId,
      actorId: params.actorId,
      reasonCodes: [...params.reasonCodes],
      selectedToolId: params.selectedToolId,
      selectedToolVersion: params.selectedToolVersion,
      snapshotDigest: params.snapshotDigest,
      routedAt: this.deps.now(),
    }
    await this.deps.writeRouteReceipt(receipt)
    return receipt
  }

  /**
   * 完整调用流程：
   * 1. 重新解析快照并做 revision/digest 复核（TOCTOU 前置）
   * 2. security gate（fail-closed）
   * 3. project scope 一致性
   * 4. input schema 校验
   * 5. 执行 + 结果三类边界
   * 6. 执行后 revision 复核（TOCTOU 后置）
   * 7. 低敏 receipt
   */
  async invoke(params: InvokePluginToolParams): Promise<PluginToolInvocationOutcome> {
    const start = Date.now()
    const { organizationId, actorId, toolId } = params

    const finish = async (
      status: CopilotToolInvocationStatus,
      extra: Partial<
        Pick<
          PluginToolInvocationOutcome,
          'denialReason' | 'queryResult' | 'advisoryDraft' | 'registeredProposalDigest'
        >
      > & {
        resultSizeBytes?: number
        truncated?: boolean
        truncationMarker?: string
        entryVersion?: string
        entrySideEffectClass?: 'query' | 'advisory' | 'write'
        snapshotDigest?: string
        revisionMatched?: boolean
      } = {},
    ): Promise<PluginToolInvocationOutcome> => {
      const receipt: CopilotToolInvocationReceipt = {
        recordId: this.deps.generateId(),
        toolId,
        toolVersion: extra.entryVersion ?? 'unknown',
        sideEffectClass: extra.entrySideEffectClass ?? 'query',
        status,
        durationMs: Date.now() - start,
        invokedAt: this.deps.now(),
        actorId,
        organizationId,
        ...(extra.denialReason ? { denialReason: extra.denialReason } : {}),
        ...(extra.resultSizeBytes !== undefined ? { resultSizeBytes: extra.resultSizeBytes } : {}),
        ...(extra.truncated !== undefined ? { truncated: extra.truncated } : {}),
        ...(extra.truncationMarker ? { truncationMarker: extra.truncationMarker } : {}),
        snapshotDigest: extra.snapshotDigest ?? '',
        revisionMatched: extra.revisionMatched ?? false,
      }
      // 禁存约束守卫：违规直接抛错，绝不落账（任务 3.6）
      const violations = validateToolReceiptNoSensitiveData(
        receipt as unknown as Record<string, unknown>,
      )
      if (violations.length > 0) {
        throw new Error(`invocation receipt 含禁存字段: ${violations.join(', ')}`)
      }
      await this.deps.writeInvocationReceipt(receipt)
      return {
        success: status === 'success' || status === 'truncated',
        status,
        ...(extra.denialReason ? { denialReason: extra.denialReason } : {}),
        ...(extra.queryResult ? { queryResult: extra.queryResult } : {}),
        ...(extra.advisoryDraft ? { advisoryDraft: extra.advisoryDraft } : {}),
        ...(extra.registeredProposalDigest
          ? { registeredProposalDigest: extra.registeredProposalDigest }
          : {}),
        receipt,
      }
    }

    // ── 1. 重新解析快照（组织 × actor × project）──
    const { snapshot } = await this.deps.snapshotService.resolveSnapshot({
      organizationId,
      actorId,
      ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
    })

    const entry = snapshot.entries.find((e) => e.toolId === toolId)
    if (!entry) {
      // 隐藏/不存在 → 泛化拒绝，不泄露名称/数量/版本差异
      return finish('blocked_undeclared', {
        denialReason: 'tool_not_visible',
        snapshotDigest: snapshot.digest,
      })
    }

    // 路由快照 vs 当前快照：revision 或 digest 变化 → stale（升级/停用/授权变化）
    if (
      (params.routedSnapshotDigest && params.routedSnapshotDigest !== snapshot.digest) ||
      (params.routedToolDigest && params.routedToolDigest !== entry.toolDigest)
    ) {
      return finish('stale', {
        denialReason: 'snapshot_stale',
        entryVersion: entry.version,
        entrySideEffectClass: entry.sideEffectClass,
        snapshotDigest: snapshot.digest,
      })
    }

    // ── 2. security gate（每次调用重判，fail-closed）──
    const gate = await this.deps.runSecurityGate({
      organizationId,
      actorId,
      pluginId: entry.pluginId,
      toolId: entry.toolId,
      sideEffectClass: entry.sideEffectClass,
      requiredPermissions: entry.requiredPermissions.map((p) => p.permissionKey),
      ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
    })
    if (!gate.allowed) {
      return finish('blocked_unauthorized', {
        denialReason: 'invoker_permission_denied',
        entryVersion: entry.version,
        entrySideEffectClass: entry.sideEffectClass,
        snapshotDigest: snapshot.digest,
      })
    }

    // ── 3. project scope 一致性（跨项目拒绝）──
    const needsProject = entry.requiredPermissions.some((p) => p.scopeKind === 'project')
    if (needsProject && params.projectId === undefined) {
      return finish('blocked_permission', {
        denialReason: 'cross_project',
        entryVersion: entry.version,
        entrySideEffectClass: entry.sideEffectClass,
        snapshotDigest: snapshot.digest,
      })
    }

    // ── 4. input schema 校验 ──
    if (validateInputAgainstSchema(params.input, entry.inputSchema) !== 'ok') {
      return finish('blocked_undeclared', {
        denialReason: 'schema_invalid',
        entryVersion: entry.version,
        entrySideEffectClass: entry.sideEffectClass,
        snapshotDigest: snapshot.digest,
      })
    }

    // ── 5. 执行（唯一副作用点）──
    let rawResult: string
    try {
      rawResult = await this.deps.executeTool(
        { toolId: entry.toolId, version: entry.version, budget: entry.budget },
        params.input,
      )
    } catch {
      return finish('error', {
        entryVersion: entry.version,
        entrySideEffectClass: entry.sideEffectClass,
        snapshotDigest: snapshot.digest,
      })
    }

    // ── 6. 执行后 revision 复核（在途期间变化 → 结果丢弃）──
    const resolvedSnapshot = await this.deps.snapshotService.resolveSnapshot({
      organizationId,
      actorId,
      ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
    })
    const currentRevisions: CopilotPluginToolSnapshotRevisions = resolvedSnapshot.snapshot.revisions
    const stillFresh = isSnapshotFreshForInvocation(snapshot, currentRevisions, toolId)
    if (!stillFresh) {
      return finish('stale', {
        denialReason: 'snapshot_stale',
        entryVersion: entry.version,
        entrySideEffectClass: entry.sideEffectClass,
        snapshotDigest: snapshot.digest,
        revisionMatched: false,
      })
    }

    // ── 7. 结果按 side-effect class 受控（D4）──
    if (entry.sideEffectClass === 'query') {
      const sanitized = sanitizeQueryToolResult({
        resultText: rawResult,
        budgetBytes: entry.budget.maxResultBytes,
      })
      if (!sanitized.ok) {
        return finish('blocked_injection', {
          entryVersion: entry.version,
          entrySideEffectClass: 'query',
          snapshotDigest: snapshot.digest,
          resultSizeBytes: sanitized.resultSizeBytes,
          revisionMatched: true,
        })
      }
      return finish(sanitized.truncated ? 'truncated' : 'success', {
        queryResult: sanitized,
        entryVersion: entry.version,
        entrySideEffectClass: 'query',
        snapshotDigest: snapshot.digest,
        resultSizeBytes: sanitized.resultSizeBytes,
        truncated: sanitized.truncated,
        truncationMarker: sanitized.truncationMarker,
        revisionMatched: true,
      })
    }

    if (entry.sideEffectClass === 'advisory') {
      const draft = buildAdvisoryToolDraft({
        toolId: entry.toolId,
        toolVersion: entry.version,
        summary: rawResult,
        now: this.deps.now(),
      })
      return finish('success', {
        advisoryDraft: draft,
        entryVersion: entry.version,
        entrySideEffectClass: 'advisory',
        snapshotDigest: snapshot.digest,
        resultSizeBytes: new TextEncoder().encode(rawResult).length,
        revisionMatched: true,
      })
    }

    // write：只产 proposal，零正式写入（inputPayload = 已过 schema 校验的有界输入）
    const built = buildCopilotToolActionProposal({
      actionKind: params.actionKind ?? '',
      knownActionKinds: this.deps.knownActionKinds,
      organizationId,
      ...(params.projectId !== undefined ? { projectId: params.projectId } : {}),
      inputPayload: params.input,
      pluginId: entry.pluginId,
      pluginVersion: entry.pluginVersion,
      installationId: Number(entry.installationRef.replace('install:', '')) || null,
      contributionKey: null,
      budgetBytes: entry.budget.maxResultBytes,
      now: this.deps.now(),
    })
    if (!built.proposal) {
      return finish('budget_exceeded', {
        denialReason: built.reason === 'action_kind_unknown' ? 'schema_invalid' : 'budget_exceeded',
        entryVersion: entry.version,
        entrySideEffectClass: 'write',
        snapshotDigest: snapshot.digest,
        revisionMatched: true,
      })
    }
    await this.deps.registerActionProposal(built.proposal)
    return finish('success', {
      registeredProposalDigest: built.proposal.sourceRefs[0]?.contentDigest ?? '',
      entryVersion: entry.version,
      entrySideEffectClass: 'write',
      snapshotDigest: snapshot.digest,
      resultSizeBytes: new TextEncoder().encode(rawResult).length,
      revisionMatched: true,
    })
  }
}

/** 导出快照类型别名便于消费方引用（不重复定义）。 */
export type { CopilotPluginToolSnapshot }
