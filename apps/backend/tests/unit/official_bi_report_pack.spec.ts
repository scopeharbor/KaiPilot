/**
 * v3-bi-report-plugin-pack — Official BI 报表包单元测试（tasks §2.1–2.3, §3.1）。
 *
 * 覆盖：
 * - 官方包 payload 校验与 digest
 * - 启用后模板可见、来源徽标与确定性排序
 * - 分页与分类过滤
 * - 组织强隔离
 * - 只读映射（风险热力图/趋势数据源走 allowlist）
 * - 人物维度权限 diff 标注
 * - 禁止任意查询（未知 templateId 返回 null/空）
 *
 * 纪律：使用 useAiDatabase / truncate 生命周期，零网络、零真实外部动作。
 */
import { test } from '@japa/runner'
import { createOrganization, createUser, useAiDatabase } from './ai/_helpers.js'
import PluginTemplatePackService from '#services/plugin_template_pack_service'
import { BiTemplateLibraryService } from '#services/bi_report_templates/template_library_service'
import {
  OFFICIAL_BI_REPORT_PACK_PAYLOAD,
  OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
  computeTemplatePackDigest,
  validateTemplatePackPayload,
} from '@aiproj/types'
import { BI_DATASOURCE_KEY_VALUES, BI_TEMPLATE_ID_VALUES } from '@aiproj/types'
import { seedOfficialBiReportPackRelease } from '../fixtures/plugin_official_bi_report_pack_release.js'
import PluginInstallation from '#models/plugin_installation'
import { DateTime } from 'luxon'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'

async function seedEnabledOfficialPack(organizationId: number) {
  const { release } = await seedOfficialBiReportPackRelease(organizationId)
  const installation = await PluginInstallation.create({
    organizationId,
    pluginId: OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    version: '1.0.0',
    releaseId: release.id,
    status: 'enabled',
    permissionConfirmation: {
      confirmedBy: '1',
      permissionDigest: 'sha256:official-test',
      permissionKeys: ['report:view'],
      confirmedAt: DateTime.now().toISO()!,
    },
    packageDigest: release.packageDigest,
    manifestDigest: release.manifestDigest,
    compatibilityDigest: release.compatibilityDigest,
    rowVersion: 1,
    uninstalledAt: null,
  })
  return { release, installation }
}

async function createTestOrg() {
  const user = await createUser()
  return { user, org: await createOrganization(user) }
}

test.group('Official BI Report Pack — 官方包与模板库聚合（单元）', (group) => {
  useAiDatabase(group)

  test('官方包 payload 校验通过且 digest 稳定', async ({ assert }) => {
    const res = validateTemplatePackPayload(OFFICIAL_BI_REPORT_PACK_PAYLOAD, {
      knownDataSourceKeys: BI_DATASOURCE_KEY_VALUES,
      knownBuiltinTemplateIds: BI_TEMPLATE_ID_VALUES,
    })
    assert.isTrue(res.valid)
    assert.lengthOf(
      res.findings.filter((f) => f.severity === 'blocking'),
      0,
    )
    const d1 = computeTemplatePackDigest(OFFICIAL_BI_REPORT_PACK_PAYLOAD)
    const d2 = computeTemplatePackDigest(OFFICIAL_BI_REPORT_PACK_PAYLOAD)
    assert.equal(d1, d2)
  })

  test('启用官方包后目录可见 5 个插件模板且携带 pluginRef 与来源标识', async ({ assert }) => {
    const { org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)

    const list = await lib.listTemplates(org.id)
    // 5 内置 + 5 官方 = 10
    assert.isAtLeast(list.data.length, 10)
    const official = list.data.filter(
      (t) => t.pluginRef?.pluginId === OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    )
    assert.lengthOf(official, 5)
    for (const t of official) {
      assert.equal(t.source, 'plugin')
      assert.isFalse(t.builtin)
      assert.isFalse(t.isCopy)
      assert.isNotNull(t.pluginRef)
      assert.equal(t.pluginRef?.pluginVersion, '1.0.0')
    }
    // 确定性排序：内置在前，插件居中
    const firstPluginIdx = list.data.findIndex((t) => t.source === 'plugin')
    const lastBuiltinIdx = list.data.map((t) => t.source).lastIndexOf('builtin')
    assert.isBelow(lastBuiltinIdx, firstPluginIdx)
    // 插件模板按 templateId 排序稳定（归一化）
    const officialIds = official.map((t) => t.templateId)
    const sorted = [...officialIds].sort()
    assert.deepEqual(officialIds, sorted)
  })

  test('分类与分页：风险类与分页正确', async ({ assert }) => {
    const { org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)

    const riskOnly = await lib.listTemplates(org.id, { category: 'risk' })
    // 内置 risk_analysis + 官方 risk_heatmap_matrix = 2
    const riskIds = riskOnly.data.map((t) => t.templateId)
    assert.include(riskIds, 'risk_analysis')
    assert.include(riskIds, 'ptpl_official_risk_heatmap_matrix')

    const page1 = await lib.listTemplates(org.id, { page: 1, perPage: 3 })
    assert.equal(page1.data.length, 3)
    assert.equal(page1.meta.page, 1)
    assert.equal(page1.meta.perPage, 3)
    assert.isAtLeast(page1.meta.total, 10)
    const page2 = await lib.listTemplates(org.id, { page: 2, perPage: 3 })
    assert.equal(page2.data.length, 3)
    // 分页无重叠
    const ids1 = page1.data.map((t) => t.templateId)
    const ids2 = page2.data.map((t) => t.templateId)
    assert.isFalse(ids1.some((id) => ids2.includes(id)))
  })

  test('组织隔离：A 组织启用官方包，B 组织不可见', async ({ assert }) => {
    const { org: orgA } = await createTestOrg()
    const { org: orgB } = await createTestOrg()

    await seedEnabledOfficialPack(orgA.id)

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)

    const listA = await lib.listTemplates(orgA.id)
    const listB = await lib.listTemplates(orgB.id)

    const officialA = listA.data.filter(
      (t) => t.pluginRef?.pluginId === OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    )
    const officialB = listB.data.filter(
      (t) => t.pluginRef?.pluginId === OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    )

    assert.lengthOf(officialA, 5)
    assert.lengthOf(officialB, 0)
  })

  test('未启用/已停用官方包时目录不包含插件模板', async ({ assert }) => {
    const { org } = await createTestOrg()
    const { release } = await seedOfficialBiReportPackRelease(org.id)
    // 创建 installed（未启用）安装
    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
      version: '1.0.0',
      releaseId: release.id,
      status: 'installed',
      permissionConfirmation: null,
      packageDigest: release.packageDigest,
      manifestDigest: release.manifestDigest,
      compatibilityDigest: release.compatibilityDigest,
      rowVersion: 1,
      uninstalledAt: null,
    })

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)

    const list = await lib.listTemplates(org.id)
    const official = list.data.filter(
      (t) => t.pluginRef?.pluginId === OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    )
    assert.lengthOf(official, 0)
  })

  test('风险热力图与趋势模板映射到 allowlist 数据源', async ({ assert }) => {
    const { org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)

    const heatmap = await lib.getTemplate(org.id, 'ptpl_official_risk_heatmap_matrix')
    assert.isNotNull(heatmap)
    // 通过库预览应成功（placeholder fresh）
    const previewH = await lib.previewTemplate(org.id, 'ptpl_official_risk_heatmap_matrix')
    assert.equal(previewH.templateId, 'ptpl_official_risk_heatmap_matrix')
    assert.isFalse(previewH.blocking)

    const trend = await lib.getTemplate(org.id, 'ptpl_official_trend_velocity')
    assert.isNotNull(trend)
    const previewT = await lib.previewTemplate(org.id, 'ptpl_official_trend_velocity')
    assert.equal(previewT.templateId, 'ptpl_official_trend_velocity')
    assert.isFalse(previewT.blocking)
  })

  test('人物维度模板标注 requiresExtraPermission', async ({ assert }) => {
    const { org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const service = new PluginTemplatePackService()
    const res = await service.getPluginTemplate(org.id, 'ptpl_official_team_perf_trend')
    assert.isNotNull(res)
    assert.isTrue(res!.def.personDimensionRequiresExtraPermission)
    assert.include(res!.def.composition.dimensionKeys, 'person')
  })

  test('未知模板返回 null 且预览返回 blocking warning', async ({ assert }) => {
    const { org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)

    const missing = await lib.getTemplate(org.id, 'ptpl_unknown_not_exist')
    assert.isNull(missing)

    const preview = await lib.previewTemplate(org.id, 'ptpl_unknown_not_exist')
    assert.isTrue(preview.blocking)
    assert.equal(preview.sources.length, 0)
  })

  test('损坏负载 isolate-drop：不抛异常且目录回退到仅内置', async ({ assert }) => {
    const { org } = await createTestOrg()
    // 注入损坏 metadata（非 JSON）
    const badRelease = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
      version: '1.0.0',
      packageDigest: 'sha256:bad',
      manifestDigest: 'sha256:bad-manifest',
      compatibilityDigest: 'sha256:bad-compat',
      upstreamReceiptRef: 'receipt-bad',
      status: 'approved',
      metadata: 'invalid-json',
      rowVersion: 1,
    })
    await PluginInstallation.create({
      organizationId: org.id,
      pluginId: OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
      version: '1.0.0',
      releaseId: badRelease.id,
      status: 'enabled',
      permissionConfirmation: {
        confirmedBy: '1',
        permissionDigest: 'sha256:test',
        permissionKeys: ['report:view'],
        confirmedAt: DateTime.now().toISO()!,
      },
      packageDigest: badRelease.packageDigest,
      manifestDigest: badRelease.manifestDigest,
      compatibilityDigest: badRelease.compatibilityDigest,
      rowVersion: 1,
      uninstalledAt: null,
    })

    const service = new PluginTemplatePackService()
    const lib = new BiTemplateLibraryService(service)
    const list = await lib.listTemplates(org.id)
    // 仅内置 5 个，无插件
    const official = list.data.filter(
      (t) => t.pluginRef?.pluginId === OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    )
    assert.lengthOf(official, 0)
    assert.isAtLeast(list.data.length, 5)
  })
})

test.group('Official BI Report Pack — 组织副本 preview/confirm（单元）', (group) => {
  useAiDatabase(group)

  test('preview 插件模板不落库，返回 handle/digest/permissionDiff/快照', async ({ assert }) => {
    const { user, org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const pluginService = new PluginTemplatePackService()
    const { BiTemplateCopyService } = await import('#services/bi_report_templates/copy_service')
    const copyService = new BiTemplateCopyService(pluginService)

    const { default: ReportTemplateModel } = await import('#models/report_template')
    const before = await ReportTemplateModel.query().where('organization_id', org.id)
    assert.lengthOf(before, 0)

    const preview = await copyService.previewCopy(
      org.id,
      'ptpl_official_exec_governance',
      '我的治理副本',
      'desc',
      user.id,
      { hasPersonPermission: true },
    )
    assert.isString(preview.previewHandle)
    assert.isString(preview.previewDigest)
    assert.isString(preview.expiresAt)
    assert.equal(preview.templateId, 'ptpl_official_exec_governance')
    assert.equal(preview.sourceVersion, 1)
    assert.isFalse(preview.permissionDiff.requiresExtraPermission)
    assert.isNotNull(preview.sourceSnapshot)

    const afterPreview = await ReportTemplateModel.query().where('organization_id', org.id)
    assert.lengthOf(afterPreview, 0)

    const confirm = await copyService.confirmCopy(
      org.id,
      preview.previewHandle,
      preview.previewDigest,
      user.id,
    )
    assert.equal(confirm.sourceTemplateId, 'ptpl_official_exec_governance')
    assert.equal(confirm.sourceVersion, 1)
    assert.equal(confirm.name, '我的治理副本')

    const afterConfirm = await ReportTemplateModel.query().where('organization_id', org.id)
    assert.lengthOf(afterConfirm, 1)
    const rawCfg = afterConfirm[0]!.config as any
    const cfg = typeof rawCfg === 'string' ? JSON.parse(rawCfg) : rawCfg
    assert.isNotNull(cfg.sourceSnapshot)
    // 快照与插件来源均在 config 中，列 sourceTemplateId 由 DTO 覆盖
    assert.isNotNull(cfg.sourceSnapshot)
  })

  test('人物维度模板 preview 权限 diff 正确标注', async ({ assert }) => {
    const { user, org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const pluginService = new PluginTemplatePackService()
    const { BiTemplateCopyService } = await import('#services/bi_report_templates/copy_service')
    const copyService = new BiTemplateCopyService(pluginService)

    const previewNoPerm = await copyService.previewCopy(
      org.id,
      'ptpl_official_team_perf_trend',
      '团队副本',
      '',
      user.id,
      { hasPersonPermission: false },
    )
    assert.isTrue(previewNoPerm.permissionDiff.requiresExtraPermission)
    assert.isFalse(previewNoPerm.permissionDiff.hasPermission)

    const previewHasPerm = await copyService.previewCopy(
      org.id,
      'ptpl_official_team_perf_trend',
      '团队副本2',
      '',
      user.id,
      { hasPersonPermission: true },
    )
    assert.isTrue(previewHasPerm.permissionDiff.requiresExtraPermission)
    assert.isTrue(previewHasPerm.permissionDiff.hasPermission)
  })

  test('过期 preview 确认失败', async ({ assert }) => {
    const { user, org } = await createTestOrg()
    await seedEnabledOfficialPack(org.id)

    const pluginService = new PluginTemplatePackService()
    const { BiTemplateCopyService } = await import('#services/bi_report_templates/copy_service')
    const copyService = new BiTemplateCopyService(pluginService)

    const preview = await copyService.previewCopy(
      org.id,
      'ptpl_official_exec_governance',
      '过期副本',
      '',
      user.id,
      {
        hasPersonPermission: true,
      },
    )

    // 摘要不匹配应阻断
    try {
      await copyService.confirmCopy(org.id, preview.previewHandle, 'wrong-digest', user.id)
      assert.fail('应抛出摘要不匹配')
    } catch (err: any) {
      assert.equal(err.code, 'VALIDATION_ERROR')
    }

    // 注入已过期的 preview 验证过期阻断
    const expiredHandle = `expired-${Date.now()}`
    const expiredDigest = 'expired-digest'
    BiTemplateCopyService.__injectPreview({
      previewHandle: expiredHandle,
      previewDigest: expiredDigest,
      organizationId: org.id,
      templateId: 'ptpl_official_exec_governance',
      name: '过期副本2',
      description: '',
      createdBy: user.id,
      defSnapshot: OFFICIAL_BI_REPORT_PACK_PAYLOAD.templates[0] as any,
      pluginRef: { pluginId: OFFICIAL_BI_REPORT_PACK_PLUGIN_ID, pluginVersion: '1.0.0' },
      permissionDiff: { requiresExtraPermission: false, hasPermission: true },
      expiresAt: DateTime.now().minus({ minutes: 20 }),
      createdAt: DateTime.now().minus({ minutes: 30 }),
    } as any)

    try {
      await copyService.confirmCopy(org.id, expiredHandle, expiredDigest, user.id)
      assert.fail('应抛出过期')
    } catch (err: any) {
      assert.equal(err.code, 'VALIDATION_ERROR')
      assert.include(err.message, '过期')
    }
  })

  test('插件副本保存快照，卸载后仍可读', async ({ assert }) => {
    const { user, org } = await createTestOrg()
    const { release: ignoredRelease } = await seedEnabledOfficialPack(org.id)
    void ignoredRelease

    const pluginService = new PluginTemplatePackService()
    const { BiTemplateCopyService } = await import('#services/bi_report_templates/copy_service')
    const copyService = new BiTemplateCopyService(pluginService)

    const preview = await copyService.previewCopy(
      org.id,
      'ptpl_official_risk_heatmap_matrix',
      '风险副本',
      '',
      user.id,
      {
        hasPersonPermission: true,
      },
    )
    const copy = await copyService.confirmCopy(
      org.id,
      preview.previewHandle,
      preview.previewDigest,
      user.id,
    )
    assert.equal(copy.sourceTemplateId, 'ptpl_official_risk_heatmap_matrix')

    // 模拟卸载：更新安装状态为 uninstalled
    const inst = await PluginInstallation.query()
      .where('organization_id', org.id)
      .where('plugin_id', OFFICIAL_BI_REPORT_PACK_PLUGIN_ID)
      .first()
    assert.isNotNull(inst)
    inst!.status = 'uninstalled' as any
    inst!.uninstalledAt = DateTime.now() as any
    await inst!.save()

    // 模板库中插件模板已消失
    const lib = new BiTemplateLibraryService(pluginService)
    const afterUninstall = await lib.listTemplates(org.id)
    const officialAfter = afterUninstall.data.filter(
      (t) => t.pluginRef?.pluginId === OFFICIAL_BI_REPORT_PACK_PLUGIN_ID,
    )
    assert.lengthOf(officialAfter, 0)

    // 但组织副本仍可读
    const { default: ReportTemplate } = await import('#models/report_template')
    const copies = await ReportTemplate.query().where('organization_id', org.id)
    assert.lengthOf(copies, 1)
    assert.equal(copies[0]!.sourceTemplateId, 'ptpl_official_risk_heatmap_matrix')
    const cfg = copies[0]!.config as any
    assert.isNotNull(cfg.sourceSnapshot)
    assert.isNotNull(cfg.pluginRef)
  })
})
