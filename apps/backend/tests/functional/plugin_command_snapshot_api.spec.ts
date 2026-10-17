/**
 * v3-command-palette-plugin-action-pack —— 官方命令包资格快照 API 测试（任务 3.2）。
 *
 * 覆盖：
 * - 无插件组织 → 空快照 + 零 findings（零行为变化）
 * - 未认证请求被拒
 * - installed（未启用）/ disabled / uninstalled → 快照不出现或消失
 * - enabled → 出现官方四命令快照（instanceRevision=rowVersion，grant keys 注入）
 * - incompatible（hostRange 不满足宿主版本）→ 排除 + 低敏 finding
 * - 损坏 ui-command payload → 整个 owner 隔离 + warning finding
 * - 跨租户：其他组织的安装不可见；非成员访问 → 权限拒绝
 * - stale revision：rowVersion 变化后 instanceRevision 跟随变化
 *
 * 纪律：使用 truncate() 生命周期；零网络/零真实 provider/零外部写回。
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import { buildOfficialCommandActionPackReleaseMetadata } from '@aiproj/types'

const PACK_PLUGIN_ID = 'com.aiproj.official.command-action-pack'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-command-snapshots`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedPackRelease(
  organizationId: number,
  opts: {
    metadata?: Record<string, unknown>
    status?: string
    version?: string
  } = {},
) {
  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PACK_PLUGIN_ID,
    version: opts.version ?? '1.0.0',
    packageDigest: 'sha256:pack-pkg-001',
    manifestDigest: 'sha256:pack-manifest-001',
    compatibilityDigest: 'sha256:pack-compat-001',
    upstreamReceiptRef: 'receipt-pack-001',
    status: opts.status ?? 'approved',
    metadata: JSON.stringify(opts.metadata ?? buildOfficialCommandActionPackReleaseMetadata()),
    rowVersion: 1,
  })
}

/** 形状合法但宿主版本不满足的兼容性声明（唯一失败原因 = host-version-out-of-range）。 */
function incompatibleMatrix(): Record<string, unknown> {
  return {
    pluginVersion: '1.0.0',
    hostRange: '^9.0.0',
    manifestSchemaVersion: '1.0',
    permissionModelVersion: '1.0',
    channel: 'stable',
    requiredSeams: [{ seamKey: 'skill-adapter.skill-bundle', seamVersion: '1.0.0' }],
  }
}

async function seedInstallation(
  organizationId: number,
  releaseId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    rowVersion?: number
    permissionKeys?: string[]
  } = {},
) {
  const installation = new PluginInstallation()
  installation.organizationId = organizationId
  installation.pluginId = PACK_PLUGIN_ID
  installation.version = '1.0.0'
  installation.releaseId = releaseId
  installation.status = opts.status ?? 'enabled'
  installation.packageDigest = 'sha256:pack-pkg-001'
  installation.manifestDigest = 'sha256:pack-manifest-001'
  installation.compatibilityDigest = 'sha256:pack-compat-001'
  installation.rowVersion = opts.rowVersion ?? 1
  if ((opts.status ?? 'enabled') === 'enabled') {
    installation.permissionConfirmation = {
      confirmedBy: 'test-owner',
      permissionDigest: 'digest-pack-001',
      permissionKeys: opts.permissionKeys ?? ['aiproj.plugin.command-entry'],
      confirmedAt: new Date().toISOString(),
    }
  }
  await installation.save()
  return installation
}

test.group('PluginCommandSnapshot API', (group) => {
  useAiDatabase(group)

  test('无插件组织返回空快照且零行为变化', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.deepEqual(res.body().data, [])
    assert.equal(res.body().meta.total, 0)
    assert.deepEqual(res.body().meta.findings, [])
  })

  test('未认证请求被拒绝', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)

    const res = await client.get(base(org.id))
    res.assertStatus(401)
  })

  test('installed（未启用）不产生快照，enable 后出现完整四命令快照', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedPackRelease(org.id)
    const installation = await seedInstallation(org.id, release.id, { status: 'installed' })

    let res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)

    // enable：状态置为 enabled + 写入权限确认（走既有生命周期语义）
    installation.status = 'enabled'
    installation.permissionConfirmation = {
      confirmedBy: 'owner',
      permissionDigest: 'digest-002',
      permissionKeys: ['aiproj.plugin.command-entry'],
      confirmedAt: new Date().toISOString(),
    }
    installation.rowVersion += 1
    await installation.save()

    res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data as Array<Record<string, any>>
    assert.lengthOf(data, 1)
    assert.equal(data[0]!.pluginId, PACK_PLUGIN_ID)
    assert.isTrue(data[0]!.enabled)
    assert.isFalse(data[0]!.quarantined)
    assert.lengthOf(data[0]!.contributions, 4)
    assert.include(data[0]!.effectiveGrantPermissions, 'aiproj.plugin.command-entry')
    assert.equal(String(data[0]!.instanceRevision), String(installation.rowVersion))
    assert.equal(data[0]!.trustedScope.kind, 'organization')
    assert.include(data[0]!.hostReadySeams, 'command-palette')
  })

  test('disabled 后快照原子消失', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedPackRelease(org.id)
    const installation = await seedInstallation(org.id, release.id, { status: 'enabled' })

    let res = await client.get(base(org.id)).bearerToken(token)
    assert.lengthOf(res.body().data, 1)

    installation.status = 'installed'
    installation.rowVersion += 1
    await installation.save()

    res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)
    assert.equal(res.body().meta.total, 0)
  })

  test('uninstalled 后快照消失', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedPackRelease(org.id)
    const installation = await seedInstallation(org.id, release.id, { status: 'enabled' })

    let res = await client.get(base(org.id)).bearerToken(token)
    assert.lengthOf(res.body().data, 1)

    installation.status = 'uninstalled'
    installation.rowVersion += 1
    await installation.save()

    res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)
  })

  test('incompatible 安装被排除并给出低敏 finding', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedPackRelease(org.id, {
      metadata: {
        ...buildOfficialCommandActionPackReleaseMetadata(),
        compatibilityMatrix: incompatibleMatrix(),
      },
    })
    await seedInstallation(org.id, release.id, { status: 'enabled' })

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    assert.lengthOf(res.body().data, 0)
    const findings = res.body().meta.findings as Array<{ code: string; severity: string }>
    assert.isTrue(findings.some((f) => f.code === 'plugin-command-incompatible'))
    // 低敏：finding 不携带 payload/manifest 内容
    const serialized = JSON.stringify(findings)
    assert.notInclude(serialized, 'actionRef')
    assert.notInclude(serialized, 'contributions')
  })

  test('损坏的 ui-command payload 隔离整个 owner 并给 warning finding', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const corruptedMeta = buildOfficialCommandActionPackReleaseMetadata() as {
      contributions: Array<{ payload: unknown }>
    }
    // 第一条贡献损坏（缺 actionKey）
    corruptedMeta.contributions[0]!.payload = {
      version: '1',
      contributionKey: 'broken-entry',
      surface: 'command-palette',
      label: '损坏条目',
      iconKey: 'Search',
      scopeKind: 'organization',
    }
    const release = await seedPackRelease(org.id, { metadata: corruptedMeta })
    await seedInstallation(org.id, release.id, { status: 'enabled' })

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    // fail-closed：整个 owner 隔离，而不是只丢弃单条命令
    assert.lengthOf(res.body().data, 0)
    const findings = res.body().meta.findings as Array<{
      code: string
      severity: string
      pluginId: string
    }>
    const isolated = findings.find((f) => f.code === 'plugin-command-pack-isolated')
    assert.isDefined(isolated)
    assert.equal(isolated!.severity, 'warning')
    assert.equal(isolated!.pluginId, PACK_PLUGIN_ID)
  })

  test('跨租户隔离：其他组织的安装不可见，非成员被拒', async ({ client, assert }) => {
    const owner = await createUser()
    const orgA = await createOrganization(owner)
    const outsider = await createUser()
    const orgB = await createOrganization(outsider)

    const release = await seedPackRelease(orgA.id)
    await seedInstallation(orgA.id, release.id, { status: 'enabled' })

    // A 组织可见
    const tokenA = await login(client, owner.email)
    const resA = await client.get(base(orgA.id)).bearerToken(tokenA)
    resA.assertStatus(200)
    assert.lengthOf(resA.body().data, 1)

    // B 组织（自己的组织）看不到 A 的安装——零泄露
    const tokenB = await login(client, outsider.email)
    const resB = await client.get(base(orgB.id)).bearerToken(tokenB)
    resB.assertStatus(200)
    assert.lengthOf(resB.body().data, 0)
    assert.equal(resB.body().meta.total, 0)

    // 非成员访问 A 组织 → 统一掩蔽为 404（不泄露组织/安装存在性，Policy 层约定）
    const resCross = await client.get(base(orgA.id)).bearerToken(tokenB)
    resCross.assertStatus(404)
  })

  test('stale revision：rowVersion 变化后 instanceRevision 跟随更新', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedPackRelease(org.id)
    const installation = await seedInstallation(org.id, release.id, {
      status: 'enabled',
      rowVersion: 5,
    })

    let res = await client.get(base(org.id)).bearerToken(token)
    let data = res.body().data as Array<Record<string, any>>
    assert.equal(String(data[0]!.instanceRevision), '5')

    installation.rowVersion = 7
    await installation.save()

    res = await client.get(base(org.id)).bearerToken(token)
    data = res.body().data as Array<Record<string, any>>
    assert.equal(String(data[0]!.instanceRevision), '7')
  })
})
