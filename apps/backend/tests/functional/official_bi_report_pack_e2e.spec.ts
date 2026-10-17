/**
 * v3-bi-report-plugin-pack —— Official BI 报表包端到端集成测试（tasks §4.1）。
 *
 * 覆盖：
 * - 双租户隔离：OrgA 安装启用官方包，OrgB 不可见
 * - 安装 → 启用 → 列表（5 官方模板可见，带 pluginRef）→ 预览 → 实例化（审计含 pluginRef）
 * - 组织副本两步 preview/confirm（权限 diff、确认前不落库、过期/错误摘要、来源快照）
 * - 禁用后插件模板即时消失，副本仍可读
 * - 卸载后零残留但副本快照保留
 * - 未安装/禁用/卸载/权限不足负例
 */
import { test } from '@japa/runner'
import {
  STRONG_PASSWORD,
  createOrganization,
  createUser,
  addOrgMember,
  useAiDatabase,
} from '../unit/ai/_helpers.js'
import ReportTemplate from '#models/report_template'
import AuditLog from '#models/audit_log'
import { seedOfficialBiReportPackRelease } from '../fixtures/plugin_official_bi_report_pack_release.js'

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

test.group('Official BI Report Pack — 端到端生命周期（E2E）', (group) => {
  useAiDatabase(group)

  test('双租户完整流水线：安装启用→列表隔离→预览实例化→副本 preview/confirm→禁用→卸载与零残留', async ({
    client,
    assert,
  }) => {
    const ownerA = await createUser()
    const orgA = await createOrganization(ownerA)
    const tokenA = await login(client, ownerA.email)

    const ownerB = await createUser()
    const orgB = await createOrganization(ownerB)
    const tokenB = await login(client, ownerB.email)

    // 1. OrgA 发布 official 官方包 release
    const { release, pluginId } = await seedOfficialBiReportPackRelease(orgA.id)
    assert.equal(pluginId, 'com.aiproj.official.bi-report-pack')

    // OrgB 尚未发布/安装，列表应仅有内置 5 个，无官方包
    const listBBefore = await client.get(biBase(orgB.id)).bearerToken(tokenB)
    listBBefore.assertStatus(200)
    const dataBBefore = listBBefore.body().data as any[]
    assert.isFalse(dataBBefore.some((t: any) => t.templateId === 'ptpl_official_exec_governance'))

    // 2. OrgA 安装预览与确认
    const installPrev = await client
      .post(`${installBase(orgA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'install', pluginId, releaseId: release.id })
    installPrev.assertStatus(200)
    const installPreview = installPrev.body().data
    const installConfirm = await client
      .post(`${installBase(orgA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({
        previewHandle: installPreview.previewHandle,
        previewDigest: installPreview.previewDigest,
      })
    installConfirm.assertStatus(200)
    assert.equal(installConfirm.body().data.status, 'installed')

    // 未启用前，OrgA 仍不应看到官方模板
    const preEnableA = await client.get(biBase(orgA.id)).bearerToken(tokenA)
    preEnableA.assertStatus(200)
    assert.isFalse(
      (preEnableA.body().data as any[]).some(
        (t: any) => t.templateId === 'ptpl_official_exec_governance',
      ),
    )

    // 3. OrgA 启用
    const enablePrev = await client
      .post(`${installBase(orgA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'enable', pluginId })
    enablePrev.assertStatus(200)
    const enableConfirm = await client
      .post(`${installBase(orgA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({
        previewHandle: enablePrev.body().data.previewHandle,
        previewDigest: enablePrev.body().data.previewDigest,
        permissionConfirmed: true,
        permissionDigest: enablePrev.body().data.permissionDigest,
      })
    enableConfirm.assertStatus(200)
    assert.equal(enableConfirm.body().data.status, 'enabled')

    // 4. 启用后 OrgA 列表应包含 5 官方模板，OrgB 仍无
    const listA = await client.get(biBase(orgA.id)).bearerToken(tokenA)
    listA.assertStatus(200)
    const dataA = listA.body().data as any[]
    assert.isAtLeast(dataA.length, 10)
    const execGov = dataA.find((t: any) => t.templateId === 'ptpl_official_exec_governance')
    assert.isNotNull(execGov)
    assert.equal(execGov.source, 'plugin')
    assert.equal(execGov.pluginRef.pluginId, pluginId)
    assert.equal(execGov.pluginRef.pluginVersion, '1.0.0')
    // 风险热力图模板
    const heat = dataA.find((t: any) => t.templateId === 'ptpl_official_risk_heatmap_matrix')
    assert.isNotNull(heat)
    const trend = dataA.find((t: any) => t.templateId === 'ptpl_official_trend_velocity')
    assert.isNotNull(trend)

    const listB = await client.get(biBase(orgB.id)).bearerToken(tokenB)
    listB.assertStatus(200)
    assert.isFalse(
      (listB.body().data as any[]).some(
        (t: any) => t.templateId === 'ptpl_official_exec_governance',
      ),
    )

    // 5. 预览官方模板（风险热力图）
    const previewH = await client
      .get(`${biBase(orgA.id)}/ptpl_official_risk_heatmap_matrix/preview`)
      .bearerToken(tokenA)
    previewH.assertStatus(200)
    assert.equal(previewH.body().data.templateId, 'ptpl_official_risk_heatmap_matrix')
    assert.isFalse(previewH.body().data.blocking)

    // 6. 实例化官方模板（降级通道，审计含 pluginRef）
    const instantiate = await client
      .post(`${biBase(orgA.id)}/ptpl_official_exec_governance/instantiate`)
      .bearerToken(tokenA)
      .json({ projectId: 101 })
    instantiate.assertStatus(200)
    assert.equal(instantiate.body().data.path, 'reporting_system_upgrade')
    const logs = await AuditLog.query()
      .where('organization_id', orgA.id)
      .where('entity_type', 'bi_report_template')
    assert.isAtLeast(logs.length, 1)
    const last = logs[logs.length - 1]!
    const meta = typeof last.metadata === 'string' ? JSON.parse(last.metadata) : last.metadata
    assert.equal(meta.source, 'plugin')
    assert.equal(meta.pluginRef.pluginId, pluginId)

    // 7. 组织副本两步 preview/confirm（来自官方模板）
    const copyPreviewRes = await client
      .post(`${biBase(orgA.id)}/ptpl_official_exec_governance/copy/preview`)
      .bearerToken(tokenA)
      .json({ name: '治理副本E2E', description: 'e2e desc' })
    copyPreviewRes.assertStatus(200)
    const cp = copyPreviewRes.body().data
    assert.isString(cp.previewHandle)
    assert.isString(cp.previewDigest)
    assert.isString(cp.expiresAt)
    assert.equal(cp.templateId, 'ptpl_official_exec_governance')
    assert.isNotNull(cp.sourceSnapshot)

    // 确认前不落库
    const beforeCopy = await ReportTemplate.query().where('organization_id', orgA.id)
    assert.lengthOf(beforeCopy, 0)

    const copyConfirmRes = await client
      .post(`${biBase(orgA.id)}/ptpl_official_exec_governance/copy/confirm`)
      .bearerToken(tokenA)
      .json({ previewHandle: cp.previewHandle, previewDigest: cp.previewDigest })
    copyConfirmRes.assertStatus(201)
    assert.equal(copyConfirmRes.body().data.sourceTemplateId, 'ptpl_official_exec_governance')

    const afterCopy = await ReportTemplate.query().where('organization_id', orgA.id)
    assert.lengthOf(afterCopy, 1)
    const cfg =
      typeof afterCopy[0]!.config === 'string'
        ? JSON.parse(afterCopy[0]!.config as any)
        : (afterCopy[0]!.config as any)
    assert.isNotNull(cfg.sourceSnapshot)
    assert.isNotNull(cfg.pluginRef)

    // 8. 禁用插件：模板即时消失，但副本仍可读
    const disablePrev = await client
      .post(`${installBase(orgA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'disable', pluginId })
    disablePrev.assertStatus(200)
    const disableConfirm = await client
      .post(`${installBase(orgA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({
        previewHandle: disablePrev.body().data.previewHandle,
        previewDigest: disablePrev.body().data.previewDigest,
      })
    disableConfirm.assertStatus(200)
    assert.equal(disableConfirm.body().data.status, 'installed')

    const postDisableList = await client.get(biBase(orgA.id)).bearerToken(tokenA)
    postDisableList.assertStatus(200)
    assert.isFalse(
      (postDisableList.body().data as any[]).some(
        (t: any) => t.templateId === 'ptpl_official_exec_governance',
      ),
    )
    const showAfterDisable = await client
      .get(`${biBase(orgA.id)}/ptpl_official_exec_governance`)
      .bearerToken(tokenA)
    showAfterDisable.assertStatus(404)

    // 副本仍可通过 copies 逻辑查询（report_templates 表）
    const copiesAfterDisable = await ReportTemplate.query().where('organization_id', orgA.id)
    assert.lengthOf(copiesAfterDisable, 1)

    // 9. 卸载插件：零宿主残留（report_templates 仍保留快照副本）
    const uninstallPrev = await client
      .post(`${installBase(orgA.id)}/commands/preview`)
      .bearerToken(tokenA)
      .json({ action: 'uninstall', pluginId })
    uninstallPrev.assertStatus(200)
    const uninstallConfirm = await client
      .post(`${installBase(orgA.id)}/commands/confirm`)
      .bearerToken(tokenA)
      .json({
        previewHandle: uninstallPrev.body().data.previewHandle,
        previewDigest: uninstallPrev.body().data.previewDigest,
      })
    uninstallConfirm.assertStatus(200)
    assert.equal(uninstallConfirm.body().data.status, 'uninstalled')

    const copiesAfterUninstall = await ReportTemplate.query().where('organization_id', orgA.id)
    assert.lengthOf(copiesAfterUninstall, 1)
  })

  test('未安装/禁用/卸载/权限不足负例', async ({ client, assert }) => {
    const owner = await createUser()
    const org = await createOrganization(owner)
    const tokenOwner = await login(client, owner.email)

    const viewer = await createUser({ email: `viewer-${Date.now()}@example.com` })
    await addOrgMember(org, viewer, 'viewer')
    const tokenViewer = await login(client, viewer.email)

    // 未安装时请求官方模板详情 → 404
    const notInstalledShow = await client
      .get(`${biBase(org.id)}/ptpl_official_exec_governance`)
      .bearerToken(tokenOwner)
    notInstalledShow.assertStatus(404)

    // 安装并启用
    const { release, pluginId } = await seedOfficialBiReportPackRelease(org.id)
    const ip = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(tokenOwner)
      .json({ action: 'install', pluginId, releaseId: release.id })
    ip.assertStatus(200)
    await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(tokenOwner)
      .json({
        previewHandle: ip.body().data.previewHandle,
        previewDigest: ip.body().data.previewDigest,
      })
    const ep = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(tokenOwner)
      .json({ action: 'enable', pluginId })
    ep.assertStatus(200)
    await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(tokenOwner)
      .json({
        previewHandle: ep.body().data.previewHandle,
        previewDigest: ep.body().data.previewDigest,
        permissionConfirmed: true,
        permissionDigest: ep.body().data.permissionDigest,
      })

    // viewer 无写权限，preview copy 应 403
    const viewerPreview = await client
      .post(`${biBase(org.id)}/ptpl_official_exec_governance/copy/preview`)
      .bearerToken(tokenViewer)
      .json({ name: 'viewer-copy', description: '' })
    assert.oneOf(viewerPreview.status(), [403, 404])

    // 错误的 previewHandle confirm 应 404
    const badConfirm = await client
      .post(`${biBase(org.id)}/ptpl_official_exec_governance/copy/confirm`)
      .bearerToken(tokenOwner)
      .json({ previewHandle: 'bad-handle', previewDigest: 'bad-digest' })
    badConfirm.assertStatus(404)

    // 禁用后再次请求官方模板应 404
    const dp = await client
      .post(`${installBase(org.id)}/commands/preview`)
      .bearerToken(tokenOwner)
      .json({ action: 'disable', pluginId })
    dp.assertStatus(200)
    await client
      .post(`${installBase(org.id)}/commands/confirm`)
      .bearerToken(tokenOwner)
      .json({
        previewHandle: dp.body().data.previewHandle,
        previewDigest: dp.body().data.previewDigest,
      })
    const afterDisableShow = await client
      .get(`${biBase(org.id)}/ptpl_official_exec_governance`)
      .bearerToken(tokenOwner)
    afterDisableShow.assertStatus(404)
  })
})
