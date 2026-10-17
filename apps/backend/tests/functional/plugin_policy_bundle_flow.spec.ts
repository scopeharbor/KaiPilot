/**
 * v3-plugin-policy-bundles —— 统一插件变更流适配测试（任务 3.2）。
 *
 * 覆盖：
 * - 受影响角色/操作/permission 的有界影响摘要（不含实体名称）
 * - 审批 ≠ 确认（approve 后仍需显式确认句柄；self-approval 拒绝）
 * - stale/replay：错误句柄、已消费请求的重复确认
 * - 审计失败整体回滚（fail-closed：无 bundle 行、无激活行、request 落 failed）
 * - happy path：copy → approve → handle → confirmAndApply → 快照可装载且 digest 一致
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { createOrganization, createUser } from '../unit/ai/_helpers.js'
import PluginChangeRequestService from '#services/plugin_change_request_service'
import PluginPolicyBundleService, {
  buildPolicyImpactSummary,
} from '#services/plugin_policy_bundle_service'
import PluginChangeRequest from '#models/plugin_change_request'
import PluginPolicyBundle from '#models/plugin_policy_bundle'
import PluginPolicyBundleActivation from '#models/plugin_policy_bundle_activation'
import type { PluginPolicyBundleRule } from '@aiproj/types'

function flow(): PluginChangeRequestService {
  return new PluginChangeRequestService()
}
function svc(): PluginPolicyBundleService {
  return new PluginPolicyBundleService(flow())
}

/** 推进到 awaiting-confirmation 并返回句柄。 */
async function driveToHandle(
  organizationId: number,
  requestUid: string,
  approverRef: string,
  executorRef: string,
): Promise<string> {
  const f = flow()
  const approved = await f.approve(organizationId, requestUid, approverRef, `apr:${requestUid}`)
  if (!approved.ok) throw new Error(`approve failed: ${approved.code}`)
  const handle = await f.issueConfirmHandle(organizationId, requestUid, executorRef)
  if (!handle.ok) throw new Error(`handle failed: ${handle.code}`)
  return handle.data.handle
}

test.group('PluginPolicyBundleService 变更流', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('copy 影响摘要有界且进入统一流；收紧性校验拒绝放宽副本', async ({ assert }) => {
    const user = await createUser()
    const org = await createOrganization(user)
    const s = svc()

    const res = await s.requestCopyFromTemplate({
      organizationId: org.id,
      templateId: 'member-readonly',
      requestedBy: `user:${user.id}`,
    })
    assert.isTrue(res.ok)
    if (!res.ok) return
    assert.equal(res.summary.bounded, true)
    assert.isTrue(res.summary.rolesAffected.length > 0)
    assert.deepEqual(
      res.summary.operationsAffected.sort(),
      [
        'command-proposal',
        'compiler-contribution',
        'execute',
        'resolve-query',
        'skill-adapter',
        'ui-slot',
      ]
        .filter((op) => res.summary.operationsAffected.includes(op))
        .sort(),
    )
    // 成员对 manage 权限的显式 deny 出现在摘要中
    assert.includeMembers(res.summary.permissionKeysAffected, ['plugin_install:manage'])

    const row = await PluginChangeRequest.query()
      .where('organization_id', org.id)
      .where('request_uid', res.requestUid)
      .first()
    assert.equal(row?.kind, 'policy-bundle-change')
    assert.equal(row?.state, 'pending-approval')

    // 放宽副本：把成员 manage deny 翻成 allow → 拒绝且不产生 request
    const templateRules = JSON.parse(JSON.stringify(res.document.rules)) as PluginPolicyBundleRule[]
    const loosened = templateRules.map((r) =>
      r.role === 'member' && r.permissionKey === 'plugin_install:manage'
        ? { ...r, effect: 'allow' as const }
        : r,
    )
    const beforeCount = await PluginChangeRequest.query().countDistinct('id')
    const rejectRes = await s.requestCopyFromTemplate({
      organizationId: org.id,
      templateId: 'member-readonly',
      requestedBy: `user:${user.id}`,
      rulesOverride: loosened,
    })
    assert.isFalse(rejectRes.ok)
    if (!rejectRes.ok) assert.equal(rejectRes.code, 'policy-template-expansion')
    const afterCount = await PluginChangeRequest.query().countDistinct('id')
    assert.equal(
      beforeCount[0].$extras['distinct("id")'] ?? beforeCount[0].$extras.total,
      afterCount[0].$extras['distinct("id")'] ?? afterCount[0].$extras.total,
    )
  })

  test('审批≠确认与 self-approval 拒绝；stale/replay fail closed', async ({ assert }) => {
    const maker = await createUser()
    const checker = await createUser()
    const org = await createOrganization(maker)
    const s = svc()
    const res = await s.requestCopyFromTemplate({
      organizationId: org.id,
      templateId: 'pm-enabled',
      requestedBy: `user:${maker.id}`,
    })
    assert.isTrue(res.ok)
    if (!res.ok) return

    // 发起人自批 → maker-checker 拒绝
    const selfApproval = await flow().approve(org.id, res.requestUid, `user:${maker.id}`, 'k1')
    assert.isFalse(selfApproval.ok)
    if (!selfApproval.ok) assert.equal(selfApproval.code, 'plugin-change-self-approval-denied')

    // 不同人审批通过；确认前 bundle 零落库
    const handle = await driveToHandle(
      org.id,
      res.requestUid,
      `user:${checker.id}`,
      `user:${maker.id}`,
    )
    const preApply = await PluginPolicyBundle.findVersion(org.id, 'org-copy.pm-enabled', 1)
    assert.isNull(preApply, '确认前组织副本零状态变化')

    // 错误句柄 → stale
    const badHandle = await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: res.requestUid,
      executorRef: `user:${maker.id}`,
      handle: 'chg-cfm-forged-1',
      applyDelegate: s.buildApplyDelegate({
        action: 'copy',
        document: res.document,
        digest: res.digest,
      }),
    })
    assert.isFalse(badHandle.ok)
    if (!badHandle.ok) assert.equal(badHandle.code, 'plugin-change-stale')

    // 正确确认 → applied；重放同一请求 → already-decided
    const apply = await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: res.requestUid,
      executorRef: `user:${maker.id}`,
      handle,
      applyDelegate: s.buildApplyDelegate({
        action: 'copy',
        document: res.document,
        digest: res.digest,
      }),
    })
    assert.equal(apply.ok, true, apply.ok ? '' : `apply failed: ${JSON.stringify(apply)}`)
    const replay = await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: res.requestUid,
      executorRef: `user:${maker.id}`,
      handle,
      applyDelegate: s.buildApplyDelegate({
        action: 'copy',
        document: res.document,
        digest: res.digest,
      }),
    })
    assert.isFalse(replay.ok)
    if (!replay.ok) assert.equal(replay.code, 'plugin-change-already-decided')

    // 幂等：版本行只有一条；激活 active revision=1；快照装载成功且 digest 与请求一致
    const versions = await PluginPolicyBundle.query()
      .where('organization_id', org.id)
      .where('bundle_id', 'org-copy.pm-enabled')
    assert.equal(versions.length, 1)
    const activation = await PluginPolicyBundleActivation.findForOrganization(org.id)
    assert.equal(activation?.status, 'active')
    assert.equal(activation?.revision, 1)
    const loaded = await s.loadVerifiedSnapshot(org.id)
    assert.equal(loaded.state, 'ok')
    if (loaded.state === 'ok') {
      assert.equal(loaded.snapshot.digest, res.digest)
      assert.equal(loaded.snapshot.revision, 1)
    }
    void handle
  })

  test('审计失败整体回滚：无 bundle 行、无激活行、request 落 failed 且可重试', async ({
    assert,
  }) => {
    const maker = await createUser()
    const checker = await createUser()
    const org = await createOrganization(maker)
    const s = svc()
    const res = await s.requestCopyFromTemplate({
      organizationId: org.id,
      templateId: 'admin-managed',
      requestedBy: `user:${maker.id}`,
    })
    assert.isTrue(res.ok)
    if (!res.ok) return
    const handle = await driveToHandle(
      org.id,
      res.requestUid,
      `user:${checker.id}`,
      `user:${maker.id}`,
    )

    // delegate 先写 bundle 行再抛审计失败 → 整体回滚
    const failingDelegate = async ({ trx }: { trx: any }) => {
      await PluginPolicyBundle.create(
        {
          organizationId: org.id,
          bundleId: res.document.bundleId,
          sourceTemplateId: res.document.sourceTemplateId ?? 'admin-managed',
          sourceTemplateVersion: res.document.sourceTemplateVersion ?? 1,
          version: 1,
          descriptionZh: res.document.descriptionZh,
          rulesJson: res.document.rules,
          documentDigest: res.digest,
        },
        { client: trx },
      )
      throw new Error('audit write failed')
    }
    const apply = await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: res.requestUid,
      executorRef: `user:${maker.id}`,
      handle,
      applyDelegate: failingDelegate,
    })
    assert.isFalse(apply.ok)

    // 回滚断言：无残留 bundle 行 / 无激活行；request 落 failed
    assert.isNull(await PluginPolicyBundle.findVersion(org.id, res.document.bundleId, 1))
    assert.isNull(await PluginPolicyBundleActivation.findForOrganization(org.id))
    const row = await PluginChangeRequest.query()
      .where('organization_id', org.id)
      .where('request_uid', res.requestUid)
      .first()
    assert.equal(row?.state, 'failed')

    // 可重试：重新预览 → awaiting-confirmation → 新句柄 → 成功应用且不重复写
    const rePreview = await flow().attachPreview(org.id, res.requestUid)
    assert.isTrue(rePreview.ok && rePreview.data.state === 'awaiting-confirmation')
    const handle2 = await flow().issueConfirmHandle(org.id, res.requestUid, `user:${maker.id}`)
    assert.isTrue(handle2.ok)
    const retry = await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: res.requestUid,
      executorRef: `user:${maker.id}`,
      handle: handle2.ok ? handle2.data.handle : '',
      applyDelegate: s.buildApplyDelegate({
        action: 'copy',
        document: res.document,
        digest: res.digest,
      }),
    })
    assert.isTrue(retry.ok)
    const versions = await PluginPolicyBundle.query().where('organization_id', org.id)
    assert.equal(versions.length, 1, '重试不重复应用领域提交')
  })

  test('disable 经统一流停用后快照回退 absent；enable 恢复并递增 revision', async ({ assert }) => {
    const maker = await createUser()
    const checker = await createUser()
    const org = await createOrganization(maker)
    const s = svc()

    // 先 copy+apply 启用
    const copyRes = await s.requestCopyFromTemplate({
      organizationId: org.id,
      templateId: 'member-readonly',
      requestedBy: `user:${maker.id}`,
    })
    assert.isTrue(copyRes.ok)
    if (!copyRes.ok) return
    const h1 = await driveToHandle(
      org.id,
      copyRes.requestUid,
      `user:${checker.id}`,
      `user:${maker.id}`,
    )
    await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: copyRes.requestUid,
      executorRef: `user:${maker.id}`,
      handle: h1,
      applyDelegate: s.buildApplyDelegate({
        action: 'copy',
        document: copyRes.document,
        digest: copyRes.digest,
      }),
    })
    const activation = await PluginPolicyBundleActivation.findForOrganization(org.id)
    assert.equal(activation?.status, 'active')

    // disable 请求 → 确认 → status=disabled，snapshot absent
    const disRes = await s.requestActivationChange({
      organizationId: org.id,
      bundleId: 'org-copy.member-readonly',
      version: 1,
      action: 'disable',
      requestedBy: `user:${maker.id}`,
    })
    assert.isTrue(disRes.ok)
    if (!disRes.ok) return
    assert.equal(disRes.summary.action, 'disable')
    const h2 = await driveToHandle(
      org.id,
      disRes.requestUid,
      `user:${checker.id}`,
      `user:${maker.id}`,
    )
    const currentAct = await PluginPolicyBundleActivation.findForOrganization(org.id)
    const disApply = await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: disRes.requestUid,
      executorRef: `user:${maker.id}`,
      handle: h2,
      applyDelegate: s.buildApplyDelegate({ action: 'disable', document: null, digest: null }),
    })
    assert.isTrue(disApply.ok)
    void currentAct
    const afterDisable = await PluginPolicyBundleActivation.findForOrganization(org.id)
    assert.equal(afterDisable?.status, 'disabled')
    const snapAfterDisable = await s.loadVerifiedSnapshot(org.id)
    assert.equal(snapAfterDisable.state, 'absent')

    // enable 回同版本 → active 且 revision 相比初始递增
    const enRes = await s.requestActivationChange({
      organizationId: org.id,
      bundleId: 'org-copy.member-readonly',
      version: 1,
      action: 'enable',
      requestedBy: `user:${maker.id}`,
    })
    assert.isTrue(enRes.ok)
    if (!enRes.ok) return
    const h3 = await driveToHandle(
      org.id,
      enRes.requestUid,
      `user:${checker.id}`,
      `user:${maker.id}`,
    )
    await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: enRes.requestUid,
      executorRef: `user:${maker.id}`,
      handle: h3,
      applyDelegate: s.buildApplyDelegate({
        action: 'enable',
        document: copyRes.document,
        digest: copyRes.digest,
      }),
    })
    const reEnabled = await PluginPolicyBundleActivation.findForOrganization(org.id)
    assert.equal(reEnabled?.status, 'active')
    assert.equal((reEnabled?.revision ?? 0) >= 3, true, '每次激活变化 revision 单调递增')
    const finalSnap = await s.loadVerifiedSnapshot(org.id)
    assert.equal(finalSnap.state, 'ok')
  })

  test('buildPolicyImpactSummary 纯函数确定性（相同 diff 输出一致）', async ({ assert }) => {
    const diff = {
      kind: 'policy-bundle-change' as const,
      pluginId: 'policy-bundle:org-copy.x',
      permissionDelta: {
        added: ['member|op:execute', 'project_manager|perm:plugin_install:manage'],
        removed: ['member|op:resolve-query'],
        unchanged: [],
      },
    }
    const a = buildPolicyImpactSummary(diff as never, 'upgrade', 'org-copy.x')
    const b = buildPolicyImpactSummary(diff as never, 'upgrade', 'org-copy.x')
    assert.deepEqual(a, b)
    assert.includeMembers(a.rolesAffected, ['member', 'project_manager'])
    assert.includeMembers(a.operationsAffected, ['execute', 'resolve-query'])
    assert.equal(a.addedTargets, 2)
    assert.equal(a.removedTargets, 1)
  })

  test('损坏快照检测：digest 与内容不一致 → corrupt（fail closed 输入）', async ({ assert }) => {
    const maker = await createUser()
    const checker = await createUser()
    const org = await createOrganization(maker)
    const s = svc()
    const res = await s.requestCopyFromTemplate({
      organizationId: org.id,
      templateId: 'pm-enabled',
      requestedBy: `user:${maker.id}`,
    })
    assert.isTrue(res.ok)
    if (!res.ok) return
    const handle = await driveToHandle(
      org.id,
      res.requestUid,
      `user:${checker.id}`,
      `user:${maker.id}`,
    )
    await flow().confirmAndApply({
      organizationId: org.id,
      requestUid: res.requestUid,
      executorRef: `user:${maker.id}`,
      handle,
      applyDelegate: s.buildApplyDelegate({
        action: 'copy',
        document: res.document,
        digest: res.digest,
      }),
    })
    // 直接篡改 DB 内容模拟损坏
    await db
      .from('plugin_policy_bundles')
      .where('organization_id', org.id)
      .update({
        rules_json: JSON.stringify([{ role: 'member', effect: 'allow', operation: 'execute' }]),
      })
    const loaded = await s.loadVerifiedSnapshot(org.id)
    assert.equal(loaded.state, 'corrupt')
    if (loaded.state === 'corrupt') assert.equal(loaded.reasonCode, 'policy-snapshot-invalid')
  })
})
