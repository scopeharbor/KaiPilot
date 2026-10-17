// v3-multitenant-tenant-identification §7.4 —— 后台作业 / 确认流 selection snapshot 测试。
//
// spec 场景覆盖：
//   - 「Queued job revalidates selection」：worker 在副作用前复核成员/角色/组织与 epoch；
//   - 「Cross-tenant replay is rejected」：O1 签发的句柄在 O2 上下文里提交被拒且无副作用；
//   - 「Removed member loses tenant selection」：成员被移除后续跑失败；
//   - §7.5 快照落 payload/日志保持低敏。
//
// 全程本地 SQLite + fixture，无外部 provider。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import OrganizationMember from '#models/organization_member'
import TenantIdentificationAuditService from '#services/tenant_identification_audit_service'
import TenantResolutionService from '#services/tenant_resolution_service'
import TenantSelectionInvalidationService from '#services/tenant_selection_invalidation_service'
import TenantSelectionSnapshotService from '#services/tenant_selection_snapshot_service'
import TenantSelectionStateService from '#services/tenant_selection_state_service'
import { buildEffectiveTenantContext } from '@aiproj/types/multitenant-tenant-identification'
import type { EffectiveTenantContext } from '@aiproj/types/multitenant-tenant-identification'
import type User from '#models/user'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

function makeService(): TenantSelectionSnapshotService {
  return new TenantSelectionSnapshotService(
    new TenantResolutionService(),
    new TenantSelectionStateService(),
    new TenantSelectionInvalidationService(),
    new TenantIdentificationAuditService(),
  )
}

const selectionState = () => new TenantSelectionStateService()

/** 走一遍真实解析拿到 effective context（而不是手捏，确保 membershipVersionHash 真实）。 */
async function resolveFor(user: User, organizationId: number): Promise<EffectiveTenantContext> {
  const { context } = await new TenantResolutionService().resolve({
    payload: {
      sub: user.id,
      organizationId,
      roleVersion: user.roleVersion,
      permissions: [],
    },
    user,
  })
  return context
}

/** 记录一次服务端 selection（让 epoch 从 0 变成 1，模拟已选组织的正常状态）。 */
async function recordSelection(context: EffectiveTenantContext, userId: number) {
  return selectionState().recordSelection({
    userId,
    organizationId: context.organizationId,
    membershipVersionHash: context.membershipVersionHash ?? null,
    scopeHash: context.scopeHash,
    selectionSource: 'server_selection',
    scopeMode: context.scopeMode,
  })
}

test.group('后台作业 selection snapshot 创建与复核（§7.1/§7.2）', (group) => {
  useAuthDatabase(group)

  test('创建快照携带服务端当前 epoch 与低敏字段', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('snap-own') })
    const org = await createOrganization(owner)
    const context = await resolveFor(owner, Number(org.id))
    await recordSelection(context, owner.id)

    const snapshot = await makeService().createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: ['project:1'],
      idempotencyKey: 'idem-1',
      requestId: 'req-1',
    })

    assert.equal(snapshot.actorRef, `user:${owner.id}`)
    assert.equal(snapshot.organizationId, Number(org.id))
    assert.equal(snapshot.selectionEpoch, 1)
    assert.equal(snapshot.scopeHash, context.scopeHash)
    assert.isNotEmpty(snapshot.membershipVersionHash)
    // 低敏：不含原始 token / 权限全集 / 组织名。
    const serialized = JSON.stringify(snapshot)
    assert.notInclude(serialized, org.name)
    assert.notInclude(serialized, 'permissions')
  })

  test('成员与 epoch 均未变 → worker 复核通过', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('snap-own') })
    const org = await createOrganization(owner)
    const context = await resolveFor(owner, Number(org.id))
    await recordSelection(context, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-ok',
      requestId: 'req-ok',
    })

    const result = await service.revalidateBeforeSideEffect({
      snapshot,
      operation: 'export.build',
    })

    assert.isTrue(result.ok)
    assert.isNull(result.failedCheck)
    assert.equal(result.context.organizationId, Number(org.id))
  })

  test('缺 epoch 的旧格式快照一律判 stale（fail closed）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('snap-own') })
    const org = await createOrganization(owner)
    const context = await resolveFor(owner, Number(org.id))
    await recordSelection(context, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-legacy',
      requestId: 'req-legacy',
    })
    // 模拟旧格式：epoch 缺省。
    const legacy = { ...snapshot, selectionEpoch: null }

    const result = await service.revalidateBeforeSideEffect({
      snapshot: legacy,
      operation: 'job.run',
    })

    assert.isFalse(result.ok)
    assert.equal(result.failedCheck, 'epoch')
  })

  test('组织切换后旧 epoch 快照 stale——即使切回原组织', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('snap-own') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const contextA = await resolveFor(owner, Number(orgA.id))
    await recordSelection(contextA, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context: contextA,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-switch',
      requestId: 'req-switch',
    })
    assert.equal(snapshot.selectionEpoch, 1)

    // 切到 B 再切回 A：scope hash 复原，但 epoch 已推进到 3。
    const contextB = await resolveFor(owner, Number(orgB.id))
    await recordSelection(contextB, owner.id)
    await recordSelection(contextA, owner.id)
    assert.equal(await selectionState().currentEpoch(owner.id), 3)

    const result = await service.revalidateBeforeSideEffect({
      snapshot,
      operation: 'preview.confirm',
    })

    assert.isFalse(result.ok, '切回原组织不得让旧预览重新生效')
    assert.equal(result.failedCheck, 'epoch')
  })

  test('成员被移除 → 复核失败（Removed member loses tenant selection）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('snap-own') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('snap-mem') })
    await addOrgMember(org, member, 'member')
    const context = await resolveFor(member, Number(org.id))
    await recordSelection(context, member.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-removed',
      requestId: 'req-removed',
    })

    await OrganizationMember.query()
      .where('organization_id', Number(org.id))
      .where('user_id', member.id)
      .delete()

    const result = await service.revalidateBeforeSideEffect({
      snapshot,
      operation: 'ledger.write',
    })

    assert.isFalse(result.ok)
    assert.equal(result.failedCheck, 'membership')
    assert.equal(result.reason, 'NOT_A_MEMBER')
    // 失败决定不得携带具体组织（下游不能拿它当已解析租户）。
    assert.isNull(result.context.organizationId)
  })

  test('组织被删除 → 复核失败', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('snap-own') })
    const org = await createOrganization(owner)
    const context = await resolveFor(owner, Number(org.id))
    await recordSelection(context, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-deleted',
      requestId: 'req-deleted',
    })

    await db.from('organizations').where('id', Number(org.id)).update({ deleted_at: new Date() })

    const result = await service.revalidateBeforeSideEffect({
      snapshot,
      operation: 'notification.send',
    })

    assert.isFalse(result.ok)
    assert.equal(result.failedCheck, 'membership')
  })
})

test.group('跨租户重放拒绝（§7.3）', (group) => {
  useAuthDatabase(group)

  test('O1 签发的句柄在 O2 上下文提交 → REPLAY_REJECTED 且不产生副作用', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('rep-own') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const contextA = await resolveFor(owner, Number(orgA.id))
    await recordSelection(contextA, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context: contextA,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-replay',
      requestId: 'req-replay',
    })

    const contextB = await resolveFor(owner, Number(orgB.id))
    const result = await service.revalidateBeforeSideEffect({
      snapshot,
      currentDecision: contextB,
      operation: 'preview.confirm',
    })

    assert.isFalse(result.ok)
    assert.equal(result.failedCheck, 'replay')
    assert.equal(result.reason, 'REPLAY_REJECTED')
    assert.include(result.context.warningCodes, 'REPLAY_STALE_OR_INVALID')
  })

  test('assertUsableForSideEffect 在快照失效时抛错，阻断 worker 继续', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('rep-own') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const contextA = await resolveFor(owner, Number(orgA.id))
    await recordSelection(contextA, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context: contextA,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-assert',
      requestId: 'req-assert',
    })
    const contextB = await resolveFor(owner, Number(orgB.id))

    let thrown: unknown = null
    try {
      await service.assertUsableForSideEffect({
        snapshot,
        currentDecision: contextB,
        operation: 'artifact.generate',
      })
    } catch (error) {
      thrown = error
    }
    assert.instanceOf(thrown, Error)
    assert.include((thrown as Error).message, 'REPLAY_REJECTED')
  })

  test('同组织上下文提交同一句柄 → 通过', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('rep-own') })
    const org = await createOrganization(owner)
    const context = await resolveFor(owner, Number(org.id))
    await recordSelection(context, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-same',
      requestId: 'req-same',
    })

    const resolved = await service.assertUsableForSideEffect({
      snapshot,
      currentDecision: context,
      operation: 'preview.confirm',
    })
    assert.equal(resolved.organizationId, Number(org.id))
  })

  test('被拒的重放与过期都写低敏审计，且不含重放目标归属', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('rep-own') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const contextA = await resolveFor(owner, Number(orgA.id))
    await recordSelection(contextA, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context: contextA,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-audit',
      requestId: 'req-audit',
    })
    const contextB = await resolveFor(owner, Number(orgB.id))
    await service.revalidateBeforeSideEffect({
      snapshot,
      currentDecision: contextB,
      operation: 'preview.confirm',
    })

    const logs = await db.from('audit_logs').orderBy('id', 'desc').limit(10)
    const denied = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes('job.preview.confirm')
    })
    assert.isDefined(denied, '跨租重放必须留低敏审计')
    const meta = JSON.parse(
      typeof denied.metadata === 'string' ? denied.metadata : JSON.stringify(denied.metadata),
    )
    assert.equal(meta.kind, 'denied')
    assert.equal(meta.resolutionReason, 'REPLAY_REJECTED')
    assert.equal(meta.idempotencyKey, 'idem-audit')
    assert.notInclude(JSON.stringify(meta), orgA.name)
    assert.notInclude(JSON.stringify(meta), orgB.name)
  })
})

test.group('快照 payload 低敏收敛（§7.5）', (group) => {
  useAuthDatabase(group)

  test('sanitizeForPayload 只输出白名单低敏字段', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('san-own') })
    const org = await createOrganization(owner)
    const context = await resolveFor(owner, Number(org.id))
    await recordSelection(context, owner.id)

    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: ['project:1'],
      idempotencyKey: 'idem-san',
      requestId: 'req-san',
    })

    const payload = service.sanitizeForPayload(snapshot)
    assert.deepEqual(
      Object.keys(payload).sort(),
      [
        'actorRef',
        'idempotencyKey',
        'issuedAt',
        'membershipVersionHash',
        'organizationId',
        'permissionSnapshotHash',
        'projectId',
        'requestId',
        'resolutionReason',
        'scopeHash',
        'scopeMode',
        'schemaVersion',
        'selectionEpoch',
        'selectionSource',
        'sourceRefs',
      ].sort(),
    )
    assert.notInclude(JSON.stringify(payload), org.name)
  })

  test('调用方误塞的敏感字段被白名单丢弃，不进 payload', async ({ assert }) => {
    const context = buildEffectiveTenantContext({
      actorRef: 'user:1',
      organizationId: 1,
      selectionSource: 'auth_token',
      resolutionReason: 'RESOLVED',
    })
    const service = makeService()
    const snapshot = await service.createForBackgroundWork({
      context,
      permissionSnapshotHash: 'perm-hash',
      sourceRefs: [],
      idempotencyKey: 'idem-bad',
      requestId: 'req-bad',
    })

    // 模拟调用方误把敏感字段塞进快照对象。
    const tainted = { ...snapshot } as Record<string, unknown>
    tainted.accessToken = 'secret-token'
    tainted.prompt = '原始提示词'
    tainted.absolutePath = 'C:/secret/report.pdf'

    const payload = service.sanitizeForPayload(tainted as never)

    // 白名单拷贝的价值就在这里：多出来的字段直接不存在，而不是靠黑名单去删。
    assert.notProperty(payload, 'accessToken')
    assert.notProperty(payload, 'prompt')
    assert.notProperty(payload, 'absolutePath')
    assert.notInclude(JSON.stringify(payload), 'secret-token')
    assert.notInclude(JSON.stringify(payload), '原始提示词')
    assert.notInclude(JSON.stringify(payload), 'C:/secret/report.pdf')
  })
})
