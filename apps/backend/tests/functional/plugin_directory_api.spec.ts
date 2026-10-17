/**
 * v3-organization-private-plugin-directory — 目录只读投影 API 集成测试
 * （tasks 2.4/2.6）。
 *
 * 覆盖：认证、统一分页 envelope、成员 vs 管理员视图、确定性排序契约、
 * 跨租 404 非泄露顺序、有界受影响安装清单、参数校验、性能预算（批量聚合）
 * 与「目录无写端点」边界。全部走本地测试库与 fixture，零外部网络。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  addOrgMember,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginPrivateRegistryReview from '#models/plugin_private_registry_review'
import PluginInstallation from '#models/plugin_installation'
import type { RegistryReleaseStatus } from '@aiproj/types'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-directory`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedRelease(
  organizationId: number,
  overrides: Partial<{
    pluginIdentity: string
    version: string
    status: RegistryReleaseStatus
    metadata: string | null
    upstreamReceiptRef: string
  }> = {},
) {
  return PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: overrides.pluginIdentity ?? 'com.example.directory',
    version: overrides.version ?? '1.0.0',
    packageDigest: 'sha256:pkg',
    manifestDigest: 'sha256:manifest',
    compatibilityDigest: 'sha256:compat',
    upstreamReceiptRef: overrides.upstreamReceiptRef ?? 'receipt-1',
    status: overrides.status ?? 'approved',
    metadata: overrides.metadata ?? null,
    rowVersion: 1,
  })
}

const COMPATIBLE_METADATA = JSON.stringify({
  compatibilityMatrix: {
    pluginVersion: '1.0.0',
    hostRange: '>=3.0.0 <4.0.0',
    manifestSchemaVersion: '1.0',
    permissionModelVersion: '1.0',
    channel: 'stable',
    requiredSeams: [{ seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' }],
  },
})

test.group('PluginDirectory API', (group) => {
  useAiDatabase(group)

  // ── 认证 ──────────────────────────────────────────────────────────────
  test('未认证访问目录列表被拒且不返回任何数据', async ({ client, assert }) => {
    const res = await client.get(`${base(1)}/releases`)
    assert.oneOf(res.status(), [401, 403])
    assert.notProperty(res.body(), 'data')
  })

  // ── 分页 envelope ─────────────────────────────────────────────────────
  test('列表返回 { data, meta } 分页 envelope 且 perPage 上限被钳制', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    for (let i = 0; i < 3; i++) {
      await seedRelease(org.id, { version: `1.0.${i}` })
    }

    const list = await client.get(`${base(org.id)}/releases`).bearerToken(token)
    list.assertStatus(200)
    const body = list.body()
    assert.isArray(body.data)
    assert.properties(body.meta, ['total', 'page', 'perPage', 'totalPages'])
    assert.equal(body.meta.total, 3)

    const clamped = await client.get(`${base(org.id)}/releases?perPage=9999`).bearerToken(token)
    assert.isAtMost(clamped.body().meta.perPage, 100)

    const paged = await client.get(`${base(org.id)}/releases?perPage=2&page=2`).bearerToken(token)
    paged.assertStatus(200)
    assert.lengthOf(paged.body().data, 1)
    assert.equal(paged.body().meta.page, 2)
  })

  // ── 成员 vs 管理员视图 ────────────────────────────────────────────────
  test('owner（管理员视图）可见全部状态；viewer（成员视图）只见 approved', async ({
    client,
    assert,
  }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedRelease(org.id, { version: '1.0.0', status: 'approved' })
    await seedRelease(org.id, { version: '1.1.0', status: 'pending_review' })
    await seedRelease(org.id, { version: '1.2.0', status: 'withdrawn' })
    await seedRelease(org.id, { version: '1.3.0', status: 'deprecated' })

    const ownerToken = await login(client, owner.email)
    const ownerRes = await client.get(`${base(org.id)}/releases`).bearerToken(ownerToken)
    ownerRes.assertStatus(200)
    assert.equal(ownerRes.body().meta.total, 4, '管理员视图可见全部状态')

    const viewer = await createUser({ email: `dir-viewer-${Date.now()}@example.com` })
    await addOrgMember(org, viewer, 'viewer')
    const viewerToken = await login(client, viewer.email)
    const viewerRes = await client.get(`${base(org.id)}/releases`).bearerToken(viewerToken)
    viewerRes.assertStatus(200)
    assert.equal(viewerRes.body().meta.total, 1, '成员视图只暴露可分发 approved')
    assert.equal(viewerRes.body().data[0].version, '1.0.0')
  })

  test('成员显式请求 pending_review 过滤不泄露待审 release 存在性', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    await seedRelease(org.id, { version: '1.1.0', status: 'pending_review' })
    await seedRelease(org.id, { version: '1.0.0', status: 'approved' })

    const viewer = await createUser({ email: `dir-viewer2-${Date.now()}@example.com` })
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client
      .get(`${base(org.id)}/releases?status=pending_review`)
      .bearerToken(token)
    res.assertStatus(200)
    assert.equal(res.body().meta.total, 0, '成员不得借状态过滤反推待审版本存在')
    assert.lengthOf(res.body().data, 0)
  })

  // ── 确定性排序契约 ────────────────────────────────────────────────────
  test('sort=-version 按 semver 数值降序：10.0.0 在 9.0.0 之前', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    await seedRelease(org.id, { version: '9.0.0' })
    await seedRelease(org.id, { version: '10.0.0' })
    await seedRelease(org.id, { version: '2.0.0' })

    const res = await client.get(`${base(org.id)}/releases?sort=-version`).bearerToken(token)
    res.assertStatus(200)
    const versions = res.body().data.map((item: { version: string }) => item.version)
    assert.deepEqual(versions, ['10.0.0', '9.0.0', '2.0.0'])
  })

  // ── 详情：兼容性摘要 + 审批摘要 + 影响计数 + 低敏 ─────────────────────
  test('详情返回兼容性/审批摘要与影响计数，且不回显 digest 原文', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedRelease(org.id, { metadata: COMPATIBLE_METADATA })
    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.example.directory',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      packageDigest: 'sha256:pkg',
      manifestDigest: 'sha256:manifest',
      compatibilityDigest: 'sha256:compat',
      rowVersion: 1,
    })
    await PluginPrivateRegistryReview.create({
      organizationId: org.id,
      releaseId: release.id,
      cycleNumber: 3,
      submitterRef: 'user-maker',
      reviewerRef: 'user-checker',
      decision: 'approved',
      reasonCode: null,
      sourceHash: 'seed-hash',
    })

    const res = await client.get(`${base(org.id)}/releases/${release.id}`).bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data
    assert.isTrue(data.compatibilityAllowed, '合法声明应投影为兼容')
    assert.isString(data.compatibility.digest)
    assert.equal(data.activeInstallationCount, 1)
    assert.equal(data.uninstalledInstallationCount, 0)
    assert.equal(data.review.latestCycleNumber, 3, '审批摘要应投影最近轮次')
    assert.equal(data.review.latestDecision, 'approved')

    const serialized = JSON.stringify(res.body())
    assert.notInclude(serialized, 'sha256:manifest', '详情不得回显 manifest digest 原文')
    assert.notInclude(serialized, 'receipt-1', '详情不得回显 upstream receipt 引用')
    assert.notInclude(serialized, 'user-maker', '审批摘要不得回显提交人原始引用')
    assert.notInclude(serialized, 'user-checker', '审批摘要不得回显审批人原始引用')
  })

  // ── 404 / 跨租非泄露 ──────────────────────────────────────────────────
  test('不存在的 release 返回 404 统一错误体', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(`${base(org.id)}/releases/999999`).bearerToken(token)
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'directory-release-not-found' } })
  })

  test('跨组织 release 返回 404 且错误体不泄露目标信息', async ({ client, assert }) => {
    const owner = await createUser()
    const orgA = await createOrganization(owner)
    const release = await seedRelease(orgA.id, { pluginIdentity: 'com.example.secret' })

    const outsider = await createUser()
    const orgB = await createOrganization(outsider)
    const token = await login(client, outsider.email)

    const res = await client.get(`${base(orgB.id)}/releases/${release.id}`).bearerToken(token)
    res.assertStatus(404)
    const body = JSON.stringify(res.body())
    assert.notInclude(body, 'PERMISSION_DENIED', '跨组织必须先 404 再谈权限')
    assert.notInclude(body, 'com.example.secret', '错误体不得回显插件标识')
    assert.notInclude(body, 'sha256:', '错误体不得回显 digest')
  })

  test('成员视图下不可分发 release 详情按不存在处理（非泄露）', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const pending = await seedRelease(org.id, { version: '1.1.0', status: 'pending_review' })

    const viewer = await createUser({ email: `dir-viewer3-${Date.now()}@example.com` })
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const res = await client.get(`${base(org.id)}/releases/${pending.id}`).bearerToken(token)
    res.assertStatus(404)
    res.assertBodyContains({ error: { code: 'directory-release-not-found' } })
  })

  // ── 有界受影响安装清单 ────────────────────────────────────────────────
  // 架构事实：plugin_installations 以 (organization_id, plugin_id) 唯一，
  // 单个 release 至多被其所属插件的一行安装引用（upgrade 原行改写 releaseId）。
  // 故本组用不同插件各挂一行，验证有界清单形态与权限边界。
  async function seedInstallation(
    organizationId: number,
    releaseId: number,
    pluginId: string,
    status: 'installed' | 'enabled' | 'uninstalled',
  ) {
    return PluginInstallation.create({
      organizationId,
      pluginId,
      version: '1.0.0',
      releaseId,
      status,
      packageDigest: 'sha256:pkg',
      manifestDigest: 'sha256:manifest',
      compatibilityDigest: 'sha256:compat',
      rowVersion: 1,
    })
  }

  test('affected-installations 返回有界清单与统一分页 envelope', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const releaseA = await seedRelease(org.id, { pluginIdentity: 'com.example.alpha' })
    const releaseB = await seedRelease(org.id, {
      pluginIdentity: 'com.example.beta',
      version: '2.0.0',
    })
    await seedInstallation(org.id, releaseA.id, 'com.example.alpha', 'enabled')
    await seedInstallation(org.id, releaseB.id, 'com.example.beta', 'uninstalled')

    const ownerToken = await login(client, owner.email)
    const res = await client
      .get(`${base(org.id)}/releases/${releaseA.id}/affected-installations`)
      .bearerToken(ownerToken)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 1)
    assert.equal(res.body().meta.total, 1)
    assert.properties(res.body().meta, ['total', 'page', 'perPage', 'totalPages'])
    assert.equal(res.body().data[0].status, 'enabled')
    assert.notProperty(res.body().data[0], 'packageDigest', '受影响清单不回显包 digest')
    assert.notProperty(res.body().data[0], 'permissionConfirmation', '受影响清单不回显权限确认摘要')

    const uninstalledRes = await client
      .get(`${base(org.id)}/releases/${releaseB.id}/affected-installations`)
      .bearerToken(ownerToken)
    uninstalledRes.assertStatus(200)
    assert.equal(uninstalledRes.body().data[0].status, 'uninstalled')
    assert.property(uninstalledRes.body().data[0], 'uninstalledAt', '卸载时间戳字段在契约内')
  })

  test('affected-installations 成员被拒 403（同组织内谈权限）', async ({ client }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const release = await seedRelease(org.id)
    await seedInstallation(org.id, release.id, 'com.example.alpha', 'installed')

    const viewer = await createUser({ email: `dir-viewer4-${Date.now()}@example.com` })
    await addOrgMember(org, viewer, 'viewer')
    const token = await login(client, viewer.email)

    const denied = await client
      .get(`${base(org.id)}/releases/${release.id}/affected-installations`)
      .bearerToken(token)
    denied.assertStatus(403)
  })

  test('affected-installations 跨组织目标返回 404（先于 403）', async ({ client }) => {
    const owner = await createUser()
    const orgA = await createOrganization(owner)
    const release = await seedRelease(orgA.id)

    const outsider = await createUser()
    const orgB = await createOrganization(outsider)
    const token = await login(client, outsider.email)

    const res = await client
      .get(`${base(orgB.id)}/releases/${release.id}/affected-installations`)
      .bearerToken(token)
    res.assertStatus(404)
  })

  // ── 参数校验 ──────────────────────────────────────────────────────────
  test('非法 status 枚举返回校验错误', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(`${base(org.id)}/releases?status=not-a-status`).bearerToken(token)
    assert.oneOf(res.status(), [400, 422])
    res.assertBodyContains({ error: { code: 'VALIDATION_ERROR' } })
  })

  test('非法排序键返回校验错误', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(`${base(org.id)}/releases?sort=;-DROP`).bearerToken(token)
    assert.oneOf(res.status(), [400, 422])
  })

  // ── 写入口边界：目录不直接写 registry ─────────────────────────────────
  //
  // ── 来源标记与过滤（v3-plugin-fixture-market-seed task 4.1）────────────
  test('fixtureOnly 由 receipt 命名空间派生，且 receipt 原文不进 DTO', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    await seedRelease(org.id, {
      version: '1.0.0',
      pluginIdentity: 'com.aiproj.canary-query',
      upstreamReceiptRef: 'fixture-seed:canary-query@1.0.0',
    })
    await seedRelease(org.id, {
      version: '2.0.0',
      pluginIdentity: 'com.example.inhouse',
      upstreamReceiptRef: 'receipt-inhouse-2',
    })
    const token = await login(client, user.email)

    // 查询串里 '+' 会被解码成空格，升序需转义；此处直接用降序断言顺序
    const res = await client.get(`${base(org.id)}/releases?sort=-version`).bearerToken(token)
    res.assertStatus(200)
    const items = res.body().data
    assert.deepEqual(
      items.map((item: any) => [item.version, item.fixtureOnly]),
      [
        ['2.0.0', false],
        ['1.0.0', true],
      ],
    )
    // 低敏：只回布尔，receipt 原文一律不出现在响应里
    assert.notInclude(JSON.stringify(res.body()), 'fixture-seed:')
    assert.notInclude(JSON.stringify(res.body()), 'receipt-inhouse-2')
  })

  test('fixtureOnly 过滤双向生效：只看示例数据 / 排除示例数据', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    await seedRelease(org.id, {
      version: '1.0.0',
      upstreamReceiptRef: 'fixture-seed:demo@1.0.0',
    })
    await seedRelease(org.id, { version: '2.0.0', upstreamReceiptRef: 'receipt-real' })
    // 无 receipt 的历史行同样属于「非示例数据」，不得被排除过滤漏掉
    await seedRelease(org.id, { version: '3.0.0', upstreamReceiptRef: '' })
    const token = await login(client, user.email)

    const only = await client.get(`${base(org.id)}/releases?fixtureOnly=true`).bearerToken(token)
    only.assertStatus(200)
    assert.deepEqual(
      only.body().data.map((item: any) => item.version),
      ['1.0.0'],
    )

    const excluded = await client
      .get(`${base(org.id)}/releases?fixtureOnly=false&sort=-version`)
      .bearerToken(token)
    excluded.assertStatus(200)
    assert.deepEqual(
      excluded.body().data.map((item: any) => item.version),
      ['3.0.0', '2.0.0'],
    )
  })

  // §3 接入后目录面有受控写入口（POST /releases/:id/changes 与 /changes/:uid/confirm），
  // 但它们**只**创建统一变更流请求；直接写 registry release 的路径（如 POST /releases）
  // 依然不存在。本用例守住后者。
  test('目录面无直写 registry 端点：POST /releases 路由不存在，不产生任何写入', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    await seedRelease(org.id)

    const before = await PluginPrivateRegistryRelease.query().where('organization_id', org.id)

    const post = await client
      .post(`${base(org.id)}/releases`)
      .bearerToken(token)
      .json({})
    assert.oneOf(post.status(), [404, 405])

    const after = await PluginPrivateRegistryRelease.query().where('organization_id', org.id)
    assert.equal(after.length, before.length, '目录面不得提供绕过变更流的直写路径')
  })

  // ── 性能预算（批量聚合，无 N+1）────────────────────────────────────────
  test('多插件多 release 列表在预算内完成且计数正确（批量聚合证据）', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const PLUGIN_COUNT = 12
    const VERSIONS_PER_PLUGIN = 3
    const firstReleasePerPlugin: Array<{ releaseId: number; pluginId: string }> = []
    for (let p = 0; p < PLUGIN_COUNT; p++) {
      for (let v = 0; v < VERSIONS_PER_PLUGIN; v++) {
        const release = await seedRelease(org.id, {
          pluginIdentity: `com.perf.plugin${p}`,
          version: `1.${v}.0`,
          status: v === 0 ? 'withdrawn' : 'approved',
        })
        if (v === 0) {
          firstReleasePerPlugin.push({ releaseId: release.id, pluginId: `com.perf.plugin${p}` })
        }
      }
    }
    // 给前 6 个插件的首个 release 各挂一行安装（org 内 plugin_id 唯一）
    for (const { releaseId, pluginId } of firstReleasePerPlugin.slice(0, 6)) {
      await PluginInstallation.create({
        organizationId: org.id,
        pluginId,
        version: '1.0.0',
        releaseId,
        status: 'installed',
        packageDigest: 'sha256:pkg',
        manifestDigest: 'sha256:manifest',
        compatibilityDigest: 'sha256:compat',
        rowVersion: 1,
      })
    }

    const start = performance.now()
    const res = await client
      .get(`${base(org.id)}/releases?perPage=100&sort=-version`)
      .bearerToken(token)
    const elapsed = performance.now() - start

    res.assertStatus(200)
    assert.equal(res.body().meta.total, PLUGIN_COUNT * VERSIONS_PER_PLUGIN)
    // 本地 SQLite 预算：远低于此阈值即可；出现逐行 N+1 时该预算同样可过，
    // 但计数正确性断言保证聚合语义，架构测试保证查询形态。
    assert.isBelow(elapsed, 5000, `36 release 列表应在预算内完成，实际 ${elapsed.toFixed(0)}ms`)

    const withInstall = res
      .body()
      .data.filter((item: { activeInstallationCount: number }) => item.activeInstallationCount > 0)
    assert.lengthOf(withInstall, 6, '安装计数应按 release 正确聚合')
  })
})
