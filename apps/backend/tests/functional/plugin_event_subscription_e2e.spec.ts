/**
 * v3-plugin-event-subscription-contract —— 全链路 E2E（任务 4.1）。
 *
 * 链路：manifest 贡献校验 → release/install（enabled=subscribe 生效）
 *   → 真实 AuditService.log 事务后旁路 → projector 投影 envelope
 *   → delivery host 复核+调用 handler → advisory-draft / action-proposal 入账与边界登记
 *   → disable 撤销（可恢复）→ uninstall 撤销（终态）→ 排队事件 dropped 不泄露。
 *
 * **零外部调用口径**（任务 4.1「network/provider calls 为零」）：
 * - network：`globalThis.fetch` 与 node `http/https.request` 全程被计数桩接管，调用即抛；
 * - provider：宿主一律不经任何 provider seam 外发——以「外发投递表零行」证明
 *   （webhook_deliveries / outgoing_webhook_delivery_* / pwa_push_subscriptions）。
 *   插件事件是**进程内**旁路，任何一行外发记录都意味着契约被击穿。
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from './auth/_helpers.js'
import PluginEventDelivery from '#models/plugin_event_delivery'
import PluginEventResponse from '#models/plugin_event_response'
import PluginInstallation from '#models/plugin_installation'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import Project from '#models/project'
import type Organization from '#models/organization'
import type User from '#models/user'
import {
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  PLUGIN_EVENT_RESPONSE_KINDS,
  computePluginEventDeliveryIdentity,
  matchPluginEventFilter,
  validatePluginContributionPayload,
  validatePluginEventSubscriptionPayload,
} from '@aiproj/types'

const PLUGIN_ID = 'com.aiproj.pilot.event-e2e'

/** 宿主全部外发投递落库面：插件事件链路走完后这些表必须仍为零行。 */
const OUTBOUND_TABLES = [
  'webhook_deliveries',
  'outgoing_webhook_delivery_events',
  'outgoing_webhook_delivery_attempts',
  'outgoing_webhook_batch_deliveries',
  'pwa_push_subscriptions',
] as const

/** manifest 贡献负载（订阅声明；与 release metadata 内一致）。 */
function contributionPayload() {
  return {
    subscriptions: [
      {
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        responseKinds: ['observation', 'advisory-draft', 'action-proposal'],
        filter: { op: 'changed', field: 'status' },
      },
    ],
  }
}

test.group('plugin event subscription E2E', (group) => {
  let user: User
  let org: Organization
  let project: Project
  let networkCalls = 0

  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    user = await createUser()
    org = await createOrganization(user)
    project = await Project.create({
      organizationId: org.id,
      name: `E2E-${org.id}`,
      code: `E2E-${org.id}-${Date.now()}`,
      createdBy: user.id,
    })
    networkCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (..._args: Parameters<typeof fetch>) => {
      networkCalls++
      throw new Error('network disabled in e2e')
    }) as typeof fetch
    // fetch 之外再堵 node 原生出网口：任何 provider SDK 走 http/https 也会被计数
    const http = await import('node:http')
    const https = await import('node:https')
    const originalHttpRequest = http.default.request
    const originalHttpsRequest = https.default.request
    const denyRequest = ((..._args: unknown[]) => {
      networkCalls++
      throw new Error('network disabled in e2e')
    }) as unknown as typeof http.default.request
    http.default.request = denyRequest
    https.default.request = denyRequest as unknown as typeof https.default.request
    // 还原必须走 setup 返回的 cleanup：在 setup 执行期间再调 `group.each.teardown()`
    // 注册的钩子对本轮不生效，`http.request` 会被永久替换，之后所有走 supertest 的
    // 用例都会以 `network disabled in e2e` 失败（全量套件 703 例）。
    return async () => {
      globalThis.fetch = originalFetch
      http.default.request = originalHttpRequest
      https.default.request = originalHttpsRequest
      const { unregisterPluginEventHandler } =
        await import('#services/plugin_event_subscription/delivery_host_service')
      unregisterPluginEventHandler(PLUGIN_ID)
    }
  })

  /** 种子：release metadata 含 event-subscription 贡献 + enabled 安装。 */
  async function seedFullChain(): Promise<number> {
    // manifest 分派器先验贡献负载（manifest→install 前的宿主校验面）
    const dispatch = validatePluginContributionPayload(
      PLUGIN_SEAM_EVENT_SUBSCRIPTION,
      contributionPayload(),
      '1.0.0',
    )
    if (!dispatch.valid) throw new Error('fixture contribution payload invalid')

    const metadata = JSON.stringify({
      pluginId: PLUGIN_ID,
      version: '1.0.0',
      permissions: ['project:view'],
      contributions: [
        {
          seamKey: PLUGIN_SEAM_EVENT_SUBSCRIPTION,
          contributionKey: 'events',
          payload: contributionPayload(),
        },
      ],
    })
    const release = await PluginPrivateRegistryRelease.create({
      organizationId: org.id,
      pluginIdentity: PLUGIN_ID,
      version: '1.0.0',
      metadata,
      status: 'approved',
      packageDigest: `pkg-${Date.now()}`,
      manifestDigest: `man-${Date.now()}`,
      compatibilityDigest: `cmp-${Date.now()}`,
      upstreamReceiptRef: `rcpt-${Date.now()}`,
    })
    const installation = await PluginInstallation.create({
      organizationId: org.id,
      pluginId: PLUGIN_ID,
      version: '1.0.0',
      releaseId: release.id,
      status: 'enabled',
      packageDigest: `pkg-${Date.now()}`,
      manifestDigest: `man-${Date.now()}`,
      compatibilityDigest: `cmp-${Date.now()}`,
    })
    return Number(installation.id)
  }

  /** 经容器组装宿主服务。 */
  async function makeServices() {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    const { default: HostService } =
      await import('#services/plugin_event_subscription/delivery_host_service')
    const { default: AuditService } = await import('#services/audit_service')
    const { default: app } = await import('@adonisjs/core/services/app')
    const audit = await app.container.make(AuditService)
    return {
      audit,
      projector: new ProjectorService(),
      host: new HostService(audit),
    }
  }

  test('全链路：审计旁路→投影→交付→advisory/proposal→disable→uninstall，零网络', async ({
    assert,
  }) => {
    const installationId = await seedFullChain()
    const services = await makeServices()
    const { registerPluginEventHandler } =
      await import('#services/plugin_event_subscription/delivery_host_service')

    // ── Stage 1：真实审计入口触发投影（changed status 过滤命中）──
    await services.audit.log({
      event: 'TASK_STATUS_CHANGED' as never,
      severity: 'info',
      userId: user.id,
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: 777,
      changes: { before: { status: 'todo' }, after: { status: 'done' } },
    })
    // 旁路为 fire-and-forget：轮询等待投影行出现
    let row1 = null as PluginEventDelivery | null
    for (let i = 0; i < 50 && !row1; i++) {
      row1 = (await PluginEventDelivery.query().where('organization_id', org.id).first()) ?? null
      if (!row1) await new Promise((r) => setTimeout(r, 20))
    }
    assert.isNotNull(row1, '审计旁路应产生 outbox 行')
    assert.equal(row1!.eventType, 'project.task.updated')
    assert.equal(row1!.envelope.projection.entityAction, 'status_changed')

    // ── Stage 2：advisory-draft 交付 ──
    registerPluginEventHandler(PLUGIN_ID, async (envelope) => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'advisory-draft',
      deliveryIdentity: computePluginEventDeliveryIdentity({
        organizationId: org.id,
        pluginId: PLUGIN_ID,
        pluginVersion: '1.0.0',
        subscriptionDigest: row1!.subscriptionDigest,
        eventId: envelope.eventId,
      }),
      advisoryDraft: { title: '建议设置阻塞标记', body: '状态快速回退，建议加阻塞标记。' },
    }))
    const report1 = await services.host.processDue({ organizationId: org.id })
    assert.equal(report1.delivered, 1)
    const respAdvisory = (await PluginEventResponse.query()
      .where('organization_id', org.id)
      .first())!
    assert.equal(respAdvisory.kind, 'advisory-draft')

    // ── Stage 3：第二个事件 → action-proposal 进入统一边界 ──
    await services.audit.log({
      event: 'TASK_STATUS_CHANGED' as never,
      severity: 'info',
      userId: user.id,
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: 778,
      changes: { before: { status: 'done' }, after: { status: 'todo' } },
    })
    let row2: PluginEventDelivery | null = null
    for (let i = 0; i < 50; i++) {
      const rows = await PluginEventDelivery.query()
        .where('organization_id', org.id)
        .where('status', 'pending')
      row2 = rows[0] ?? null
      if (row2) break
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.isNotNull(row2, '第二事件应有独立 outbox 行')

    const tasksBefore = await dbCount('tasks')
    registerPluginEventHandler(PLUGIN_ID, async (envelope) => ({
      schemaVersion: 'plugin-event-response-v1',
      kind: 'action-proposal',
      deliveryIdentity: computePluginEventDeliveryIdentity({
        organizationId: org.id,
        pluginId: PLUGIN_ID,
        pluginVersion: '1.0.0',
        subscriptionDigest: row2!.subscriptionDigest,
        eventId: envelope.eventId,
      }),
      actionProposal: {
        proposalKey: 'reopen-review.v1',
        title: '提案：重开评审',
        summary: '检测到状态回退，建议重开评审。',
      },
    }))
    const report2 = await services.host.processDue({ organizationId: org.id })
    assert.equal(report2.delivered, 1)

    const respProposal = (await PluginEventResponse.query()
      .where('organization_id', org.id)
      .where('kind', 'action-proposal')
      .first())!
    assert.equal(Boolean(respProposal.proposalRegistered), true)
    const { default: PluginActionProposalModel } = await import('#models/plugin_action_proposal')
    assert.equal(
      await PluginActionProposalModel.query()
        .where('organization_id', org.id)
        .count('* as t')
        .first()
        .then((r) => Number(r?.$extras.t)),
      1,
    )
    // 确认前正式表零变化
    assert.equal(await dbCount('tasks'), tasksBefore)

    // ── Stage 4：停用（disable）立即撤销订阅（可恢复语义）──
    // disable 与 uninstall 走同一条复核链，但语义不同：disable 后重新 enable
    // 必须能恢复投影，uninstall 是终态。两者都不得在撤销窗口里交付任何事件。
    // 本域 installation 状态枚举为 installed/enabled/uninstalled：
    // 「禁用」= 退回 `installed`（保留安装但停运），不是新增 `disabled` 值。
    const disabling = (await PluginInstallation.find(installationId))!
    disabling.status = 'installed'
    await disabling.save()

    const deliveriesBeforeRows = await PluginEventDelivery.query().where('organization_id', org.id)
    const deliveriesBeforeDisable = deliveriesBeforeRows.length
    await services.audit.log({
      event: 'TASK_STATUS_CHANGED' as never,
      severity: 'info',
      userId: user.id,
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: 776,
      changes: { before: { status: 'todo' }, after: { status: 'done' } },
    })
    await new Promise((r) => setTimeout(r, 120))
    assert.lengthOf(
      await PluginEventDelivery.query().where('organization_id', org.id),
      deliveriesBeforeDisable,
      '停运期间不得新增投影行',
    )

    let disabledHandlerCalls = 0
    registerPluginEventHandler(PLUGIN_ID, async () => {
      disabledHandlerCalls++
      return null
    })
    await services.host.processDue({ organizationId: org.id })
    assert.equal(disabledHandlerCalls, 0, '停运期间不得调用 handler')

    // 恢复 enabled：停运是可逆的，订阅重新生效
    disabling.status = 'enabled'
    await disabling.save()

    // ── Stage 5：卸载前投影排队 → 卸载 → 宿主复核丢弃（不交付、不泄露）──
    await services.audit.log({
      event: 'TASK_STATUS_CHANGED' as never,
      severity: 'info',
      userId: user.id,
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: 779,
      changes: { before: { status: 'todo' }, after: { status: 'done' } },
    })
    let pendingAfterUninstall = 0
    for (let i = 0; i < 50; i++) {
      const pendingRows = await PluginEventDelivery.query()
        .where('organization_id', org.id)
        .where('status', 'pending')
      pendingAfterUninstall = pendingRows.length
      if (pendingAfterUninstall > 0) break
      await new Promise((r) => setTimeout(r, 20))
    }
    assert.isAtLeast(pendingAfterUninstall, 1, '交付前应存在排队行')

    const installation = (await PluginInstallation.find(installationId))!
    installation.status = 'uninstalled'
    await installation.save()

    // 卸载后新事件不再投影（订阅随生命周期立即失效）
    await services.audit.log({
      event: 'TASK_STATUS_CHANGED' as never,
      severity: 'info',
      userId: user.id,
      organizationId: org.id,
      projectId: project.id,
      entityType: 'task',
      entityId: 780,
      changes: { before: { status: 'done' }, after: { status: 'todo' } },
    })
    await new Promise((r) => setTimeout(r, 120))
    const stillPendingRows = await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .where('status', 'pending')
    const stillPending = stillPendingRows.length
    assert.equal(stillPending, pendingAfterUninstall, '卸载后不得新增投影行')

    let handlerCalls = 0
    const { registerPluginEventHandler: reRegister } =
      await import('#services/plugin_event_subscription/delivery_host_service')
    reRegister(PLUGIN_ID, async () => {
      handlerCalls++
      return null
    })
    const report3 = await services.host.processDue({ organizationId: org.id })
    assert.equal(report3.dropped, pendingAfterUninstall)
    assert.equal(handlerCalls, 0, '撤销后不得调用 handler')

    const responsesFinal = await PluginEventResponse.query().where('organization_id', org.id)
    assert.lengthOf(responsesFinal, 2) // advisory + proposal；卸载后无新响应
    assert.equal(networkCalls, 0, '全程必须零网络调用')
    // provider 面：任何外发 seam 都不得被触发（表零行即证明未经 provider 出站）
    for (const table of OUTBOUND_TABLES) {
      assert.equal(await dbCount(table), 0, `插件事件链路不得写入外发投递表 ${table}`)
    }

    // 封闭词表健全性（防漂移）
    assert.deepEqual([...PLUGIN_EVENT_RESPONSE_KINDS].sort(), [
      'action-proposal',
      'advisory-draft',
      'observation',
    ])
    const directValidate = validatePluginEventSubscriptionPayload(contributionPayload())
    assert.isTrue(directValidate.valid)
    const envSample = { projection: { changedFields: 'status' } }
    assert.isTrue(matchPluginEventFilter([{ op: 'changed', field: 'status' }], envSample as never))
  })
})

/** 表行数辅助。 */
async function dbCount(table: string): Promise<number> {
  const { default: db } = await import('@adonisjs/lucid/services/db')
  const res = (await db.from(table).count('* as total').first()) as
    { total?: number | string } | undefined
  return Number(res?.total ?? 0)
}
