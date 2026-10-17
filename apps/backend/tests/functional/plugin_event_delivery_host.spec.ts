/**
 * v3-plugin-event-subscription-contract —— delivery host 功能测试（任务 2.5/2.6）。
 *
 * 覆盖：disabled/uninstalled 撤销、版本/订阅 revision stale、permission_denied 不交付、
 * scope_mismatch、handler 崩溃/超时、非法响应拒绝、幂等 recorder、批处理积压与恢复、
 * 全程零网络 spy。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from './auth/_helpers.js'
import PluginEventDelivery from '#models/plugin_event_delivery'
import PluginEventResponse from '#models/plugin_event_response'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import type Organization from '#models/organization'
import type User from '#models/user'
import {
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  computePluginEventDeliveryIdentity,
  computePluginEventId,
  validatePluginEventSubscriptionPayload,
} from '@aiproj/types'
import {
  registerPluginEventHandler,
  unregisterPluginEventHandler,
} from '#services/plugin_event_subscription/delivery_host_service'

const PLUGIN_ID = 'com.aiproj.pilot.event-delivery'

/** 与 makeMetadata 完全一致的默认订阅声明（用于计算真实 normalized digest）。 */
const DEFAULT_SUBSCRIPTIONS = [
  {
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    responseKinds: ['observation', 'action-proposal'],
  },
]

function makeMetadata(input: { permissions?: string[]; subscriptions?: unknown[] }): string {
  return JSON.stringify({
    pluginId: PLUGIN_ID,
    version: '1.0.0',
    permissions: input.permissions ?? ['project:view'],
    contributions: [
      {
        seamKey: PLUGIN_SEAM_EVENT_SUBSCRIPTION,
        contributionKey: 'events',
        payload: {
          subscriptions: input.subscriptions ?? DEFAULT_SUBSCRIPTIONS,
        },
      },
    ],
  })
}

interface SeedResult {
  installationId: number
  releaseId: number
}

async function seedSubscriber(
  organizationId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    permissions?: string[]
    version?: string
  } = {},
): Promise<SeedResult> {
  const version = opts.version ?? '1.0.0'
  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    version,
    metadata: makeMetadata({ permissions: opts.permissions }),
    status: 'approved',
    packageDigest: `pkg-${Date.now()}-${Math.random()}`,
    manifestDigest: `man-${Date.now()}-${Math.random()}`,
    compatibilityDigest: `cmp-${Date.now()}-${Math.random()}`,
    upstreamReceiptRef: `rcpt-${Date.now()}-${Math.random()}`,
  })
  const installation = await PluginInstallation.create({
    organizationId,
    pluginId: PLUGIN_ID,
    version,
    releaseId: release.id,
    status: opts.status ?? 'enabled',
    packageDigest: `pkg-${Date.now()}-${Math.random()}`,
    manifestDigest: `man-${Date.now()}-${Math.random()}`,
    compatibilityDigest: `cmp-${Date.now()}-${Math.random()}`,
  })
  return { installationId: Number(installation.id), releaseId: Number(release.id) }
}

/** 计算默认订阅的真实 normalized digest（宿主校验器同源）。 */
function realSubscriptionDigest(subscriptions?: unknown[]): string {
  const res = validatePluginEventSubscriptionPayload({
    subscriptions: subscriptions ?? DEFAULT_SUBSCRIPTIONS,
  })
  if (!res.valid || !res.normalizedPayload) throw new Error('fixture subscription payload invalid')
  return res.normalizedPayload.subscriptions[0]!.subscriptionDigest
}

/** 直接插入一条 pending 交付行。 */
async function seedPendingRow(input: {
  organizationId: number
  installationId: number
  auditLogId?: number
  version?: string
}): Promise<PluginEventDelivery> {
  const auditLogId = input.auditLogId ?? Math.floor(Math.random() * 100000)
  const eventId = computePluginEventId({
    organizationId: input.organizationId,
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    auditLogId,
  })
  const digest = realSubscriptionDigest()
  return PluginEventDelivery.create({
    organizationId: input.organizationId,
    installationId: input.installationId,
    pluginId: PLUGIN_ID,
    pluginVersion: input.version ?? '1.0.0',
    subscriptionDigest: digest,
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    eventId,
    deliveryIdentity: computePluginEventDeliveryIdentity({
      organizationId: input.organizationId,
      pluginId: PLUGIN_ID,
      pluginVersion: input.version ?? '1.0.0',
      subscriptionDigest: digest,
      eventId,
    }),
    envelope: {
      schemaVersion: 'plugin-event-envelope-v1',
      eventId,
      eventType: 'project.task.updated',
      eventVersion: '1.0.0',
      occurredAt: new Date().toISOString(),
      organizationId: input.organizationId,
      projectId: null,
      projection: { entityAction: 'updated' },
      provenance: { sourceFamily: 'project-activity', producerRef: 'test' },
    },
    status: 'pending',
    attemptCount: 0,
  })
}

async function makeHost() {
  const { default: HostService } =
    await import('#services/plugin_event_subscription/delivery_host_service')
  const { default: AuditService } = await import('#services/audit_service')
  // 经容器构造（@inject 链由 DI 解析）
  const { default: app } = await import('@adonisjs/core/services/app')
  return new HostService(await app.container.make(AuditService))
}

test.group('plugin event delivery host', (group) => {
  let user: User
  let org: Organization
  let networkCalls = 0

  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    user = await createUser()
    org = await createOrganization(user)
    // 零网络 spy：任何 fetch/http 外呼都计数并在断言中要求为 0
    networkCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
      networkCalls++
      throw new Error('network disabled in contract tests')
    }) as typeof fetch
    group.each.teardown(async () => {
      globalThis.fetch = originalFetch
      unregisterPluginEventHandler(PLUGIN_ID)
      assertNetworkClean()
    })
  })

  /** 断言零网络。 */
  function assertNetworkClean(): void {
    if (networkCalls !== 0) {
      throw new Error(`expected zero network calls, got ${networkCalls}`)
    }
  }

  test('happy path：observation 交付成功并幂等入账', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)
    await seedPendingRow({ organizationId: org.id, installationId: sub.installationId })
    let invoked = 0
    registerPluginEventHandler(PLUGIN_ID, async () => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: 'ignored-host-checks',
      observation: { note: '已观察' },
    }))
    void invoked

    // deliveryIdentity 由行携带，handler 返回的 identity 必须一致——这里用真实值回传
    const row = (await PluginEventDelivery.query().where('organization_id', org.id).first())!
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async (envelope) => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: computePluginEventDeliveryIdentity({
        organizationId: org.id,
        pluginId: PLUGIN_ID,
        pluginVersion: '1.0.0',
        subscriptionDigest: row.subscriptionDigest,
        eventId: envelope.eventId,
      }),
      observation: { note: '已观察' },
    }))

    const report = await host.processDue({ organizationId: org.id })
    assert.equal(report.delivered, 1)
    const delivered = (await PluginEventDelivery.query().where('organization_id', org.id).first())!
    assert.equal(delivered.status, 'delivered')
    assert.equal(delivered.responseKind, 'observation')
    const responses = await PluginEventResponse.query().where('organization_id', org.id)
    assert.lengthOf(responses, 1)
    assert.equal(responses[0]!.kind, 'observation')
    assert.equal(responses[0]!.body, '已观察')

    // 幂等 recorder：重复 identity 的响应不再新增记录（模拟宿主重试同 identity）
    await seedPendingRow({ organizationId: org.id, installationId: sub.installationId })
    const dup = (await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .where('status', 'pending')
      .first())!
    // 让新行复用同一 delivery_identity 场景不可构造（唯一约束）——改为直接断言 recorder 幂等分支：
    await PluginEventResponse.create({
      organizationId: org.id,
      installationId: sub.installationId,
      pluginId: PLUGIN_ID,
      deliveryIdentity: 'pre-existing-identity',
      eventId: dup.eventId,
      kind: 'observation',
      body: 'first',
      proposalRegistered: false,
    })
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async () => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: 'pre-existing-identity',
      observation: { note: 'second' },
    }))
    // 直接改写行的 identity 与预存记录冲突 → recorder 应静默复用既有记录
    dup.deliveryIdentity = 'pre-existing-identity'
    await dup.save()
    const report2 = await host.processDue({ organizationId: org.id })
    assert.equal(report2.delivered, 1)
    const responses2 = await PluginEventResponse.query()
      .where('organization_id', org.id)
      .where('delivery_identity', 'pre-existing-identity')
    assert.lengthOf(responses2, 1)
    assert.equal(responses2[0]!.body, 'first') // 未被第二条覆盖
  })

  test('停用/卸载撤销：dropped 且 handler 零调用、payload 不外泄', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id, { status: 'uninstalled' })
    const row = await seedPendingRow({ organizationId: org.id, installationId: sub.installationId })
    let calls = 0
    registerPluginEventHandler(PLUGIN_ID, async () => {
      calls++
      return {
        schemaVersion: 'plugin-event-response-v1',
        kind: 'observation',
        deliveryIdentity: row.deliveryIdentity,
        observation: { note: 'x' },
      }
    })

    const report = await host.processDue({ organizationId: org.id })
    assert.equal(report.dropped, 1)
    assert.equal(calls, 0)
    const after = (await PluginEventDelivery.find(row.id))!
    assert.equal(after.status, 'dropped')
    assert.equal(after.lastReasonCode, 'subscription_revoked')
    const responses = await PluginEventResponse.query().where('organization_id', org.id)
    assert.lengthOf(responses, 0)
  })

  test('版本变化与订阅 revision 变化 → stale', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)
    // 版本不一致
    const vRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    vRow.pluginVersion = '0.9.0'
    await vRow.save()

    const report = await host.processDue({ organizationId: org.id, timeoutMs: 1000 })
    assert.equal(report.stale, 1)
    assert.equal(
      (await PluginEventDelivery.find(vRow.id))!.lastReasonCode,
      'plugin_version_changed',
    )

    // 订阅 revision：payload 换了过滤器（digest 改变）→ 旧行 stale
    const row2 = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    const changedSubs = [
      {
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        responseKinds: ['observation', 'action-proposal'],
        filter: { op: 'changed', field: 'status' },
      },
    ]
    const release = (await PluginPrivateRegistryRelease.find(sub.releaseId))!
    release.metadata = makeMetadata({ subscriptions: changedSubs })
    await release.save()
    const report2 = await host.processDue({ organizationId: org.id, timeoutMs: 1000 })
    assert.equal(report2.stale, 1)
    assert.equal(
      (await PluginEventDelivery.find(row2.id))!.lastReasonCode,
      'subscription_revision_changed',
    )

    // 贡献整体缺失 → metadata_unavailable
    const row3 = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    release.metadata = JSON.stringify({
      pluginId: PLUGIN_ID,
      version: '1.0.0',
      permissions: ['project:view'],
      contributions: [],
    })
    await release.save()
    await host.processDue({ organizationId: org.id, timeoutMs: 1000 })
    assert.equal((await PluginEventDelivery.find(row3.id))!.lastReasonCode, 'metadata_unavailable')
  })

  test('permission_denied：grant 缺失时跳过且不调用 handler、不泄露 payload', async ({
    assert,
  }) => {
    const host = await makeHost()
    const subNoPerm = await seedSubscriber(org.id, { permissions: [] })
    const rowA = await seedPendingRow({
      organizationId: org.id,
      installationId: subNoPerm.installationId,
    })
    let calls = 0
    registerPluginEventHandler(PLUGIN_ID, async () => {
      calls++
      return null
    })

    const report = await host.processDue({ organizationId: org.id, timeoutMs: 1000 })
    assert.equal(report.skipped, 1)
    assert.equal(report.delivered, 0)
    assert.equal(calls, 0)
    const after = (await PluginEventDelivery.find(rowA.id))!
    assert.equal(after.lastReasonCode, 'permission_denied')
    // 不外泄：响应记录为空
    assert.lengthOf(await PluginEventResponse.query().where('organization_id', org.id), 0)
  })

  test('scope_mismatch：项目引用失配时跳过且不调用 handler', async ({ assert }) => {
    const host = await makeHost()
    const subOk = await seedSubscriber(org.id)
    const rowB = await seedPendingRow({
      organizationId: org.id,
      installationId: subOk.installationId,
    })
    rowB.envelope = { ...rowB.envelope, projectId: 987654321 }
    rowB.status = 'pending'
    await rowB.save()
    let calls = 0
    registerPluginEventHandler(PLUGIN_ID, async () => {
      calls++
      return null
    })

    const report2 = await host.processDue({ organizationId: org.id, timeoutMs: 1000 })
    assert.equal(report2.skipped, 1)
    assert.equal(calls, 0)
    assert.equal((await PluginEventDelivery.find(rowB.id))!.lastReasonCode, 'scope_mismatch')
  })

  test('崩溃与超时隔离；非法响应拒绝；后续事件可恢复', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)

    // 崩溃
    const crashRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    registerPluginEventHandler(PLUGIN_ID, async () => {
      throw new Error('plugin exploded')
    })
    let report = await host.processDue({ organizationId: org.id })
    assert.equal(report.failed, 1)
    assert.equal((await PluginEventDelivery.find(crashRow.id))!.lastReasonCode, 'handler_crash')

    // 超时（注入短超时）
    const timeoutRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async () => new Promise<never>(() => undefined))
    report = await host.processDue({ organizationId: org.id, timeoutMs: 50 })
    assert.isAtLeast(report.failed, 1)
    assert.equal((await PluginEventDelivery.find(timeoutRow.id))!.lastReasonCode, 'timeout')

    // 非法响应（直接写入指令）→ 拒绝
    const badRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async () => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: badRow.deliveryIdentity,
      execute: { writeTask: true },
    }))
    report = await host.processDue({ organizationId: org.id })
    assert.isAtLeast(report.failed, 1)
    assert.equal((await PluginEventDelivery.find(badRow.id))!.lastReasonCode, 'response_invalid')

    // 恢复：合法 handler 注册后新事件正常交付
    const goodRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async () => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: goodRow.deliveryIdentity,
      observation: { note: 'recovered' },
    }))
    const okReport = await host.processDue({ organizationId: org.id })
    assert.equal(okReport.delivered, 1)
  })

  test('积压与批量：batchSize 限制扫描量，余量保持 pending', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)
    for (let i = 0; i < 4; i++) {
      await seedPendingRow({ organizationId: org.id, installationId: sub.installationId })
    }
    registerPluginEventHandler(PLUGIN_ID, async (_envelope) => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: 'batch-unknown',
      observation: { note: 'ok' },
    }))
    // handler 返回的 identity 与行不符 → failed；改用动态查行：
    // 简化：此处只验证批量边界，不验证成功——用合法 identity 回传需要行信息，
    // 改为注册一个按 envelope 反查的 handler（测试内已知全部行）。
    unregisterPluginEventHandler(PLUGIN_ID)
    const rows = await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .where('status', 'pending')
    const byEventId = new Map(rows.map((r) => [r.eventId, r]))
    registerPluginEventHandler(PLUGIN_ID, async (envelope) => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: byEventId.get(envelope.eventId)?.deliveryIdentity ?? 'missing',
      observation: { note: 'ok' },
    }))

    const first = await host.processDue({ organizationId: org.id, batchSize: 2 })
    assert.equal(first.scanned, 2)
    const stillPending = await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .where('status', 'pending')
    assert.equal(stillPending.length, 2)

    const second = await host.processDue({ organizationId: org.id, batchSize: 10 })
    assert.equal(second.scanned, 2)
    assert.equal(second.delivered, 2)
    const nonePending = await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .where('status', 'pending')
    assert.lengthOf(nonePending, 0)
  })

  test('quota：maxInvocations 限制调用数，余量 leftPending 且下一轮恢复', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)
    for (let i = 0; i < 2; i++) {
      await seedPendingRow({ organizationId: org.id, installationId: sub.installationId })
    }
    const rows = await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .where('status', 'pending')
    const byEventId = new Map(rows.map((r) => [r.eventId, r]))
    registerPluginEventHandler(PLUGIN_ID, async (envelope) => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: byEventId.get(envelope.eventId)?.deliveryIdentity ?? 'missing',
      observation: { note: 'ok' },
    }))

    const first = await host.processDue({ organizationId: org.id, maxInvocations: 1 })
    assert.equal(first.delivered, 1)
    assert.equal(first.leftPending, 1)

    // 配额恢复：新一轮继续处理剩余行
    const second = await host.processDue({ organizationId: org.id })
    assert.equal(second.delivered, 1)
  })

  test('action-proposal 委托 preview boundary：确认前正式表零变化', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)
    const row = await seedPendingRow({ organizationId: org.id, installationId: sub.installationId })

    registerPluginEventHandler(PLUGIN_ID, async () => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'action-proposal',
      deliveryIdentity: row.deliveryIdentity,
      actionProposal: {
        proposalKey: 'split-task.v1',
        title: '提案：拆分任务',
        summary: '建议拆分以降低阻塞。',
      },
    }))

    const countTasksBefore = await dbCount('tasks')
    const countProjectsBefore = await dbCount('projects')
    const countInstallationsBefore = await dbCount('plugin_installations')

    const report = await host.processDue({ organizationId: org.id })
    assert.equal(report.delivered, 1)

    // 响应记录：proposal 已登记进统一 preview/confirm 边界
    const resp = (await PluginEventResponse.query().where('organization_id', org.id).first())!
    assert.equal(resp.kind, 'action-proposal')
    assert.equal(resp.proposalRegistered, true)
    assert.isNotNull(resp.proposalSummary)
    assert.equal(resp.proposalKey, 'split-task.v1')

    // 正式表零变化（确认前）
    assert.equal(await dbCount('tasks'), countTasksBefore)
    assert.equal(await dbCount('projects'), countProjectsBefore)

    // 统一边界已存在 proposed 行（surface=event-subscription 来源）
    const { default: PluginActionProposalModel } = await import('#models/plugin_action_proposal')
    const proposals = await PluginActionProposalModel.query().where('organization_id', org.id)
    assert.lengthOf(proposals, 1)
    assert.equal(proposals[0]!.status, 'proposed')
    assert.equal(proposals[0]!.actionKind, 'plugin.pilot.item.create')
    // 确认前：领域表依旧零变化
    assert.equal(await dbCount('tasks'), countTasksBefore)
    assert.equal(await dbCount('projects'), countProjectsBefore)
    assert.equal(await dbCount('plugin_installations'), countInstallationsBefore)
  })

  test('health 与低敏 audit：结果有记录且不含 payload；敏感内容不落审计', async ({ assert }) => {
    const host = await makeHost()
    const sub = await seedSubscriber(org.id)

    // 成功
    const okRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    registerPluginEventHandler(PLUGIN_ID, async () => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'observation',
      deliveryIdentity: okRow.deliveryIdentity,
      observation: { note: 'SECRET_MARKER_NOTE' },
    }))
    await host.processDue({ organizationId: org.id })

    // 崩溃
    const crashRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async () => {
      throw new Error('boom')
    })
    await host.processDue({ organizationId: org.id })
    void crashRow

    // 超时
    const timeoutRow = await seedPendingRow({
      organizationId: org.id,
      installationId: sub.installationId,
    })
    unregisterPluginEventHandler(PLUGIN_ID)
    registerPluginEventHandler(PLUGIN_ID, async () => new Promise<never>(() => undefined))
    await host.processDue({ organizationId: org.id, timeoutMs: 50 })
    void timeoutRow

    // health events：本 seam 有 success/crash/timeout 记录
    const { default: HealthEvent } = await import('#models/plugin_runtime_health_event')
    const events = await HealthEvent.query()
      .where('organization_id', org.id)
      .where('seam_key', PLUGIN_SEAM_EVENT_SUBSCRIPTION)
    const outcomes = events.map((e) => e.outcome).sort()
    assert.include(outcomes, 'success')
    assert.include(outcomes, 'crash')
    assert.include(outcomes, 'timeout')
    // 低敏：health 事件不含响应正文/envelope 投影值
    const healthJson = JSON.stringify(events)
    assert.notInclude(healthJson, 'SECRET_MARKER_NOTE')

    // 低敏 audit：交付审计存在且 metadata 无响应正文
    const { default: AuditLog } = await import('#models/audit_log')
    const audits = await AuditLog.query()
      .where('entity_type', 'plugin_event_delivery')
      .where('organization_id', org.id)
    assert.isAtLeast(audits.length, 1)
    const auditJson = JSON.stringify(audits)
    assert.notInclude(auditJson, 'SECRET_MARKER_NOTE')
    assert.include(auditJson, 'delivered')
  })
})

/** 表行数辅助。 */
async function dbCount(table: string): Promise<number> {
  const { default: db } = await import('@adonisjs/lucid/services/db')
  const res = (await db.from(table).count('* as total').first()) as
    { total?: number | string } | undefined
  return Number(res?.total ?? 0)
}
