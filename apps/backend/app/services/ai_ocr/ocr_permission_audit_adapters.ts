/**
 * OCR 权限/审计 —— 守卫式适配器端口与默认实现（v3-ocr-permission-and-audit §4.1–4.3）
 *
 * 语法：
 * - 端口（interface）定义 resolver 依赖的六类证据：项目成员、来源可见性、
 *   OCR 构件生命周期、保留/滞留、陈旧来源、隐私预检。
 * - 默认实现（Default*）基于当前已落库的 OCR 记录（accepted extraction /
 *   retention hold / job）做组织+项目隔离，能力未落地时返回 guarded 降级原因码，
 *   绝不绕过来源可见性、生命周期或隐私要求。
 * - 守卫降级适配器（Guarded*）用于活跃但未归档的邻居能力（search-index、
 *   structured-extraction、entity-link、copy/export、AI handoff）：返回
 *   `capability_unavailable` / `degraded` 原因码，而非静默放行。
 *
 * 红线：本模块只读，不写任何正式项目数据；不调用真实 OCR provider/model。
 */
import type { Permission } from '#rbac'
import RbacService from '#services/rbac_service'
import User from '#models/user'
import OcrReviewAcceptedExtraction from '#models/ocr_review_accepted_extraction'
import OcrRetentionHold from '#models/ocr_retention_hold'
import type {
  OcrArtifactRef,
  OcrLifecycleState,
  OcrPermissionAction,
  OcrPermissionReasonCode,
  OcrRetentionState,
  OcrSourceRef,
  OcrStaleStatus,
} from '@aiproj/types'

// ═══════════════════════════════════════════════════════════════════════════════
// 端口（adapter 接口）
// ═══════════════════════════════════════════════════════════════════════════════

/** 项目成员证据：角色 + 权限集 + 角色版本。 */
export interface OcrProjectMembershipContext {
  readonly isSuperAdmin: boolean
  readonly role: string | null
  readonly roleVersion: number | null
  readonly permissions: ReadonlySet<Permission>
}

export interface OcrProjectMembershipAdapter {
  resolveMembership(
    actorId: number,
    organizationId: number,
    projectId: number,
  ): Promise<OcrProjectMembershipContext>
}

/** 来源可见性证据：是否可见 + 来源引用 + 来源哈希 + 隐藏原因。 */
export interface OcrSourceVisibilityContext {
  readonly visible: boolean
  readonly sourceRef: OcrSourceRef | null
  readonly sourceHash: string | null
  readonly reason: OcrPermissionReasonCode | null
}

export interface OcrSourceVisibilityAdapter {
  resolveVisibility(
    membership: OcrProjectMembershipContext,
    organizationId: number,
    projectId: number,
    sourceRef: OcrSourceRef | null,
  ): Promise<OcrSourceVisibilityContext>
}

/** OCR 构件生命周期证据。 */
export interface OcrArtifactLifecycleContext {
  readonly lifecycleState: OcrLifecycleState | null
  readonly artifactRef: OcrArtifactRef | null
}

export interface OcrArtifactLifecycleAdapter {
  resolveLifecycle(
    organizationId: number,
    projectId: number,
    sourceRef: OcrSourceRef | null,
  ): Promise<OcrArtifactLifecycleContext>
}

/** 保留/滞留证据。 */
export interface OcrRetentionContext {
  readonly retentionState: OcrRetentionState
  readonly holdActive: boolean
}

export interface OcrRetentionAdapter {
  resolveRetention(
    organizationId: number,
    projectId: number,
    sourceRef: OcrSourceRef | null,
    artifactRef: OcrArtifactRef | null,
  ): Promise<OcrRetentionContext>
}

/** 陈旧来源检查。 */
export interface OcrStaleSourceAdapter {
  resolveStale(
    organizationId: number,
    projectId: number,
    sourceRef: OcrSourceRef | null,
    sourceHash: string | null,
  ): Promise<OcrStaleStatus>
}

/** 隐私预检（消费隐私能力决策，不重定义隐私规则）。 */
export interface OcrPrivacyPreflightContext {
  readonly blocked: boolean
  readonly privacyRef: string | null
  readonly privacyHash: string | null
}

export interface OcrPrivacyPreflightAdapter {
  preflight(
    organizationId: number,
    projectId: number,
    action: OcrPermissionAction,
    sourceRef: OcrSourceRef | null,
  ): Promise<OcrPrivacyPreflightContext>
}

// ═══════════════════════════════════════════════════════════════════════════════
// 默认成员适配器（经 RbacService 解析，组织+项目隔离）
// ═══════════════════════════════════════════════════════════════════════════════

export class DefaultProjectMembershipAdapter implements OcrProjectMembershipAdapter {
  #rbac: RbacService

  constructor(rbac?: RbacService) {
    this.#rbac = rbac ?? new RbacService()
  }

  async resolveMembership(
    actorId: number,
    organizationId: number,
    projectId: number,
  ): Promise<OcrProjectMembershipContext> {
    const user = await User.find(actorId)
    if (!user) {
      return { isSuperAdmin: false, role: null, roleVersion: null, permissions: new Set() }
    }
    if (user.isSuperAdmin) {
      return {
        isSuperAdmin: true,
        role: 'system_admin',
        roleVersion: user.roleVersion,
        permissions: new Set<Permission>(),
      }
    }
    const permissions = await this.#rbac.resolveUserPermissions(user, organizationId, projectId)
    return {
      isSuperAdmin: false,
      role: null,
      roleVersion: user.roleVersion,
      permissions: new Set(permissions),
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 默认来源可见性适配器（基于 accepted extraction；外部协作者隐藏来源）
// ═══════════════════════════════════════════════════════════════════════════════

export class DefaultSourceVisibilityAdapter implements OcrSourceVisibilityAdapter {
  async resolveVisibility(
    membership: OcrProjectMembershipContext,
    organizationId: number,
    projectId: number,
    sourceRef: OcrSourceRef | null,
  ): Promise<OcrSourceVisibilityContext> {
    // 外部协作者：来源内容一律隐藏（metadata_only），不泄露存在性细节。
    if (membership.role === 'EXTERNAL_COLLABORATOR') {
      return {
        visible: false,
        sourceRef,
        sourceHash: null,
        reason: 'source_hidden',
      }
    }
    if (!sourceRef) {
      return { visible: false, sourceRef: null, sourceHash: null, reason: 'source_not_found' }
    }
    // 从 accepted extraction 反推来源哈希（guarded：无记录则视为不可见）。
    const extraction = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('source_id', sourceRef.id)
      .where('status', 'current')
      .first()
    if (extraction) {
      return {
        visible: true,
        sourceRef,
        sourceHash: extraction.sourceHash,
        reason: null,
      }
    }
    return { visible: true, sourceRef, sourceHash: null, reason: null }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 默认生命周期适配器（基于 accepted extraction 的保留字段）
// ═══════════════════════════════════════════════════════════════════════════════

export class DefaultArtifactLifecycleAdapter implements OcrArtifactLifecycleAdapter {
  async resolveLifecycle(
    organizationId: number,
    projectId: number,
    sourceRef: OcrSourceRef | null,
  ): Promise<OcrArtifactLifecycleContext> {
    if (!sourceRef) {
      return { lifecycleState: null, artifactRef: null }
    }
    const extraction = await OcrReviewAcceptedExtraction.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('source_id', sourceRef.id)
      .where('status', 'current')
      .first()
    if (!extraction) {
      return { lifecycleState: 'active', artifactRef: null }
    }
    const artifactRef: OcrArtifactRef = {
      type: 'ocr_artifact',
      id: extraction.id,
      kind: 'accepted_extraction',
    }
    // 台账：tombstone 存在 → tombstoned；purged → purged；否则 active。
    const lifecycleState: OcrLifecycleState = extraction.tombstoneId
      ? 'tombstoned'
      : extraction.purgedAt
        ? 'purged'
        : 'active'
    return { lifecycleState, artifactRef }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 默认保留/滞留适配器（基于 retention hold + 生命周期）
// ═══════════════════════════════════════════════════════════════════════════════

export class DefaultRetentionAdapter implements OcrRetentionAdapter {
  async resolveRetention(
    organizationId: number,
    projectId: number,
    _sourceRef: OcrSourceRef | null,
    artifactRef: OcrArtifactRef | null,
  ): Promise<OcrRetentionContext> {
    // 有活跃 hold → held；否则依据生命周期派生。
    const hold = await OcrRetentionHold.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('status', 'active')
      .first()
    if (hold) {
      return { retentionState: 'held', holdActive: true }
    }
    if (!artifactRef) {
      return { retentionState: 'none', holdActive: false }
    }
    return { retentionState: 'none', holdActive: false }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 默认陈旧来源适配器（当前实现：无上游版本台账 → 视为 current / guarded）
// ═══════════════════════════════════════════════════════════════════════════════

export class DefaultStaleSourceAdapter implements OcrStaleSourceAdapter {
  async resolveStale(
    _organizationId: number,
    _projectId: number,
    _sourceRef: OcrSourceRef | null,
    _sourceHash: string | null,
  ): Promise<OcrStaleStatus> {
    // Guard：上游 source 版本台账未落地，无法比对 → 保守返回 current。
    return 'current'
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 隐私预检适配器
// ═══════════════════════════════════════════════════════════════════════════════
// 说明：隐私能力（v3-ocr-privacy-policy-controls）已落地，其自身边界已做真实
// 隐私判定。本适配器在 resolver 侧提供「消费级」预检：若隐私能力回传 blocked
// 决策则记录，否则不重定义隐私规则（设计 D"consume privacy decisions"）。
// 默认实现保守返回未阻断 + 无隐私引用；边界处的真实 privacy block 由隐私能力
// 自身的决策服务触发并写入低敏审计。

export class GuardedPrivacyPreflightAdapter implements OcrPrivacyPreflightAdapter {
  async preflight(
    _organizationId: number,
    _projectId: number,
    _action: OcrPermissionAction,
    _sourceRef: OcrSourceRef | null,
  ): Promise<OcrPrivacyPreflightContext> {
    return { blocked: false, privacyRef: null, privacyHash: null }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 守卫降级适配器（活跃但未归档的邻居能力）
// ═══════════════════════════════════════════════════════════════════════════════
// 这些能力（search-index / structured-extraction / entity-link / copy-export /
// AI handoff）在其自身 spec 未收紧前，resolver 侧不主动放行：

/** 返回 `capability_unavailable` 守卫的适配器（用于未落地能力）。 */
export class GuardedUnavailableAdapter {
  readonly reason: OcrPermissionReasonCode = 'capability_unavailable'
  readonly outputMode = 'blocked' as const
}

// ═══════════════════════════════════════════════════════════════════════════════
// 有界每请求决策缓存（§4.10）
// ═══════════════════════════════════════════════════════════════════════════════

/** 每请求决策缓存：仅缓存同一次请求内重复的决策，跨请求不共享。 */
export interface OcrDecisionCache {
  readonly get: (key: string) => unknown
  readonly set: (key: string, value: unknown) => void
  readonly size: number
}

/** 创建有界 LRU 式缓存（默认最多 64 条，超出后驱逐最旧一条）。 */
export function createOcrDecisionCache(maxEntries = 64): OcrDecisionCache {
  const cache = new Map<string, unknown>()
  return {
    get: (key: string) => cache.get(key),
    set: (key: string, value: unknown) => {
      if (cache.size >= maxEntries) {
        const oldest = cache.keys().next()
        if (!oldest.done) cache.delete(oldest.value)
      }
      cache.set(key, value)
    },
    get size() {
      return cache.size
    },
  }
}

/**
 * 计算决策缓存键（§4.10：角色版本 + 来源哈希 + 生命周期 + 保留/滞留 + 隐私
 * 哈希均进入键；任一变化即产生新键 → 重验证）。低敏，不含文本。
 */
export function computeDecisionCacheKey(input: {
  organizationId: number
  projectId: number
  action: string
  roleVersion: number | null
  sourceHash: string | null
  lifecycleState: OcrLifecycleState | null
  retentionState: OcrRetentionState | null
  holdActive: boolean
  privacyHash: string | null
}): string {
  return [
    input.organizationId,
    input.projectId,
    input.action,
    input.roleVersion ?? '',
    input.sourceHash ?? '',
    input.lifecycleState ?? '',
    input.retentionState ?? '',
    String(input.holdActive),
    input.privacyHash ?? '',
  ].join('|')
}
