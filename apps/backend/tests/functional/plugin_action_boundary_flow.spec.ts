/**
 * v3-plugin-action-preview-boundary —— 统一边界全流程功能测试
 * （tasks 2.4 / 2.6 / 3.2 / 3.3）。
 *
 * 覆盖：
 * - proposal → preview → confirm → receipt 全流程（pilot fixture domain）
 * - confirm 前正式表零写（zero-diff 基线）
 * - 目标 revision 并发变化 → stale 阻断且零写入
 * - 权限撤销 → confirm 拒绝（不得通过旧句柄提交）
 * - 句柄过期 → handle-expired
 * - 重复确认同幂等键 → 幂等重放同一 receipt，不重复写入
 * - reject/discard 零写入；modify 派生新提案、旧句柄失效
 * - dry-run blocking finding → 禁止签发/确认
 * - 安装禁用 → issue/confirm 阻断（install-not-enabled）
 * - 跨组织访问 → 统一 not-found（非泄露）
 */
import { test } from '@japa/runner'
import { createOrganization, createUser, useAiDatabase } from '../unit/ai/_helpers.js'
import { seedPilotPluginFull } from '../fixtures/plugin_hook_pilot_release.js'
import { PluginActionBoundaryService } from '#services/plugin_action_boundary/boundary_service'
import { ActionBoundaryError } from '#services/plugin_action_boundary/adapter_registry'
import PluginPilotItem from '#models/plugin_pilot_item'
import { fixturePilotProposal, type PluginActionProposal } from '@aiproj/types'

const PILOT_PLUGIN_ID = 'com.aiproj.pilot.actions'
const PILOT_VERSION = '1.0.0'
const FULL_PERMS = ['plugin_action:view', 'plugin_action:confirm']

interface SeedResult {
  organizationId: number
  installationId: number
}

async function seedOrgWithEnabledPlugin(): Promise<SeedResult> {
  const user = await createUser()
  const org = await createOrganization(user)
  const seeded = await seedPilotPluginFull(org.id, {
    pluginId: PILOT_PLUGIN_ID,
    version: PILOT_VERSION,
    installationStatus: 'enabled',
  })
  return { organizationId: org.id, installationId: seeded.installationId }
}

function pilotProposalFor(organizationId: number, installationId: number): PluginActionProposal {
  return fixturePilotProposal({
    scope: { organizationId, projectId: null },
    sourceRefs: [
      {
        surface: 'server-hook',
        pluginId: PILOT_PLUGIN_ID,
        pluginVersion: PILOT_VERSION,
        installationId,
        contributionKey: 'pilot-item-create',
        contentDigest: 'aa11bb22',
        capturedAt: '2026-08-24T07:59:00.000Z',
      },
    ],
  })
}

/**
 * 时间锚点必须相对**测试执行时刻**取值，不能写死历史时间戳：
 * `issueConfirmHandle` 的 preview 过期前置校验读真实 `Date.now()`（不看注入的 `nowIso`），
 * 固定时间戳一旦滑到过去，签发阶段就抛 `handle-expired`，后续断言永远走不到。
 * 整秒对齐以保持 `expiresAt` 的 `.000Z` 形态，让句柄 digest 重算逐字节一致。
 * `offsetSeconds` 用于表达「TTL 之后 / TTL 之内」这类相对时点。
 */
function anchorIso(offsetSeconds = 0): string {
  return new Date(Math.floor(Date.now() / 1000) * 1000 + offsetSeconds * 1000).toISOString()
}

async function countPilotItems(organizationId: number): Promise<number> {
  const dbModule = await import('@adonisjs/lucid/services/db')
  const Database = dbModule.default
  const rows = (await Database.from('plugin_pilot_items')
    .where('organization_id', organizationId)
    .count('* as total')) as unknown as Array<{ total: number }>
  return Number(rows[0]?.total ?? 0)
}

test.group('plugin-action boundary flow（pilot domain）', (group) => {
  useAiDatabase(group)

  test('全流程：proposal→preview→confirm→receipt 恰好写入一次并带审计 receipt', async ({
    assert,
  }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })

    // confirm 前正式表零写：preview 之后 pilot 条目仍为 0
    const preview = await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    assert.isTrue(preview.dryRun.canApply)
    assert.isTrue(preview.permissionSummary.granted)
    assert.lengthOf(preview.diffEntries, 2)
    assert.equal(await countPilotItems(organizationId), 0)

    const handle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    assert.isTrue(handle.handle.startsWith('pact-cfm-'))

    const outcome = await boundary.confirm({
      organizationId,
      proposalUid,
      handleValue: handle.handle,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    assert.equal(outcome.status, 'applied')
    assert.isNotNull(outcome.receipt)
    assert.isAbove(outcome.receipt!.auditLogId, 0)
    assert.lengthOf(outcome.receipt!.writtenRefs, 1)

    const items = await PluginPilotItem.forOrganization(organizationId)
    assert.lengthOf(items, 1)
    assert.equal(items[0].title, 'Fixture 试点条目')
    assert.equal(items[0].sourceProposalUid, proposalUid)
  })

  test('目标 revision 在 preview 后被并发修改 → confirm stale 阻断且零写入', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    const handle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    // 并发修改目标域：直接追加一条 pilot 条目，使 revision 前移
    await PluginPilotItem.create({
      organizationId,
      projectId: null,
      title: '并发写入',
      content: 'revision mover',
      createdBy: null,
    })

    let caught: unknown = null
    try {
      await boundary.confirm({
        organizationId,
        proposalUid,
        handleValue: handle.handle,
        actorUserId: 42,
        actorPermissions: FULL_PERMS,
        nowIso: anchorIso(),
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'preview-stale')

    // 只有并发那条，确认未产生新写入
    const items = await PluginPilotItem.forOrganization(organizationId)
    assert.lengthOf(items, 1)
    assert.equal(items[0].title, '并发写入')
  })

  test('权限在 preview 后被撤销 → confirm 拒绝，旧句柄不可提交', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    const handle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    let caught: unknown = null
    try {
      await boundary.confirm({
        organizationId,
        proposalUid,
        handleValue: handle.handle,
        actorUserId: 42,
        actorPermissions: ['plugin_action:view'], // confirm 权限已被撤销
        nowIso: anchorIso(),
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'permission-denied')
    assert.equal(await countPilotItems(organizationId), 0)
  })

  test('过期句柄 → handle-expired（不静默刷新）', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    const handle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    let caught: unknown = null
    try {
      // TTL 默认 600s：使用过期后的时间点确认
      await boundary.confirm({
        organizationId,
        proposalUid,
        handleValue: handle.handle,
        actorUserId: 42,
        actorPermissions: FULL_PERMS,
        nowIso: anchorIso(20 * 60), // 超出 600s TTL
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'handle-expired')
    assert.equal(await countPilotItems(organizationId), 0)
  })

  test('重复发送相同确认 → 幂等重放同一 receipt 且不重复写入', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    const handle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    const first = await boundary.confirm({
      organizationId,
      proposalUid,
      handleValue: handle.handle,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    assert.equal(first.status, 'applied')

    const replay = await boundary.confirm({
      organizationId,
      proposalUid,
      handleValue: handle.handle,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(60), // 仍在 TTL 内
    })
    assert.equal(replay.status, 'idempotent_replay')
    assert.deepEqual(replay.receipt, first.receipt)

    const items = await PluginPilotItem.forOrganization(organizationId)
    assert.lengthOf(items, 1)
  })

  test('reject/discard 零写入；attempting confirm on rejected 提案失败', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })

    const rejected = await boundary.decide({
      organizationId,
      projectId: null,
      proposalUid,
      actorUserId: 42,
      decision: 'reject',
    })
    assert.equal(rejected.status, 'rejected')

    let caught: unknown = null
    try {
      await boundary.confirm({
        organizationId,
        proposalUid,
        handleValue: 'pact-cfm-forged0000',
        actorUserId: 42,
        actorPermissions: FULL_PERMS,
        nowIso: anchorIso(),
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal(await countPilotItems(organizationId), 0)

    // discard 同样零写入
    const { proposalUid: uid2 } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    const discarded = await boundary.decide({
      organizationId,
      projectId: null,
      proposalUid: uid2,
      actorUserId: 42,
      decision: 'discard',
    })
    assert.equal(discarded.status, 'discarded')
    assert.equal(await countPilotItems(organizationId), 0)
  })

  test('modify 必须重新预览：派生新提案、原提案 stale、旧句柄失效', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    const oldPreview = await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    const oldHandle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    const modified = await boundary.decide({
      organizationId,
      projectId: null,
      proposalUid,
      actorUserId: 42,
      decision: 'modify',
      userModifiedValue: { title: '用户修改后的标题', content: '用户修改后的内容' },
    })
    assert.notEqual(modified.proposalUid, proposalUid)
    assert.equal(modified.status, 'proposed')

    // 新提案的 preview digest 必须不同于旧 digest（新值新预览）
    const newPreview = await boundary.generatePreview({
      organizationId,
      proposalUid: modified.proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    assert.notEqual(newPreview.previewDigest, oldPreview.previewDigest)

    // 旧句柄对新提案无效
    let caught: unknown = null
    try {
      await boundary.confirm({
        organizationId,
        proposalUid: modified.proposalUid,
        handleValue: oldHandle.handle,
        actorUserId: 42,
        actorPermissions: FULL_PERMS,
        nowIso: anchorIso(),
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.include(
      ['handle-invalid', 'handle-consumed'],
      (caught as ActionBoundaryError).reasonCode,
    )
    assert.equal(await countPilotItems(organizationId), 0)

    // 新值必须经新 preview 后才能确认（走完整链路可成功）
    const newHandle = await boundary.issueConfirmHandle({
      organizationId,
      proposalUid: modified.proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    const outcome = await boundary.confirm({
      organizationId,
      proposalUid: modified.proposalUid,
      handleValue: newHandle.handle,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    assert.equal(outcome.status, 'applied')
    const items = await PluginPilotItem.forOrganization(organizationId)
    assert.lengthOf(items, 1)
    assert.equal(items[0].title, '用户修改后的标题')
  })

  test('dry-run blocking finding 时禁止签发句柄与确认', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    const preview = await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })
    // 白盒注入 blocking finding（模拟 adapter dry-run 失败），验证门禁
    const proposalModule = await import('#models/plugin_action_proposal')
    const row = await proposalModule.default
      .forOrganization(organizationId)
      .where('proposal_uid', proposalUid)
      .firstOrFail()
    row.previewJson = {
      ...preview,
      dryRun: {
        canApply: true,
        findings: [{ code: 'dep-cycle', severity: 'blocking', message: '依赖环阻断' }],
      },
    }
    await row.save()

    let caught: unknown = null
    try {
      await boundary.issueConfirmHandle({
        organizationId,
        proposalUid,
        actorUserId: 42,
        actorPermissions: FULL_PERMS,
        nowIso: anchorIso(),
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'dry-run-blocking')
    assert.equal(await countPilotItems(organizationId), 0)
  })

  test('插件停用后 issue/confirm 阻断（disable/stale 边界）', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })
    await boundary.generatePreview({
      organizationId,
      proposalUid,
      actorUserId: 42,
      actorPermissions: FULL_PERMS,
      nowIso: anchorIso(),
    })

    // 停用安装态
    const installationModule = await import('#models/plugin_installation')
    const PluginInstallation = installationModule.default
    const installation = await PluginInstallation.findOrFail(installationId)
    installation.status = 'installed' // 停用
    await installation.save()

    let caught: unknown = null
    try {
      await boundary.issueConfirmHandle({
        organizationId,
        proposalUid,
        actorUserId: 42,
        actorPermissions: FULL_PERMS,
        nowIso: anchorIso(),
      })
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.equal((caught as ActionBoundaryError).reasonCode, 'install-not-enabled')
    assert.equal(await countPilotItems(organizationId), 0)
  })

  test('跨组织访问统一 not-found（非泄露）', async ({ assert }) => {
    const { organizationId, installationId } = await seedOrgWithEnabledPlugin()
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)
    const boundary = new PluginActionBoundaryService()

    const { proposalUid } = await boundary.registerProposal({
      organizationId,
      projectId: null,
      proposal: pilotProposalFor(organizationId, installationId),
      proposedBy: 1,
    })

    let caught: unknown = null
    try {
      await boundary.detail(otherOrg.id, proposalUid)
    } catch (error) {
      caught = error
    }
    assert.instanceOf(caught, ActionBoundaryError)
    assert.include((caught as ActionBoundaryError).message, 'not found')
  })
})
