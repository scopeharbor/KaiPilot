/**
 * OCR provider 边界 —— 下游权限集成测试（v3-ocr-permission-and-audit §6.4）
 *
 * 覆盖：权限 / 隐私 / 陈旧 / 滞留 阻断时，`OcrProviderExecutionService.executePage`
 * 在调用真实 provider/model 之前即被 resolver 守卫拦截，返回 blocked 结果。
 *
 * 红线：
 * - 只走 fixture/假适配器，不调用真实 OCR/provider/model/网络
 * - 不写任何正式项目数据
 */

import { test } from '@japa/runner'
import OcrProviderExecutionService from '#services/ai_ocr/ocr_provider_execution_service'
import { OcrPermissionAuditResolver } from '#services/ai_ocr/ocr_permission_audit_resolver'
import type {
  OcrArtifactLifecycleAdapter,
  OcrPrivacyPreflightAdapter,
  OcrProjectMembershipAdapter,
  OcrProjectMembershipContext,
  OcrRetentionAdapter,
  OcrSourceVisibilityAdapter,
  OcrStaleSourceAdapter,
} from '#services/ai_ocr/ocr_permission_audit_adapters'
import type { Permission } from '#rbac'
import type {
  OcrArtifactRef,
  OcrLifecycleState,
  OcrRetentionState,
  OcrSourceRef,
  OcrStaleStatus,
} from '@aiproj/types'

const PM_PERMS: Permission[] = [
  'ocr_document:view',
  'ocr:review',
  'ocr:confirm',
  'ocr_provider_observability:view',
]

function fakeMembership(permissions: Permission[]): OcrProjectMembershipAdapter {
  return {
    async resolveMembership(): Promise<OcrProjectMembershipContext> {
      return {
        isSuperAdmin: false,
        role: 'PROJECT_MANAGER',
        roleVersion: 1,
        permissions: new Set<Permission>(permissions),
      }
    },
  }
}

function visibleVisibility(): OcrSourceVisibilityAdapter {
  return {
    async resolveVisibility(): Promise<{
      visible: boolean
      sourceRef: OcrSourceRef | null
      sourceHash: string | null
      reason: 'source_hidden' | 'source_not_found' | null
    }> {
      return {
        visible: true,
        sourceRef: { type: 'ocr_source', id: 1, kind: 'job' },
        sourceHash: 'src_hash_001',
        reason: null,
      }
    },
  }
}

function lifecycle(state: OcrLifecycleState | null): OcrArtifactLifecycleAdapter {
  return {
    async resolveLifecycle(): Promise<{
      lifecycleState: OcrLifecycleState | null
      artifactRef: OcrArtifactRef | null
    }> {
      return {
        lifecycleState: state,
        artifactRef: { type: 'ocr_artifact', id: 1, kind: 'accepted_extraction' },
      }
    },
  }
}

function retention(state: OcrRetentionState, holdActive: boolean): OcrRetentionAdapter {
  return {
    async resolveRetention(): Promise<{ retentionState: OcrRetentionState; holdActive: boolean }> {
      return { retentionState: state, holdActive }
    },
  }
}

function stale(status: OcrStaleStatus): OcrStaleSourceAdapter {
  return {
    async resolveStale(): Promise<OcrStaleStatus> {
      return status
    },
  }
}

function privacy(blocked: boolean): OcrPrivacyPreflightAdapter {
  return {
    async preflight(): Promise<{
      blocked: boolean
      privacyRef: string | null
      privacyHash: string | null
    }> {
      return {
        blocked,
        privacyRef: blocked ? 'privacy' : null,
        privacyHash: blocked ? 'privacy_hash' : null,
      }
    },
  }
}

/** 构造一个可注入 resolver 的执行服务。 */
function makeService(
  overrides: {
    membership?: OcrProjectMembershipAdapter
    lifecycle?: OcrArtifactLifecycleAdapter
    retention?: OcrRetentionAdapter
    stale?: OcrStaleSourceAdapter
    privacy?: OcrPrivacyPreflightAdapter
  } = {},
) {
  const resolver = new OcrPermissionAuditResolver({
    membership: overrides.membership ?? fakeMembership(PM_PERMS),
    visibility: visibleVisibility(),
    lifecycle: overrides.lifecycle ?? lifecycle('active'),
    retention: overrides.retention ?? retention('none', false),
    stale: overrides.stale ?? stale('current'),
    privacy: overrides.privacy ?? privacy(false),
  })
  return new OcrProviderExecutionService({ resolver })
}

const EMPTY_JOB = { id: 1 } as any
const EMPTY_PAGE = { id: 1 } as any

const BASE = {
  organizationId: 1,
  projectId: 10,
  job: EMPTY_JOB,
  page: EMPTY_PAGE,
  attemptNumber: 1,
  imageDataUrl: 'data:image/png;base64,AAAA',
  userId: 100,
}

test.group('OcrProviderExecutionService — 权限边界', () => {
  test('权限被拒（denied）：不调用 provider，返回 blocked', async ({ assert }) => {
    const service = makeService({
      membership: fakeMembership([]), // 无 ocr_provider_observability:view
    })
    const result = await service.executePage({ ...BASE })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.equal(result.blockReason, 'ocr_permission_blocked')
    assert.isUndefined(result.extractedText)
  })

  test('陈旧来源（stale_blocked）：不调用 provider，返回 blocked', async ({ assert }) => {
    const service = makeService({ stale: stale('stale') })
    const result = await service.executePage({ ...BASE })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.equal(result.blockReason, 'ocr_permission_blocked')
    assert.isUndefined(result.extractedText)
  })

  test('保留滞留（retention_blocked）：不调用 provider，返回 blocked', async ({ assert }) => {
    const service = makeService({ retention: retention('held', true) })
    const result = await service.executePage({ ...BASE })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.equal(result.blockReason, 'ocr_permission_blocked')
    assert.isUndefined(result.extractedText)
  })

  test('隐私阻止（privacy_blocked）：不调用 provider，返回 blocked', async ({ assert }) => {
    const service = makeService({ privacy: privacy(true) })
    const result = await service.executePage({ ...BASE })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.equal(result.blockReason, 'ocr_permission_blocked')
    assert.isUndefined(result.extractedText)
  })

  test('tombstone（metadata_only）：不调用 provider，返回 blocked', async ({ assert }) => {
    const service = makeService({ lifecycle: lifecycle('tombstoned') })
    const result = await service.executePage({ ...BASE })
    assert.equal(result.ok, false)
    assert.equal(result.blocked, true)
    assert.equal(result.blockReason, 'ocr_permission_blocked')
  })

  test('放行（confirm_required）：不因权限守卫被阻断（继续走适配器解析）', async ({ assert }) => {
    const service = makeService()
    const result = await service.executePage({ ...BASE })
    // provider_run 为写类动作 → confirm_required 放行；此处未配真实连接，应走到
    // 适配器解析并因模型不可用而返回 model_unavailable，而非权限阻断。
    assert.notEqual(result.blockReason, 'ocr_permission_blocked')
  })
})
