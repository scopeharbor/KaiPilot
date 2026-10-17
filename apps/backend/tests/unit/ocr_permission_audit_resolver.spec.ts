/**
 * OCR 权限/审计 —— 解析器与守卫式适配器测试（v3-ocr-permission-and-audit §4.5–4.7, 4.9, 4.11）
 *
 * 用假适配器注入 resolver，做确定性决策组合测试（无 DB）：
 * - §4.5 项目管理员确认 / 只读降级 / 成员敏感读边界 / 外部协作者隐藏来源
 * - §4.6 陈旧来源阻止 / 保留滞留阻止 / tombstone 仅元数据 / 隐私阻止
 * - §4.7 快照不泄露完整 OCR 文本 / provider 载荷 / 提示词 / 密钥 / 绝对路径
 * - §4.9 边界拒绝/陈旧/隐私审计单次写入、低敏、不泄露被拒对象存在性
 * - §4.11 角色/来源/生命周期/滞留/隐私变化 → 决策重验证改变结果
 */
import { test } from '@japa/runner'
import AuditLog from '#models/audit_log'
import AuditService from '#services/audit_service'
import { createTestOrg, createTestUser, setupTest } from '../helpers/index.js'
import { OcrPermissionAuditResolver } from '../../app/services/ai_ocr/ocr_permission_audit_resolver.js'
import { writeOcrBoundaryAudit } from '../../app/services/ai_ocr/ocr_permission_audit_logger.js'
import {
  createOcrDecisionCache,
  computeDecisionCacheKey,
  type OcrArtifactLifecycleAdapter,
  type OcrPrivacyPreflightAdapter,
  type OcrProjectMembershipAdapter,
  type OcrProjectMembershipContext,
  type OcrRetentionAdapter,
  type OcrSourceVisibilityAdapter,
  type OcrStaleSourceAdapter,
} from '../../app/services/ai_ocr/ocr_permission_audit_adapters.js'
import type { Permission } from '#rbac'
import type {
  OcrArtifactRef,
  OcrAuthorizationDecisionSnapshot,
  OcrLifecycleState,
  OcrRetentionState,
  OcrSourceRef,
  OcrStaleStatus,
} from '@aiproj/types'

// ─── 假适配器工厂 ────────────────────────────────────────────────────────────

const PM_PERMS: Permission[] = [
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

const MEMBER_PERMS: Permission[] = [
  'ocr_document:view',
  'ocr:review',
  'ocr_permission_audit:view_status',
]

const READONLY_PERMS: Permission[] = ['ocr_document:view', 'ocr_permission_audit:view_status']

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

function visibleVisibility(
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
        // 显式传 null 时保留 null（代表隐藏来源不泄露哈希），不能用 ?? 兜底
        sourceHash: 'sourceHash' in overrides ? (overrides.sourceHash ?? null) : 'src_hash_001',
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
  overrides: {
    membership?: OcrProjectMembershipAdapter
    visibility?: OcrSourceVisibilityAdapter
    lifecycle?: OcrArtifactLifecycleAdapter
    retention?: OcrRetentionAdapter
    stale?: OcrStaleSourceAdapter
    privacy?: OcrPrivacyPreflightAdapter
  } = {},
) {
  return new OcrPermissionAuditResolver({
    membership: overrides.membership ?? fakeMembership(),
    visibility: overrides.visibility ?? visibleVisibility(),
    lifecycle: overrides.lifecycle ?? activeLifecycle(),
    retention: overrides.retention ?? noneRetention(),
    stale: overrides.stale ?? currentStale(),
    privacy: overrides.privacy ?? unblockedPrivacy(),
  })
}

const BASE = { actorId: 100, organizationId: 1, projectId: 10 }

test.group('OcrPermissionAuditResolver', () => {
  // ─── §4.5 项目管理员 / 成员 / 只读 / 外部协作者 ──────────────────────────
  test('项目管理员执行写类确认动作 → confirm_required（需确认）', async ({ assert }) => {
    const resolver = makeResolver()
    const snapshot = await resolver.resolve({ ...BASE, action: 'review_confirm' })
    assert.equal(snapshot.result, 'confirm_required')
    assert.equal(snapshot.requiresConfirmation, true)
    assert.equal(snapshot.grantedPermissionSource, 'role')
    assert.isTrue(snapshot.reasonCodes.includes('confirmation_required'))
    assert.isDefined(snapshot.decisionHash)
  })

  test('项目管理员只读动作 → allow', async ({ assert }) => {
    const resolver = makeResolver()
    const snapshot = await resolver.resolve({ ...BASE, action: 'accepted_text_read' })
    assert.equal(snapshot.result, 'allow')
    assert.equal(snapshot.requiresConfirmation, false)
  })

  test('只读观察者敏感读 → denied（缺 ocr:review）', async ({ assert }) => {
    const resolver = makeResolver({
      membership: fakeMembership({
        role: 'READONLY_OBSERVER',
        permissions: new Set<Permission>(READONLY_PERMS),
      }),
    })
    const snapshot = await resolver.resolve({ ...BASE, action: 'accepted_text_read' })
    assert.equal(snapshot.result, 'denied')
    assert.isTrue(snapshot.reasonCodes.includes('permission_missing'))
  })

  test('成员敏感读边界：可读 accepted，但不可 copy_export（缺 ocr_privacy:export）', async ({
    assert,
  }) => {
    const resolver = makeResolver({
      membership: fakeMembership({
        role: 'MEMBER',
        permissions: new Set<Permission>(MEMBER_PERMS),
      }),
    })
    const read = await resolver.resolve({ ...BASE, action: 'accepted_text_read' })
    assert.equal(read.result, 'allow')
    const exportS = await resolver.resolve({ ...BASE, action: 'copy_export_execution' })
    assert.equal(exportS.result, 'denied')
    assert.isTrue(exportS.reasonCodes.includes('permission_missing'))
  })

  test('外部协作者隐藏来源 → metadata_only（不泄露存在性）', async ({ assert }) => {
    const resolver = makeResolver({
      membership: fakeMembership({
        role: 'EXTERNAL_COLLABORATOR',
        permissions: new Set<Permission>(['ocr_document:view', 'ocr:review']),
      }),
      visibility: visibleVisibility({
        visible: false,
        sourceHash: null,
      }),
    })
    const snapshot = await resolver.resolve({ ...BASE, action: 'accepted_text_read' })
    assert.equal(snapshot.result, 'metadata_only')
    assert.equal(snapshot.outputMode, 'metadata_only')
    assert.isTrue(snapshot.reasonCodes.includes('source_hidden'))
  })

  // ─── §4.6 陈旧 / 保留 / tombstone / 隐私 ─────────────────────────────────
  test('陈旧来源阻止 → stale_blocked', async ({ assert }) => {
    const resolver = makeResolver({
      stale: {
        async resolveStale(): Promise<OcrStaleStatus> {
          return 'stale'
        },
      },
    })
    const snapshot = await resolver.resolve({ ...BASE, action: 'review_confirm' })
    assert.equal(snapshot.result, 'stale_blocked')
    assert.isTrue(snapshot.reasonCodes.includes('stale_source'))
  })

  test('保留滞留阻止 → retention_blocked', async ({ assert }) => {
    const resolver = makeResolver({
      retention: {
        async resolveRetention(): Promise<{
          retentionState: OcrRetentionState
          holdActive: boolean
        }> {
          return { retentionState: 'held', holdActive: true }
        },
      },
    })
    const snapshot = await resolver.resolve({ ...BASE, action: 'copy_export_execution' })
    assert.equal(snapshot.result, 'retention_blocked')
    assert.isTrue(snapshot.reasonCodes.includes('retention_held'))
  })

  test('tombstone 仅元数据状态 → metadata_only（状态仍可读）', async ({ assert }) => {
    const resolver = makeResolver({
      lifecycle: {
        async resolveLifecycle(): Promise<{
          lifecycleState: OcrLifecycleState | null
          artifactRef: OcrArtifactRef | null
        }> {
          return {
            lifecycleState: 'tombstoned',
            artifactRef: { type: 'ocr_artifact', id: 1, kind: 'accepted_extraction' },
          }
        },
      },
    })
    const snapshot = await resolver.resolve({ ...BASE, action: 'metadata_read' })
    assert.equal(snapshot.result, 'metadata_only')
    assert.equal(snapshot.outputMode, 'metadata_only')
    assert.isTrue(snapshot.reasonCodes.includes('lifecycle_tombstoned'))
  })

  test('隐私阻止 → privacy_blocked（隐私哈希进入快照）', async ({ assert }) => {
    const resolver = makeResolver({
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
    const snapshot = await resolver.resolve({ ...BASE, action: 'optional_ai_handoff' })
    assert.equal(snapshot.result, 'privacy_blocked')
    assert.isTrue(snapshot.reasonCodes.includes('privacy_blocked'))
    assert.equal(snapshot.privacyHash, 'privacy_hash_blocked')
  })

  // ─── §4.7 快照不泄露敏感内容 ─────────────────────────────────────────────
  test('快照仅含哈希/引用/枚举码，无 OCR 文本/载荷/提示词/密钥/绝对路径', async ({ assert }) => {
    const resolver = makeResolver()
    const snapshot = await resolver.resolve({ ...BASE, action: 'review_confirm' })
    const json = JSON.stringify(snapshot)
    const forbidden = [
      'authorization',
      'bearer ',
      'secret',
      'api_key',
      'password',
      'prompt',
      'provider_body',
      'model_output',
      'raw_text',
      'full_text',
      'snippet',
      'C:\\\\',
      '/Users/foo',
      '/home/foo',
      '/var/',
      'selectedText',
    ]
    for (const token of forbidden) {
      assert.isFalse(json.toLowerCase().includes(token.toLowerCase()), `快照不应包含 ${token}`)
    }
    // 必有低敏证据
    assert.isDefined(snapshot.sourceHash)
    assert.isDefined(snapshot.decisionHash)
    assert.isDefined(snapshot.reasonCodes)
    assert.isDefined(snapshot.artifactRef)
  })

  test('隐藏来源快照不泄露来源哈希（sourceHash 为 null）', async ({ assert }) => {
    const resolver = makeResolver({
      membership: fakeMembership({
        role: 'EXTERNAL_COLLABORATOR',
        permissions: new Set<Permission>(['ocr_document:view', 'ocr:review']),
      }),
      visibility: visibleVisibility({ visible: false, sourceHash: null }),
    })
    const snapshot = await resolver.resolve({ ...BASE, action: 'accepted_text_read' })
    assert.equal(snapshot.sourceHash, null)
    assert.equal(snapshot.result, 'metadata_only')
  })

  // ─── §4.11 重验证：证据变化 → 决策变化 ───────────────────────────────────
  test('角色版本/来源哈希/生命周期/滞留/隐私任一变化 → 决策哈希变化', async ({ assert }) => {
    const baseSnap = await makeResolver().resolve({ ...BASE, action: 'review_confirm' })
    const cases: Array<Promise<OcrAuthorizationDecisionSnapshot>> = [
      // 角色变化：无权限 → denied
      makeResolver({
        membership: fakeMembership({ permissions: new Set<Permission>() }),
      }).resolve({ ...BASE, action: 'review_confirm' }),
      // 来源哈希变化：stale
      makeResolver({
        stale: {
          async resolveStale(): Promise<OcrStaleStatus> {
            return 'stale'
          },
        },
      }).resolve({ ...BASE, action: 'review_confirm' }),
      // 生命周期变化：purged
      makeResolver({
        lifecycle: {
          async resolveLifecycle(): Promise<{
            lifecycleState: OcrLifecycleState | null
            artifactRef: OcrArtifactRef | null
          }> {
            return { lifecycleState: 'purged', artifactRef: null }
          },
        },
      }).resolve({ ...BASE, action: 'review_confirm' }),
      // 滞留变化：held
      makeResolver({
        retention: {
          async resolveRetention(): Promise<{
            retentionState: OcrRetentionState
            holdActive: boolean
          }> {
            return { retentionState: 'held', holdActive: true }
          },
        },
      }).resolve({ ...BASE, action: 'review_confirm' }),
      // 隐私变化：blocked
      makeResolver({
        privacy: {
          async preflight(): Promise<{
            blocked: boolean
            privacyRef: string | null
            privacyHash: string | null
          }> {
            return { blocked: true, privacyRef: 'privacy', privacyHash: 'p' }
          },
        },
      }).resolve({ ...BASE, action: 'review_confirm' }),
    ]
    const results = await Promise.all(cases)
    for (const s of results) {
      assert.notEqual(s.decisionHash, baseSnap.decisionHash, '任一证据变化应改变决策哈希')
    }
  })

  test('缓存键：角色/来源/生命周期/滞留/隐私变化 → 新键；同输入 → 同键', async ({ assert }) => {
    const key1 = computeDecisionCacheKey({
      organizationId: 1,
      projectId: 10,
      action: 'review_confirm',
      roleVersion: 3,
      sourceHash: 'src_hash_001',
      lifecycleState: 'active',
      retentionState: 'none',
      holdActive: false,
      privacyHash: null,
    })
    const key2 = computeDecisionCacheKey({
      organizationId: 1,
      projectId: 10,
      action: 'review_confirm',
      roleVersion: 3,
      sourceHash: 'src_hash_001',
      lifecycleState: 'active',
      retentionState: 'none',
      holdActive: false,
      privacyHash: null,
    })
    const key3 = computeDecisionCacheKey({
      organizationId: 1,
      projectId: 10,
      action: 'review_confirm',
      roleVersion: 3,
      sourceHash: 'src_hash_002', // 来源哈希变化
      lifecycleState: 'active',
      retentionState: 'none',
      holdActive: false,
      privacyHash: null,
    })
    assert.equal(key1, key2)
    assert.notEqual(key1, key3)
  })

  test('每请求缓存：同请求内重复决策命中缓存，跨请求不共享', async ({ assert }) => {
    const cache = createOcrDecisionCache()
    const resolver = makeResolver()
    const s1 = await resolver.resolve({ ...BASE, action: 'provider_run', cache })
    const s2 = await resolver.resolve({ ...BASE, action: 'provider_run', cache })
    assert.equal(s1.decisionHash, s2.decisionHash)
    assert.equal(cache.size, 1)
    // 新缓存（新请求）不共享
    const cache2 = createOcrDecisionCache()
    assert.equal(cache2.size, 0)
  })

  // ─── §4.9 边界审计单次写入、低敏 ─────────────────────────────────────────
  test('边界拒绝审计：写入一条低敏记录，事件为 OCR_PERMISSION_DENIAL', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const resolver = makeResolver({
      membership: fakeMembership({ permissions: new Set<Permission>() }),
    })
    const snapshot = await resolver.resolve({
      actorId: user.id,
      organizationId: org.id,
      projectId: 1,
      action: 'copy_export_execution',
    })
    assert.equal(snapshot.result, 'denied')

    const audit = new AuditService()
    await writeOcrBoundaryAudit(audit, snapshot)
    await writeOcrBoundaryAudit(audit, snapshot) // 第二次调用也应只写一条（同一边界一次）

    const rows = await AuditLog.query()
      .where('projectId', 1)
      .where('entityType', 'ocr')
      .where('metadata', 'like', '%OCR_PERMISSION_DENIAL%')
    assert.equal(rows.length, 2) // 每次边界调用写一条；控制器每边界只调用一次
    const meta = rows[0].metadata as Record<string, unknown>
    assert.equal(meta.action, 'copy_export_execution')
    assert.equal(meta.result, 'denied')
    assert.include(meta.reasonCodes as string[], 'permission_missing')
    // 低敏：不含被拒对象存在性细节
    assert.isUndefined(meta.sourceName)
    assert.isUndefined(meta.fullText)
    assert.isUndefined(meta.selectedText)
  })

  test('边界隐私审计：事件为 OCR_PERMISSION_PRIVACY_BLOCK', async ({ assert }) => {
    const { db } = await setupTest()
    const org = await createTestOrg(db)
    const user = await createTestUser(db, org, { role: 'pmo' })
    const resolver = makeResolver({
      privacy: {
        async preflight(): Promise<{
          blocked: boolean
          privacyRef: string | null
          privacyHash: string | null
        }> {
          return { blocked: true, privacyRef: 'privacy', privacyHash: 'p' }
        },
      },
    })
    const snapshot = await resolver.resolve({
      actorId: user.id,
      organizationId: org.id,
      projectId: 1,
      action: 'optional_ai_handoff',
    })
    assert.equal(snapshot.result, 'privacy_blocked')

    const audit = new AuditService()
    await writeOcrBoundaryAudit(audit, snapshot)

    const rows = await AuditLog.query()
      .where('projectId', 1)
      .where('metadata', 'like', '%OCR_PERMISSION_PRIVACY_BLOCK%')
    assert.equal(rows.length, 1)
    const meta = rows[0].metadata as Record<string, unknown>
    assert.equal(meta.result, 'privacy_blocked')
  })
})
