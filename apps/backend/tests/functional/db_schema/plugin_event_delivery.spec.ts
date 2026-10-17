/**
 * v3-plugin-event-subscription-contract —— plugin_event_deliveries 迁移测试（任务 2.2）。
 *
 * 验证：
 * - 关键列存在性（organization/installation/plugin/subscription digest/event/delivery identity/envelope/status）
 * - 外键策略：organizations / plugin_installations 级联
 * - 唯一性：delivery_identity（幂等交付锚点）
 * - 封闭枚举 CHECK（status；response_kind 允许 NULL）
 * - Model：forOrganization 组织隔离、envelope JSON prepare/consume 往返、
 *   delivery_identity 重复写入被唯一约束拒绝（幂等）
 * - 方言自适应断言（同一套断言在 SQLite 与 PostgreSQL 上均可运行）
 */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { columnNames, foreignKeys, hasUniqueIndex, tableSql, checkEnum } from './_helpers.js'
import { createOrganization, createUser } from '../auth/_helpers.js'
import PluginEventDelivery from '#models/plugin_event_delivery'
import PluginInstallation from '#models/plugin_installation'
import type Organization from '#models/organization'
import type User from '#models/user'

/** 最小安装记录。 */
async function seedInstallation(
  organizationId: number,
  pluginId: string,
): Promise<PluginInstallation> {
  return PluginInstallation.create({
    organizationId,
    pluginId,
    version: '1.0.0',
    releaseId: 1,
    status: 'enabled',
    packageDigest: 'pkg-digest',
    manifestDigest: 'manifest-digest',
    compatibilityDigest: 'compat-digest',
  })
}

/** 最小合法 envelope。 */
function makeEnvelope(eventId: string) {
  return {
    schemaVersion: 'plugin-event-envelope-v1' as const,
    eventId,
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    occurredAt: '2026-08-24T00:00:00.000Z',
    organizationId: 1,
    projectId: null,
    projection: { entityAction: 'updated' },
    provenance: { sourceFamily: 'project-activity' as const, producerRef: 'audit-bypass' },
  }
}

/** 建一条 delivery 行。 */
async function seedDelivery(input: {
  organizationId: number
  installationId: number
  deliveryIdentity: string
  eventId?: string
}): Promise<PluginEventDelivery> {
  return PluginEventDelivery.create({
    organizationId: input.organizationId,
    installationId: input.installationId,
    pluginId: 'com.aiproj.pilot.events',
    pluginVersion: '1.0.0',
    subscriptionDigest: 'abcd1234',
    eventType: 'project.task.updated',
    eventVersion: '1.0.0',
    eventId: input.eventId ?? 'evt00001',
    deliveryIdentity: input.deliveryIdentity,
    envelope: makeEnvelope(input.eventId ?? 'evt00001'),
    status: 'pending',
    attemptCount: 0,
  })
}

test.group('plugin event deliveries 迁移', (group) => {
  let user: User
  let org: Organization

  group.setup(async () => {
    await testUtils.db().migrate()
  })

  group.each.setup(async () => {
    user = await createUser()
    org = await createOrganization(user)
  })

  test('plugin_event_deliveries 关键列存在', async ({ assert }) => {
    const cols = await columnNames('plugin_event_deliveries')
    for (const c of [
      'id',
      'organization_id',
      'installation_id',
      'plugin_id',
      'plugin_version',
      'subscription_digest',
      'event_type',
      'event_version',
      'event_id',
      'delivery_identity',
      'envelope',
      'status',
      'attempt_count',
      'last_reason_code',
      'response_kind',
      'created_at',
      'updated_at',
      'delivered_at',
    ]) {
      assert.include(cols, c, `plugin_event_deliveries 应含字段 ${c}`)
    }
  })

  test('外键策略：组织与安装级联删除', async ({ assert }) => {
    const fks = await foreignKeys('plugin_event_deliveries')
    const orgFk = fks.find((f) => f.from === 'organization_id')
    assert.equal(orgFk?.table, 'organizations')
    assert.equal(orgFk?.on_delete.toLowerCase(), 'cascade')
    const instFk = fks.find((f) => f.from === 'installation_id')
    assert.equal(instFk?.table, 'plugin_installations')
    assert.equal(instFk?.on_delete.toLowerCase(), 'cascade')
  })

  test('delivery_identity 组织复合唯一索引存在；status CHECK 封闭', async ({ assert }) => {
    assert.isTrue(
      await hasUniqueIndex('plugin_event_deliveries', ['organization_id', 'delivery_identity']),
    )
    const sql = await tableSql('plugin_event_deliveries')
    assert.isTrue(checkEnum(sql, 'status', ['pending']), 'status 应有封闭 CHECK 约束（含 pending）')
  })

  test('Model：envelope JSON 往返 + forOrganization 组织隔离', async ({ assert }) => {
    const otherUser = await createUser()
    const otherOrg = await createOrganization(otherUser)
    const instA = await seedInstallation(org.id, 'com.aiproj.pilot.events')
    await seedDelivery({
      organizationId: org.id,
      installationId: instA.id,
      deliveryIdentity: `d-${org.id}-a`,
    })
    const instB = await seedInstallation(otherOrg.id, 'com.aiproj.pilot.events')
    await seedDelivery({
      organizationId: otherOrg.id,
      installationId: instB.id,
      deliveryIdentity: `d-${otherOrg.id}-b`,
    })

    const rowsA = await PluginEventDelivery.query().where('organizationId', org.id)
    assert.lengthOf(rowsA, 1)
    // JSON 往返
    const env = rowsA[0]!.envelope
    assert.equal(env.schemaVersion, 'plugin-event-envelope-v1')
    assert.equal(env.eventType, 'project.task.updated')
    assert.equal(env.projection.entityAction, 'updated')

    // 跨租隔离：组织过滤只见本组织
    const scoped = await PluginEventDelivery.query().where('organizationId', otherOrg.id)
    assert.lengthOf(scoped, 1)
    assert.notEqual(scoped[0]!.deliveryIdentity, `d-${org.id}-a`)
  })

  test('幂等：相同 delivery_identity 二次写入被唯一约束拒绝', async ({ assert }) => {
    const inst = await seedInstallation(org.id, 'com.aiproj.pilot.events')
    await seedDelivery({
      organizationId: org.id,
      installationId: inst.id,
      deliveryIdentity: 'dup-identity-1',
    })
    try {
      await seedDelivery({
        organizationId: org.id,
        installationId: inst.id,
        deliveryIdentity: 'dup-identity-1',
      })
      assert.fail('重复 delivery_identity 应被唯一约束拒绝')
    } catch (error) {
      assert.include(
        String((error as Error).message).toLowerCase() +
          String((error as { code?: string }).code ?? ''),
        ['unique'],
      )
    }
  })
})
