/**
 * v3-personal-edition-open-source-export §3.2 —— 个人版的 AI 连接由使用者自行配置。
 *
 * 未注册平台统一 AI 配置扩展点时（开源个人版）：
 * - free 组织所有者不需要平台管理员授权，就能直接新增 AI 连接；
 * - 解析器只用组织自己的连接，不查「平台统一 AI 配置」组织；
 * - 部署者用 `OPENAI_API_KEY` 提供的实例级默认 Key 仍作为回退生效。
 *
 * 私有部署（企业 provider 已注册）的既有行为由 platform_ai_managed_connections.spec.ts 覆盖。
 */
import { test } from '@japa/runner'
import env from '#start/env'
import Organization from '#models/organization'
import OrganizationMember from '#models/organization_member'
import OrganizationSetting from '#models/organization_setting'
import RbacService from '#services/rbac_service'
import CopilotWebSearchSettingsService from '#services/copilot_web_search/settings_service'
import { COPILOT_WEB_SEARCH_SETTINGS_KEY, defaultCopilotWebSearchSettings } from '@aiproj/types'
import { resolveAdapter } from '#services/ai_m0/resolver'
import {
  registerEditionHooks,
  resetEditionHooksForTests,
  type EditionHooks,
} from '#services/edition/edition_registry'
import { STRONG_PASSWORD, createAiConnection, createUser } from '../unit/ai/_helpers.js'
import { useAuthDatabase } from './auth/_helpers.js'

/** 新注册用户的 free 个人组织（与 Google 登录自动建立的组织同形）。 */
async function createFreeOwner() {
  const user = await createUser()
  user.allowSelfAiConfig = false
  await user.save()
  const org = await Organization.create({
    ownerId: user.id,
    name: '个人空间',
    slug: `personal-${user.id}-${Date.now()}`,
    planTier: 'free',
  })
  await OrganizationMember.create({ organizationId: org.id, userId: user.id, role: 'owner' })
  return { user, org }
}

/** 私有部署才有的平台统一配置组织（这里只用来证明个人版解析器不会去查它）。 */
async function createPlatformLikeOrg() {
  const admin = await createUser({ isSuperAdmin: true })
  const org = await Organization.create({
    ownerId: admin.id,
    name: '平台统一 AI 配置',
    slug: 'platform-ai',
    planTier: 'enterprise',
  })
  const { conn } = await createAiConnection({ organizationId: Number(org.id) })
  return { org, conn }
}

test.group('个人版 · AI 连接由使用者自行配置', (group) => {
  useAuthDatabase(group)

  let previous: EditionHooks
  group.each.setup(() => {
    previous = resetEditionHooksForTests()
    return () => registerEditionHooks(previous)
  })

  test('free 组织所有者直接拥有 ai:connection:manage，并能新增 AI 连接', async ({
    client,
    assert,
  }) => {
    const { user, org } = await createFreeOwner()
    const permissions = await new RbacService().resolveOrganizationPermissions(user, Number(org.id))
    assert.isTrue(permissions.has('ai:connection:manage' as never))

    const login = await client
      .post('/api/v1/auth/login')
      .json({ email: user.email, password: STRONG_PASSWORD })
    login.assertStatus(200)
    const res = await client
      .post('/api/v1/ai/connections')
      .bearerToken(login.body().data.accessToken)
      .json({
        displayName: '自带模型',
        protocol: 'openai_compatible',
        apiKey: 'sk-test-personal-edition-key',
        model: 'gpt-5.4-mini',
      })
    res.assertStatus(201)
    assert.equal(res.body().data.displayName, '自带模型')
  })

  test('解析器只用组织自己的连接，不查平台统一配置组织', async ({ assert }) => {
    const { conn: platformConn } = await createPlatformLikeOrg()
    const { org } = await createFreeOwner()

    // 自己没有连接：不回退到平台组织的连接
    const none = await resolveAdapter({ organizationId: Number(org.id) })
    assert.notEqual(none.connectionId, platformConn.id)
    assert.notEqual(none.source, 'user')

    // 显式指定平台组织的连接：跨组织，不可用
    const byPlatformId = await resolveAdapter({
      connectionId: platformConn.id,
      organizationId: Number(org.id),
    })
    assert.isTrue(byPlatformId.unavailable)

    // 有自己的连接：直接使用
    const { conn: ownConn } = await createAiConnection({ organizationId: Number(org.id) })
    const own = await resolveAdapter({ organizationId: Number(org.id) })
    assert.equal(own.source, 'user')
    assert.equal(own.connectionId, ownConn.id)
  })

  test('没有组织连接时，部署者的 OPENAI_API_KEY 仍作为实例级默认回退', async ({ assert }) => {
    const { org } = await createFreeOwner()
    const before = env.get('OPENAI_API_KEY')
    env.set('OPENAI_API_KEY', 'sk-test-instance-default-key')
    try {
      const resolved = await resolveAdapter({ organizationId: Number(org.id) })
      assert.equal(resolved.source, 'fallback')
      assert.isTrue(resolved.usingRealAdapter)
    } finally {
      env.set('OPENAI_API_KEY', before ?? '')
    }
    const withoutKey = await resolveAdapter({ organizationId: Number(org.id) })
    assert.equal(withoutKey.source, 'mock')
  })

  test('网页搜索设置按组织自管，不沿用平台统一配置组织', async ({ assert }) => {
    const service = new CopilotWebSearchSettingsService()
    const platform = await createPlatformLikeOrg()
    const { org } = await createFreeOwner()
    const organizationId = Number(org.id)
    await writeWebSearchSettings(Number(platform.org.id), true)

    // 平台组织开启不影响个人版组织：自己未开启就不可用
    const off = await service.resolveEffective(organizationId)
    assert.equal(off.governance.mode, 'organization')
    assert.isFalse(off.settings.enabled)

    // 自己开启即可用，提供方与配额都记在自己组织名下
    await writeWebSearchSettings(organizationId, true)
    const on = await service.resolveEffective(organizationId)
    assert.isTrue(on.settings.enabled)
    assert.equal(on.providerOrganizationId, organizationId)
  })
})

async function writeWebSearchSettings(organizationId: number, enabled: boolean) {
  await OrganizationSetting.updateOrCreate(
    { organizationId, key: COPILOT_WEB_SEARCH_SETTINGS_KEY },
    {
      value: JSON.stringify({
        ...defaultCopilotWebSearchSettings(organizationId),
        enabled,
        allowForGeneralCopilot: enabled,
      }),
    },
  )
}
