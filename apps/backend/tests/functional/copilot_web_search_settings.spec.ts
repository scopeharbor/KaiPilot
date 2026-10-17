/**
 * v3-copilot-optional-web-search-configuration —— Copilot 网页搜索设置 API 功能测试。
 *
 * 覆盖（设计 B / spec §1）：默认关闭、secret-safe（GET 永不回 credential）、
 * 无权限 403、更新生效 + 审计、validator 拒绝非法域名、status 配额。
 *
 * 隔离策略（沿用 ai_quality_cost_console_threshold_change 先例）：
 * - 不使用 useAuthDatabase（其每测试 truncate 与并行测试冲突）；
 * - 合并为单个 test 内部串行，场景间用唯一 org + user（uniqueEmail），互不清理；
 * - token 由 TokenService 直签，避免登录接口的限流与并行写。
 */

import { test } from '@japa/runner'
import AiConnection from '#models/ai_connection'
import CryptoService from '#services/crypto_service'
import TokenService from '#services/token_service'
import AuditLog from '#models/audit_log'
import OrganizationMember from '#models/organization_member'
import AppService from '@adonisjs/core/services/app'
import { createOrganization, createUser, uniqueEmail } from './auth/_helpers.js'

const BASE = '/api/v1/settings/copilot-tools/web-search'

test.group('Copilot 网页搜索设置 API（v3-copilot-optional-web-search-configuration）', (group) => {
  let tokenSvc: TokenService

  group.each.setup(async () => {
    tokenSvc = await AppService.container.make(TokenService)
  })

  async function makeOwner() {
    const user = await createUser({ email: uniqueEmail('ws-owner') })
    const org = await createOrganization(user)
    const organizationId = Number(org.id)
    const token = await tokenSvc.generateAccessToken({
      sub: user.id,
      organizationId,
      roleVersion: 0,
      permissions: [],
    })
    return { organizationId, userId: user.id, token, org }
  }

  test('设置 API：默认关闭 + secret-safe + 权限 + 审计 + validator + 配额', async ({
    client,
    assert,
  }) => {
    // ── 场景 1：未认证 401 ──────────────────────────────────────────
    const anon = await client.get(BASE)
    anon.assertStatus(401)

    // ── 场景 2：默认关闭、无 credential、按次同意锁定 ────────────────
    const owner = await makeOwner()
    const getDefault = await client.get(BASE).header('Authorization', `Bearer ${owner.token}`)
    getDefault.assertStatus(200)
    const d = getDefault.body().data
    assert.equal(d.enabled, false)
    // 默认提供方 = 免费公开搜索（无需密钥），开箱即已配置；总开关仍默认关闭
    assert.equal(d.configured, true)
    assert.equal(d.providerKind, 'free')
    assert.equal(d.providerKeyConfigured, false)
    assert.include(d.maskedProviderLabel ?? '', '免费')
    assert.equal(d.requirePerTurnConsent, true)
    assert.equal(d.allowForAiCreate, false)
    assert.equal(d.allowForGeneralCopilot, false)
    assert.equal(d.dailyQueryLimit, 50)
    assert.notMatch(JSON.stringify(getDefault.body()), /api[_A-Z]?key|credential|secretValue/i)

    // ── 场景 3：member 无管理权限 → 403（非泄露语义） ─────────────────
    const member = await createUser({ email: uniqueEmail('ws-member') })
    await OrganizationMember.create({
      organizationId: owner.organizationId,
      userId: member.id,
      role: 'member',
    })
    const memberToken = await tokenSvc.generateAccessToken({
      sub: member.id,
      organizationId: owner.organizationId,
      roleVersion: 0,
      permissions: [],
    })
    const denied = await client
      .put(BASE)
      .header('Authorization', `Bearer ${memberToken}`)
      .json({ enabled: true })
    denied.assertStatus(403)

    // ── 场景 4：配置 provider 后 GET 只回 configured + masked，永不含 key ──
    const encrypted = new CryptoService().encrypt('sk-secret-material')
    const conn = await AiConnection.create({
      organizationId: owner.organizationId,
      displayName: '搜索服务商',
      protocol: 'openai_compatible',
      apiKeyEncrypted: encrypted,
      model: 'default',
      isActive: true,
    })
    const updated = await client
      .put(BASE)
      .header('Authorization', `Bearer ${owner.token}`)
      .json({
        enabled: true,
        providerConnectionId: Number(conn.id),
        allowedDomains: ['example.com', '*.gov.cn'],
        deniedDomains: ['spam.example.com'],
        dailyQueryLimit: 100,
        maxResultsPerQuery: 3,
        allowForGeneralCopilot: true,
      })
    updated.assertStatus(200)
    const up = updated.body().data
    assert.equal(up.enabled, true)
    assert.equal(up.allowedDomainCount, 2)
    assert.equal(up.deniedDomainCount, 1)
    assert.equal(up.dailyQueryLimit, 100)
    assert.equal(up.requirePerTurnConsent, true)

    const getAfter = await client.get(BASE).header('Authorization', `Bearer ${owner.token}`)
    getAfter.assertStatus(200)
    const g = getAfter.body().data
    assert.equal(g.configured, true)
    assert.equal(g.providerConnectionId, Number(conn.id))
    assert.include(g.maskedProviderLabel ?? '', '••••')
    assert.notInclude(JSON.stringify(getAfter.body()), 'sk-secret-material')
    assert.notProperty(g, 'apiKey')
    assert.notProperty(g, 'keyHint')

    // ── 场景 4b：切换到需要密钥的提供方：密钥只写、加密保存，GET 只回末四位 ──
    const tavily = await client
      .put(BASE)
      .header('Authorization', `Bearer ${owner.token}`)
      .json({ providerKind: 'tavily', providerApiKey: 'tvly-secret-9876' })
    tavily.assertStatus(200)
    assert.equal(tavily.body().data.providerKind, 'tavily')
    assert.equal(tavily.body().data.providerKeyConfigured, true)
    assert.equal(tavily.body().data.providerKeyHint, '…9876')
    assert.notInclude(JSON.stringify(tavily.body()), 'tvly-secret')
    const cleared = await client
      .put(BASE)
      .header('Authorization', `Bearer ${owner.token}`)
      .json({ providerApiKey: '' })
    assert.equal(cleared.body().data.providerKeyConfigured, false)

    // ── 场景 5：审计落账（低敏，无 secret 字段） ─────────────────────
    const auditRows = await AuditLog.query()
      .where('organization_id', owner.organizationId)
      .where('action', 'update')
      .orderBy('id', 'desc')
      .limit(5)
    const auditRow = auditRows.find((row) => {
      const m = (row.metadata ?? {}) as Record<string, unknown>
      return m.event === 'COPILOT_WEB_SEARCH_SETTINGS_UPDATED'
    })
    assert.isNotNull(auditRow)
    const meta = (auditRow!.metadata ?? {}) as Record<string, unknown>
    assert.equal(meta.enabled, true)
    for (const forbidden of ['apiKey', 'credential', 'secret', 'providerKey']) {
      assert.notProperty(meta, forbidden)
    }

    // ── 场景 6：validator 拒绝非法域名 422 ──────────────────────────
    const badDomain = await client
      .put(BASE)
      .header('Authorization', `Bearer ${owner.token}`)
      .json({ allowedDomains: ['https://not-a-domain.example'] })
    badDomain.assertStatus(422)

    // ── 场景 7：status 配额（默认未消耗） ────────────────────────────
    const status = await client
      .get(`${BASE}/status`)
      .header('Authorization', `Bearer ${owner.token}`)
    status.assertStatus(200)
    const s = status.body().data
    assert.equal(s.quota.usedToday, 0)
    assert.equal(s.quota.limitToday, 100)
    assert.equal(s.quota.remainingToday, 100)
    assert.equal(s.enabled, true)
  })
})
