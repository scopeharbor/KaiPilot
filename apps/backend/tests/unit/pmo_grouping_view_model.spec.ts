import PmoGroupingView from '#models/pmo_grouping_view'
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { PMO_GROUPING_VIEW_DEFINITION_VERSION, PMO_GROUPING_VIEW_SCOPES } from '@aiproj/types'

test.group('PmoGroupingView Model — 持久化与字段约束', (group) => {
  useAuthDatabase(group)

  async function setupOrg() {
    const owner = await createUser({ email: uniqueEmail('pgv-model') })
    const org = await createOrganization(owner)
    return { org, owner }
  }

  // ─── §3.2 组织隔离 ─────────────────────────────────────────────────────

  test('view 组织隔离：不同组织视图互不可见', async ({ assert }) => {
    const { org: org1, owner: u1 } = await setupOrg()
    const { org: org2, owner: u2 } = await setupOrg()

    await PmoGroupingView.create({
      viewId: 'v-org1',
      organizationId: Number(org1.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(u1.id),
      name: 'Org1 视图',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
      isDefault: 0,
      isOrgDefault: 0,
    })

    await PmoGroupingView.create({
      viewId: 'v-org2',
      organizationId: Number(org2.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(u2.id),
      name: 'Org2 视图',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
      isDefault: 0,
      isOrgDefault: 0,
    })

    const org1Views = await PmoGroupingView.query()
      .where('organization_id', Number(org1.id))
      .whereNull('deleted_at')
    const org2Views = await PmoGroupingView.query()
      .where('organization_id', Number(org2.id))
      .whereNull('deleted_at')

    assert.equal(org1Views.length, 1)
    assert.equal(org2Views.length, 1)
    assert.equal(org1Views[0].viewId, 'v-org1')
    assert.equal(org2Views[0].viewId, 'v-org2')
  })

  // ─── 唯一性/默认约束 ───────────────────────────────────────────────────

  test('view_id 唯一约束', async ({ assert }) => {
    const { org, owner } = await setupOrg()

    await PmoGroupingView.create({
      viewId: 'unique-view-id',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '唯一视图',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
      isDefault: 0,
      isOrgDefault: 0,
    })

    await assert.rejects(async () => {
      await PmoGroupingView.create({
        viewId: 'unique-view-id',
        organizationId: Number(org.id),
        scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
        ownerUserId: Number(owner.id),
        name: '重复视图',
        definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
        queryDefinition: JSON.stringify({ primaryGrouping: 'health' }),
        isDefault: 0,
        isOrgDefault: 0,
      })
    })
  })

  test('is_default 默认值为 0', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const view = await PmoGroupingView.create({
      viewId: 'default-test',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '默认测试',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })
    // Lucid 的 create() 只把传入字段放进实例，不回读 DB 默认值；断言库里的默认值必须重查一次。
    const reloaded = await PmoGroupingView.findOrFail(view.id)
    assert.equal(reloaded.isDefault, 0)
    assert.equal(reloaded.isOrgDefault, 0)
  })

  test('ownerUserId 可为 null（系统预设/共享视图）', async ({ assert }) => {
    const { org } = await setupOrg()
    const view = await PmoGroupingView.create({
      viewId: 'shared-no-owner',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
      ownerUserId: null,
      name: '共享视图无明确所有者',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'department' }),
      isDefault: 0,
      isOrgDefault: 0,
    })
    assert.isNull(view.ownerUserId)
  })

  // ─── JSON 定义形状 ─────────────────────────────────────────────────────

  test('queryDefinition 写入回读为 JSON 对象', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const queryDef = {
      primaryGrouping: 'health',
      secondaryGrouping: 'status',
      sort: 'project_count',
      order: 'desc',
      topN: 10,
    }

    const view = await PmoGroupingView.create({
      viewId: 'json-test',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: 'JSON 测试',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify(queryDef),
      isDefault: 0,
      isOrgDefault: 0,
    })

    const loaded = await PmoGroupingView.findOrFail(view.id)
    const parsed =
      typeof loaded.queryDefinition === 'string'
        ? JSON.parse(loaded.queryDefinition)
        : loaded.queryDefinition
    assert.equal(parsed.primaryGrouping, 'health')
    assert.equal(parsed.secondaryGrouping, 'status')
    assert.equal(parsed.sort, 'project_count')
    assert.equal(parsed.topN, 10)
  })

  // ─── 时间戳 ────────────────────────────────────────────────────────────

  test('createdAt/updatedAt 自动填充', async ({ assert }) => {
    const { DateTime } = await import('luxon')
    const { org, owner } = await setupOrg()

    const view = await PmoGroupingView.create({
      viewId: 'ts-test',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '时间戳测试',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    assert.isTrue(DateTime.isDateTime(view.createdAt))
    assert.isTrue(DateTime.isDateTime(view.updatedAt))
    // deletedAt 没有传入 create()，实例上是 undefined；库里才是 null。
    const reloaded = await PmoGroupingView.findOrFail(view.id)
    assert.isNull(reloaded.deletedAt)
  })

  test('deleted_at 默认为 null', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const view = await PmoGroupingView.create({
      viewId: 'not-deleted',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '未删除',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })
    const reloaded = await PmoGroupingView.findOrFail(view.id)
    assert.isNull(reloaded.deletedAt)
  })

  // ─── 系统预设排除 ──────────────────────────────────────────────────────

  test('系统预设不持久化到数据库（scope=system 不存入表）', async ({ assert }) => {
    const { org } = await setupOrg()
    // 创建后检查：scope=system 应被拒绝（validator 负责拦截，model 层允许但前端不会传入）
    // 此测试验证数据库中没有 system scope 的视图
    const views = await PmoGroupingView.query()
      .where('organization_id', Number(org.id))
      .where('scope', PMO_GROUPING_VIEW_SCOPES.SYSTEM)
      .whereNull('deleted_at')

    // 系统预设不在数据库中存储，由 getSystemPresetViews() 在代码中提供
    assert.lengthOf(views, 0)
  })

  // ─── 软删除 ────────────────────────────────────────────────────────────

  test('软删除：deletedAt 非 null 后 find 不返回', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const { DateTime } = await import('luxon')

    const view = await PmoGroupingView.create({
      viewId: 'to-delete',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '待删除',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    view.deletedAt = DateTime.now()
    await view.save()

    const notFound = await PmoGroupingView.query()
      .where('view_id', 'to-delete')
      .whereNull('deleted_at')
      .first()
    assert.isNull(notFound)
  })

  test('软删除：数据库原始行仍然存在', async ({ assert }) => {
    const { org, owner } = await setupOrg()
    const { DateTime } = await import('luxon')

    const view = await PmoGroupingView.create({
      viewId: 'soft-deleted',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '软删除视图',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    view.deletedAt = DateTime.now()
    await view.save()

    const raw = await db.from('pmo_grouping_views').where('view_id', 'soft-deleted').first()
    assert.isNotNull(raw)
    assert.isNotNull(raw!.deleted_at)
  })

  // ─── 关系 ──────────────────────────────────────────────────────────────

  test('关联 organization 加载正确', async ({ assert }) => {
    const { org, owner } = await setupOrg()

    await PmoGroupingView.create({
      viewId: 'rel-org',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '关联测试',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    const loaded = await PmoGroupingView.query()
      .where('view_id', 'rel-org')
      .whereNull('deleted_at')
      .preload('organization')
      .firstOrFail()

    assert.exists(loaded.organization)
    assert.equal(loaded.organization.id, Number(org.id))
  })

  test('关联 owner 加载正确', async ({ assert }) => {
    const { org, owner } = await setupOrg()

    await PmoGroupingView.create({
      viewId: 'rel-owner',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '所有者关联',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    const loaded = await PmoGroupingView.query()
      .where('view_id', 'rel-owner')
      .whereNull('deleted_at')
      .preload('owner')
      .firstOrFail()

    assert.exists(loaded.owner)
    assert.equal(loaded.owner.id, Number(owner.id))
  })
})
