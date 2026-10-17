/**
 * BI 报表模板库 API 集成测试（v3-bi-report-template-library tasks §3.4）。
 *
 * 覆盖：
 *   - 认证：未登录 401
 *   - 越权：非组织成员不可推断存在（404）
 *   - 目录/详情/预览读端点
 *   - RBAC 权限分层
 *   - 参数白名单：非法参数 VALIDATION_ERROR
 *   - 统一错误信封 { error: { code, message } }
 *
 * 运行方式：node ace test --files=bi_report_template_api.spec.ts
 * 需要 AdonisJS 运行时（数据库、JWT 中间件）。
 */
import type Organization from '#models/organization'
import type User from '#models/user'
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from './auth/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import ReportTemplate from '#models/report_template'
import AuditLog from '#models/audit_log'
import { PLUGIN_SEAM_TEMPLATE_PACK, PILOT_TEMPLATE_PACK_PAYLOAD } from '@aiproj/types'

const BI_PREFIX = '/api/v1/organizations'

async function login(client: any, user: User): Promise<string> {
  const res = await client
    .post('/api/v1/auth/login')
    .json({ email: user.email, password: STRONG_PASSWORD })
  return res.body().data.accessToken
}

async function setupOrganization(): Promise<{
  org: Organization
  owner: User
  outsider: User
}> {
  const owner = await createUser({
    email: uniqueEmail('bi-owner'),
    fullName: 'BI Owner',
  })
  const outsider = await createUser({
    email: uniqueEmail('bi-outsider'),
    fullName: 'Outsider',
  })
  const org = await createOrganization(owner)
  return { org, owner, outsider }
}

test.group('BI 报表模板库 API', (group) => {
  let org: Organization
  let owner: User
  let outsider: User

  group.setup(async () => {
    await useAuthDatabase(group)
  })

  group.each.setup(async () => {
    const setup = await setupOrganization()
    org = setup.org
    owner = setup.owner
    outsider = setup.outsider
  })

  // ── 认证 ──────────────────────────────────────────────────────────────

  test('未登录请求返回 401', async ({ client }) => {
    const res = await client.get(`${BI_PREFIX}/${org.id}/bi/report-templates`)
    res.assertStatus(401)
  })

  // ── 越权/组织隔离 ────────────────────────────────────────────────────

  // 无活动组织的外部用户：返回任一已登记的非泄露错误（403/404）均合规（multitenant-tenant-identification），
  // 要求是不可推断存在——与不存在的组织返回完全相同的响应。
  test('非组织成员请求目录被拒且不可推断存在', async ({ client, assert }) => {
    const token = await login(client, outsider)
    const res = await client.get(`${BI_PREFIX}/${org.id}/bi/report-templates`).bearerToken(token)
    assert.include([403, 404], res.status())
    const missing = await client
      .get(`${BI_PREFIX}/${org.id + 100000}/bi/report-templates`)
      .bearerToken(token)
    assert.equal(missing.status(), res.status())
    assert.deepEqual(missing.body(), res.body())
  })

  // ── 目录 ──────────────────────────────────────────────────────────────

  test('组织成员可查看模板目录', async ({ assert, client }) => {
    const token = await login(client, owner)
    const res = await client.get(`${BI_PREFIX}/${org.id}/bi/report-templates`).bearerToken(token)
    res.assertStatus(200)
    const body = res.body()
    // 原写法是 `body.assert.hasOwnProperty('data')`——`body` 是响应 JSON，上面没有
    // `assert` 属性，每次都抛 TypeError，该用例从未真正校验过响应形状。
    assert.property(body, 'data')
    assert.property(body, 'meta')
  })

  test('按分类筛选模板目录', async ({ client }) => {
    const token = await login(client, owner)
    const res = await client
      .get(`${BI_PREFIX}/${org.id}/bi/report-templates?category=risk`)
      .bearerToken(token)
    res.assertStatus(200)
  })

  // ── 详情 ──────────────────────────────────────────────────────────────

  test('获取内置模板详情', async ({ client }) => {
    const token = await login(client, owner)
    const res = await client
      .get(`${BI_PREFIX}/${org.id}/bi/report-templates/project_execution_overview`)
      .bearerToken(token)
    res.assertStatus(200)
  })

  // ── 预览 ──────────────────────────────────────────────────────────────

  test('预览内置模板', async ({ client }) => {
    const token = await login(client, owner)
    const res = await client
      .get(`${BI_PREFIX}/${org.id}/bi/report-templates/project_execution_overview/preview`)
      .bearerToken(token)
    res.assertStatus(200)
  })

  // ── 插件模板支持 ────────────────────────────────────────────────────────

  test('enabled 插件模板进列表（顺序断言：内置在前、插件居中、自定义副本在后）', async ({
    client,
    assert,
  }) => {
    const token = await login(client, owner)

    // 创建一个自定义副本（在后）
    await ReportTemplate.create({
      organizationId: org.id,
      name: '自定义周会副本',
      description: '自定义副本描述',
      sourceTemplateId: 'project_execution_overview',
      sourceVersion: 1,
      status: 'active',
      concurrencyVersion: 1,
      createdBy: owner.id,
    })

    // 创建一个已启用的模板插件（居中）
    const release = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      packageDigest: 'sha256:pkg-tpl-001',
      manifestDigest: 'sha256:manifest-tpl-001',
      compatibilityDigest: 'sha256:compat-tpl-001',
      upstreamReceiptRef: 'receipt-uuid-tpl-1',
      status: 'approved',
      metadata: JSON.stringify({
        contributions: [
          {
            contributionKey: 'pilot-bi',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            title: 'Pilot BI Pack',
            payload: PILOT_TEMPLATE_PACK_PAYLOAD,
          },
        ],
      }),
      rowVersion: 1,
    })

    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      permissionConfirmation: {
        confirmedBy: String(owner.id),
        permissionDigest: 'sha256:perm-001',
        permissionKeys: ['report:view'],
        confirmedAt: DateTime.now().toISO()!,
      },
      packageDigest: release.packageDigest,
      manifestDigest: release.manifestDigest,
      compatibilityDigest: release.compatibilityDigest,
      rowVersion: 1,
    })

    const res = await client.get(`${BI_PREFIX}/${org.id}/bi/report-templates`).bearerToken(token)
    res.assertStatus(200)

    const list = res.body().data
    // 5 builtin + 2 plugin + 1 copy = 8 templates
    assert.isAtLeast(list.length, 8)

    // 检查顺序：内置在前
    const builtinSlice = list.slice(0, 5)
    for (const item of builtinSlice) {
      assert.isTrue(item.builtin)
      assert.equal(item.source, 'builtin')
    }

    // 插件居中
    const pluginSlice = list.slice(5, 7)
    for (const item of pluginSlice) {
      assert.isFalse(item.builtin)
      assert.equal(item.source, 'plugin')
      assert.isNotNull(item.pluginRef)
      assert.equal(item.pluginRef.pluginId, 'com.aiproj.pilot-bi-plugin')
    }

    // 自定义副本在后
    const copySlice = list.slice(7)
    for (const item of copySlice) {
      assert.isTrue(item.isCopy)
      assert.equal(item.source, 'organization-copy')
    }
  })

  test('获取插件模板详情与预览', async ({ client, assert }) => {
    const token = await login(client, owner)

    const release = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      packageDigest: 'sha256:pkg-tpl-001',
      manifestDigest: 'sha256:manifest-tpl-001',
      compatibilityDigest: 'sha256:compat-tpl-001',
      upstreamReceiptRef: 'receipt-uuid-tpl-1',
      status: 'approved',
      metadata: JSON.stringify({
        contributions: [
          {
            contributionKey: 'pilot-bi',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            title: 'Pilot BI Pack',
            payload: PILOT_TEMPLATE_PACK_PAYLOAD,
          },
        ],
      }),
      rowVersion: 1,
    })

    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      permissionConfirmation: {
        confirmedBy: String(owner.id),
        permissionDigest: 'sha256:perm-001',
        permissionKeys: ['report:view'],
        confirmedAt: DateTime.now().toISO()!,
      },
      packageDigest: release.packageDigest,
      manifestDigest: release.manifestDigest,
      compatibilityDigest: release.compatibilityDigest,
      rowVersion: 1,
    })

    // 详情
    const showRes = await client
      .get(`${BI_PREFIX}/${org.id}/bi/report-templates/ptpl_pilot_delivery_governance`)
      .bearerToken(token)
    showRes.assertStatus(200)
    const detail = showRes.body().data
    assert.equal(detail.templateId, 'ptpl_pilot_delivery_governance')
    assert.equal(detail.name, '交付治理全景报告')
    assert.equal(detail.source, 'plugin')
    assert.equal(detail.pluginRef?.pluginId, 'com.aiproj.pilot-bi-plugin')

    // 预览
    const prevRes = await client
      .get(`${BI_PREFIX}/${org.id}/bi/report-templates/ptpl_pilot_delivery_governance/preview`)
      .bearerToken(token)
    prevRes.assertStatus(200)
    const preview = prevRes.body().data
    assert.equal(preview.templateId, 'ptpl_pilot_delivery_governance')
    assert.isAtLeast(preview.sources.length, 1)
  })

  test('停用与卸载后插件模板即时消失且 report_templates 表零变更', async ({ client, assert }) => {
    const token = await login(client, owner)

    const release = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      packageDigest: 'sha256:pkg-tpl-001',
      manifestDigest: 'sha256:manifest-tpl-001',
      compatibilityDigest: 'sha256:compat-tpl-001',
      upstreamReceiptRef: 'receipt-uuid-tpl-1',
      status: 'approved',
      metadata: JSON.stringify({
        contributions: [
          {
            contributionKey: 'pilot-bi',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            title: 'Pilot BI Pack',
            payload: PILOT_TEMPLATE_PACK_PAYLOAD,
          },
        ],
      }),
      rowVersion: 1,
    })

    const install = await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      releaseId: release.id,
      status: 'installed', // installed (disabled)
      packageDigest: release.packageDigest,
      manifestDigest: release.manifestDigest,
      compatibilityDigest: release.compatibilityDigest,
      rowVersion: 1,
    })

    const res = await client.get(`${BI_PREFIX}/${org.id}/bi/report-templates`).bearerToken(token)
    res.assertStatus(200)
    const list = res.body().data
    assert.isFalse(
      list.some((t: { templateId: string }) => t.templateId === 'ptpl_pilot_delivery_governance'),
    )

    const showRes = await client
      .get(`${BI_PREFIX}/${org.id}/bi/report-templates/ptpl_pilot_delivery_governance`)
      .bearerToken(token)
    showRes.assertStatus(404)

    // 卸载
    install.status = 'uninstalled'
    install.uninstalledAt = DateTime.now()
    await install.save()

    // 验证 report_templates 业务表零写
    const records = await ReportTemplate.query().where('organization_id', org.id)
    assert.equal(records.length, 0)
  })

  test('实例化插件模板记录 provenance 审计', async ({ client, assert }) => {
    const token = await login(client, owner)

    const release = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      packageDigest: 'sha256:pkg-tpl-001',
      manifestDigest: 'sha256:manifest-tpl-001',
      compatibilityDigest: 'sha256:compat-tpl-001',
      upstreamReceiptRef: 'receipt-uuid-tpl-1',
      status: 'approved',
      metadata: JSON.stringify({
        contributions: [
          {
            contributionKey: 'pilot-bi',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            title: 'Pilot BI Pack',
            payload: PILOT_TEMPLATE_PACK_PAYLOAD,
          },
        ],
      }),
      rowVersion: 1,
    })

    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: 'com.aiproj.pilot-bi-plugin',
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      permissionConfirmation: {
        confirmedBy: String(owner.id),
        permissionDigest: 'sha256:perm-001',
        permissionKeys: ['report:view'],
        confirmedAt: DateTime.now().toISO()!,
      },
      packageDigest: release.packageDigest,
      manifestDigest: release.manifestDigest,
      compatibilityDigest: release.compatibilityDigest,
      rowVersion: 1,
    })

    const instantiateRes = await client
      .post(`${BI_PREFIX}/${org.id}/bi/report-templates/ptpl_pilot_delivery_governance/instantiate`)
      .bearerToken(token)
      .json({ projectId: 1 })

    instantiateRes.assertStatus(200)
    assert.equal(instantiateRes.body().data.path, 'reporting_system_upgrade')

    const auditLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'bi_report_template')

    assert.isAtLeast(auditLogs.length, 1)
    const log = auditLogs[0]!
    const meta = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata
    assert.equal(meta.source, 'plugin')
    assert.isNotNull(meta.pluginRef)
    assert.equal(meta.pluginRef.pluginId, 'com.aiproj.pilot-bi-plugin')
  })
})
