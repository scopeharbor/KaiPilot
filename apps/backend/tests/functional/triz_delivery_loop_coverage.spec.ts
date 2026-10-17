/**
 * v3-triz-to-delivery-closed-loop §11.3 —— c8/Japa 可采集的 Service/Policy 行为门。
 *
 * 仓库的 Vitest runner 当前未安装 coverage provider；这些断言复用既有 unit 行为，
 * 放进 Japa functional suite 以让官方 c8 门能合并真实 API/DB 路径与纯服务分支。
 */
import { test } from '@japa/runner'
import type User from '#models/user'
import TrizDeliveryLoopPolicy from '#policies/triz_delivery_loop_policy'
import {
  assembleTrizDlAdvisories,
  resolveAdvisoryContribution,
  TrizDlAiDraftService,
} from '#services/triz_delivery_loop/advisory_service'
import {
  assertHumanActorId,
  TrizDeliveryLoopAppendOnlyError,
} from '#services/triz_delivery_loop/guards'
import { describeTrizDlReceiptCoverage } from '#services/triz_delivery_loop/receipt_coverage'
import {
  TrizDlAdapterRegistryError,
  TrizDlClosedAdapterRegistry,
  isContextKind,
  isRequiredDeliveryKind,
  type TrizDlClosedDeliveryPort,
} from '#services/triz_delivery_loop/read_adapters'
import {
  mapContextStatus,
  mapMilestoneStatus,
  mapTaskStatus,
} from '#services/triz_delivery_loop/default_read_adapters'

const GOOD = {
  advisory: true,
  capability: 'delivery_template',
  version: '1.0.0',
  source: { pluginId: 'triz-pack', provider: 'first_party' },
  content: '建议按矛盾类型拆解交付。',
}

function makeUser(superAdmin = false): User {
  return { id: 7, isSuperAdmin: superAdmin } as unknown as User
}

function makePolicy(allowed: (permission: string) => boolean) {
  return new TrizDeliveryLoopPolicy({
    check: async (_user: User, permission: string) => ({ allowed: allowed(permission) }),
  } as never)
}

const fakePort = (kind: TrizDlClosedDeliveryPort['kind']): TrizDlClosedDeliveryPort => ({
  kind,
  fetchSummaries: async () => new Map(),
})

test.group('TRIZ delivery-loop §11.3 coverage behavior', () => {
  test('advisory validator/assembler/AI fallback 覆盖允许、拒绝、降级与三种草稿', ({ assert }) => {
    const valid = resolveAdvisoryContribution(GOOD)
    assert.isTrue('block' in valid)
    if ('block' in valid) {
      assert.equal(valid.block.provenance, 'triz-pack@first_party')
      assert.equal(valid.block.advisory, true)
    }

    const invalidOutputs = [
      null,
      { ...GOOD, capability: 'auto_apply' },
      { ...GOOD, version: 'bad version' },
      { ...GOOD, source: null },
      { ...GOOD, source: { pluginId: 1, provider: 'x' } },
      { ...GOOD, content: null },
    ]
    for (const input of invalidOutputs) {
      assert.equal('reason' in resolveAdvisoryContribution(input), true)
    }
    for (const input of [
      { ...GOOD, advisory: false },
      { ...GOOD, verify: true },
      { ...GOOD, nested: { token: 'secret' } },
    ]) {
      assert.deepEqual(resolveAdvisoryContribution(input), { reason: 'forbidden_content' })
    }
    const truncated = resolveAdvisoryContribution({ ...GOOD, content: 'x'.repeat(5000) })
    assert.isTrue('block' in truncated)
    if ('block' in truncated) assert.isAtMost(truncated.block.content.length, 2000)

    const disabled = assembleTrizDlAdvisories([GOOD], {
      pluginEnabled: false,
      timeout: false,
      oversize: false,
    })
    assert.isFalse(disabled.available)
    const mixed = assembleTrizDlAdvisories(
      [GOOD, { ...GOOD, capability: 'unknown' }, { ...GOOD, advisory: false }],
      { pluginEnabled: true, timeout: true, oversize: true },
    )
    assert.isTrue(mixed.available)
    assert.lengthOf(mixed.blocks, 1)
    assert.includeMembers(mixed.degradedReasons, [
      'plugin_timeout',
      'payload_oversize',
      'invalid_output',
      'forbidden_content',
    ])

    const ai = new TrizDlAiDraftService()
    for (const draftType of ['delivery_breakdown', 'metrics_draft', 'retrospective'] as const) {
      const output = ai.generateDraft(
        draftType,
        {
          decisionLogId: '5',
          posture: 'awaiting_verification',
          conclusion: draftType === 'retrospective' ? 'effective' : null,
          visibleDeliveryCount: 2,
        },
        false,
      )
      assert.isTrue(output.isFallback)
      assert.equal(output.costSummary.providerCalls, 0)
      assert.equal(output.costSummary.networkCalls, 0)
      assert.notInclude(output.content, '已自动判定')
    }
  })

  test('Policy 五动作覆盖 super-admin、allow、deny 与 RBAC error', async ({ assert }) => {
    const actions = ['view', 'link', 'verify', 'reopen', 'requestAi'] as const
    const superAdmin = makeUser(true)
    const denied = makePolicy(() => false)
    for (const action of actions) {
      assert.isTrue(await denied[action](superAdmin, 1, 10))
    }

    const allowed = makePolicy(() => true)
    const member = makeUser(false)
    for (const action of actions) {
      assert.isTrue(await allowed[action](member, 1, 10))
      assert.isFalse(await denied[action](member, 1, 10))
    }

    const failed = new TrizDeliveryLoopPolicy({
      check: async () => Promise.reject(new Error('rbac down')),
    } as never)
    await assert.rejects(() => failed.verify(member, 1, 10), 'rbac down')
  })

  test('append-only actor、receipt coverage、registry 与状态闭集边界', ({ assert }) => {
    assert.doesNotThrow(() => assertHumanActorId(7))
    for (const actorId of [0, -1, 1.5, Number.NaN]) {
      assert.throws(() => assertHumanActorId(actorId), TrizDeliveryLoopAppendOnlyError)
    }

    for (const refs of [null, undefined, []]) {
      const coverage = describeTrizDlReceiptCoverage(42, refs as never)
      assert.isTrue(coverage.legacyUnlinked)
      assert.equal(coverage.warningCode, 'TRIZ_DL_LEGACY_UNLINKED')
    }
    assert.isFalse(
      describeTrizDlReceiptCoverage(7, [
        { entityType: 'task', entityId: '1001', sourceChangeId: 3, tempId: 't1' },
      ]).legacyUnlinked,
    )

    const registry = new TrizDlClosedAdapterRegistry()
      .register(fakePort('task'))
      .register(fakePort('milestone'))
      .register(fakePort('risk'))
      .register(fakePort('change_request'))
    assert.deepEqual(registry.registeredKinds(), ['change_request', 'milestone', 'risk', 'task'])
    assert.equal(registry.require('task').kind, 'task')
    assert.equal(registry.get('risk')?.kind, 'risk')
    assert.throws(() => registry.register(fakePort('task')), TrizDlAdapterRegistryError)
    assert.throws(
      () => new TrizDlClosedAdapterRegistry().register(fakePort('unknown' as never)),
      TrizDlAdapterRegistryError,
    )
    assert.throws(
      () => new TrizDlClosedAdapterRegistry().require('task'),
      TrizDlAdapterRegistryError,
    )

    assert.isTrue(isRequiredDeliveryKind('task'))
    assert.isTrue(isRequiredDeliveryKind('milestone'))
    assert.isFalse(isRequiredDeliveryKind('risk'))
    assert.isTrue(isContextKind('risk'))
    assert.isTrue(isContextKind('change_request'))
    assert.isFalse(isContextKind('task'))
    assert.equal(mapTaskStatus('on_hold'), 'blocked')
    assert.isNull(mapTaskStatus('unknown'))
    assert.equal(mapMilestoneStatus('planned'), 'not_started')
    assert.equal(mapMilestoneStatus('at_risk'), 'blocked')
    assert.equal(mapMilestoneStatus('achieved'), 'completed')
    assert.isNull(mapMilestoneStatus('unknown'))
    assert.equal(mapContextStatus('risk', 'resolved'), 'completed')
    assert.equal(mapContextStatus('change_request', 'under_review'), 'in_progress')
    assert.isNull(mapContextStatus('task', 'completed'))
  })
})
