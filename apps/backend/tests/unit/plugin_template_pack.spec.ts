/**
 * v3-template-as-plugin-package —— PluginTemplatePackService 单元测试（tasks §4.5）。
 *
 * 覆盖：
 * - enabled 插件解析出有效模板贡献与完整构成
 * - installed（未启用）与 uninstalled（已卸载）不解析贡献
 * - 损坏负载 isolate-drop 降级
 * - 跨组织强隔离（组织 A 安装的插件在组织 B 绝不可见）
 * - metadata 缺贡献时安全返回空
 * - getPluginTemplate 详情获取
 *
 * 纪律：使用 useAiDatabase() / truncate 生命周期，零网络、零真实外部动作。
 */
import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { createOrganization, createUser, useAiDatabase } from './ai/_helpers.js'
import PluginTemplatePackService from '#services/plugin_template_pack_service'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import {
  PLUGIN_SEAM_TEMPLATE_PACK,
  PILOT_TEMPLATE_PACK_PAYLOAD,
  NEGATIVE_TEMPLATE_PACK_FIXTURES,
} from '@aiproj/types'

const TEST_PLUGIN_ID = 'com.aiproj.pilot-template-pack'
const TEST_VERSION = '1.0.0'

async function seedTemplatePackPlugin(
  organizationId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    pluginId?: string
    version?: string
    payload?: unknown
    corruptMetadata?: boolean
  } = {},
) {
  const pluginId = opts.pluginId ?? TEST_PLUGIN_ID
  const version = opts.version ?? TEST_VERSION
  const status = opts.status ?? 'enabled'
  const payload = opts.payload !== undefined ? opts.payload : PILOT_TEMPLATE_PACK_PAYLOAD

  const metadata = opts.corruptMetadata
    ? 'invalid-json'
    : JSON.stringify({
        contributions: [
          {
            contributionKey: 'pilot-bi-templates',
            seamKey: PLUGIN_SEAM_TEMPLATE_PACK,
            seamVersion: '1.0.0',
            title: 'Pilot BI Templates',
            payload,
          },
        ],
      })

  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: pluginId,
    version,
    packageDigest: 'sha256:pkg-tpl-001',
    manifestDigest: 'sha256:manifest-tpl-001',
    compatibilityDigest: 'sha256:compat-tpl-001',
    upstreamReceiptRef: 'receipt-uuid-tpl-1',
    status: 'approved',
    metadata,
    rowVersion: 1,
  })

  const installation = await PluginInstallation.create({
    organizationId,
    pluginId,
    version,
    releaseId: release.id,
    status,
    permissionConfirmation:
      status === 'enabled'
        ? {
            confirmedBy: '1',
            permissionDigest: 'sha256:test-perm-digest',
            permissionKeys: ['report:view'],
            confirmedAt: DateTime.now().toISO()!,
          }
        : null,
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    rowVersion: 1,
    uninstalledAt: status === 'uninstalled' ? DateTime.now() : null,
  })

  return { release, installation }
}

async function createTestOrg() {
  const user = await createUser()
  return createOrganization(user)
}

test.group('PluginTemplatePackService — 单元测试', (group) => {
  useAiDatabase(group)

  test('enabled 插件能成功解析出模板贡献，携带 source=plugin 与 pluginRef', async ({ assert }) => {
    const org = await createTestOrg()
    await seedTemplatePackPlugin(org.id, { status: 'enabled' })

    const service = new PluginTemplatePackService()
    const templates = await service.listPluginTemplates(org.id)

    assert.lengthOf(templates, 2)
    const first = templates[0]
    assert.equal(first.templateId, 'ptpl_pilot_delivery_governance')
    assert.equal(first.source, 'plugin')
    assert.isFalse(first.builtin)
    assert.isFalse(first.isCopy)
    assert.isNotNull(first.pluginRef)
    assert.equal(first.pluginRef?.pluginId, TEST_PLUGIN_ID)
    assert.equal(first.pluginRef?.pluginVersion, TEST_VERSION)
    assert.equal(first.name, '交付治理全景报告')
    assert.equal(first.category, 'execution')
    assert.equal(first.scenario, 'weekly_review')

    const second = templates[1]
    assert.equal(second.templateId, 'ptpl_pilot_risk_heatmap_drilldown')
    assert.equal(second.source, 'plugin')
    assert.equal(second.category, 'risk')
  })

  test('按 category 过滤插件模板', async ({ assert }) => {
    const org = await createTestOrg()
    await seedTemplatePackPlugin(org.id, { status: 'enabled' })

    const service = new PluginTemplatePackService()
    const execTemplates = await service.listPluginTemplates(org.id, { category: 'execution' })
    assert.lengthOf(execTemplates, 1)
    assert.equal(execTemplates[0].templateId, 'ptpl_pilot_delivery_governance')

    const riskTemplates = await service.listPluginTemplates(org.id, { category: 'risk' })
    assert.lengthOf(riskTemplates, 1)
    assert.equal(riskTemplates[0].templateId, 'ptpl_pilot_risk_heatmap_drilldown')

    const milestoneTemplates = await service.listPluginTemplates(org.id, { category: 'milestone' })
    assert.lengthOf(milestoneTemplates, 0)
  })

  test('installed（未启用）与 uninstalled（已卸载）状态不解析模板', async ({ assert }) => {
    const org = await createTestOrg()
    await seedTemplatePackPlugin(org.id, { status: 'installed', pluginId: 'plugin-installed' })
    await seedTemplatePackPlugin(org.id, { status: 'uninstalled', pluginId: 'plugin-uninstalled' })

    const service = new PluginTemplatePackService()
    const templates = await service.listPluginTemplates(org.id)
    assert.lengthOf(templates, 0)
  })

  test('损坏负载 isolate-drop 降级：不抛异常且安全返回空', async ({ assert }) => {
    const org = await createTestOrg()
    // 注入无效 ID 前缀负例负载
    await seedTemplatePackPlugin(org.id, {
      status: 'enabled',
      payload: NEGATIVE_TEMPLATE_PACK_FIXTURES.invalidIdPrefix,
    })

    const service = new PluginTemplatePackService()
    const templates = await service.listPluginTemplates(org.id)
    assert.lengthOf(templates, 0)
  })

  test('corrupt JSON metadata isolate-drop 降级', async ({ assert }) => {
    const org = await createTestOrg()
    await seedTemplatePackPlugin(org.id, {
      status: 'enabled',
      corruptMetadata: true,
    })

    const service = new PluginTemplatePackService()
    const templates = await service.listPluginTemplates(org.id)
    assert.lengthOf(templates, 0)
  })

  test('跨组织强隔离：组织 A 安装的插件在组织 B 绝不可见', async ({ assert }) => {
    const orgA = await createTestOrg()
    const orgB = await createTestOrg()

    await seedTemplatePackPlugin(orgA.id, { status: 'enabled' })

    const service = new PluginTemplatePackService()
    const templatesA = await service.listPluginTemplates(orgA.id)
    const templatesB = await service.listPluginTemplates(orgB.id)

    assert.lengthOf(templatesA, 2)
    assert.lengthOf(templatesB, 0)
  })

  test('getPluginTemplate 获取单个模板详情与构成', async ({ assert }) => {
    const org = await createTestOrg()
    await seedTemplatePackPlugin(org.id, { status: 'enabled' })

    const service = new PluginTemplatePackService()
    const result = await service.getPluginTemplate(org.id, 'ptpl_pilot_delivery_governance')

    assert.isNotNull(result)
    assert.equal(result!.entry.templateId, 'ptpl_pilot_delivery_governance')
    assert.equal(result!.def.name, '交付治理全景报告')
    assert.include(result!.def.composition.dataSourceKeys, 'organization_dashboard')
    assert.lengthOf(result!.def.composition.charts, 3)

    const notFound = await service.getPluginTemplate(org.id, 'ptpl_non_existent')
    assert.isNull(notFound)
  })
})
