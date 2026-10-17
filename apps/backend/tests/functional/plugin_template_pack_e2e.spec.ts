/**
 * v3-template-as-plugin-package —— Pilot 模板包端到端集成测试（tasks §7.3）。
 *
 * 完整验证流程：
 * 1. 私有目录发布/注入 approved release
 * 2. 安装预览（preview）校验影响面与 permissionDigest
 * 3. 确认安装（confirm），状态进入 installed
 * 4. 启用预览与确认（enable），进入 enabled
 * 5. 查询 BI 报表模板列表，2 个插件模板均在列表中（带 source: 'plugin' 与 pluginRef）
 * 6. 聚合预览插件模板（GET /preview），返回各数据源 freshness 与图表定义
 * 7. 实例化预填插件模板（POST /instantiate），走 reporting_system_upgrade 降级通道且写入 provenance 审计
 * 8. 停用插件（disable），模板即时从列表中消失，详情返回 404
 * 9. 卸载插件（uninstall），report_templates 业务表零变更
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import ReportTemplate from '#models/report_template'
import AuditLog from '#models/audit_log'
import {
  seedPilotTemplatePackRelease,
  PILOT_TEMPLATE_PACK_PLUGIN_ID,
} from '../fixtures/plugin_template_pack_pilot_release.js'

function installBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/plugin-installations`
}

function biBase(orgId: number | string): string {
  return `/api/v1/organizations/${orgId}/bi/report-templates`
}

async function login(client: any, email: string): Promise<string> {
  const res = await client.post('/api/v1/auth/login').json({ email, password: STRONG_PASSWORD })
  res.assertStatus(200)
  return res.body().data.accessToken as string
}

test.group('PluginTemplatePack — 端到端集成生命周期（E2E）', (group) => {
  useAiDatabase(group)

  test('发布 → 安装 → 启用 → 列表 → 预览 → 实例化 → 停用 → 卸载 完整流水线', async ({
    client,
    assert,
  }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const token = await login(client, user.email)

    // 1. 模拟私有目录 Release 审批通过
    const { release, pluginId } = await seedPilotTemplatePackRelease(org.id)
    assert.equal(pluginId, PILOT_TEMPLATE_PACK_PLUGIN_ID)

    // 2. 安装预览
    const installPrevRes = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'install',
        pluginId,
        releaseId: release.id,
      })
    installPrevRes.assertStatus(200)
    const installPreview = installPrevRes.body().data
    assert.equal(installPreview.pluginId, pluginId)
    assert.isString(installPreview.permissionDigest)
    assert.isString(installPreview.previewDigest)

    // 3. 安装确认
    const installConfirmRes = await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: installPreview.previewHandle,
        previewDigest: installPreview.previewDigest,
      })
    installConfirmRes.assertStatus(200)
    const installed = installConfirmRes.body().data
    assert.equal(installed.status, 'installed')
    assert.isNull(installed.permissionConfirmation)

    // 未启用前，BI 模板列表不应包含插件模板
    const preEnableListRes = await client.get(biBase(org.id)).bearerToken(token)
    preEnableListRes.assertStatus(200)
    const preEnableList = preEnableListRes.body().data
    assert.isFalse(
      preEnableList.some(
        (t: { templateId: string }) => t.templateId === 'ptpl_pilot_delivery_governance',
      ),
    )

    // 4. 启用预览与确认
    const enablePrevRes = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'enable',
        pluginId,
      })
    enablePrevRes.assertStatus(200)
    const enablePreview = enablePrevRes.body().data

    const enableConfirmRes = await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: enablePreview.previewHandle,
        previewDigest: enablePreview.previewDigest,
        permissionConfirmed: true,
        permissionDigest: enablePreview.permissionDigest,
      })
    enableConfirmRes.assertStatus(200)
    assert.equal(enableConfirmRes.body().data.status, 'enabled')

    // 5. 启用后查询 BI 模板列表
    const postEnableListRes = await client.get(biBase(org.id)).bearerToken(token)
    postEnableListRes.assertStatus(200)
    const postEnableList = postEnableListRes.body().data

    // 5 内置 + 2 插件 = 7 模板
    assert.isAtLeast(postEnableList.length, 7)
    const tpl1 = postEnableList.find(
      (t: { templateId: string }) => t.templateId === 'ptpl_pilot_delivery_governance',
    )
    const tpl2 = postEnableList.find(
      (t: { templateId: string }) => t.templateId === 'ptpl_pilot_risk_heatmap_drilldown',
    )

    assert.isNotNull(tpl1)
    assert.equal(tpl1.name, '交付治理全景报告')
    assert.equal(tpl1.source, 'plugin')
    assert.equal(tpl1.pluginRef?.pluginId, pluginId)

    assert.isNotNull(tpl2)
    assert.equal(tpl2.name, '风险穿透热力分析报告')
    assert.equal(tpl2.source, 'plugin')

    // 6. 聚合预览插件模板
    const prevTplRes = await client
      .get(`${biBase(org.id)}/ptpl_pilot_delivery_governance/preview`)
      .bearerToken(token)
    prevTplRes.assertStatus(200)
    const tplPreview = prevTplRes.body().data
    assert.equal(tplPreview.templateId, 'ptpl_pilot_delivery_governance')
    assert.isAtLeast(tplPreview.sources.length, 1)
    assert.isFalse(tplPreview.blocking)

    // 7. 实例化插件模板（降级通道）
    const instantiateRes = await client
      .post(`${biBase(org.id)}/ptpl_pilot_delivery_governance/instantiate`)
      .bearerToken(token)
      .json({ projectId: 101 })
    instantiateRes.assertStatus(200)
    assert.equal(instantiateRes.body().data.path, 'reporting_system_upgrade')
    assert.equal(instantiateRes.body().data.prefill.templateId, 'ptpl_pilot_delivery_governance')

    // 验证审计日志记录 provenance
    const auditLogs = await AuditLog.query()
      .where('organization_id', org.id)
      .where('entity_type', 'bi_report_template')
    assert.isAtLeast(auditLogs.length, 1)
    const lastLog = auditLogs[auditLogs.length - 1]!
    const meta =
      typeof lastLog.metadata === 'string' ? JSON.parse(lastLog.metadata) : lastLog.metadata
    assert.equal(meta.source, 'plugin')
    assert.equal(meta.pluginRef?.pluginId, pluginId)

    // 8. 停用插件
    const disablePrevRes = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'disable',
        pluginId,
      })
    disablePrevRes.assertStatus(200)
    const disablePreview = disablePrevRes.body().data

    const disableConfirmRes = await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: disablePreview.previewHandle,
        previewDigest: disablePreview.previewDigest,
      })
    disableConfirmRes.assertStatus(200)
    assert.equal(disableConfirmRes.body().data.status, 'installed')

    // 停用后模板即时消失
    const postDisableListRes = await client.get(biBase(org.id)).bearerToken(token)
    postDisableListRes.assertStatus(200)
    const postDisableList = postDisableListRes.body().data
    assert.isFalse(
      postDisableList.some(
        (t: { templateId: string }) => t.templateId === 'ptpl_pilot_delivery_governance',
      ),
    )

    const showAfterDisableRes = await client
      .get(`${biBase(org.id)}/ptpl_pilot_delivery_governance`)
      .bearerToken(token)
    showAfterDisableRes.assertStatus(404)

    // 9. 卸载插件
    const uninstallPrevRes = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(token)
      .json({
        action: 'uninstall',
        pluginId,
      })
    uninstallPrevRes.assertStatus(200)
    const uninstallPreview = uninstallPrevRes.body().data

    const uninstallConfirmRes = await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(token)
      .json({
        previewHandle: uninstallPreview.previewHandle,
        previewDigest: uninstallPreview.previewDigest,
      })
    uninstallConfirmRes.assertStatus(200)
    assert.equal(uninstallConfirmRes.body().data.status, 'uninstalled')

    // 验证 report_templates 业务表零变更（保持为 0）
    const reportTemplates = await ReportTemplate.query().where('organization_id', org.id)
    assert.equal(reportTemplates.length, 0)
  })
})
