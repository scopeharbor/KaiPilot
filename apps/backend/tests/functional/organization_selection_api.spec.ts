// v3-multitenant-tenant-identification §4.4 —— 组织选择（切换）API 测试。
//
// spec 场景覆盖：
//   - 「Member switches to another owned organization」：切到自己 owner 的组织、切到成员组织；
//   - 「Non-member switch is hidden」：切到非成员组织统一 404，不泄露组织是否存在；
//   - 「Removed member loses tenant selection」：成员被移除后再切换失败；
//   - §4.2 切换成功刷新 access token claims + 持久化服务端 selection snapshot；
//   - §4.3 切换后返回失效报告且 selection epoch 递增；
//   - §4.5 低敏切换审计（previous/next scope hash + requestId，无组织名）。
//
// 全程本地 SQLite + fixture，无外部 provider（spec「Default verification is offline」）。
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import OrganizationMember from '#models/organization_member'
import TokenService from '#services/token_service'
import {
  addOrgMember,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'

const ENDPOINT = '/api/v1/account/organization-selection'

test.group('组织选择 API（§4.4）', (group) => {
  useAuthDatabase(group)

  let tokenSvc: TokenService

  group.each.setup(async () => {
    tokenSvc = await app.container.make(TokenService)
  })

  /** 签发携带组织 claim 的 access token（模拟已登录）。 */
  async function tokenFor(userId: number, organizationId: number | null): Promise<string> {
    return tokenSvc.generateAccessToken({
      sub: userId,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
  }

  test('切换到自己 owner 的组织 → 200，返回新 claims 与 tenant 模式上下文', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)

    const token = await tokenFor(owner.id, Number(orgA.id))
    const res = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })

    res.assertStatus(200)
    const body = res.body().data
    assert.equal(body.effectiveContext.organizationId, Number(orgB.id))
    assert.equal(body.effectiveContext.scopeMode, 'tenant')
    assert.equal(body.effectiveContext.selectionSource, 'server_selection')
    assert.isString(body.accessToken)
    assert.isNotEmpty(body.scopeHash)

    // §4.2：新 access token 的 claims 必须指向目标组织。
    const verified = await tokenSvc.verifyAccessToken(body.accessToken)
    assert.equal(verified.organizationId, Number(orgB.id))
  })

  test('切换到自己是成员（非 owner）的组织 → 200', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('osel-owna') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('osel-ownb') })
    const orgB = await createOrganization(ownerB)

    const member = await createUser({ email: uniqueEmail('osel-mem') })
    await addOrgMember(orgA, member, 'member')
    await addOrgMember(orgB, member, 'viewer')

    const token = await tokenFor(member.id, Number(orgA.id))
    const res = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })

    res.assertStatus(200)
    assert.equal(res.body().data.effectiveContext.organizationId, Number(orgB.id))
    assert.equal(res.body().data.effectiveContext.membershipRole, 'viewer')
  })

  test('切换到非成员组织 → 404，且与"组织不存在"响应不可区分', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('osel-owna') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('osel-ownb') })
    const orgB = await createOrganization(ownerB)

    const member = await createUser({ email: uniqueEmail('osel-mem') })
    await addOrgMember(orgA, member, 'member')

    const token = await tokenFor(member.id, Number(orgA.id))

    const hidden = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })
    const missing = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: 987654 })

    hidden.assertStatus(404)
    missing.assertStatus(404)
    assert.equal(hidden.body().error.code, 'RESOURCE_NOT_FOUND')
    // 关键：两条响应体必须逐字节一致，否则响应差异本身就泄露了组织存在性。
    assert.deepEqual(hidden.body(), missing.body())
    // 响应不得出现目标组织名称。
    assert.notInclude(JSON.stringify(hidden.body()), orgB.name)
  })

  test('成员被移除后切换失败（Removed member loses tenant selection）', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser({ email: uniqueEmail('osel-owna') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('osel-ownb') })
    const orgB = await createOrganization(ownerB)

    const member = await createUser({ email: uniqueEmail('osel-mem') })
    await addOrgMember(orgA, member, 'member')
    await addOrgMember(orgB, member, 'member')

    const token = await tokenFor(member.id, Number(orgA.id))

    // 先证明切换本可成功。
    const before = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })
    before.assertStatus(200)

    // 移除 orgB 成员关系后再切。
    await OrganizationMember.query()
      .where('organization_id', Number(orgB.id))
      .where('user_id', member.id)
      .delete()

    const after = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })

    after.assertStatus(404)
    assert.equal(after.body().error.code, 'RESOURCE_NOT_FOUND')
  })

  test('组织已软删除 → 切换 404（Organization deletion invalidates context）', async ({
    client,
  }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    await db.from('organizations').where('id', Number(orgB.id)).update({ deleted_at: new Date() })

    const token = await tokenFor(owner.id, Number(orgA.id))
    const res = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })

    res.assertStatus(404)
  })

  test('切换成功持久化服务端 selection snapshot 并递增 epoch（§4.2/§4.3）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const token = await tokenFor(owner.id, Number(orgA.id))

    const first = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgA.id) })
    first.assertStatus(200)
    assert.equal(first.body().data.selectionEpoch, 1)

    const second = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })
    second.assertStatus(200)
    assert.equal(second.body().data.selectionEpoch, 2)

    // 服务端持久化了 selection（低敏字段）。
    const row = await db.from('tenant_selection_states').where('user_id', owner.id).first()
    assert.isNotNull(row)
    assert.equal(Number(row.organization_id), Number(orgB.id))
    assert.equal(Number(row.selection_epoch), 2)
    assert.equal(row.selection_source, 'server_selection')
    assert.isNotEmpty(row.scope_hash)

    // 切回原组织时 epoch 继续递增：scope hash 会复原，只有 epoch 拦得住旧句柄。
    const back = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgA.id) })
    back.assertStatus(200)
    assert.equal(back.body().data.selectionEpoch, 3)
    assert.equal(back.body().data.scopeHash, first.body().data.scopeHash)
  })

  test('切换返回失效报告，覆盖预览/导出/作业/AI/Compiler 与前端缓存（§4.3）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const token = await tokenFor(owner.id, Number(orgA.id))

    await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgA.id) })
    const res = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })

    res.assertStatus(200)
    const report = res.body().data.invalidation
    const targets = report.entries.map((e: { target: string }) => e.target)
    for (const expected of [
      'server_cache',
      'preview_signature',
      'export_handle',
      'job_handle',
      'ai_context_handle',
      'compiler_context_handle',
      'query_cache',
    ]) {
      assert.include(targets, expected, `失效报告缺少目标 ${expected}`)
    }
    assert.equal(report.previousScopeHash !== report.nextScopeHash, true)
    // 报告不得含缓存值、raw key 或句柄本体。
    assert.notProperty(report, 'keys')
    assert.notProperty(report, 'values')
  })

  test('切换写入低敏审计事件，含 previous/next scope hash 且不含组织名（§4.5）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const orgA = await createOrganization(owner)
    const orgB = await createOrganization(owner)
    const token = await tokenFor(owner.id, Number(orgA.id))

    await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgA.id) })
    await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })

    const logs = await db
      .from('audit_logs')
      .where('user_id', owner.id)
      .orderBy('id', 'desc')
      .limit(5)
    const switched = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes('organization_selection.select')
    })

    assert.isDefined(switched, '组织切换必须写审计事件')
    const meta = JSON.parse(
      typeof switched.metadata === 'string' ? switched.metadata : JSON.stringify(switched.metadata),
    )
    assert.equal(meta.kind, 'switched')
    assert.isNotEmpty(meta.nextScopeHash)
    assert.equal(meta.previousToNextChanged, true)
    assert.equal(meta.actorRef, `user:${owner.id}`)
    // 低敏：不得含组织名称、原始 token、权限全集。
    assert.notInclude(JSON.stringify(meta), orgA.name)
    assert.notInclude(JSON.stringify(meta), token)
    assert.notProperty(meta, 'permissions')
  })

  test('被拒切换的审计不记录目标组织归属（不留存在性证据）', async ({ client, assert }) => {
    const ownerA = await createUser({ email: uniqueEmail('osel-owna') })
    const orgA = await createOrganization(ownerA)
    const ownerB = await createUser({ email: uniqueEmail('osel-ownb') })
    const orgB = await createOrganization(ownerB)
    const member = await createUser({ email: uniqueEmail('osel-mem') })
    await addOrgMember(orgA, member, 'member')

    const token = await tokenFor(member.id, Number(orgA.id))
    const res = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(orgB.id) })
    res.assertStatus(404)

    const logs = await db.from('audit_logs').where('user_id', member.id).orderBy('id', 'desc')
    const denied = logs.find((l) => {
      const meta = typeof l.metadata === 'string' ? l.metadata : JSON.stringify(l.metadata ?? {})
      return meta.includes('organization_selection.select')
    })
    assert.isDefined(denied, '被拒切换也必须留低敏审计')
    const meta = JSON.parse(
      typeof denied.metadata === 'string' ? denied.metadata : JSON.stringify(denied.metadata),
    )
    assert.equal(meta.kind, 'denied')
    // 关键：目标组织不得出现在审计里（否则审计本身成为存在性侧信道）。
    assert.isNull(meta.organizationId)
    assert.notInclude(JSON.stringify(meta), orgB.name)
  })

  test('GET 当前上下文返回低敏有效租户决定', async ({ client, assert }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const org = await createOrganization(owner)
    const token = await tokenFor(owner.id, Number(org.id))

    await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({ organizationId: Number(org.id) })

    const res = await client.get(ENDPOINT).header('Authorization', `Bearer ${token}`)

    res.assertStatus(200)
    const body = res.body().data
    assert.isTrue(body.resolved)
    assert.equal(body.effectiveContext.organizationId, Number(org.id))
    assert.equal(body.selectionEpoch, 1)
    // 低敏：不得返回权限全集或原始 token。
    assert.notProperty(body.effectiveContext, 'permissions')
    assert.notInclude(JSON.stringify(body), token)
  })

  test('未认证请求被拒（受保护路由）', async ({ client }) => {
    const res = await client.post(ENDPOINT).json({ organizationId: 1 })
    res.assertStatus(401)
  })

  test('客户端提交的 permissions/scopeMode 声明被忽略（Frontend permission claim is ignored）', async ({
    client,
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('osel-owner') })
    const org = await createOrganization(owner)
    const token = await tokenFor(owner.id, Number(org.id))

    const res = await client
      .post(ENDPOINT)
      .header('Authorization', `Bearer ${token}`)
      .json({
        organizationId: Number(org.id),
        scopeMode: 'global-low-sensitive',
        isSuperAdmin: true,
        permissions: ['system:admin'],
      })

    res.assertStatus(200)
    const context = res.body().data.effectiveContext
    // 服务端重算：不是 super admin、不是全局模式。
    assert.equal(context.scopeMode, 'tenant')
    assert.isFalse(context.isSuperAdmin)
  })
})
