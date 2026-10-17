/**
 * v3-plugin-approval-change-flow —— 三类 adapter 功能测试（tasks 3.1-3.8 核心断言）。
 *
 * 覆盖要求：
 * - 审批 ≠ 确认：审批通过但未确认时，安装态/grant/版本零变化
 * - 安装状态零变化直到提交；提交与可信审计 receipt 同一事务边界（D5）
 * - 审计失败整体回滚：零残留、原版本保持、可重试
 * - permission-upgrade：净提升默认 fail-closed、策略交集放行、平台红线拒绝、批量不洗白、低敏 diff
 * - version-upgrade：release 替换 → 提交失败且原版本保持；请求 failed 可重试
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from '../unit/ai/_helpers.js'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import AuditLog from '#models/audit_log'
import PluginChangeRequestService from '#services/plugin_change_request_service'
import { appendTrustedChangeAuditReceipt } from '#services/plugin_change_request_service'
import PluginInstallService from '#services/plugin_install_service'
import { PluginChangeAdapters } from '#services/plugin_change_adapters'
import AuditService from '#services/audit_service'
import type { PluginPermissionConfirmationSummary } from '@aiproj/types'

const PLUGIN_ID = 'org.example.dev-toolkit'

function buildCtx() {
  const audit = new AuditService()
  const installService = new PluginInstallService(audit)
  const changeService = new PluginChangeRequestService()
  return {
    audit,
    installService,
    changeService,
    adapters: new PluginChangeAdapters(installService, changeService, audit),
  }
}

const RELEASE_METADATA = JSON.stringify({
  name: 'Dev Toolkit',
  permissions: [
    {
      permissionKey: 'compiler:skill:view',
      seamKey: 's',
      sideEffect: 'read-only',
      network: 'none',
    },
    { permissionKey: 'compiler:run:view', seamKey: 's', sideEffect: 'read-only', network: 'none' },
  ],
})

async function seedRelease(
  organizationId: number,
  overrides?: Partial<{ version: string; compatibilityDigest: string }>,
) {
  return await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    version: overrides?.version ?? '1.2.0',
    packageDigest: 'sha256:pkg-001',
    manifestDigest: 'sha256:man-001',
    compatibilityDigest: overrides?.compatibilityDigest ?? 'sha256:compat-001',
    upstreamReceiptRef: 'receipt-1',
    status: 'approved',
    metadata: RELEASE_METADATA,
    rowVersion: 1,
  })
}

async function seedEnabledInstallation(input: {
  organizationId: number
  releaseId: number
  grantKeys?: string[]
}) {
  const summary: PluginPermissionConfirmationSummary = {
    confirmedBy: 'seed',
    permissionDigest: 'seed-digest',
    permissionKeys: input.grantKeys ?? ['compiler:skill:view'],
    confirmedAt: '2026-08-21T10:00:00.000Z',
  }
  return await PluginInstallation.create({
    organizationId: input.organizationId,
    pluginId: PLUGIN_ID,
    version: '1.2.0',
    releaseId: input.releaseId,
    status: 'enabled',
    permissionConfirmation: summary,
    packageDigest: 'sha256:pkg-001',
    manifestDigest: 'sha256:man-001',
    compatibilityDigest: 'sha256:compat-001',
    rowVersion: 1,
    uninstalledAt: null,
  })
}

/** 统一推进到可确认状态：previewed → （可选他人审批）→ 句柄。 */
async function driveToReady(
  ctx: ReturnType<typeof buildCtx>,
  organizationId: number,
  requestUid: string,
  opts: { approvalRequired: boolean; requesterId: number; checkerId?: number; executorId: number },
) {
  const pv = await ctx.changeService.attachPreview(organizationId, requestUid)
  if (!pv.ok) throw new Error('preview failed: ' + pv.code + ' ' + pv.message)
  if (opts.approvalRequired && opts.checkerId) {
    const ap = await ctx.changeService.approve(
      organizationId,
      requestUid,
      String(opts.checkerId),
      `ap:${requestUid}`,
    )
    if (!ap.ok) throw new Error('approve failed: ' + ap.code)
  }
  const h = await ctx.changeService.issueConfirmHandle(
    organizationId,
    requestUid,
    String(opts.executorId),
  )
  if (!h.ok) throw new Error('handle failed: ' + h.code)
  return h.data
}

/** 读被抛出错误上的 reason code（adapter 抛 PluginChangeRequestError，带 code 字段）。 */
function thrownCode(e: unknown): string {
  const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : ''
}

test.group('PluginChangeAdapters', (group) => {
  group.setup(() => testUtils.db().truncate())
  group.each.setup(() => testUtils.db().truncate())

  test('install：审批 ≠ 确认零变化 → 确认提交创建 + receipt 回填 + 重放 already-decided', async ({
    assert,
  }) => {
    const user = await createUser()
    const checker = await createUser()
    const org = await createOrganization(user)
    const ctx = buildCtx()
    const release = await seedRelease(org.id)

    const req = await ctx.adapters.createInstallLifecycleRequest({
      organizationId: org.id,
      projectId: null,
      requestedBy: user.id,
      kind: 'install',
      pluginId: PLUGIN_ID,
      releaseId: release.id,
      approvalRequired: true,
    })

    let rows = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(rows.length, 0, '预览阶段不得产生安装记录')

    const pv = await ctx.changeService.attachPreview(org.id, req.requestUid)
    if (!pv.ok) throw new Error('preview failed: ' + pv.code)
    await ctx.changeService.approve(
      org.id,
      req.requestUid,
      String(checker.id),
      `ap:${req.requestUid}`,
    )

    rows = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(rows.length, 0, '审批 ≠ 确认：审批后安装态必须保持不变')

    // 显式确认阶段：执行者取得一次性句柄
    const h = await ctx.changeService.issueConfirmHandle(org.id, req.requestUid, String(user.id))
    if (!h.ok) throw new Error('handle failed: ' + h.code)
    const handle = h.data

    const applyRes = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: req.requestUid,
      executorRef: String(user.id),
      handle: handle.handle,
      applyDelegate: ctx.adapters.buildInstallLifecycleApplyDelegate({
        organizationId: org.id,
        executorId: user.id,
      }),
    })
    if (!applyRes.ok)
      throw new Error('apply failed code=' + applyRes.code + ' msg=' + applyRes.message)
    assert.equal(applyRes.data.request.state, 'applied')
    assert.isNotNull(applyRes.data.receipt.auditLogId)

    const installations = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(installations.length, 1, '提交后恰好一条安装记录')
    assert.equal(installations[0].version, release.version)

    // applied 决策事件回填 receipt id
    const decisions = await ctx.changeService.listDecisions(org.id, req.id)
    assert.isOk(decisions.find((d) => d.event === 'applied' && d.auditLogId !== null))

    // 重放已消费句柄：终态幂等且不再触发领域写入
    const replay = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: req.requestUid,
      executorRef: String(user.id),
      handle: handle.handle,
      applyDelegate: async () => {
        throw new Error('must not be called')
      },
    })
    assert.isFalse(replay.ok)
    if (!replay.ok) assert.equal(replay.code, 'plugin-change-already-decided')
    assert.lengthOf(await PluginInstallation.query().where('organization_id', org.id), 1)
  })

  test('version-upgrade：release 替换后提交失败落 failed，原版本保持不变', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const ctx = buildCtx()
    const oldRelease = await seedRelease(org.id, { version: '1.2.0' })
    const inst = await seedEnabledInstallation({ organizationId: org.id, releaseId: oldRelease.id })
    const newRelease = await seedRelease(org.id, {
      version: '1.3.0',
      compatibilityDigest: 'sha256:compat-002',
    })

    const req = await ctx.adapters.createInstallLifecycleRequest({
      organizationId: org.id,
      projectId: null,
      requestedBy: user.id,
      kind: 'version-upgrade',
      pluginId: PLUGIN_ID,
      releaseId: newRelease.id,
      approvalRequired: false,
    })
    assert.equal(req.diffJson.versionDelta?.currentVersion, '1.2.0')
    assert.equal(req.diffJson.versionDelta?.targetVersion, '1.3.0')

    // 预览后 release 被替换（兼容性摘要被篡改）
    newRelease.compatibilityDigest = 'sha256:compat-TAMPERED'
    await newRelease.save()

    const handle = await driveToReady(ctx, org.id, req.requestUid, {
      approvalRequired: false,
      requesterId: user.id,
      executorId: user.id,
    })

    const res = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: req.requestUid,
      executorRef: String(user.id),
      handle: handle.handle,
      applyDelegate: ctx.adapters.buildInstallLifecycleApplyDelegate({
        organizationId: org.id,
        executorId: user.id,
      }),
    })
    assert.isFalse(res.ok, '替换后的 release 必须提交失败')

    const afterInst = await PluginInstallation.findOrFail(inst.id)
    assert.equal(afterInst.version, '1.2.0', '升级失败原版本必须保持')
    assert.equal(afterInst.rowVersion, 1)

    const afterReq = await ctx.changeService.getByUid(org.id, req.requestUid)
    assert.equal(afterReq.state, 'failed', '领域失败落 failed（可经重新预览重试）')

    // 重试路径：修复 release（恢复被篡改摘要）→ failed --previewed--> awaiting-confirmation
    // → 新句柄 → applied。共享层重放同一 preview 绑定，confirm 重验当前 release 状态一致。
    newRelease.compatibilityDigest = 'sha256:compat-002'
    await newRelease.save()
    const rePreview = await ctx.changeService.attachPreview(org.id, req.requestUid)
    if (!rePreview.ok) throw new Error('re-preview failed: ' + rePreview.code)
    const h2 = await ctx.changeService.issueConfirmHandle(org.id, req.requestUid, String(user.id))
    if (!h2.ok) throw new Error('handle failed: ' + h2.code)
    const retry = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: req.requestUid,
      executorRef: String(user.id),
      handle: h2.data.handle,
      applyDelegate: ctx.adapters.buildInstallLifecycleApplyDelegate({
        organizationId: org.id,
        executorId: user.id,
      }),
    })
    if (!retry.ok) throw new Error('retry failed code=' + retry.code + ' msg=' + retry.message)
    const upgraded = await PluginInstallation.findOrFail(inst.id)
    assert.equal(upgraded.version, '1.3.0', '重试成功后升级生效')
  })

  test('permission-upgrade：非提升刷新 grant；提升 fail-closed/策略放行/红线拒绝；批量不洗白', async ({
    assert,
  }) => {
    const user = await createUser()
    const checker = await createUser()
    const org = await createOrganization(user)
    const ctx = buildCtx()
    const release = await seedRelease(org.id)
    const inst = await seedEnabledInstallation({ organizationId: org.id, releaseId: release.id })

    // 1) 净新增默认 fail-closed（策略空集），安装态不变
    let deniedCode = ''
    try {
      await ctx.adapters.createPermissionUpgradeRequest({
        organizationId: org.id,
        projectId: null,
        requestedBy: user.id,
        pluginId: PLUGIN_ID,
        targetReleaseId: release.id,
        requestedKeys: ['compiler:skill:view', 'ocr:file:read'],
        policy: { actorAllowedKeys: [], orgPolicyAllowedKeys: [] },
      })
    } catch (e) {
      deniedCode = thrownCode(e)
    }
    assert.equal(deniedCode, 'plugin-change-permission-elevation-denied')
    const unchanged = await PluginInstallation.findOrFail(inst.id)
    assert.deepEqual(unchanged.permissionConfirmation?.permissionKeys, ['compiler:skill:view'])

    // 2) 平台红线：任何策略都不得授权 admin 类键
    let forbiddenCode = ''
    try {
      await ctx.adapters.createPermissionUpgradeRequest({
        organizationId: org.id,
        projectId: null,
        requestedBy: user.id,
        pluginId: PLUGIN_ID,
        targetReleaseId: release.id,
        requestedKeys: ['organization:manage'],
        policy: {
          actorAllowedKeys: ['organization:manage'],
          orgPolicyAllowedKeys: ['organization:manage'],
        },
      })
    } catch (e) {
      forbiddenCode = thrownCode(e)
    }
    assert.equal(forbiddenCode, 'plugin-change-permission-elevation-denied')

    // 3) 非提升（同集）：免提升语义，仍走完整流程，grant 刷新
    const same = await ctx.adapters.createPermissionUpgradeRequest({
      organizationId: org.id,
      projectId: null,
      requestedBy: user.id,
      pluginId: PLUGIN_ID,
      targetReleaseId: release.id,
      requestedKeys: ['compiler:skill:view'],
      policy: { actorAllowedKeys: [], orgPolicyAllowedKeys: [] },
    })
    const hSame = await driveToReady(ctx, org.id, same.requestUid, {
      approvalRequired: true,
      requesterId: user.id,
      checkerId: checker.id,
      executorId: user.id,
    })
    const applied = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: same.requestUid,
      executorRef: String(user.id),
      handle: hSame.handle,
      applyDelegate: ctx.adapters.buildPermissionUpgradeApplyDelegate({
        organizationId: org.id,
        requestedKeys: ['compiler:skill:view'],
      }),
    })
    if (!applied.ok) throw new Error('non-elevation apply failed: ' + applied.code)
    const refreshed = await PluginInstallation.findOrFail(inst.id)
    assert.deepEqual(refreshed.permissionConfirmation?.permissionKeys, ['compiler:skill:view'])
    assert.equal(refreshed.permissionConfirmation?.confirmedBy, String(user.id))
    assert.notEqual(refreshed.rowVersion, inst.rowVersion, 'grant 边界刷新必须前进行版本')

    // 4) 策略交集放行提升：diff 低敏（仅 key 清单，无 metadata 原文）、强制审批
    const elevated = await ctx.adapters.createPermissionUpgradeRequest({
      organizationId: org.id,
      projectId: null,
      requestedBy: user.id,
      pluginId: PLUGIN_ID,
      targetReleaseId: release.id,
      requestedKeys: ['compiler:skill:view', 'ocr:file:read'],
      policy: {
        actorAllowedKeys: ['compiler:skill:view', 'ocr:file:read'],
        orgPolicyAllowedKeys: ['compiler:skill:view', 'ocr:file:read'],
      },
    })
    assert.equal(elevated.approvalRequired, true)
    assert.isTrue(elevated.diffJson.permissionDelta?.added.includes('ocr:file:read'))
    assert.isFalse(JSON.stringify(elevated.diffJson).includes('"metadata"'))

    const hElev = await driveToReady(ctx, org.id, elevated.requestUid, {
      approvalRequired: true,
      requesterId: user.id,
      checkerId: checker.id,
      executorId: user.id,
    })
    const appliedElev = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: elevated.requestUid,
      executorRef: String(user.id),
      handle: hElev.handle,
      applyDelegate: ctx.adapters.buildPermissionUpgradeApplyDelegate({
        organizationId: org.id,
        requestedKeys: ['compiler:skill:view', 'ocr:file:read'],
      }),
    })
    if (!appliedElev.ok) throw new Error('elevation apply failed: ' + appliedElev.code)
    const elevatedInst = await PluginInstallation.findOrFail(inst.id)
    assert.deepEqual(elevatedInst.permissionConfirmation?.permissionKeys, [
      'compiler:skill:view',
      'ocr:file:read',
    ])

    // 5) 批量不洗白：含违规键的成员被各自拒绝，合规成员不受影响
    const results = await Promise.allSettled([
      ctx.adapters.createPermissionUpgradeRequest({
        organizationId: org.id,
        projectId: null,
        requestedBy: user.id,
        pluginId: PLUGIN_ID,
        targetReleaseId: release.id,
        requestedKeys: ['secret:admin'],
        policy: {
          actorAllowedKeys: ['secret:admin'],
          orgPolicyAllowedKeys: ['secret:admin'],
        },
      }),
      ctx.adapters.createPermissionUpgradeRequest({
        organizationId: org.id,
        projectId: null,
        requestedBy: user.id,
        pluginId: PLUGIN_ID,
        targetReleaseId: release.id,
        requestedKeys: ['compiler:skill:view', 'compiler:run:view'],
        policy: {
          actorAllowedKeys: ['compiler:run:view'],
          orgPolicyAllowedKeys: ['compiler:run:view'],
        },
      }),
    ])
    assert.equal(results[0].status, 'rejected', '红线键批量成员必须被拒')
    assert.equal(results[1].status, 'fulfilled', '合规成员不受影响')
  })

  test('审计失败整体回滚：安装零残留、请求 failed、无审计行', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const ctx = buildCtx()
    const release = await seedRelease(org.id)

    const req = await ctx.adapters.createInstallLifecycleRequest({
      organizationId: org.id,
      projectId: null,
      requestedBy: user.id,
      kind: 'install',
      pluginId: PLUGIN_ID,
      releaseId: release.id,
      approvalRequired: false,
    })
    const handle = await driveToReady(ctx, org.id, req.requestUid, {
      approvalRequired: false,
      requesterId: user.id,
      executorId: user.id,
    })

    const res = await ctx.changeService.confirmAndApply({
      organizationId: org.id,
      requestUid: req.requestUid,
      executorRef: String(user.id),
      handle: handle.handle,
      applyDelegate: async ({ request, trx }) => {
        // 模拟领域提交后审计边界失败：同事务先写审计再抛错 → 整体回滚
        await appendTrustedChangeAuditReceipt({
          organizationId: request.organizationId,
          projectId: request.projectId,
          userId: null,
          action: 'apply',
          requestUid: request.requestUid,
          metadata: { note: 'rollback-me' },
          client: trx,
        })
        throw new Error('simulated failure after audit write')
      },
    })
    assert.isFalse(res.ok)
    if (!res.ok) assert.equal(res.code, 'plugin-change-apply-failed')

    const installations = await PluginInstallation.query().where('organization_id', org.id)
    assert.equal(installations.length, 0, '回滚后不得有安装记录')

    const audits = await AuditLog.query()
      .where('entityType', 'plugin_change_request')
      .where('action', 'apply')
    assert.equal(audits.length, 0, '回滚后不得有审计残留')

    const after = await ctx.changeService.getByUid(org.id, req.requestUid)
    assert.equal(after.state, 'failed')
  })
})
