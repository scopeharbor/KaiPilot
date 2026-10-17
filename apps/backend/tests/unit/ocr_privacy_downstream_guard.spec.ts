/**
 * OCR 权限/审计 —— 下游敏感复用边界守卫测试（v3-ocr-permission-and-audit §6.13–6.14）
 *
 * 用假适配器注入 resolver，做确定性守卫决策测试（无真实 provider/model/网络）：
 * - 隐私 copy/export 预览：放行 → 消费 copy/export 自身决策；拒绝 → 阻止 + 低敏审计
 * - 隐私 copy/export 执行：confirm_required 仍走 copy/export 自身确认/幂等契约
 * - optional AI handoff：ai:trigger 门控、确定性降级（capability_unavailable/degraded）、低敏审计
 */
import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import AuditService from '#services/audit_service'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'
import { OcrPermissionDownstreamGuard } from '../../app/services/ai_ocr/ocr_privacy_downstream_guard.js'
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
import { resolveSystemDefaultPrivacyPolicy } from '@aiproj/types'
import type { Permission } from '#rbac'
import type {
  OcrArtifactRef,
  OcrLifecycleState,
  OcrRetentionState,
  OcrSourceRef,
  OcrStaleStatus,
} from '@aiproj/types'

// ─── 假适配器工厂（与 resolver spec 同构）────────────────────────────────────

const PM_PERMS: Permission[] = [
  'ocr_document:view',
  'ocr:review',
  'ocr:confirm',
  'ocr_privacy:copy',
  'ocr_privacy:export',
  'ocr_permission_audit:view_status',
]

function fakeMembership(
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
        sourceRef: { type: 'ocr_source', id: 1, kind: 'attachment' },
        sourceHash: 'src_hash_001',
        reason: null,
      }
    },
  }
}

function activeLifecycle(): OcrArtifactLifecycleAdapter {
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

function noneRetention(): OcrRetentionAdapter {
  return {
    async resolveRetention(): Promise<{ retentionState: OcrRetentionState; holdActive: boolean }> {
      return { retentionState: 'none', holdActive: false }
    },
  }
}

function currentStale(): OcrStaleSourceAdapter {
  return {
    async resolveStale(): Promise<OcrStaleStatus> {
      return 'current'
    },
  }
}

function unblockedPrivacy(): OcrPrivacyPreflightAdapter {
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

function makeResolver(
  deps: {
    membership?: OcrProjectMembershipAdapter
    privacy?: OcrPrivacyPreflightAdapter
    stale?: OcrStaleSourceAdapter
  } = {},
) {
  return new OcrPermissionAuditResolver({
    membership: deps.membership ?? fakeMembership(),
    visibility: visibleVisibility(),
    lifecycle: activeLifecycle(),
    retention: noneRetention(),
    stale: deps.stale ?? currentStale(),
    privacy: deps.privacy ?? unblockedPrivacy(),
  })
}

function makeGuard(
  deps: {
    resolver?: OcrPermissionAuditResolver
    membership?: OcrProjectMembershipAdapter
    aiHandoffAvailable?: boolean
    audit?: AuditService
  } = {},
) {
  return new OcrPermissionDownstreamGuard({
    resolver: deps.resolver ?? makeResolver(),
    membership: deps.membership ?? fakeMembership(),
    aiHandoffAvailable: deps.aiHandoffAvailable ?? false,
    audit: deps.audit,
  })
}

const BASE = { actorId: 100, organizationId: 1, projectId: 10 }
const CTX = {
  ...BASE,
  sourceRef: { type: 'ocr_source' as const, id: 1, kind: 'attachment' },
  sourceHash: 'src_hash_001',
}

const POLICY = resolveSystemDefaultPrivacyPolicy({ organizationId: 1, projectId: 10 })

const PREVIEW_INPUT = {
  purpose: 'export_metadata' as const,
  scope: {
    organizationId: 1,
    projectId: 10,
    acceptedExtractionIds: [1, 2],
    sourceKind: 'attachment',
  },
  format: 'json_summary' as const,
  policyHash: POLICY.policyHash,
}

const EXTRACTIONS = [
  {
    id: 1,
    sourceHash: 'src_1',
    textLength: 1500,
    pageCount: 1,
    lifecycleState: 'active',
    holdActive: false,
  },
  {
    id: 2,
    sourceHash: 'src_2',
    textLength: 1500,
    pageCount: 1,
    lifecycleState: 'active',
    holdActive: false,
  },
]

test.group('OcrPermissionDownstreamGuard.copyExport', () => {
  test('copy/export 预览：resolver 放行 → 消费 copy/export 自身决策并返回预览', async ({
    assert,
  }) => {
    const guard = makeGuard()
    const result = await guard.guardCopyExportPreview(PREVIEW_INPUT, POLICY, EXTRACTIONS, CTX)
    assert.isTrue(result.allowed)
    if (!result.allowed) return
    assert.equal(result.data.recordCount, 2)
    assert.equal(result.data.estimatedCharacters, 3000)
    assert.isDefined(result.data.previewHash)
  })

  test('copy/export 预览：permission 缺失 → 阻止且写低敏 OCR_PERMISSION_DENIAL 审计', async ({
    assert,
  }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const guard = makeGuard({
      resolver: makeResolver({
        membership: fakeMembership({ permissions: new Set<Permission>() }),
      }),
      audit: new AuditService(),
    })
    const result = await guard.guardCopyExportPreview(PREVIEW_INPUT, POLICY, EXTRACTIONS, {
      ...CTX,
      actorId: user.id,
      organizationId: org.id,
    })
    assert.isFalse(result.allowed)
    if (result.allowed) return
    assert.equal(result.blocked.result, 'denied')
    assert.isTrue(result.blocked.reasonCodes.includes('permission_missing'))
    assert.isDefined(result.blocked.decisionHash)

    const rows = await AuditLog.query()
      .where('userId', user.id)
      .where('entityType', 'ocr')
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
    assert.equal(rows.length, 1)
    const meta = rows[0].metadata as Record<string, unknown>
    assert.equal(meta.result, 'denied')
    assert.isUndefined(meta.fullText)
    assert.isUndefined(meta.selectedText)
  })

  test('copy/export 执行：resolver confirm_required → 仍走 copy/export 自身确认/幂等契约', async ({
    assert,
  }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const guard = makeGuard({ audit: new AuditService() })
    const result = await guard.guardCopyExportExecute(
      {
        previewHash: 'preview_hash_1',
        policyHash: POLICY.policyHash,
        confirmationToken: 'confirm-token',
        idempotencyKey: 'idem-1',
      },
      POLICY,
      EXTRACTIONS.map(({ id, sourceHash, textLength, pageCount }) => ({
        id,
        sourceHash,
        textLength,
        pageCount,
      })),
      user.id,
      { ...CTX, actorId: user.id, organizationId: org.id },
    )
    assert.isTrue(result.allowed)
    if (!result.allowed) return
    assert.isDefined(result.data.runKey)
    assert.equal(result.data.counts.recordCount, 2)
    assert.equal(result.data.status, 'completed')
  })

  test('copy/export 执行：privacy 阻止 → 阻止执行且不创建运行记录', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const guard = makeGuard({
      resolver: makeResolver({
        privacy: {
          async preflight(): Promise<{
            blocked: boolean
            privacyRef: string | null
            privacyHash: string | null
          }> {
            return { blocked: true, privacyRef: 'privacy', privacyHash: 'p' }
          },
        },
      }),
      audit: new AuditService(),
    })
    const result = await guard.guardCopyExportExecute(
      {
        previewHash: 'preview_hash_1',
        policyHash: POLICY.policyHash,
        confirmationToken: 'confirm-token',
        idempotencyKey: 'idem-2',
      },
      POLICY,
      EXTRACTIONS.map(({ id, sourceHash, textLength, pageCount }) => ({
        id,
        sourceHash,
        textLength,
        pageCount,
      })),
      user.id,
      { ...CTX, actorId: user.id, organizationId: org.id },
    )
    assert.isFalse(result.allowed)
    if (result.allowed) return
    assert.equal(result.blocked.result, 'privacy_blocked')
    assert.isTrue(result.blocked.reasonCodes.includes('privacy_blocked'))
  })
})

test.group('OcrPermissionDownstreamGuard.aiHandoff', () => {
  test('ai:trigger 门控：resolver 放行但缺 ai:trigger → 阻止 + 写 OCR_PERMISSION_AI_HANDOFF_BLOCK 审计', async ({
    assert,
  }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const guard = makeGuard({
      membership: {
        async resolveMembership(): Promise<OcrProjectMembershipContext> {
          return {
            isSuperAdmin: false,
            role: 'PROJECT_MANAGER',
            roleVersion: 3,
            permissions: new Set<Permission>(PM_PERMS), // 无 ai:trigger
          }
        },
      },
      audit: new AuditService(),
    })
    const result = await guard.guardAiHandoff(null, {
      ...CTX,
      actorId: user.id,
      organizationId: org.id,
    })
    assert.isFalse(result.allowed)
    if (result.allowed) return
    assert.equal(result.blocked.result, 'degraded')
    assert.isTrue(result.blocked.reasonCodes.includes('permission_missing'))
    assert.isTrue(result.blocked.degraded)

    const rows = await AuditLog.query()
      .where('userId', user.id)
      .where('metadata', 'like', '%OCR_PERMISSION_AI_HANDOFF_BLOCK%')
    assert.equal(rows.length, 1)
    const meta = rows[0].metadata as Record<string, unknown>
    assert.equal(meta.result, 'degraded')
    assert.isTrue(
      (meta.reasonCodes as string[]).includes('capability_unavailable') ||
        (meta.reasonCodes as string[]).includes('permission_missing'),
    )
  })

  test('确定性降级：resolver 放行 + ai:trigger 具备、能力未落地 → capability_unavailable/degraded', async ({
    assert,
  }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const guard = makeGuard({
      membership: {
        async resolveMembership(): Promise<OcrProjectMembershipContext> {
          return {
            isSuperAdmin: false,
            role: 'PROJECT_MANAGER',
            roleVersion: 3,
            permissions: new Set<Permission>([...PM_PERMS, 'ai:trigger' as Permission]),
          }
        },
      },
      aiHandoffAvailable: false,
      audit: new AuditService(),
    })
    const result = await guard.guardAiHandoff(null, {
      ...CTX,
      actorId: user.id,
      organizationId: org.id,
    })
    assert.isFalse(result.allowed)
    if (result.allowed) return
    assert.equal(result.blocked.result, 'degraded')
    assert.isTrue(result.blocked.reasonCodes.includes('capability_unavailable'))
    assert.isTrue(result.blocked.reasonCodes.includes('degraded'))
    assert.isDefined(result.blocked.decisionHash)
  })

  test('resolver 拒绝 handoff → 阻止 + 写低敏 OCR_PERMISSION_DENIAL 审计', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'observer' })
    const guard = makeGuard({
      resolver: makeResolver({
        membership: fakeMembership({ permissions: new Set<Permission>(['ocr_document:view']) }),
      }),
      audit: new AuditService(),
    })
    const result = await guard.guardAiHandoff(null, {
      ...CTX,
      actorId: user.id,
      organizationId: org.id,
    })
    assert.isFalse(result.allowed)
    if (result.allowed) return
    assert.equal(result.blocked.result, 'denied')
    assert.isTrue(result.blocked.reasonCodes.includes('permission_missing'))

    const rows = await AuditLog.query()
      .where('userId', user.id)
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
    assert.equal(rows.length, 1)
  })

  test('低敏审计：阻止描述与审计元数据不含 OCR 文本/提示词/密钥/绝对路径', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const guard = makeGuard({
      membership: {
        async resolveMembership(): Promise<OcrProjectMembershipContext> {
          return {
            isSuperAdmin: false,
            role: 'PROJECT_MANAGER',
            roleVersion: 3,
            permissions: new Set<Permission>(PM_PERMS),
          }
        },
      },
      audit: new AuditService(),
    })
    const result = await guard.guardAiHandoff(null, {
      ...CTX,
      actorId: user.id,
      organizationId: org.id,
    })
    assert.isFalse(result.allowed)
    if (result.allowed) return

    const json = JSON.stringify(result.blocked)
    const forbidden = [
      'fullText',
      'ocrText',
      'prompt',
      'selectedText',
      'apiKey',
      'secret',
      'C:\\\\',
      '/Users/',
    ]
    for (const token of forbidden) {
      assert.isFalse(json.toLowerCase().includes(token.toLowerCase()), `阻止描述不应包含 ${token}`)
    }

    const rows = await AuditLog.query()
      .where('userId', user.id)
      .where('metadata', 'like', '%OCR_PERMISSION_AI_HANDOFF_BLOCK%')
    assert.equal(rows.length, 1)
    const meta = rows[0].metadata as Record<string, unknown>
    assert.isDefined(meta.decisionHash)
    assert.isDefined(meta.sourceHash)
    const metaJson = JSON.stringify(meta).toLowerCase()
    for (const token of forbidden) {
      assert.isFalse(metaJson.includes(token.toLowerCase()), `审计元数据不应包含 ${token}`)
    }
  })
})
