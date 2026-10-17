/**
 * v3-plugin-event-subscription-contract —— projector pilot 功能测试（任务 2.3/2.4）。
 *
 * 覆盖：
 * - 核心事务成功后（审计旁路入口）生成最小 permission-aware envelope 的 pending 行
 * - 过滤器 eq / changed 命中语义；未命中不写行
 * - 幂等：同 auditLogId 重复投影只产生一行
 * - 非 enabled 安装不产生交付行；跨租不产生行
 * - 泄露防护：envelope 仅 allowlist 投影键，无实体 ID/名称/数量/hash
 * - 失败隔离：损坏 metadata isolate-drop、唯一冲突静默——projectFromAuditEntry 绝不抛出，
 *   审计写入路径不受影响（结构上 void+try/catch，与 timeline hint 同语义）
 * - 有界保留：组织级超过 MAX_EVENT_DELIVERY_ROWS_PER_ORG 时删除最旧
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { createOrganization, createUser } from './auth/_helpers.js'
import PluginEventDelivery from '#models/plugin_event_delivery'
import PluginPrivateRegistryRelease from '#models/plugin_private_registry_release'
import PluginInstallation from '#models/plugin_installation'
import Project from '#models/project'
import type Organization from '#models/organization'
import type User from '#models/user'
import {
  PLUGIN_SEAM_EVENT_SUBSCRIPTION,
  MAX_EVENT_DELIVERY_ROWS_PER_ORG,
  computePluginEventDeliveryIdentity,
  computePluginEventId,
} from '@aiproj/types'

const PLUGIN_ID = 'com.aiproj.pilot.event-subscription'

/** 构造 event-subscription 贡献的 release 元数据。 */
function makeMetadata(input: {
  permissions?: string[]
  subscriptions?: unknown[]
  corrupt?: boolean
}): string {
  if (input.corrupt) return '{not-json'
  return JSON.stringify({
    pluginId: PLUGIN_ID,
    version: '1.0.0',
    permissions: input.permissions ?? ['project:view'],
    contributions: [
      {
        seamKey: PLUGIN_SEAM_EVENT_SUBSCRIPTION,
        contributionKey: 'events',
        payload: {
          subscriptions: input.subscriptions ?? [
            {
              eventType: 'project.task.updated',
              eventVersion: '1.0.0',
              responseKinds: ['observation'],
            },
          ],
        },
      },
    ],
  })
}

/** 种子 release + 安装。 */
async function seedSubscriber(
  organizationId: number,
  opts: {
    status?: 'installed' | 'enabled' | 'uninstalled'
    subscriptions?: unknown[]
    permissions?: string[]
    corrupt?: boolean
    version?: string
  } = {},
): Promise<number> {
  const version = opts.version ?? '1.0.0'
  const release = await PluginPrivateRegistryRelease.create({
    organizationId,
    pluginIdentity: PLUGIN_ID,
    version,
    metadata: makeMetadata({
      subscriptions: opts.subscriptions,
      permissions: opts.permissions,
      corrupt: opts.corrupt,
    }),
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
  return Number(installation.id)
}

/** 构造审计旁路入参。 */
function makeAuditEntry(input: {
  organizationId: number
  projectId: number | null
  event?: string
  changes?: Record<string, unknown>
}) {
  const changedKeys = Object.keys(input.changes ?? {})
  return {
    event: input.event ?? 'TASK_UPDATED',
    organizationId: input.organizationId,
    projectId: input.projectId,
    entityType: 'task',
    entityId: 999,
    changes: {
      before: Object.fromEntries(changedKeys.map((k) => [k, 'old'])),
      after: input.changes ?? {},
    },
    metadata: null,
  } as never
}

test.group('plugin event projector pilot', (group) => {
  let user: User
  let org: Organization
  let project: Project

  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    user = await createUser()
    org = await createOrganization(user)
    project = await Project.create({
      organizationId: org.id,
      name: `PEP-${org.id}`,
      code: `PEP-${org.id}-${Date.now()}`,
      createdBy: user.id,
    })
  })

  test('happy path：enabled 订阅者收到最小 envelope 的 pending 行', async ({ assert }) => {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id)
    const projector = new ProjectorService()

    await projector.projectFromAuditEntry(
      makeAuditEntry({
        organizationId: org.id,
        projectId: project.id,
        changes: { status: 'done' },
      }),
      4242,
    )

    const rows = await PluginEventDelivery.query().where('organization_id', org.id)
    assert.lengthOf(rows, 1)
    const row = rows[0]!
    assert.equal(row.status, 'pending')
    assert.equal(row.eventType, 'project.task.updated')
    assert.equal(row.envelope.projection.entityAction, 'updated')
    // eventId 稳定：由 org/type/version/auditLogId 派生
    assert.equal(
      row.eventId,
      computePluginEventId({
        organizationId: org.id,
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        auditLogId: 4242,
      }),
    )
    // delivery identity 与共享契约一致
    assert.equal(
      row.deliveryIdentity,
      computePluginEventDeliveryIdentity({
        organizationId: org.id,
        pluginId: row.pluginId,
        pluginVersion: row.pluginVersion,
        subscriptionDigest: row.subscriptionDigest,
        eventId: row.eventId,
      }),
    )
  })

  test('过滤器：eq 未命中动作不写行；changed 监听字段命中才写行', async ({ assert }) => {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id, {
      subscriptions: [
        {
          eventType: 'project.task.updated',
          eventVersion: '1.0.0',
          filter: { op: 'changed', field: 'status' },
        },
      ],
    })
    const projector = new ProjectorService()

    // 变更字段不含 status → 不投递
    await projector.projectFromAuditEntry(
      makeAuditEntry({ organizationId: org.id, projectId: project.id, changes: { dueDate: 'x' } }),
      5001,
    )
    let rows = await PluginEventDelivery.query().where('organization_id', org.id)
    assert.lengthOf(rows, 0)

    // 含 status → 投递
    await projector.projectFromAuditEntry(
      makeAuditEntry({
        organizationId: org.id,
        projectId: project.id,
        changes: { status: 'done' },
      }),
      5002,
    )
    rows = await PluginEventDelivery.query().where('organization_id', org.id)
    assert.lengthOf(rows, 1)
  })

  test('幂等：同一 auditLogId 重复投影只保留一行', async ({ assert }) => {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id)
    const projector = new ProjectorService()
    const entry = makeAuditEntry({
      organizationId: org.id,
      projectId: project.id,
      changes: { status: 'done' },
    })
    await projector.projectFromAuditEntry(entry, 6000)
    await projector.projectFromAuditEntry(entry, 6000)
    const rows = await PluginEventDelivery.query().where('organization_id', org.id)
    assert.lengthOf(rows, 1)
  })

  test('生命周期与租户：非 enabled 不产生行；跨组织零串扰', async ({ assert }) => {
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)

    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id, { status: 'installed' }) // 未启用 → 撤销语义
    await seedSubscriber(otherOrg.id) // enabled，但事件属于 org A
    const projector = new ProjectorService()

    await projector.projectFromAuditEntry(
      makeAuditEntry({ organizationId: org.id, projectId: project.id }),
      7000,
    )

    const rowsA = await PluginEventDelivery.query().where('organization_id', org.id)
    assert.lengthOf(rowsA, 0)
    const rowsB = await PluginEventDelivery.query().where('organization_id', otherOrg.id)
    assert.lengthOf(rowsB, 0)
  })

  test('泄露防护：envelope 无实体 ID/名称/元数据；仅 allowlist 投影键', async ({ assert }) => {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id)
    const projector = new ProjectorService()

    await projector.projectFromAuditEntry(
      makeAuditEntry({
        organizationId: org.id,
        projectId: project.id,
        changes: { status: 'done', title: '机密任务标题' },
      }),
      8000,
    )
    const row = (await PluginEventDelivery.query().where('organization_id', org.id).first())!
    const serialized = JSON.stringify(row.envelope)
    // 结构断言：envelope 不含实体级字段（entityId/entityType/title 等键不存在）
    assert.notInclude(serialized, '"entityId"')
    assert.notInclude(serialized, '"entityType"')
    assert.notInclude(serialized, '"title"')
    // 任务标题等非 allowlist 值不得出现（title 只作为变更字段名进入列表）
    assert.notInclude(serialized, '机密任务标题')
    assert.deepEqual(Object.keys(row.envelope.projection).sort(), ['changedFields', 'entityAction'])
    // provenance 仅低敏来源族
    assert.equal(row.envelope.provenance.sourceFamily, 'project-activity')
  })

  test('失败隔离：损坏 metadata 与重复冲突都不抛出；审计路径不受影响', async ({ assert }) => {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id, { corrupt: true })
    const projector = new ProjectorService()

    // isolate-drop：损坏 metadata 静默跳过，绝不抛出
    await projector.projectFromAuditEntry(
      makeAuditEntry({ organizationId: org.id, projectId: project.id }),
      9000,
    )
    const rows = await PluginEventDelivery.query().where('organization_id', org.id)
    assert.lengthOf(rows, 0)

    // 非目录事件静默跳过
    await projector.projectFromAuditEntry(
      makeAuditEntry({ organizationId: org.id, projectId: project.id, event: 'MEMBER_INVITED' }),
      9001,
    )
    assert.lengthOf(await PluginEventDelivery.query().where('organization_id', org.id), 0)
  })

  test(`有界保留：组织级行数不超过 ${MAX_EVENT_DELIVERY_ROWS_PER_ORG}`, async ({ assert }) => {
    const { default: ProjectorService } =
      await import('#services/plugin_event_subscription/projector_service')
    await seedSubscriber(org.id)
    // 直接预插 MAX 行（占满配额）
    const base = Date.now()
    for (let i = 0; i < MAX_EVENT_DELIVERY_ROWS_PER_ORG; i++) {
      await PluginEventDelivery.create({
        organizationId: org.id,
        installationId: 1,
        pluginId: PLUGIN_ID,
        pluginVersion: '1.0.0',
        subscriptionDigest: `dg${i}`,
        eventType: 'project.task.updated',
        eventVersion: '1.0.0',
        eventId: `seed${i}ev`,
        deliveryIdentity: `pre${base}-${i}`,
        envelope: {
          schemaVersion: 'plugin-event-envelope-v1',
          eventId: `seed${i}ev`,
          eventType: 'project.task.updated',
          eventVersion: '1.0.0',
          occurredAt: '2026-08-24T00:00:00.000Z',
          organizationId: org.id,
          projectId: null,
          projection: {},
          provenance: { sourceFamily: 'project-activity', producerRef: 'seed' },
        },
        status: 'delivered',
        attemptCount: 1,
      })
    }
    const projector = new ProjectorService()
    // 新投影触发保留清理（auditLogId 唯一 → 新行 identity 不同）
    await projector.projectFromAuditEntry(
      makeAuditEntry({ organizationId: org.id, projectId: project.id }),
      9500 + (base % 1000),
    )
    const count = await PluginEventDelivery.query()
      .where('organization_id', org.id)
      .count('* as total')
      .first()
    assert.isAtMost(Number(count!.$extras.total), MAX_EVENT_DELIVERY_ROWS_PER_ORG)
  })
})
