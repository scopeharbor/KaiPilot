/**
 * v3-copilot-productized-operating-entry —— 宿主就绪聚合服务（任务 3.2 / 3.4 / 3.5）。
 *
 * 只读聚合：把「有效 actor/organization → 可选 project 可见性 → 核心回合前置 →
 * 最近会话摘要 → 插件工具资格快照」按 mandatory/optional 分级组合成一个确定性快照。
 *
 * 红线：
 * - **禁止**调用模型、provider、公网；readiness 是宿主前置检查，不是健康探针（design D2）；
 * - **禁止**任何写入：无会话写、无审计写、无入口专用表（design D9）；
 * - 各下游能力的权威判定（RBAC、项目可见性、会话可见性、插件资格）一律委托，不在此重算；
 * - 只输出闭集状态/原因/动作与低敏投影；资格快照 `exclusions` 绝不外发。
 *
 * 依赖全部可注入，便于离线单测（零 DB、零网络）。
 */

import {
  COPILOT_ENTRY_CONTRACT_VERSION,
  COPILOT_ENTRY_MAX_QUICK_START_DRAFT_LENGTH,
  COPILOT_ENTRY_MAX_QUICK_START_LABEL_LENGTH,
  COPILOT_ENTRY_MAX_SCOPE_LABEL_LENGTH,
  COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH,
  boundCopilotEntryQuickStarts,
  boundCopilotEntryText,
  isCopilotEntrySessionScope,
  isCopilotEntrySideEffectClass,
} from '@aiproj/types'
import type {
  CopilotEntryAllowedAction,
  CopilotEntryQuickStart,
  CopilotEntryReadinessSnapshot,
  CopilotEntryReason,
  CopilotEntryReasonCode,
  CopilotEntryRecentSession,
  CopilotEntryScope,
  CopilotEntryScopeKind,
} from '@aiproj/types'

// ---------------------------------------------------------------------------
// 请求上下文
// ---------------------------------------------------------------------------

export interface CopilotEntryRequestContext {
  readonly actorId: number
  /** 有效组织；null/<=0 表示缺少可信组织上下文（fail closed）。 */
  readonly organizationId: number | null
  /** 客户端请求的 project scope；**未经 Policy 复核前只是输入**。 */
  readonly requestedProjectId?: number
}

// ---------------------------------------------------------------------------
// 下游投影（服务层只接受低敏投影，不接受 Model 行）
// ---------------------------------------------------------------------------

/** 会话权威返回的低敏投影（不含消息正文）。 */
export interface CopilotEntrySessionProjection {
  readonly sessionId: string
  readonly title: string | null
  readonly scope: string
  /** ISO 8601；null 表示会话从未更新（回落 createdAt 由适配层负责）。 */
  readonly updatedAt: string | null
  readonly archived: boolean
  readonly status: string
  /** 保留治理判定为不可续接时为 true。 */
  readonly retentionBlocked?: boolean
}

/** 资格快照的低敏投影（`exclusions` 不进入本结构）。 */
export interface CopilotEntryToolSnapshotProjection {
  /** 快照 digest —— 整体替换即失效。 */
  readonly revision: string
  /** ISO 8601 生成时间，用于 stale 判定。 */
  readonly generatedAt: string
  readonly entries: readonly CopilotEntryToolProjection[]
}

export interface CopilotEntryToolProjection {
  readonly toolId: string
  readonly name: string
  readonly sideEffectClass: string
  readonly pluginId: string
  readonly pluginVersion: string
  readonly toolDigest: string
}

// ---------------------------------------------------------------------------
// 核心 quick start 宿主声明
// ---------------------------------------------------------------------------

export interface CopilotEntryCoreQuickStartDeclaration {
  readonly quickStartId: string
  readonly label: string
  readonly draftTemplate: string
  /** 所需权限；缺失即整条缺席（无解释性泄露）。 */
  readonly requiredPermission: string
  /** 适用的 scope 类型。 */
  readonly scopeKinds: readonly CopilotEntryScopeKind[]
}

/**
 * 宿主核心能力派生的快捷建议。
 *
 * 与既有侧栏空状态示例同一产品语域，但**判定权威在服务端**：
 * 权限缺失的条目直接缺席，客户端不得自行补齐。
 */
export const COPILOT_ENTRY_CORE_QUICK_STARTS: readonly CopilotEntryCoreQuickStartDeclaration[] = [
  {
    quickStartId: 'core.project-health',
    label: '看看项目健康度',
    draftTemplate: '帮我总结当前项目的健康度、进度偏差与主要风险。',
    requiredPermission: 'project:view',
    scopeKinds: ['project'],
  },
  {
    quickStartId: 'core.critical-path',
    label: '梳理关键路径',
    draftTemplate: '梳理这个项目当前的关键路径与里程碑。',
    requiredPermission: 'project:view',
    scopeKinds: ['project'],
  },
  {
    quickStartId: 'core.blocking-dependencies',
    label: '找出阻塞依赖',
    draftTemplate: '帮我分析任务依赖中可能阻塞进度的问题。',
    requiredPermission: 'project:view',
    scopeKinds: ['project'],
  },
  {
    quickStartId: 'core.explain-term',
    label: '解释一个术语',
    draftTemplate: '解释项目管理中「关键路径」是什么意思。',
    requiredPermission: 'project:view',
    scopeKinds: ['organization', 'project'],
  },
  {
    quickStartId: 'core.plan-new-project',
    label: '规划一个新项目',
    draftTemplate: '我想启动一个新项目，帮我拆解初步计划。',
    requiredPermission: 'project:create',
    scopeKinds: ['organization', 'project'],
  },
]

// ---------------------------------------------------------------------------
// 依赖
// ---------------------------------------------------------------------------

export interface CopilotOperatingEntryDeps {
  /** mandatory —— actor 是否可用 Copilot（复用 RBAC `ai:trigger`）。 */
  readonly canUseCopilot: (ctx: CopilotEntryRequestContext) => Promise<boolean>
  /** mandatory —— 请求的 project scope 是否可见（复用既有项目可见性判定）。 */
  readonly canAccessProject: (
    ctx: CopilotEntryRequestContext,
    projectId: number,
  ) => Promise<boolean>
  /** quick start 权限过滤（复用 RBAC）。 */
  readonly hasPermission: (ctx: CopilotEntryRequestContext, permission: string) => Promise<boolean>
  /** 已授权项目的展示名；只在授权后调用，失败返回 null（不阻断）。 */
  readonly getProjectLabel?: (
    ctx: CopilotEntryRequestContext,
    projectId: number,
  ) => Promise<string | null>
  /** optional —— 最近一条合格会话（复用既有会话列表权威）。 */
  readonly getRecentSession?: (
    ctx: CopilotEntryRequestContext,
    scope: CopilotEntryScope,
  ) => Promise<CopilotEntrySessionProjection | null>
  /** optional —— 当前有效插件工具资格快照。 */
  readonly getToolSnapshot?: (
    ctx: CopilotEntryRequestContext,
    scope: CopilotEntryScope,
  ) => Promise<CopilotEntryToolSnapshotProjection | null>
  /** 当前时间（ISO 8601）。 */
  readonly now: () => string
  /** 资格快照最大新鲜度（毫秒）；超过即 `tool_snapshot_stale` 降级。默认 5 分钟。 */
  readonly toolSnapshotMaxAgeMs?: number
}

/** 资格快照默认新鲜度窗口。 */
export const COPILOT_ENTRY_DEFAULT_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000

/** 未命名会话的中性占位（不泄露内容）。 */
export const COPILOT_ENTRY_UNTITLED_SESSION_LABEL = '未命名会话'

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

export class CopilotOperatingEntryService {
  constructor(private readonly deps: CopilotOperatingEntryDeps) {}

  /**
   * 求值一次就绪快照。
   *
   * 求值顺序固定（design D1）：有效 actor/organization → 可选 project 可见性 →
   * 核心回合前置 → 最近会话摘要 → 插件工具资格快照。
   * 前三项属 mandatory，任一失败即 `unavailable`；后两项属 optional，失败降为 `degraded`。
   */
  async evaluate(ctx: CopilotEntryRequestContext): Promise<CopilotEntryReadinessSnapshot> {
    const evaluatedAt = this.deps.now()

    // ── 1. 有效 actor / organization（mandatory）──
    const organizationId = ctx.organizationId
    if (organizationId === null || !Number.isInteger(organizationId) || organizationId <= 0) {
      return this.unavailable(
        { kind: 'organization', organizationId: 0 },
        'organization_context_missing',
        false,
        evaluatedAt,
      )
    }

    // ── 2. 可选 project scope 可见性（mandatory 判定）──
    let scope: CopilotEntryScope = { kind: 'organization', organizationId }
    if (ctx.requestedProjectId !== undefined) {
      let visible: boolean
      try {
        visible = await this.deps.canAccessProject(ctx, ctx.requestedProjectId)
      } catch {
        return this.unavailable(scope, 'readiness_evaluation_failed', true, evaluatedAt)
      }
      if (!visible) {
        // fail closed：回落到组织级 scope，绝不回显被拒 projectId / 名称 / 存在性。
        return this.unavailable(scope, 'project_scope_denied', false, evaluatedAt)
      }
      scope = {
        kind: 'project',
        organizationId,
        projectId: ctx.requestedProjectId,
        ...(await this.resolveProjectLabel(ctx, ctx.requestedProjectId)),
      }
    }

    // ── 3. 核心回合前置（mandatory）──
    let allowed: boolean
    try {
      allowed = await this.deps.canUseCopilot(ctx)
    } catch {
      return this.unavailable(scope, 'turn_channel_unavailable', true, evaluatedAt)
    }
    if (!allowed) {
      return this.unavailable(scope, 'copilot_permission_denied', false, evaluatedAt)
    }

    // ── 4. 最近会话摘要（optional）──
    const degradedReasons: CopilotEntryReason[] = []
    let recentSession: CopilotEntryRecentSession | null = null
    if (this.deps.getRecentSession) {
      try {
        const projection = await this.deps.getRecentSession(ctx, scope)
        recentSession = projection ? projectRecentSession(projection) : null
      } catch {
        recentSession = null
        degradedReasons.push({ code: 'recent_session_unavailable', retryable: true })
      }
    }

    // ── 5. 插件工具资格快照（optional）──
    let quickStarts = await this.resolveCoreQuickStarts(ctx, scope, degradedReasons)
    if (this.deps.getToolSnapshot) {
      try {
        const snapshot = await this.deps.getToolSnapshot(ctx, scope)
        if (snapshot === null) {
          degradedReasons.push({ code: 'tool_snapshot_unavailable', retryable: true })
        } else if (this.isSnapshotStale(snapshot, evaluatedAt)) {
          degradedReasons.push({ code: 'tool_snapshot_stale', retryable: true })
        } else {
          quickStarts = [...quickStarts, ...projectPluginQuickStarts(snapshot)]
        }
      } catch {
        degradedReasons.push({ code: 'tool_snapshot_unavailable', retryable: true })
      }
    }

    const boundedQuickStarts = boundCopilotEntryQuickStarts(quickStarts)
    const state = degradedReasons.length > 0 ? 'degraded' : 'ready'

    return {
      contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
      state,
      scope,
      reasons:
        state === 'ready'
          ? [{ code: 'entry_ready', retryable: false }]
          : dedupeReasons(degradedReasons),
      allowedActions: buildAllowedActions(recentSession !== null),
      recentSession,
      quickStarts: boundedQuickStarts,
      evaluatedAt,
    }
  }

  private async resolveProjectLabel(
    ctx: CopilotEntryRequestContext,
    projectId: number,
  ): Promise<{ label?: string }> {
    if (!this.deps.getProjectLabel) return {}
    try {
      const raw = await this.deps.getProjectLabel(ctx, projectId)
      if (typeof raw !== 'string' || raw.trim().length === 0) return {}
      return { label: boundCopilotEntryText(raw, COPILOT_ENTRY_MAX_SCOPE_LABEL_LENGTH) }
    } catch {
      // 展示名不可用不影响可用性判定——scope 仍是已授权的项目。
      return {}
    }
  }

  private async resolveCoreQuickStarts(
    ctx: CopilotEntryRequestContext,
    scope: CopilotEntryScope,
    degradedReasons: CopilotEntryReason[],
  ): Promise<CopilotEntryQuickStart[]> {
    const applicable = COPILOT_ENTRY_CORE_QUICK_STARTS.filter((declaration) =>
      declaration.scopeKinds.includes(scope.kind),
    )
    const permissionCache = new Map<string, boolean>()
    const quickStarts: CopilotEntryQuickStart[] = []

    for (const declaration of applicable) {
      let permitted = permissionCache.get(declaration.requiredPermission)
      if (permitted === undefined) {
        try {
          permitted = await this.deps.hasPermission(ctx, declaration.requiredPermission)
        } catch {
          // 权限判定不可用 ⇒ fail closed（缺席），并标记 quick starts 降级。
          permitted = false
          if (!degradedReasons.some((r) => r.code === 'quick_starts_unavailable')) {
            degradedReasons.push({ code: 'quick_starts_unavailable', retryable: true })
          }
        }
        permissionCache.set(declaration.requiredPermission, permitted)
      }
      if (!permitted) continue

      quickStarts.push({
        quickStartId: declaration.quickStartId,
        source: 'core',
        label: boundCopilotEntryText(declaration.label, COPILOT_ENTRY_MAX_QUICK_START_LABEL_LENGTH),
        draftTemplate: boundCopilotEntryText(
          declaration.draftTemplate,
          COPILOT_ENTRY_MAX_QUICK_START_DRAFT_LENGTH,
        ),
        sideEffectClass: 'query',
      })
    }
    return quickStarts
  }

  private isSnapshotStale(
    snapshot: CopilotEntryToolSnapshotProjection,
    evaluatedAt: string,
  ): boolean {
    const maxAge = this.deps.toolSnapshotMaxAgeMs ?? COPILOT_ENTRY_DEFAULT_SNAPSHOT_MAX_AGE_MS
    const generated = Date.parse(snapshot.generatedAt)
    const now = Date.parse(evaluatedAt)
    if (Number.isNaN(generated) || Number.isNaN(now)) return true
    return now - generated > maxAge
  }

  private unavailable(
    scope: CopilotEntryScope,
    code: CopilotEntryReasonCode,
    retryable: boolean,
    evaluatedAt: string,
  ): CopilotEntryReadinessSnapshot {
    return {
      contractVersion: COPILOT_ENTRY_CONTRACT_VERSION,
      state: 'unavailable',
      scope,
      reasons: [{ code, retryable }],
      allowedActions: ['retry-readiness'],
      recentSession: null,
      quickStarts: [],
      evaluatedAt,
    }
  }
}

// ---------------------------------------------------------------------------
// 纯投影函数
// ---------------------------------------------------------------------------

/**
 * 会话投影：只保留可续接所需的最小引用与有界标题。
 *
 * 归档/非活跃/保留治理阻断的会话由适配层过滤；此处再做一次防御性判定，
 * 使服务在依赖行为漂移时仍 fail closed。
 */
export function projectRecentSession(
  projection: CopilotEntrySessionProjection,
): CopilotEntryRecentSession | null {
  if (projection.archived) return null
  if (projection.status !== 'active') return null
  if (projection.retentionBlocked === true) return null
  if (!isCopilotEntrySessionScope(projection.scope)) return null
  const updatedAt = projection.updatedAt
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return null

  const title =
    typeof projection.title === 'string' && projection.title.trim().length > 0
      ? projection.title
      : COPILOT_ENTRY_UNTITLED_SESSION_LABEL

  return {
    sessionId: projection.sessionId,
    titleSummary: boundCopilotEntryText(title, COPILOT_ENTRY_MAX_SESSION_TITLE_LENGTH),
    scope: projection.scope,
    updatedAt,
  }
}

/**
 * 插件 quick start 投影：只映射资格快照的允许字段并绑定 revision。
 *
 * 未通过副作用词表的条目直接缺席（不解释原因）。
 */
export function projectPluginQuickStarts(
  snapshot: CopilotEntryToolSnapshotProjection,
): CopilotEntryQuickStart[] {
  const quickStarts: CopilotEntryQuickStart[] = []
  for (const entry of snapshot.entries) {
    if (!isCopilotEntrySideEffectClass(entry.sideEffectClass)) continue
    quickStarts.push({
      quickStartId: `plugin.${entry.pluginId}.${entry.toolId}`,
      source: 'plugin',
      label: boundCopilotEntryText(entry.name, COPILOT_ENTRY_MAX_QUICK_START_LABEL_LENGTH),
      draftTemplate: boundCopilotEntryText(
        `使用「${entry.name}」处理当前工作。`,
        COPILOT_ENTRY_MAX_QUICK_START_DRAFT_LENGTH,
      ),
      sideEffectClass: entry.sideEffectClass,
      pluginBinding: {
        pluginId: entry.pluginId,
        pluginVersion: entry.pluginVersion,
        toolId: entry.toolId,
        toolDigest: entry.toolDigest,
        snapshotRevision: snapshot.revision,
      },
    })
  }
  return quickStarts
}

/**
 * 允许动作。
 *
 * 服务端**从不**返回 `enter-explicit-demo` —— 演示能力由宿主构建/运行环境在客户端
 * 显式声明，服务端不知道也不授予（design D7）。
 */
function buildAllowedActions(hasRecentSession: boolean): CopilotEntryAllowedAction[] {
  const actions: CopilotEntryAllowedAction[] = ['open-workspace', 'start-session']
  if (hasRecentSession) actions.splice(1, 0, 'continue-session')
  actions.push('retry-readiness')
  return actions
}

/** 原因去重（保序），避免同一降级重复播报。 */
function dedupeReasons(reasons: readonly CopilotEntryReason[]): CopilotEntryReason[] {
  const seen = new Set<string>()
  const result: CopilotEntryReason[] = []
  for (const reason of reasons) {
    if (seen.has(reason.code)) continue
    seen.add(reason.code)
    result.push(reason)
  }
  return result
}
