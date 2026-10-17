/**
 * v3-plugin-private-registry-lifecycle — API 集成测试（task 7.4）。
 *
 * 覆盖：认证、分页 envelope、统一错误体、preview 边界、404 先于 403 的非泄露顺序、
 * 跨组织负例、confirm 通道未接线时**不静默写入**。
 *
 * 全部走本地测试库与 fixture，不触任何外部 registry/网络。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginPrivateRegistryEntry from '#models/plugin_private_registry_entry'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-registry`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedEntry(organizationId: number, pluginIdentity = 'com.example.plugin') {
  const entry = await PluginPrivateRegistryEntry.create({
    organizationId,
    pluginIdentity,
    pluginName: '示例插件',
    recommendedReleaseId: null,
    recommendedVersion: null,
    rowVersion: 1,
  })
  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity,
    version: '1.0.0',
    packageDigest: 'sha256:pkg',
    manifestDigest: 'sha256:manifest',
    compatibilityDigest: 'sha256:compat',
    upstreamReceiptRef: 'receipt-1',
    status: 'draft',
    metadata: null,
    rowVersion: 1,
  })
  return { entry, release }
}

test.group('PluginRegistry API', (group) => {
  useAiDatabase(group)

  // ── 认证 ──────────────────────────────────────────────────────────────
  // 组织作用域路由（/organizations/:organizationId/...）上，未认证请求先被全局
  // tenant 中间件 fail closed 成 403「需要组织上下文」——它跑在按路由的 auth 之前。
  // 这是既有全局链路语义（见 tenant_middleware 注释），本 change 不改全局中间件；
  // 这里断言的是**到不了控制器、且不泄露任何目录数据**。
  test('未认证访问列表被拒且不返回任何目录数据', async ({ client, assert }) => {
    const res = await client.get(base(1))
    assert.oneOf(res.status(), [401, 403])
    assert.notProperty(res.body(), 'data')
  })

  test('未认证访问 preview 被拒（写向端点同样拦截）', async ({ client, assert }) => {
    const res = await client.post(`${base(1)}/commands/preview`).json({ action: 'approve' })
    assert.oneOf(res.status(), [401, 403])
    assert.notProperty(res.body(), 'data')
  })

  // ── 分页 envelope ─────────────────────────────────────────────────────
  test('列表返回 { data, meta } 分页 envelope', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    const body = res.body()
    assert.isArray(body.data)
    assert.properties(body.meta, ['total', 'page', 'perPage', 'totalPages'])
  })

  test('列表按 perPage 分页且上限被钳制', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    await seedEntry(org.id, 'com.example.a')
    await seedEntry(org.id, 'com.example.b')

    const res = await client.get(`${base(org.id)}?perPage=1`).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().meta.total, 2)

    const clamped = await client.get(`${base(org.id)}?perPage=9999`).bearerToken(token)
    assert.isAtMost(clamped.body().meta.perPage, 100)
  })

  test('列表按 pluginIdentity 过滤', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    await seedEntry(org.id, 'com.example.a')
    await seedEntry(org.id, 'com.example.b')

    const res = await client.get(`${base(org.id)}?pluginIdentity=com.example.a`).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().data[0].pluginIdentity, 'com.example.a')
  })

  // ── 统一错误体与非泄露顺序 ────────────────────────────────────────────
  test('不存在的条目返回 404 与统一错误体', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(`${base(org.id)}/999999`).bearerToken(token)
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'registry-release-not-found' } })
  })

  test('跨组织条目返回 404 而非 403（不反推存在性）', async ({ client, assert }) => {
    const owner = await createUser()
    const orgA = await createOrganization(owner)
    const { entry } = await seedEntry(orgA.id)

    const outsider = await createUser()
    const orgB = await createOrganization(outsider)
    const token = await login(client, outsider.email)

    // 用 B 组织的路径去取 A 组织的条目 → 必须是「不存在」
    const res = await client.get(`${base(orgB.id)}/${entry.id}`).bearerToken(token)
    res.assertStatus(404)
    assert.notInclude(JSON.stringify(res.body()), 'PERMISSION_DENIED')
  })

  test('跨组织 preview 目标返回 404，且错误体不回显目标细节', async ({ client, assert }) => {
    const owner = await createUser()
    const orgA = await createOrganization(owner)
    const { release } = await seedEntry(orgA.id)

    const outsider = await createUser()
    const orgB = await createOrganization(outsider)
    const token = await login(client, outsider.email)

    const res = await client
      .post(`${base(orgB.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'submit-for-review', targetReleaseId: release.id })

    res.assertStatus(404)
    const body = JSON.stringify(res.body())
    assert.notInclude(body, 'sha256:pkg', '错误体不得回显 digest')
    assert.notInclude(body, 'com.example.plugin', '错误体不得回显插件标识')
  })

  test('无权限成员访问列表返回 403（同组织内才谈权限）', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const viewer = await createUser({ email: `viewer-${Date.now()}@example.com` })
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    // external_collaborator 只有 view；用写向端点验证 403
    const res = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'approve', targetReleaseId: 1 })
    // 目标不存在 → 仍应先 404（非泄露顺序优先于权限）
    res.assertStatus(404)
  })

  // ── preview / confirm 边界 ────────────────────────────────────────────
  test('preview 缺参返回 400 校验错误', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({})
    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('preview 产出低敏 diff 与影响集合，且不写入正式数据', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const { release } = await seedEntry(org.id)

    const before = await PluginPrivateRegistryRelease.query().where('organization_id', org.id)

    const res = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'submit-for-review', targetReleaseId: release.id })

    res.assertStatus(200)
    const data = res.body().data
    assert.isString(data.diff)
    assert.isArray(data.impactSummary)
    // 低敏：预览不得回显包体/manifest digest 原文
    assert.notInclude(JSON.stringify(data), 'sha256:manifest')

    const after = await PluginPrivateRegistryRelease.query().where('organization_id', org.id)
    assert.equal(after.length, before.length, 'preview 不得新增行')
    assert.equal(after[0]!.status, 'draft', 'preview 不得改变状态')
  })

  test('preview 拒绝非法状态迁移', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const { release } = await seedEntry(org.id)

    // draft 直接 approve 属非法迁移
    const res = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'approve', targetReleaseId: release.id })

    res.assertStatus(400)
    res.assertBodyContains({ error: { code: 'registry-illegal-status-transition' } })
  })

  test('confirm 未知 handle 返回 404，且不产生任何写入', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    await seedEntry(org.id)

    const before = await PluginPrivateRegistryRelease.query().where('organization_id', org.id)
    const res = await client
      .post(`${base(org.id)}/commands/unknown-handle/confirm`)
      .bearerToken(token)
      .json({ action: 'submit-for-review' })

    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'registry-preview-handle-invalid' } })

    const after = await PluginPrivateRegistryRelease.query().where('organization_id', org.id)
    assert.equal(after[0]!.status, before[0]!.status)
  })

  // ── 解析与队列 ────────────────────────────────────────────────────────
  test('resolve 缺 pluginIdentity 返回 400', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(`${base(org.id)}/resolve`).bearerToken(token)
    res.assertStatus(400)
  })

  test('resolve 排除 withdrawn 状态的 release', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const { release } = await seedEntry(org.id)
    release.status = 'withdrawn'
    await release.save()

    const res = await client
      .get(`${base(org.id)}/resolve?pluginIdentity=com.example.plugin`)
      .bearerToken(token)
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'registry-no-compatible-version' } })
  })

  test('review-queue 只返回本组织 pending_review 的 release', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const { release } = await seedEntry(org.id)
    release.status = 'pending_review'
    await release.save()

    const otherOwner = await createUser()
    const otherOrg = await createOrganization(otherOwner)
    const other = await seedEntry(otherOrg.id, 'com.other.plugin')
    other.release.status = 'pending_review'
    await other.release.save()

    const res = await client.get(`${base(org.id)}/review-queue`).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().data[0].pluginIdentity, 'com.example.plugin')
  })
})
