/**
 * OCR 权限/审计 —— 授权决策解析器（v3-ocr-permission-and-audit §4.4）
 *
 * 组合 RBAC / 项目成员 / 来源可见性 / 生命周期 / 保留滞留 / 陈旧来源 / 隐私预检
 * 为确定性决策快照。系统管理员绕过沿用既有 RBAC 规则（isSuperAdmin）。
 *
 * 快照只含哈希 / 引用 / 枚举码 / 原因码，绝不写完整 OCR 文本、provider 载荷、
 * 提示词、密钥或绝对路径。写类动作（isMutation）一律返回 confirm_required
 * （仍需目标能力自身的 preview/确认/idempotency 契约），本解析器不自动 apply。
 *
 * 依赖可注入（构造器），便于用假适配器做确定性单测（§4.5–4.7）。
 */
import {
  buildDecisionSnapshot,
  computeStatusHash,
  isMutationAction,
  resolveActionMapping,
  type OcrArtifactRef,
  type OcrAuthorizationDecisionSnapshot,
  type OcrGrantedSource,
  type OcrPermissionAction,
  type OcrPermissionDecisionResult,
  type OcrPermissionOutputMode,
  type OcrPermissionReasonCode,
  type OcrPermissionStatus,
  type OcrSourceRef,
} from '@aiproj/types'
import {
  computeDecisionCacheKey,
  createOcrDecisionCache,
  DefaultArtifactLifecycleAdapter,
  DefaultProjectMembershipAdapter,
  DefaultRetentionAdapter,
  DefaultSourceVisibilityAdapter,
  DefaultStaleSourceAdapter,
  GuardedPrivacyPreflightAdapter,
  type OcrArtifactLifecycleAdapter,
  type OcrDecisionCache,
  type OcrPrivacyPreflightAdapter,
  type OcrProjectMembershipAdapter,
  type OcrRetentionAdapter,
  type OcrSourceVisibilityAdapter,
  type OcrStaleSourceAdapter,
} from './ocr_permission_audit_adapters.js'

export interface OcrResolverDeps {
  readonly membership: OcrProjectMembershipAdapter
  readonly visibility: OcrSourceVisibilityAdapter
  readonly lifecycle: OcrArtifactLifecycleAdapter
  readonly retention: OcrRetentionAdapter
  readonly stale: OcrStaleSourceAdapter
  readonly privacy: OcrPrivacyPreflightAdapter
}

export interface OcrResolveInput {
  readonly actorId: number
  readonly organizationId: number
  readonly projectId: number
  readonly action: OcrPermissionAction
  readonly sourceRef?: OcrSourceRef | null
  readonly artifactRef?: OcrArtifactRef | null
  readonly sourceHash?: string | null
  /** 每请求缓存（可选）：仅缓存同一次请求内重复决策，跨请求不共享。 */
  readonly cache?: OcrDecisionCache
}

/**
 * 项目级动作：不针对单个 OCR 来源，sourceRef 为 null 是正常调用形态。
 * 这些动作的授权仅由 RBAC 权限把关（无来源可见性/生命周期/陈旧检查），
 * 故当 sourceRef 缺省时不走来源可见性降级，避免把项目级批量/状态操作误判为 metadata_only。
 */
const PROJECT_SCOPED_ACTIONS: ReadonlySet<OcrPermissionAction> = new Set([
  'retention_cleanup_preview',
  'metadata_read',
  'permission_status_read',
  'ocr_audit_read',
  // 针对已确认提取的派生操作：授权由 RBAC 把关，单来源可见性/生命周期/
  // retention/stale/隐私由各 service 自身 eligibility 检查保留（§6.9/§6.11）。
  'structured_extraction_run',
  'entity_linking_run',
  'explain_request',
])

const DEFAULT_RELEVANT_ACTIONS: readonly OcrPermissionAction[] = [
  'metadata_read',
  'accepted_text_read',
  'provider_run',
  'review_preview',
  'review_confirm',
  'supersede',
  'retention_hold',
  'retention_cleanup_preview',
  'search_indexing_preview',
  'search_indexing_execution',
  'structured_extraction_run',
  'entity_linking_run',
  'copy_export_preview',
  'copy_export_execution',
  'optional_ai_handoff',
  'explain_request',
  'permission_status_read',
  'ocr_audit_read',
]

export class OcrPermissionAuditResolver {
  readonly #membership: OcrProjectMembershipAdapter
  readonly #visibility: OcrSourceVisibilityAdapter
  readonly #lifecycle: OcrArtifactLifecycleAdapter
  readonly #retention: OcrRetentionAdapter
  readonly #stale: OcrStaleSourceAdapter
  readonly #privacy: OcrPrivacyPreflightAdapter

  constructor(deps?: Partial<OcrResolverDeps>) {
    this.#membership = deps?.membership ?? new DefaultProjectMembershipAdapter()
    this.#visibility = deps?.visibility ?? new DefaultSourceVisibilityAdapter()
    this.#lifecycle = deps?.lifecycle ?? new DefaultArtifactLifecycleAdapter()
    this.#retention = deps?.retention ?? new DefaultRetentionAdapter()
    this.#stale = deps?.stale ?? new DefaultStaleSourceAdapter()
    this.#privacy = deps?.privacy ?? new GuardedPrivacyPreflightAdapter()
  }

  /** 解析单个动作的授权决策快照（确定性）。 */
  async resolve(input: OcrResolveInput): Promise<OcrAuthorizationDecisionSnapshot> {
    const mapping = resolveActionMapping(input.action)
    if (!mapping) {
      throw new Error(`未知 OCR 动作：${input.action}`)
    }
    const requiredPermission = mapping.permission

    // 每请求缓存：同键命中直接返回（§4.10）。
    let cacheKey: string | null = null
    if (input.cache) {
      cacheKey = computeDecisionCacheKey({
        organizationId: input.organizationId,
        projectId: input.projectId,
        action: input.action,
        roleVersion: null,
        sourceHash: input.sourceHash ?? null,
        lifecycleState: null,
        retentionState: null,
        holdActive: false,
        privacyHash: null,
      })
      const cached = input.cache.get(cacheKey)
      if (cached) return cached as OcrAuthorizationDecisionSnapshot
    }

    const snapshot = await this.#resolveUncached(input, requiredPermission)

    if (cacheKey && input.cache) {
      input.cache.set(cacheKey, snapshot)
    }
    return snapshot
  }

  /** 解析一组相关动作的权限状态（供状态面板/API 使用）。 */
  async resolveStatus(
    input: Omit<OcrResolveInput, 'action'>,
    relevantActions: readonly OcrPermissionAction[] = DEFAULT_RELEVANT_ACTIONS,
  ): Promise<OcrPermissionStatus> {
    const cache = createOcrDecisionCache()
    const decisions = await Promise.all(
      relevantActions.map((action) =>
        this.resolve({ ...input, action, cache }).then((s) => ({ action, s })),
      ),
    )

    const allowedActions: OcrPermissionAction[] = []
    const blockedActions: {
      action: OcrPermissionAction
      reasonCodes: readonly OcrPermissionReasonCode[]
      decisionHash: string
    }[] = []
    const decisionHashes: string[] = []
    const warnings: string[] = []

    for (const { action, s } of decisions) {
      decisionHashes.push(s.decisionHash)
      if (s.result === 'allow' || s.result === 'confirm_required') {
        allowedActions.push(action)
      } else {
        blockedActions.push({
          action,
          reasonCodes: s.reasonCodes,
          decisionHash: s.decisionHash,
        })
        warnings.push(...s.reasonCodes.map((code) => reasonLabel(code)))
      }
    }

    const first = decisions[0]?.s
    const statusHash = computeStatusHash({
      organizationId: input.organizationId,
      projectId: input.projectId,
      sourceRefId: first?.sourceRef?.id ?? null,
      allowedActions: allowedActions.map((a) => a),
      blockedHashes: blockedActions.map((b) => b.decisionHash),
      outputMode: first?.outputMode ?? 'blocked',
    })

    return {
      projectRef: { type: 'project', id: input.projectId },
      sourceRef: first?.sourceRef ?? null,
      artifactRef: first?.artifactRef ?? null,
      sourceHash: first?.sourceHash ?? null,
      lifecycleState: first?.lifecycleState ?? null,
      retentionState: first?.retentionState ?? null,
      staleStatus: first?.staleStatus ?? 'current',
      outputMode: first?.outputMode ?? 'blocked',
      allowedActions,
      blockedActions,
      decisionHashes,
      warnings: [...new Set(warnings)],
      statusHash,
    }
  }

  /** 核心：无缓存路径的决策组合。 */
  async #resolveUncached(
    input: OcrResolveInput,
    requiredPermission: string,
  ): Promise<OcrAuthorizationDecisionSnapshot> {
    const sourceRef = input.sourceRef ?? null
    const artifactRef = input.artifactRef ?? null

    // 1) 项目成员 + RBAC
    const membership = await this.#membership.resolveMembership(
      input.actorId,
      input.organizationId,
      input.projectId,
    )

    let grantedSource: OcrGrantedSource
    const reasonCodes: OcrPermissionReasonCode[] = []
    let result: OcrPermissionDecisionResult
    let outputMode: OcrPermissionOutputMode
    let requiresConfirmation = false

    if (membership.isSuperAdmin) {
      grantedSource = 'system_admin_bypass'
    } else if (membership.permissions.has(requiredPermission as never)) {
      grantedSource = 'role'
    } else {
      grantedSource = 'none'
      reasonCodes.push('role_denied', 'permission_missing')
      result = 'denied'
      outputMode = 'blocked'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef,
        artifactRef,
        sourceHash: input.sourceHash ?? null,
        lifecycleState: null,
        retentionState: null,
        holdActive: false,
        staleStatus: 'current',
        privacyRef: null,
        privacyHash: null,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }

    // 2) 来源可见性
    //    项目级动作（cleanup preview / metadata read / status read / audit read）
    //    不针对单个来源，无 sourceRef 时跳过可见性降级——授权由 RBAC 把关。
    const isProjectScoped = PROJECT_SCOPED_ACTIONS.has(input.action)
    const visibility = await this.#visibility.resolveVisibility(
      membership,
      input.organizationId,
      input.projectId,
      sourceRef,
    )
    const effectiveSourceHash = visibility.sourceHash ?? input.sourceHash ?? null
    if (!visibility.visible && !(isProjectScoped && !sourceRef)) {
      reasonCodes.push(visibility.reason ?? 'source_hidden')
      result = 'metadata_only'
      outputMode = 'metadata_only'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef: visibility.sourceRef,
        artifactRef,
        sourceHash: effectiveSourceHash,
        lifecycleState: null,
        retentionState: null,
        holdActive: false,
        staleStatus: 'current',
        privacyRef: null,
        privacyHash: null,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }

    // 3) 生命周期
    const lifecycle = await this.#lifecycle.resolveLifecycle(
      input.organizationId,
      input.projectId,
      visibility.sourceRef,
    )
    const effectiveArtifactRef = lifecycle.artifactRef ?? artifactRef

    if (lifecycle.lifecycleState === 'tombstoned') {
      reasonCodes.push('lifecycle_tombstoned')
      result = 'metadata_only'
      outputMode = 'metadata_only'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef: visibility.sourceRef,
        artifactRef: effectiveArtifactRef,
        sourceHash: effectiveSourceHash,
        lifecycleState: 'tombstoned',
        retentionState: null,
        holdActive: false,
        staleStatus: 'current',
        privacyRef: null,
        privacyHash: null,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }
    if (lifecycle.lifecycleState === 'purged' || lifecycle.lifecycleState === 'expired') {
      reasonCodes.push(
        lifecycle.lifecycleState === 'purged' ? 'lifecycle_purged' : 'lifecycle_expired',
      )
      result = 'retention_blocked'
      outputMode = 'blocked'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef: visibility.sourceRef,
        artifactRef: effectiveArtifactRef,
        sourceHash: effectiveSourceHash,
        lifecycleState: lifecycle.lifecycleState,
        retentionState: null,
        holdActive: false,
        staleStatus: 'current',
        privacyRef: null,
        privacyHash: null,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }

    // 4) 保留/滞留
    const retention = await this.#retention.resolveRetention(
      input.organizationId,
      input.projectId,
      visibility.sourceRef,
      effectiveArtifactRef,
    )
    if (retention.holdActive || retention.retentionState === 'purge_pending') {
      reasonCodes.push(retention.holdActive ? 'retention_held' : 'retention_purge_pending')
      result = 'retention_blocked'
      outputMode = 'blocked'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef: visibility.sourceRef,
        artifactRef: effectiveArtifactRef,
        sourceHash: effectiveSourceHash,
        lifecycleState: lifecycle.lifecycleState ?? 'active',
        retentionState: retention.retentionState,
        holdActive: retention.holdActive,
        staleStatus: 'current',
        privacyRef: null,
        privacyHash: null,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }

    // 5) 陈旧来源
    const staleStatus = await this.#stale.resolveStale(
      input.organizationId,
      input.projectId,
      visibility.sourceRef,
      effectiveSourceHash,
    )
    if (staleStatus === 'stale') {
      reasonCodes.push('stale_source')
      result = 'stale_blocked'
      outputMode = 'blocked'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef: visibility.sourceRef,
        artifactRef: effectiveArtifactRef,
        sourceHash: effectiveSourceHash,
        lifecycleState: lifecycle.lifecycleState ?? 'active',
        retentionState: retention.retentionState,
        holdActive: retention.holdActive,
        staleStatus,
        privacyRef: null,
        privacyHash: null,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }

    // 6) 隐私预检
    const privacy = await this.#privacy.preflight(
      input.organizationId,
      input.projectId,
      input.action,
      visibility.sourceRef,
    )
    if (privacy.blocked) {
      reasonCodes.push('privacy_blocked')
      result = 'privacy_blocked'
      outputMode = 'blocked'
      return this.#buildSnapshot(input, {
        result,
        requiredPermission,
        grantedSource,
        membershipRoleVersion: membership.roleVersion,
        sourceRef: visibility.sourceRef,
        artifactRef: effectiveArtifactRef,
        sourceHash: effectiveSourceHash,
        lifecycleState: lifecycle.lifecycleState ?? 'active',
        retentionState: retention.retentionState,
        holdActive: retention.holdActive,
        staleStatus,
        privacyRef: privacy.privacyRef,
        privacyHash: privacy.privacyHash,
        outputMode,
        requiresConfirmation: false,
        reasonCodes,
      })
    }

    // 7) 放行 vs 写类确认
    if (isMutationAction(input.action)) {
      result = 'confirm_required'
      requiresConfirmation = true
      outputMode = 'full'
      reasonCodes.push('confirmation_required')
    } else {
      result = 'allow'
      outputMode = privacy.privacyHash ? 'masked' : 'full'
    }
    return this.#buildSnapshot(input, {
      result,
      requiredPermission,
      grantedSource,
      membershipRoleVersion: membership.roleVersion,
      sourceRef: visibility.sourceRef,
      artifactRef: effectiveArtifactRef,
      sourceHash: effectiveSourceHash,
      lifecycleState: lifecycle.lifecycleState ?? 'active',
      retentionState: retention.retentionState,
      holdActive: retention.holdActive,
      staleStatus,
      privacyRef: privacy.privacyRef,
      privacyHash: privacy.privacyHash,
      outputMode,
      requiresConfirmation,
      reasonCodes,
    })
  }

  /** 组装确定性快照（幂等：同一输入 → 同一 decisionHash）。 */
  #buildSnapshot(
    input: OcrResolveInput,
    ctx: {
      result: OcrPermissionDecisionResult
      requiredPermission: string
      grantedSource: OcrGrantedSource
      membershipRoleVersion: number | null
      sourceRef: OcrSourceRef | null
      artifactRef: OcrArtifactRef | null
      sourceHash: string | null
      lifecycleState: OcrAuthorizationDecisionSnapshot['lifecycleState']
      retentionState: OcrAuthorizationDecisionSnapshot['retentionState']
      holdActive: boolean
      staleStatus: OcrAuthorizationDecisionSnapshot['staleStatus']
      privacyRef: string | null
      privacyHash: string | null
      outputMode: OcrPermissionOutputMode
      requiresConfirmation: boolean
      reasonCodes: readonly OcrPermissionReasonCode[]
    },
  ): OcrAuthorizationDecisionSnapshot {
    return buildDecisionSnapshot({
      action: input.action,
      result: ctx.result,
      requiredPermission: ctx.requiredPermission,
      grantedPermissionSource: ctx.grantedSource,
      roleVersion: ctx.membershipRoleVersion,
      actorRef: { type: 'user', id: input.actorId },
      organizationRef: { type: 'organization', id: input.organizationId },
      projectRef: { type: 'project', id: input.projectId },
      sourceRef: ctx.sourceRef,
      artifactRef: ctx.artifactRef,
      sourceHash: ctx.sourceHash,
      lifecycleState: ctx.lifecycleState,
      retentionState: ctx.retentionState,
      holdActive: ctx.holdActive,
      staleStatus: ctx.staleStatus,
      privacyRef: ctx.privacyRef,
      privacyHash: ctx.privacyHash,
      outputMode: ctx.outputMode,
      requiresConfirmation: ctx.requiresConfirmation,
      reasonCodes: ctx.reasonCodes,
    })
  }
}

/** 低敏原因码 → 中文标签（§D6）。 */
export function reasonLabel(reason: OcrPermissionReasonCode): string {
  switch (reason) {
    case 'role_denied':
      return '无该权限'
    case 'permission_missing':
      return '缺少所需权限'
    case 'org_mismatch':
      return '组织不匹配'
    case 'project_mismatch':
      return '项目不匹配'
    case 'source_hidden':
      return '来源已隐藏'
    case 'source_not_found':
      return '来源不存在'
    case 'lifecycle_expired':
      return '已过期'
    case 'lifecycle_purged':
      return '已清除'
    case 'lifecycle_tombstoned':
      return '仅保留元数据'
    case 'retention_held':
      return '保留滞留中'
    case 'retention_purge_pending':
      return '待清除'
    case 'stale_source':
      return '来源已过期'
    case 'privacy_blocked':
      return '隐私策略阻止'
    case 'confirmation_required':
      return '需确认'
    case 'capability_unavailable':
      return '能力暂不可用'
    case 'degraded':
      return '降级'
    case 'system_admin_bypass':
      return '系统管理员放行'
    default:
      return reason
  }
}
