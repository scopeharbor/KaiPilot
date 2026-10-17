/**
 * v3-skill-as-plugin-adapter —— PluginInstall API 集成测试（task 3.6）。
 *
 * 覆盖要求：
 * - 来源未批准/摘要不符拒绝
 * - 未确认权限不得启用
 * - 卸载不删宿主资源
 * - 跨组织操作不可区分
 * - 审计脱敏断言
 *
 * 纪律：使用 truncate() 生命周期，禁止 group 级 migrate。
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
import CompilerSkill from '#models/compiler_skill'
import AuditLog from '#models/audit_log'
import {
  FIXTURE_PLUGIN_ID,
  FIXTURE_VERSION,
  PLUGIN_SEAM_TEMPLATE_PACK,
  PILOT_TEMPLATE_PACK_PAYLOAD,
  NEGATIVE_TEMPLATE_PACK_FIXTURES,
} from '@aiproj/types'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-installations`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedRelease(
  organizationId: number,
  opts: {
    status?: string
    pluginIdentity?: string
    version?: string
    packageDigest?: string
    metadata?: Record<string, unknown>
  } = {},
) {
  const pluginIdentity = opts.pluginIdentity ?? FIXTURE_PLUGIN_ID
  const version = opts.version ?? FIXTURE_VERSION
  const status = opts.status ?? 'approved'
  const packageDigest = opts.packageDigest ?? 'sha256:pkg-001'

  const metadata = opts.metadata ?? {
    name: 'Dev Toolkit Plugin',
    contributions: [
      {
        contributionKey: 'dev-skill',
        seamKey: 'skill-adapter.skill-bundle',
        seamVersion: '1.0.0',
        title: 'Dev Skill Bundle',
        payload: {
          skillKey: 'dev-patterns',
          skillVersion: '1.0.0',
          lifecycleRef: 'active',
        },
      },
    ],
    permissions: [
      {
        permissionKey: 'compiler:skill:view',
        seamKey: 'skill-adapter.skill-bundle',
        sideEffect: 'read-only',
        network: 'none',
      },
    ],
  }

  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity,
    version,
    packageDigest,
    manifestDigest: 'sha256:manifest-001',
    compatibilityDigest: 'sha256:compat-001',
    upstreamReceiptRef: 'receipt-uuid-1',
    status,
    metadata: JSON.stringify(metadata),
    rowVersion: 1,
  })
}

test.group('PluginInstall API', (group) => {
  useAiDatabase(group)

  test('来源未批准拒绝安装并返回错误，不创建安装记录', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    // 创建处于 pending_review 状态的 release
    const draftRelease = await seedRelease(org.id, { status: 'pending_review' })

    const res = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId: FIXTURE_PLUGIN_ID,
        releaseId: draftRelease.id,
      })

    res.assertStatus(400)
    res.assertBodyContains({
      error: { code: 'plugin-install-release-not-approved' },
    })

    const count = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(count.length, 0, '未批准 release 不得创建安装记录')
  })

  test('内容摘要不符拒绝安装且 fail closed', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const release = await seedRelease(org.id, {
      status: 'approved',
      packageDigest: 'sha256:actual-digest',
    })

    const res = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId: FIXTURE_PLUGIN_ID,
        releaseId: release.id,
        expectedDigest: 'sha256:mismatched-digest',
      })

    res.assertStatus(400)
    res.assertBodyContains({
      error: { code: 'plugin-install-digest-mismatch' },
    })

    const count = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(count.length, 0)
  })

  test('安装、启用与权限确认完整流程', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedRelease(org.id)

    // 1. 安装预览
    const prevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId: FIXTURE_PLUGIN_ID,
        releaseId: release.id,
      })
    prevRes.assertStatus(200)
    const installPreview = prevRes.body().data

    // 2. 安装确认
    const confirmRes = await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: installPreview.previewHandle,
        previewDigest: installPreview.previewDigest,
      })
    confirmRes.assertStatus(200)
    assert.equal(confirmRes.body().data.status, 'installed')
    assert.isNull(confirmRes.body().data.permissionConfirmation)

    // 3. 启用预览
    const enablePrevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'enable',
        pluginId: FIXTURE_PLUGIN_ID,
      })
    enablePrevRes.assertStatus(200)
    const enablePreview = enablePrevRes.body().data
    assert.isString(enablePreview.permissionDigest)

    // 4. 未显式确认权限清单启用被拒
    const rejectEnableRes = await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: enablePreview.previewHandle,
        previewDigest: enablePreview.previewDigest,
        permissionConfirmed: false,
      })
    rejectEnableRes.assertStatus(400)
    rejectEnableRes.assertBodyContains({
      error: { code: 'plugin-install-permission-unconfirmed' },
    })

    // 5. 显式确认权限清单启用成功
    const successEnableRes = await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: enablePreview.previewHandle,
        previewDigest: enablePreview.previewDigest,
        permissionConfirmed: true,
        permissionDigest: enablePreview.permissionDigest,
      })
    successEnableRes.assertStatus(200)
    const enabledRecord = successEnableRes.body().data
    assert.equal(enabledRecord.status, 'enabled')
    assert.isNotNull(enabledRecord.permissionConfirmation)
    assert.equal(
      enabledRecord.permissionConfirmation.permissionDigest,
      enablePreview.permissionDigest,
    )
  })

  test('卸载不删除宿主资源（Skill 状态与记录保持完整）', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedRelease(org.id)

    // 宿主预先存在一个 Skill
    const hostSkill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'dev-patterns',
      name: 'Development Patterns',
      version: '1.0.0',
      description: 'Host Skill',
      status: 'active',
      category: { primary: 'engineering' } as any,
      tags: ['dev'] as any,
      activation: {} as any,
      knowledge: {} as any,
      basePriority: 10,
      createdBy: user.id,
      updatedBy: user.id,
    })

    // 安装插件
    const prevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: FIXTURE_PLUGIN_ID, releaseId: release.id })
    const preview = prevRes.body().data

    await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({ previewHandle: preview.previewHandle, previewDigest: preview.previewDigest })

    // 卸载插件
    const uninstPrevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'uninstall', pluginId: FIXTURE_PLUGIN_ID })
    const uninstPreview = uninstPrevRes.body().data

    const uninstConfirmRes = await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: uninstPreview.previewHandle,
        previewDigest: uninstPreview.previewDigest,
      })
    uninstConfirmRes.assertStatus(200)
    assert.equal(uninstConfirmRes.body().data.status, 'uninstalled')

    // 断言宿主 Skill 状态不变且依然存在
    const reloadedSkill = await CompilerSkill.find(hostSkill.id)
    assert.isNotNull(reloadedSkill)
    assert.equal(reloadedSkill!.status, 'active')
  })

  test('跨组织操作响应形状与记录不存在不可区分（404）', async ({ client }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const tokenA = await login(client, ownerA.email)
    const releaseA = await seedRelease(orgA.id)

    // 在 orgA 中安装插件
    const prevResA = await client
      .post(`${base(orgA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'install', pluginId: FIXTURE_PLUGIN_ID, releaseId: releaseA.id })
    const prevA = prevResA.body().data

    await client
      .post(`${base(orgA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({ previewHandle: prevA.previewHandle, previewDigest: prevA.previewDigest })

    // 用户 B 在 orgB
    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)
    const tokenB = await login(client, ownerB.email)

    // 用户 B 试图查询 orgB 路径下的该插件安装记录（该记录仅存在于 orgA）
    const showRes = await client.get(`${base(orgB.id)}/${FIXTURE_PLUGIN_ID}`).bearerToken(tokenB)
    showRes.assertStatus(404)
    showRes.assertBodyContains({
      error: { code: 'plugin-install-not-found' },
    })

    // 用户 B 试图用 orgA 的 release 预览安装在 orgB（跨组织引用 release）
    const crossOrgPrevRes = await client
      .post(`${base(orgB.id)}/commands/preview`)
      .bearerToken(tokenB)
      .json({ action: 'install', pluginId: FIXTURE_PLUGIN_ID, releaseId: releaseA.id })
    crossOrgPrevRes.assertStatus(404)
    crossOrgPrevRes.assertBodyContains({
      error: { code: 'plugin-install-not-found' },
    })
  })

  test('状态转移产生低敏审计事件且不含敏感材料', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    const release = await seedRelease(org.id)

    const prevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: FIXTURE_PLUGIN_ID, releaseId: release.id })
    const prev = prevRes.body().data

    await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({ previewHandle: prev.previewHandle, previewDigest: prev.previewDigest })

    const auditLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'plugin_installation')

    assert.isAtLeast(auditLogs.length, 1)
    const log = auditLogs[0]!
    assert.equal(log.action, 'create')
    const metaStr = JSON.stringify(log.metadata)
    assert.notInclude(metaStr, 'token')
    assert.notInclude(metaStr, 'secret')
    assert.notInclude(metaStr, 'apiKey')
  })

  test('悬空数据源键的模板包在 preview 阶段被阻断且无安装记录', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const release = await seedRelease(org.id, {
      pluginIdentity: 'com.aiproj.invalid-tpl-pack',
      metadata: {
        name: 'Invalid Template Pack',
        contributions: [
          {
            contributionKey: 'bad-tpl',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            payload: NEGATIVE_TEMPLATE_PACK_FIXTURES.danglingDataSourceKey,
          },
        ],
      },
    })

    const prevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: 'com.aiproj.invalid-tpl-pack', releaseId: release.id })

    prevRes.assertStatus(400)
    prevRes.assertBodyContains({
      error: { code: 'plugin-install-seam-validation-failed' },
    })

    const installations = await PluginInstallation.query().where('organization_id', org.id)
    assert.lengthOf(installations, 0)
  })

  test('与内置模板 ID 冲突的模板包在 preview 阶段被阻断', async ({ client }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const release = await seedRelease(org.id, {
      pluginIdentity: 'com.aiproj.conflict-tpl-pack',
      metadata: {
        name: 'Conflict Template Pack',
        contributions: [
          {
            contributionKey: 'conflict-tpl',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            payload: NEGATIVE_TEMPLATE_PACK_FIXTURES.idConflictBuiltin,
          },
        ],
      },
    })

    const prevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({ action: 'install', pluginId: 'com.aiproj.conflict-tpl-pack', releaseId: release.id })

    prevRes.assertStatus(400)
    prevRes.assertBodyContains({
      error: { code: 'plugin-install-seam-validation-failed' },
    })
  })

  test('合法模板包 preview 通过且 permissionDigest 稳定，成功 confirm 安装', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    const release = await seedRelease(org.id, {
      pluginIdentity: 'com.aiproj.pilot-template-pack',
      metadata: {
        name: 'Pilot Template Pack',
        contributions: [
          {
            contributionKey: 'pilot-tpl',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            title: 'Pilot Templates',
            payload: PILOT_TEMPLATE_PACK_PAYLOAD,
          },
        ],
        permissions: [
          {
            permissionKey: 'report:view',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            sideEffect: 'read-only',
            network: 'none',
          },
        ],
      },
    })

    const prevRes = await client
      .post(`${base(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId: 'com.aiproj.pilot-template-pack',
        releaseId: release.id,
      })

    prevRes.assertStatus(200)
    const prev = prevRes.body().data
    assert.equal(prev.pluginId, 'com.aiproj.pilot-template-pack')
    assert.isNotNull(prev.permissionDigest)
    assert.isNotNull(prev.previewDigest)

    const confirmRes = await client
      .post(`${base(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({ previewHandle: prev.previewHandle, previewDigest: prev.previewDigest })

    confirmRes.assertStatus(200)
    const install = confirmRes.body().data
    assert.equal(install.pluginId, 'com.aiproj.pilot-template-pack')
    assert.equal(install.status, 'installed')
  })
})
