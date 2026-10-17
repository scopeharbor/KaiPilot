// v3-multitenant-tenant-identification §3.4/§3.5 —— TenantResolutionService 解析链路测试。
//
// spec 场景覆盖：
//   - 「Tenant resolution MUST use server-trusted sources」：有效成员 / owner fallback；
//   - 「Removed member loses tenant selection」/「Organization deletion invalidates context」：
//     非成员隐藏、组织软删除、roleVersion 过期、membership version 变化；
//   - 「Missing tenant is rejected for tenant-required route」：JWT 无组织声明；
//   - 「Super admin tenant mode uses concrete organization」：super admin 带 org → tenant 模式；
//   - §3.5 resolver 故障 degraded：不回退客户端 hint。
//
// 全程本地 SQLite + fixture，无外部 provider（spec「Default verification is offline」）。
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import OrganizationMember from '#models/organization_member'
import TenantResolutionService from '#services/tenant_resolution_service'
import type { JwtAccessPayload } from '#types/auth'
import type User from '#models/user'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

function payloadFor(user: User, organizationId: number | null): JwtAccessPayload {
  return {
    sub: user.id,
    organizationId,
    roleVersion: user.roleVersion,
    permissions: [],
  }
}

test.group('TenantResolutionService 解析链路（§3.4）', (group) => {
  useAuthDatabase(group)

  test('有效成员 → RESOLVED + tenant 模式 + 低敏 scope hash', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({
      payload: payloadFor(member, org.id),
      user: member,
    })

    assert.isTrue(ok)
    assert.equal(context.resolutionReason, 'RESOLVED')
    assert.equal(context.scopeMode, 'tenant')
    assert.equal(context.organizationId, org.id)
    assert.equal(context.actorRef, `user:${member.id}`)
    assert.equal(context.membershipRole, 'member')
    assert.equal(context.selectionSource, 'auth_token')
    assert.isFalse(context.isSuperAdmin)
    assert.isEmpty(context.warningCodes)
    // scope hash 必须存在且不含原始 id 拼接（低敏派生）。
    assert.isNotEmpty(context.membershipVersionHash)
    assert.isNotEmpty(context.scopeHash)
  })

  test('owner 无 member 行时 owner fallback 仍解析成功', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    // 删掉 owner 的成员行，只留 organizations.owner_id 这一条服务端事实。
    await OrganizationMember.query().where('organization_id', org.id).delete()

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({
      payload: payloadFor(owner, org.id),
      user: owner,
    })

    assert.isTrue(ok)
    assert.equal(context.resolutionReason, 'RESOLVED')
    assert.equal(context.membershipRole, 'owner')
    assert.equal(context.organizationId, org.id)
  })

  test('非成员且非 owner → NOT_A_MEMBER 且仅返回 ORGANIZATION_HIDDEN 警告', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const outsider = await createUser({ email: uniqueEmail('outsider') })

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({
      payload: payloadFor(outsider, org.id),
      user: outsider,
    })

    assert.isFalse(ok)
    assert.equal(context.resolutionReason, 'NOT_A_MEMBER')
    assert.deepEqual(context.warningCodes, ['ORGANIZATION_HIDDEN'])
    // 不得携带组织名称等隐藏信息（决定体只含低敏 id/hash/枚举）。
    assert.notInclude(JSON.stringify(context), org.name)
  })

  test('组织不存在 → ORGANIZATION_MISSING，与非成员共用同一 hidden 警告', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('user') })

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({
      payload: payloadFor(user, 987654),
      user,
    })

    assert.isFalse(ok)
    assert.equal(context.resolutionReason, 'ORGANIZATION_MISSING')
    assert.deepEqual(context.warningCodes, ['ORGANIZATION_HIDDEN'])
  })

  test('组织已软删除 → ORGANIZATION_DELETED（对外与不存在不可区分）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    // 软删除：模型钩子会自动过滤 deleted_at，故直接走 query builder 写入。
    await db.from('organizations').where('id', org.id).update({ deleted_at: new Date() })

    const service = new TenantResolutionService()
    const missing = await service.resolve({ payload: payloadFor(owner, 987654), user: owner })
    const deleted = await service.resolve({ payload: payloadFor(owner, org.id), user: owner })

    assert.isFalse(deleted.ok)
    assert.equal(deleted.context.resolutionReason, 'ORGANIZATION_DELETED')
    // 两条分支的对外可见部分（warningCodes）必须一致，区分只进低敏 reason 供排查。
    assert.deepEqual(deleted.context.warningCodes, missing.context.warningCodes)
  })

  test('JWT roleVersion 落后于 DB → ROLE_STALE 要求刷新', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member'), roleVersion: 3 })
    await addOrgMember(org, member, 'member')

    const service = new TenantResolutionService()
    const stalePayload: JwtAccessPayload = {
      sub: member.id,
      organizationId: org.id,
      roleVersion: 2, // 旧 token
      permissions: [],
    }
    const { context, ok } = await service.resolve({ payload: stalePayload, user: member })

    assert.isFalse(ok)
    assert.equal(context.resolutionReason, 'ROLE_STALE')
    assert.deepEqual(context.warningCodes, ['ROLE_STALE_REFRESH_REQUIRED'])
  })

  test('JWT 无组织声明（普通用户）→ NO_ACTIVE_ORGANIZATION', async ({ assert }) => {
    const user = await createUser({ email: uniqueEmail('user') })

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({ payload: payloadFor(user, null), user })

    assert.isFalse(ok)
    assert.equal(context.resolutionReason, 'NO_ACTIVE_ORGANIZATION')
    assert.isNull(context.organizationId)
    assert.deepEqual(context.warningCodes, ['NO_ACTIVE_TENANT'])
  })

  test('未认证（无 user/payload）→ 无 actor，不可解析', async ({ assert }) => {
    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({ payload: null, user: null })

    assert.isFalse(ok)
    assert.equal(context.actorRef, 'user:unknown')
    assert.equal(context.resolutionReason, 'NO_ACTIVE_ORGANIZATION')
  })

  test('super admin 带具体组织 → tenant 模式（不默认全局业务可见）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const admin = await createUser({ email: uniqueEmail('sa'), isSuperAdmin: true })

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({
      payload: payloadFor(admin, org.id),
      user: admin,
    })

    assert.isTrue(ok)
    assert.equal(context.scopeMode, 'tenant')
    assert.equal(context.resolutionReason, 'SUPER_ADMIN_TENANT_SCOPE')
    assert.equal(context.organizationId, org.id)
    assert.isTrue(context.isSuperAdmin)
  })

  test('super admin 无组织声明 → global-low-sensitive 并带只读警告', async ({ assert }) => {
    const admin = await createUser({ email: uniqueEmail('sa'), isSuperAdmin: true })

    const service = new TenantResolutionService()
    const { context, ok } = await service.resolve({ payload: payloadFor(admin, null), user: admin })

    assert.isTrue(ok)
    assert.equal(context.scopeMode, 'global-low-sensitive')
    assert.equal(context.resolutionReason, 'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE')
    assert.isNull(context.organizationId)
    assert.deepEqual(context.warningCodes, ['GLOBAL_LOW_SENSITIVE_ONLY'])
  })

  test('项目级路由 scope 透传进决定并改变 scope hash', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)

    const service = new TenantResolutionService()
    const withoutProject = await service.resolve({
      payload: payloadFor(owner, org.id),
      user: owner,
    })
    const withProject = await service.resolve({
      payload: payloadFor(owner, org.id),
      user: owner,
      projectId: 42,
    })

    assert.equal(withProject.context.projectId, 42)
    assert.notEqual(withProject.context.scopeHash, withoutProject.context.scopeHash)
  })
})

test.group('TenantResolutionService 后台快照复核（§3.4/§7）', (group) => {
  useAuthDatabase(group)

  test('membership 未变 → 快照复核通过并标记 server_selection 来源', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)

    const service = new TenantResolutionService()
    const issued = await service.resolve({ payload: payloadFor(owner, org.id), user: owner })

    const revalidated = await service.revalidateSnapshot({
      actorRef: issued.context.actorRef,
      organizationId: issued.context.organizationId,
      expectedMembershipVersionHash: issued.context.membershipVersionHash ?? null,
    })

    assert.isTrue(revalidated.ok)
    assert.equal(revalidated.context.selectionSource, 'server_selection')
    assert.equal(revalidated.context.resolutionReason, 'RESOLVED')
  })

  test('membership version 变化 → MEMBERSHIP_STALE 且拒绝副作用', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)

    const service = new TenantResolutionService()
    const issued = await service.resolve({ payload: payloadFor(owner, org.id), user: owner })

    const revalidated = await service.revalidateSnapshot({
      actorRef: issued.context.actorRef,
      organizationId: issued.context.organizationId,
      expectedMembershipVersionHash: 'stale-hash-from-old-snapshot',
    })

    assert.isFalse(revalidated.ok)
    assert.equal(revalidated.context.resolutionReason, 'MEMBERSHIP_STALE')
    assert.include(revalidated.context.warningCodes, 'MEMBERSHIP_STALE_REFRESH_REQUIRED')
    assert.include(revalidated.context.warningCodes, 'REPLAY_STALE_OR_INVALID')
  })

  test('成员被移除后快照复核失败（Removed member loses tenant selection）', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)
    const member = await createUser({ email: uniqueEmail('member') })
    await addOrgMember(org, member, 'member')

    const service = new TenantResolutionService()
    const issued = await service.resolve({ payload: payloadFor(member, org.id), user: member })
    assert.isTrue(issued.ok)

    // 成员关系被移除。
    await OrganizationMember.query()
      .where('organization_id', org.id)
      .where('user_id', member.id)
      .delete()

    const revalidated = await service.revalidateSnapshot({
      actorRef: issued.context.actorRef,
      organizationId: issued.context.organizationId,
      expectedMembershipVersionHash: issued.context.membershipVersionHash ?? null,
    })

    assert.isFalse(revalidated.ok)
    assert.equal(revalidated.context.resolutionReason, 'NOT_A_MEMBER')
    assert.include(revalidated.context.warningCodes, 'REPLAY_STALE_OR_INVALID')
  })

  test('组织删除后快照复核失败（Organization deletion invalidates context）', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)

    const service = new TenantResolutionService()
    const issued = await service.resolve({ payload: payloadFor(owner, org.id), user: owner })

    await db.from('organizations').where('id', org.id).update({ deleted_at: new Date() })

    const revalidated = await service.revalidateSnapshot({
      actorRef: issued.context.actorRef,
      organizationId: issued.context.organizationId,
      expectedMembershipVersionHash: issued.context.membershipVersionHash ?? null,
    })

    assert.isFalse(revalidated.ok)
    assert.equal(revalidated.context.resolutionReason, 'ORGANIZATION_DELETED')
  })

  test('快照无组织 / actorRef 不可解析 → 直接拒绝重放', async ({ assert }) => {
    const service = new TenantResolutionService()
    const noOrg = await service.revalidateSnapshot({
      actorRef: 'user:1',
      organizationId: null,
      expectedMembershipVersionHash: null,
    })

    assert.isFalse(noOrg.ok)
    assert.equal(noOrg.context.resolutionReason, 'NO_ACTIVE_ORGANIZATION')
    assert.include(noOrg.context.warningCodes, 'REPLAY_STALE_OR_INVALID')
  })
})

test.group('TenantResolutionService resolver 故障降级（§3.5）', (group) => {
  useAuthDatabase(group)

  test('resolver 依赖异常 → RESOLVER_FAILED，且不回退到客户端组织 hint', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)

    const service = new TenantResolutionService()
    // 模拟 resolver 依赖故障：组织表查询抛错（DB 抖动 / 迁移中 / 连接失效）。
    const original = db.from.bind(db)
    db.from = (() => {
      throw new Error('resolver dependency down')
    }) as typeof db.from

    try {
      const { context, ok } = await service.resolve({
        payload: payloadFor(owner, org.id),
        user: owner,
      })

      assert.isFalse(ok)
      assert.equal(context.resolutionReason, 'RESOLVER_FAILED')
      // 关键断言：degraded 决定**不得**带上客户端/JWT 声明的组织，
      // 否则下游可能把未经服务端校验的 org 当成已解析租户使用。
      assert.isNull(context.organizationId)
      // 也不得泄露底层错误文本。
      assert.notInclude(JSON.stringify(context), 'resolver dependency down')
    } finally {
      db.from = original
    }
  })

  test('后台快照复核遇 resolver 故障 → 拒绝副作用而非沿用旧快照组织', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('owner') })
    const org = await createOrganization(owner)

    const service = new TenantResolutionService()
    const original = db.from.bind(db)
    db.from = (() => {
      throw new Error('resolver dependency down')
    }) as typeof db.from

    try {
      const revalidated = await service.revalidateSnapshot({
        actorRef: `user:${owner.id}`,
        organizationId: org.id,
        expectedMembershipVersionHash: 'any',
      })

      assert.isFalse(revalidated.ok)
      assert.equal(revalidated.context.resolutionReason, 'RESOLVER_FAILED')
      assert.isNull(revalidated.context.organizationId)
    } finally {
      db.from = original
    }
  })
})
