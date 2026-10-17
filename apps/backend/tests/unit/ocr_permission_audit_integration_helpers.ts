/**
 * OCR 权限/审计 —— 下游集成测试共享装配（v3-ocr-permission-and-audit §6.7–6.12）
 *
 * 用假适配器注入 resolver，做确定性决策组合（无 DB）：
 * - makePermissiveResolver()：PM 全量权限 → 所有动作 allow / confirm_required
 *   （供既有模块测试注入，保持其原有行为不变）
 * - makeResolver(overrides)：按需覆盖成员/可见性/生命周期/滞留/陈旧/隐私，
 *   构造降级/拒绝/隐私/仅元数据决策，供新增集成测试证明阻断。
 *
 * 红/线：本助手只读，不写库、不调用真实 provider/model。
 */
import { OcrPermissionAuditResolver } from '../../app/services/ai_ocr/ocr_permission_audit_resolver.js'
import type {
  OcrArtifactLifecycleAdapter,
  OcrPrivacyPreflightAdapter,
  OcrProjectMembershipAdapter,
  OcrProjectMembershipContext,
  OcrRetentionAdapter,
  OcrSourceVisibilityAdapter,
  OcrStaleSourceAdapter,
} from '../../app/services/ai_ocr/ocr_permission_audit_adapters.js'
import type { Permission } from '#rbac'
import type {
  OcrArtifactRef,
  OcrLifecycleState,
  OcrRetentionState,
  OcrSourceRef,
  OcrStaleStatus,
} from '@aiproj/types'

/** 项目管理员全量 OCR 权限（与 resolver.spec 的 PM_PERMS 对齐）。 */
export const PM_PERMS: Permission[] = [
  'ocr_document:view',
  'ocr:review',
  'ocr:confirm',
  'ocr_provider_observability:view',
  'ocr_retention:hold',
  'ocr_retention:cleanup',
  'ocr_search_index:view',
  'ocr_search_index:manage',
  'ocr_structured_extraction:run',
  'ocr_entity_link:manage',
  'ocr_entity_link:explain',
  'ocr_privacy:copy',
  'ocr_privacy:export',
  'ocr_permission_audit:view_status',
  'ocr_permission_audit:audit_read',
]

export function fakeMembership(
  overrides: Partial<OcrProjectMembershipContext> = {},
): OcrProjectMembershipAdapter {
  return {
    async resolveMembership(): Promise<OcrProjectMembershipContext> {
      return {
        isSuperAdmin: false,
        role: 'PROJECT_MANAGER',
        roleVersion: 3,
        permissions: new Set<Permission>(PM_PERMS),
        ...overrides,
      }
    },
  }
}

export function visibleVisibility(
  overrides: Partial<{ visible: boolean; sourceHash: string | null }> = {},
): OcrSourceVisibilityAdapter {
  return {
    async resolveVisibility(): Promise<{
      visible: boolean
      sourceRef: OcrSourceRef | null
      sourceHash: string | null
      reason: 'source_hidden' | 'source_not_found' | null
    }> {
      return {
        visible: overrides.visible ?? true,
        sourceRef: { type: 'ocr_source', id: 1, kind: 'attachment' },
        // 显式传 null 时保留 null（隐藏来源不泄露哈希），不能用 ?? 兜底
        sourceHash: 'sourceHash' in overrides ? (overrides.sourceHash ?? null) : 'src_hash_001',
        reason: null,
      }
    },
  }
}

export function activeLifecycle(): OcrArtifactLifecycleAdapter {
  return {
    async resolveLifecycle(): Promise<{
      lifecycleState: OcrLifecycleState | null
      artifactRef: OcrArtifactRef | null
    }> {
      return {
        lifecycleState: 'active',
        artifactRef: { type: 'ocr_artifact', id: 1, kind: 'accepted_extraction' },
      }
    },
  }
}

export function noneRetention(): OcrRetentionAdapter {
  return {
    async resolveRetention(): Promise<{ retentionState: OcrRetentionState; holdActive: boolean }> {
      return { retentionState: 'none', holdActive: false }
    },
  }
}

export function currentStale(): OcrStaleSourceAdapter {
  return {
    async resolveStale(): Promise<OcrStaleStatus> {
      return 'current'
    },
  }
}

export function unblockedPrivacy(): OcrPrivacyPreflightAdapter {
  return {
    async preflight(): Promise<{
      blocked: boolean
      privacyRef: string | null
      privacyHash: string | null
    }> {
      return { blocked: false, privacyRef: null, privacyHash: null }
    },
  }
}

export interface ResolverOverrides {
  membership?: OcrProjectMembershipAdapter
  visibility?: OcrSourceVisibilityAdapter
  lifecycle?: OcrArtifactLifecycleAdapter
  retention?: OcrRetentionAdapter
  stale?: OcrStaleSourceAdapter
  privacy?: OcrPrivacyPreflightAdapter
}

/** 构造 resolver：默认 PM 放行；按需覆盖证据以构造降级/拒绝决策。 */
export function makeResolver(overrides: ResolverOverrides = {}): OcrPermissionAuditResolver {
  return new OcrPermissionAuditResolver({
    membership: overrides.membership ?? fakeMembership(),
    visibility: overrides.visibility ?? visibleVisibility(),
    lifecycle: overrides.lifecycle ?? activeLifecycle(),
    retention: overrides.retention ?? noneRetention(),
    stale: overrides.stale ?? currentStale(),
    privacy: overrides.privacy ?? unblockedPrivacy(),
  })
}

/** 放行 resolver：PM 全量权限，所有动作 allow / confirm_required（供既有模块测试）。 */
export function makePermissiveResolver(): OcrPermissionAuditResolver {
  return makeResolver()
}

/** 拒绝 resolver：无任何 OCR 权限（供 denied 决策测试）。 */
export function makeDeniedResolver(): OcrPermissionAuditResolver {
  return makeResolver({
    membership: fakeMembership({ permissions: new Set<Permission>() }),
  })
}

/** 仅元数据 resolver：隐藏来源（供 metadata_only 决策测试）。 */
export function makeMetadataOnlyResolver(): OcrPermissionAuditResolver {
  return makeResolver({
    membership: fakeMembership({
      role: 'EXTERNAL_COLLABORATOR',
      permissions: new Set<Permission>(['ocr_document:view', 'ocr:review']),
    }),
    visibility: visibleVisibility({ visible: false, sourceHash: null }),
  })
}

/** 隐私阻止 resolver：隐私预检阻断（供 privacy_blocked 决策测试）。 */
export function makePrivacyBlockedResolver(): OcrPermissionAuditResolver {
  return makeResolver({
    privacy: {
      async preflight(): Promise<{
        blocked: boolean
        privacyRef: string | null
        privacyHash: string | null
      }> {
        return { blocked: true, privacyRef: 'privacy', privacyHash: 'privacy_hash_blocked' }
      },
    },
  })
}

/** 陈旧来源 resolver：来源已过期（供 stale_blocked 决策测试）。 */
export function makeStaleResolver(): OcrPermissionAuditResolver {
  return makeResolver({
    stale: {
      async resolveStale(): Promise<OcrStaleStatus> {
        return 'stale'
      },
    },
  })
}
