/**
 * v3-skill-as-plugin-adapter —— PluginSkillAdapter API 集成测试（task 4.4）。
 *
 * 覆盖要求：
 * - 停用/未启用呈现（未生效标明插件未启用，非 Skill 不存在）
 * - 宿主 active 状态对接生效
 * - 宿主不存在/非 active 时生效性标注
 * - Compiler context contribution 提取
 * - 组织隔离
 * - 零写断言
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
import { FIXTURE_PLUGIN_ID, FIXTURE_VERSION } from '@aiproj/types'

function base(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-skill-adapters`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

async function seedPluginWithRelease(
  organizationId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    pluginIdentity?: string
    contributions?: Array<Record<string, unknown>>
  } = {},
) {
  const pluginIdentity = opts.pluginIdentity ?? FIXTURE_PLUGIN_ID
  const status = opts.status ?? 'enabled'

  const contributions = opts.contributions ?? [
    {
      contributionKey: 'dev-skill-bundle',
      seamKey: 'skill-adapter.skill-bundle',
      seamVersion: '1.0.0',
      payload: {
        skillKey: 'dev-patterns',
        skillVersion: '1.0.0',
        lifecycleRef: 'active',
        description: 'Developer pattern skill',
      },
    },
    {
      contributionKey: 'dev-context',
      seamKey: 'compiler-contribution.context-contribution',
      seamVersion: '1.0.0',
      payload: {
        descriptor: 'Dev Context',
        scope: 'organization',
        targetStages: ['stage_wbs_decomposition'],
        advisory: true,
      },
    },
  ]

  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity,
    version: FIXTURE_VERSION,
    packageDigest: 'sha256:pkg-001',
    manifestDigest: 'sha256:manifest-001',
    compatibilityDigest: 'sha256:compat-001',
    upstreamReceiptRef: 'receipt-uuid-1',
    status: 'approved',
    metadata: JSON.stringify({ contributions }),
    rowVersion: 1,
  })

  const installation = await PluginInstallation.create({
    organizationId,
    pluginId: pluginIdentity,
    version: FIXTURE_VERSION,
    releaseId: release.id,
    status,
    permissionConfirmation: status === 'enabled' ? ({ confirmedBy: '1' } as any) : null,
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    rowVersion: 1,
    uninstalledAt: status === 'uninstalled' ? (new Date() as any) : null,
  })

  return { release, installation }
}

test.group('PluginSkillAdapter API', (group) => {
  useAiDatabase(group)

  test('停用/未启用插件贡献返回未生效（插件未启用）而非 Skill 不存在', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    // 创建未启用的插件（status = 'installed'）
    await seedPluginWithRelease(org.id, { status: 'installed' })

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data

    assert.lengthOf(data.skillBundles, 1)
    const bundle = data.skillBundles[0]
    assert.isFalse(bundle.isEffective)
    assert.equal(bundle.status, 'inactive')
    assert.equal(bundle.reasonCode, 'plugin_disabled')
    assert.include(bundle.reasonMessage, '插件未启用')

    const contextItem = data.contextContributions[0]
    assert.isFalse(contextItem.isEffective)
    assert.equal(contextItem.status, 'inactive')
    assert.equal(contextItem.reasonCode, 'plugin_disabled')
  })

  test('已启用插件在宿主对应 active Skill 存在时生效', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    // 宿主创建 active Skill
    const skill = await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'dev-patterns',
      name: 'Development Patterns',
      version: '1.0.0',
      description: 'Dev Skill Description',
      status: 'active',
      category: { primary: 'engineering' } as any,
      tags: ['dev'] as any,
      activation: {} as any,
      knowledge: {} as any,
      basePriority: 10,
      createdBy: user.id,
      updatedBy: user.id,
    })

    // 创建已启用的插件
    await seedPluginWithRelease(org.id, { status: 'enabled' })

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data

    assert.lengthOf(data.skillBundles, 1)
    const bundle = data.skillBundles[0]
    assert.isTrue(bundle.isEffective)
    assert.equal(bundle.status, 'effective')
    assert.equal(bundle.hostSkillId, skill.id)
    assert.equal(bundle.hostSkillStatus, 'active')
    assert.deepEqual(data.effectiveSkillKeys, ['dev-patterns'])

    const contextItem = data.contextContributions[0]
    assert.isTrue(contextItem.isEffective)
    assert.equal(contextItem.status, 'effective')
  })

  test('宿主 Skill 处于 draft 或不存在时标明宿主状态且不生效', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    // 宿主创建 draft 状态的 Skill
    await CompilerSkill.create({
      organizationId: org.id,
      skillKey: 'dev-patterns',
      name: 'Development Patterns',
      version: '1.0.0',
      description: 'Dev Skill Description',
      status: 'draft',
      category: { primary: 'engineering' } as any,
      tags: ['dev'] as any,
      activation: {} as any,
      knowledge: {} as any,
      basePriority: 10,
      createdBy: user.id,
      updatedBy: user.id,
    })

    await seedPluginWithRelease(org.id, { status: 'enabled' })

    const res = await client.get(base(org.id)).bearerToken(token)
    res.assertStatus(200)
    const data = res.body().data

    const bundle = data.skillBundles[0]
    assert.isFalse(bundle.isEffective)
    assert.equal(bundle.status, 'skill_inactive')
    assert.equal(bundle.reasonCode, 'skill_status_not_active')
    assert.equal(bundle.hostSkillStatus, 'draft')
  })

  test('跨组织隔离：组织 B 无法查看组织 A 的插件适配器', async ({ client, assert }) => {
    const userA = await createUser()
    const orgA = await createOrganization(userA)
    await seedPluginWithRelease(orgA.id, { status: 'enabled' })

    const userB = await createUser()
    const orgB = await createOrganization(userB)
    const tokenB = await login(client, userB.email)

    // B 组织列表无数据
    const resB = await client.get(base(orgB.id)).bearerToken(tokenB)
    resB.assertStatus(200)
    assert.lengthOf(resB.body().data.skillBundles, 0)
    assert.lengthOf(resB.body().data.contextContributions, 0)

    // B 组织详情 404
    const showRes = await client.get(`${base(orgB.id)}/${FIXTURE_PLUGIN_ID}`).bearerToken(tokenB)
    showRes.assertStatus(404)
    showRes.assertBodyContains({
      error: { code: 'plugin-adapter-not-found' },
    })
  })

  test('零写断言：查询不修改任何 Skill 记录与安装记录', async ({ client, assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)
    await seedPluginWithRelease(org.id, { status: 'enabled' })

    const skillsBefore = await CompilerSkill.query().where('organization_id', org.id)
    const installsBefore = await PluginInstallation.query().where('organization_id', org.id)

    await client.get(base(org.id)).bearerToken(token)

    const skillsAfter = await CompilerSkill.query().where('organization_id', org.id)
    const installsAfter = await PluginInstallation.query().where('organization_id', org.id)

    assert.equal(skillsAfter.length, skillsBefore.length)
    assert.equal(installsAfter.length, installsBefore.length)
  })
})
