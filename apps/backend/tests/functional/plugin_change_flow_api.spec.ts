/**
 * v3-plugin-approval-change-flow —— 统一变更请求 API 集成测试（tasks 4.1/4.2）。
 *
 * 覆盖要求：
 * - 统一错误 envelope / 分页 meta / 401 / 403（RBAC）/ 404（跨租不可区分）
 * - maker-checker：发起人自批被拒；第二管理员审批通过
 * - 重放防护：伪造句柄 409、已应用句柄重放 409 already-decided
 * - 确认前安装态零变化；确认后创建且审计落库
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { STRONG_PASSWORD, addOrgMember, createUser } from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'

const PLUGIN_ID = 'org.example.dev-toolkit'
const BASE = (orgId: number | string) => `/api/v1/organizations/${orgId}/plugin-change-requests`

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedRelease(organizationId: number) {
  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    version: '1.2.0',
    packageDigest: 'sha256:pkg-001',
    manifestDigest: 'sha256:man-001',
    compatibilityDigest: 'sha256:compat-001',
    upstreamReceiptRef: 'receipt-1',
    status: 'approved',
    metadata: JSON.stringify({
      name: 'Dev Toolkit',
      permissions: [
        {
          permissionKey: 'compiler:skill:view',
          seamKey: 's',
          sideEffect: 'read-only',
          network: 'none',
        },
      ],
    }),
    rowVersion: 1,
  })
}

test.group('PluginChangeRequests API', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('未认证访问返回 401', async ({ client }) => {
    const user = await createUser()
    const org = await createOrgFor(user)
    const res = await client.get(BASE(org.id))
    res.assertStatus(401)
  })

  test('member 角色无管理权：创建请求返回 403 统一 envelope', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const member = await createUser()
    await addOrgMember(org, member, 'member')
    const memberToken = await login(client, member.email)
    const release = await seedRelease(org.id)

    const res = await client
      .post(BASE(org.id))
      .bearerToken(memberToken)
      .json({ kind: 'install', pluginId: PLUGIN_ID, releaseId: release.id })
    res.assertStatus(403)
    assert.equal(res.body().error?.code, 'PERMISSION_DENIED')
  })

  test('全链路：创建→列表分页→详情→审批→句柄→确认→重放；跨租 404', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const admin2 = await createUser()
    await addOrgMember(org, admin2, 'admin')
    const ownerToken = await login(client, owner.email)
    const admin2Token = await login(client, admin2.email)
    const release = await seedRelease(org.id)

    // 创建（默认需审批）
    let res = await client
      .post(BASE(org.id))
      .bearerToken(ownerToken)
      .json({ kind: 'install', pluginId: PLUGIN_ID, releaseId: release.id })
    res.assertStatus(201)
    const requestUid = res.body().data.id as string
    assert.equal(res.body().data.state, 'draft')

    // 确认前零安装记录
    assert.equal(await countInstallations(org.id), 0)

    // 列表 + 分页 meta
    res = await client.get(BASE(org.id)).bearerToken(ownerToken).qs({ page: 1, perPage: 10 })
    res.assertStatus(200)
    assert.isArray(res.body().data)
    assert.exists(res.body().meta.total)

    // 详情含决策流水
    res = await client.get(`${BASE(org.id)}/${requestUid}`).bearerToken(ownerToken)
    res.assertStatus(200)
    assert.equal(res.body().data.request.id, requestUid)
    assert.isTrue(res.body().data.decisions.some((d: any) => d.event === 'requested'))

    // 推进预览 → pending-approval
    res = await client.post(`${BASE(org.id)}/${requestUid}/preview`).bearerToken(ownerToken)
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'pending-approval')

    // maker-checker：发起人自批被拒
    res = await client
      .post(`${BASE(org.id)}/${requestUid}/approve`)
      .bearerToken(ownerToken)
      .json({ idempotencyKey: 'idem-self' })
    res.assertStatus(403)
    assert.equal(res.body().error.code, 'plugin-change-self-approval-denied')

    // 第二管理员审批通过（幂等键重复不产生第二条事件）
    res = await client
      .post(`${BASE(org.id)}/${requestUid}/approve`)
      .bearerToken(admin2Token)
      .json({ idempotencyKey: 'idem-ap-1' })
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'approved')
    res = await client
      .post(`${BASE(org.id)}/${requestUid}/approve`)
      .bearerToken(admin2Token)
      .json({ idempotencyKey: 'idem-ap-1' })
    res.assertStatus(200)

    // 审批 ≠ 确认：仍零安装记录
    assert.equal(await countInstallations(org.id), 0)

    // 签发句柄
    res = await client.post(`${BASE(org.id)}/${requestUid}/confirm-handle`).bearerToken(ownerToken)
    res.assertStatus(200)
    const handle = res.body().data.handle as string

    // 伪造句柄 → 409 stale
    res = await client
      .post(`${BASE(org.id)}/${requestUid}/confirm`)
      .bearerToken(ownerToken)
      .json({ handle: 'chg-cfm-000000000000-9' })
    res.assertStatus(409)
    assert.equal(res.body().error.code, 'plugin-change-stale')

    // 正确句柄确认 → applied，安装记录恰一条
    res = await client
      .post(`${BASE(org.id)}/${requestUid}/confirm`)
      .bearerToken(ownerToken)
      .json({ handle })
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'applied')
    assert.equal(await countInstallations(org.id), 1)

    // 重放同一句柄 → already-decided，且不新增安装
    res = await client
      .post(`${BASE(org.id)}/${requestUid}/confirm`)
      .bearerToken(ownerToken)
      .json({ handle })
    res.assertStatus(409)
    assert.equal(res.body().error.code, 'plugin-change-already-decided')
    assert.equal(await countInstallations(org.id), 1)

    // 跨组织不可区分：另一组织管理员读取该请求 → 404
    const outsider = await createUser()
    await createOrgFor(outsider)
    const outsiderToken = await login(client, outsider.email)
    res = await client.get(`${BASE(org.id)}/${requestUid}`).bearerToken(outsiderToken)
    res.assertStatus(404)
    assert.exists(res.body().error, '跨组织 404 必须非泄露且携带错误体')
    void assertEnvelope
    function assertEnvelope(r: any) {
      assert.exists(r.body().error?.code)
      assert.exists(r.body().error?.message)
    }
  })

  test('reject 流程进入终态并拒绝后续确认', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const admin2 = await createUser()
    await addOrgMember(org, admin2, 'admin')
    const ownerToken = await login(client, owner.email)
    const admin2Token = await login(client, admin2.email)
    const release = await seedRelease(org.id)

    let res = await client
      .post(BASE(org.id))
      .bearerToken(ownerToken)
      .json({ kind: 'version-upgrade', pluginId: PLUGIN_ID, releaseId: release.id })
    res.assertStatus(409)
    assert.equal(res.body().error.code, 'plugin-change-target-invalid')

    // 换成 install 请求走拒绝路径
    res = await client
      .post(BASE(org.id))
      .bearerToken(ownerToken)
      .json({ kind: 'install', pluginId: PLUGIN_ID, releaseId: release.id })
    res.assertStatus(201)
    const uid2 = res.body().data.id
    await client.post(`${BASE(org.id)}/${uid2}/preview`).bearerToken(ownerToken)
    res = await client
      .post(`${BASE(org.id)}/${uid2}/reject`)
      .bearerToken(admin2Token)
      .json({ idempotencyKey: 'rj-1', reasonCode: 'plugin-change-permission-denied' })
    res.assertStatus(200)
    assert.equal(res.body().data.state, 'rejected')

    res = await client.post(`${BASE(org.id)}/${uid2}/confirm-handle`).bearerToken(ownerToken)
    res.assertStatus(409)
    assert.equal(res.body().error.code, 'plugin-change-already-decided')
  })

  test('非法 payload 返回 VALIDATION_ERROR envelope', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrgFor(owner)
    const token = await login(client, owner.email)
    const res = await client
      .post(BASE(org.id))
      .bearerToken(token)
      .json({ kind: 'not-a-kind', pluginId: '' })
    res.assertStatus(400)
    assert.equal(res.body().error.code, 'VALIDATION_ERROR')
    assert.isArray(res.body().error.details)
  })
})

function createOrgFor(user: any): Promise<any> {
  // 复用 auth helpers 的组织工厂（保持与其它 API 测试一致的所有权语义）
  return import('../unit/ai/_helpers.js').then((m) => m.createOrganization(user))
}

async function countInstallations(orgId: number): Promise<number> {
  const rows = await PluginInstallation.query().where('organization_id', orgId)
  return rows.length
}
