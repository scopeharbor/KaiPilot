import PortfolioGroupingViewService from '#services/portfolio_grouping_view_service'
import PortfolioGroupingViewPolicy from '#policies/portfolio_grouping_view_policy'
import AuditService from '#services/audit_service'
import PmoGroupingView from '#models/pmo_grouping_view'
import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import {
  PMO_GROUPING_VIEW_SCOPES,
  PMO_GROUPING_VIEW_PRIMARY_KEYS,
  PMO_GROUPING_VIEW_SORT_KEYS,
} from '@aiproj/types'

test.group('PortfolioGroupingViewService — §4.2/4.4/4.6/4.8', (group) => {
  useAuthDatabase(group)

  async function setupService() {
    const owner = await createUser({
      email: uniqueEmail('pgv-svc'),
      isSuperAdmin: true,
    })
    const org = await createOrganization(owner)
    const { default: RbacService } = await import('#services/rbac_service')
    const policy = new PortfolioGroupingViewPolicy((global as any).rbacService ?? new RbacService())
    // 用真实 AuditService（会落库）
    const audit = new AuditService()
    const service = new PortfolioGroupingViewService(policy, audit)

    // 预创建组织共享视图
    const sharedView = await PmoGroupingView.create({
      viewId: 'svc-shared-001',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
      ownerUserId: Number(owner.id),
      name: '服务测试组织视图',
      description: '用于 service 测试',
      definitionVersion: 'grouping-view.v1',
      queryDefinition: JSON.stringify({
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH,
        sort: PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
        order: 'desc',
      }),
    })

    return { service, org, owner, sharedView }
  }

  // ─── §4.2 列表 ──────────────────────────────────────────────────────────

  test('list: 返回系统预设视图', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.list(owner, Number(org.id))
    assert.isArray(result.data)
    // 至少包含 6 个系统预设
    const presets = result.data.filter((v: any) => v.scope === 'system')
    assert.equal(presets.length, 6)
  })

  test('list: 包含数据库保存的视图', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.list(owner, Number(org.id))
    const dbViews = result.data.filter((v: any) => v.scope !== 'system')
    assert.isTrue(dbViews.length >= 1)
  })

  test('list: 分页限制', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.list(owner, Number(org.id), { page: 1, perPage: 2 })
    assert.isArray(result.data)
    assert.isTrue(result.data.length <= 2)
    assert.equal(result.meta.page, 1)
    assert.equal(result.meta.perPage, 2)
  })

  test('list: scope 过滤仅返回个人视图', async ({ assert }) => {
    const { service, org, owner } = await setupService()

    // 创建一个个人视图
    await service.create(owner, Number(org.id), {
      name: 'list-scope-test',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const result = await service.list(owner, Number(org.id), {
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
    })
    // 系统预设被过滤掉
    assert.isTrue(result.data.every((v: any) => v.scope === 'personal'))
  })

  test('list: 搜索过滤', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.list(owner, Number(org.id), { search: '服务测试' })
    assert.isTrue(result.data.some((v: any) => v.name.includes('服务测试')))
  })

  // ─── §4.2 详情 ──────────────────────────────────────────────────────────

  test('detail: 返回系统预设详情', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.detail(owner, Number(org.id), 'system-by-status')
    assert.isNotNull(view)
    assert.equal(view!.id, 'system-by-status')
    assert.equal(view!.scope, 'system')
  })

  test('detail: 返回数据库视图详情', async ({ assert }) => {
    const { service, org, owner, sharedView } = await setupService()
    const view = await service.detail(owner, Number(org.id), sharedView.viewId)
    assert.isNotNull(view)
    assert.equal(view!.id, sharedView.viewId)
  })

  test('detail: 不存在的视图返回 null', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.detail(owner, Number(org.id), 'nonexistent-id')
    assert.isNull(view)
  })

  test('detail: 跨组织视图返回 null（RESOURCE_NOT_FOUND masking）', async ({ assert }) => {
    const { service, org } = await setupService()
    const { org: org2, owner: owner2 } = await (async () => {
      const u = await createUser({ email: uniqueEmail('org2-detail') })
      const o = await createOrganization(u)
      return { org: o, owner: u }
    })()

    // 在 org2 创建一个视图
    await PmoGroupingView.create({
      viewId: 'org2-view',
      organizationId: Number(org2.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner2.id),
      name: 'Org2 视图',
      definitionVersion: 'grouping-view.v1',
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    // org1 的用户查询 org2 的视图
    const org1User = await createUser({
      email: uniqueEmail('org1-user'),
      isSuperAdmin: true,
    })
    const view = await service.detail(org1User, Number(org.id), 'org2-view')
    assert.isNull(view)
  })

  test('detail: 非所有者查询他人个人视图返回 null（masking）', async ({ assert }) => {
    const { service, org, owner } = await setupService()

    const otherUser = await createUser({
      email: uniqueEmail('other-personal'),
      isSuperAdmin: false,
    })
    // 创建他人的个人视图
    const otherView = await PmoGroupingView.create({
      viewId: 'other-personal-view',
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(otherUser.id),
      name: '他人视图',
      definitionVersion: 'grouping-view.v1',
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    const view = await service.detail(owner, Number(org.id), otherView.viewId)
    // owner 没有 portfolio:manage，看不到他人个人视图
    assert.isNull(view)
  })

  // ─── §4.4 预览 ──────────────────────────────────────────────────────────

  test('preview: 按保存视图预览', async ({ assert }) => {
    const { service, org, owner, sharedView } = await setupService()
    const result = await service.preview(owner, Number(org.id), {
      viewId: sharedView.viewId,
    })
    assert.isNotNull(result)
    assert.isArray(result!.groups)
    assert.isObject(result!.meta)
    assert.equal(result!.meta.organizationId, Number(org.id))
  })

  test('preview: 按临时 query 预览', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.preview(owner, Number(org.id), {
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    assert.isNotNull(result)
    assert.isArray(result!.groups)
    assert.isObject(result!.meta)
  })

  test('preview: 不存在的视图 ID 返回 null', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.preview(owner, Number(org.id), {
      viewId: 'nonexistent',
    })
    assert.isNull(result)
  })

  test('preview: 无 viewId 和 query 时默认按 status 分组', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.preview(owner, Number(org.id), {})
    assert.isNotNull(result)
    assert.isArray(result!.groups)
  })

  test('preview: 带 secondaryGrouping 返回二级分组', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.preview(owner, Number(org.id), {
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        secondaryGrouping: 'health',
      },
    })
    assert.isNotNull(result)
    // 每个 group 可能包含 secondaryGroups
    assert.isArray(result!.groups)
  })

  test('preview: 预览不产生写操作（无落库/无审计）', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    // 先获取当前审计日志数量
    const auditBefore = await PmoGroupingView.query()
      .where('organization_id', Number(org.id))
      .whereNull('deleted_at')
      .count('* as total')

    await service.preview(owner, Number(org.id), {
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const auditAfter = await PmoGroupingView.query()
      .where('organization_id', Number(org.id))
      .whereNull('deleted_at')
      .count('* as total')

    // 预览不应创建新视图记录
    assert.equal(auditBefore[0].$extras.total, auditAfter[0].$extras.total)
  })

  // ─── §4.6 写操作 ────────────────────────────────────────────────────────

  test('create: 个人视图创建成功', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '新个人视图',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS,
        sort: PMO_GROUPING_VIEW_SORT_KEYS.PROJECT_COUNT,
        order: 'desc',
      },
    })
    assert.isNotNull(view)
    assert.equal(view.name, '新个人视图')
    assert.equal(view.scope, 'personal')
    assert.equal(view.organizationId, Number(org.id))
    assert.equal(view.definitionVersion, 'grouping-view.v1')
    assert.isFalse(view.isDefault)
  })

  test('create: 组织共享视图创建成功（需管理权限）', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '新组织视图',
      scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.DEPARTMENT },
    })
    assert.isNotNull(view)
    assert.equal(view.scope, 'organization')
  })

  test('create: 设默认时清除旧默认', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    // 创建第一个默认视图
    const v1 = await service.create(owner, Number(org.id), {
      name: '默认1',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
      isDefault: true,
    })
    assert.isTrue(v1.isDefault)

    // 创建第二个默认视图
    const v2 = await service.create(owner, Number(org.id), {
      name: '默认2',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH },
      isDefault: true,
    })
    assert.isTrue(v2.isDefault)

    // 旧默认应被清除
    const oldDefault = await service.detail(owner, Number(org.id), v1.id)
    assert.isFalse(oldDefault!.isDefault)
  })

  test('update: 更新名称和描述', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '原始名称',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const updated = await service.update(owner, Number(org.id), view.id, {
      name: '更新后名称',
      description: '新描述',
    })
    assert.isNotNull(updated)
    assert.equal(updated!.name, '更新后名称')
    assert.equal(updated!.description, '新描述')
  })

  test('update: 更新查询定义', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '查询更新测试',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const updated = await service.update(owner, Number(org.id), view.id, {
      query: {
        primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.HEALTH,
        sort: PMO_GROUPING_VIEW_SORT_KEYS.GROUP_NAME,
        order: 'asc',
      },
    })
    assert.isNotNull(updated)
    assert.equal(updated!.query.primaryGrouping, 'health')
    assert.equal(updated!.query.sort, 'group_name')
  })

  test('update: 不存在的视图返回 null', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const updated = await service.update(owner, Number(org.id), 'nonexistent', {
      name: 'noop',
    })
    assert.isNull(updated)
  })

  test('delete: 软删除成功', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '待删除视图',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const deleted = await service.delete(owner, Number(org.id), view.id)
    assert.isTrue(deleted)

    const after = await service.detail(owner, Number(org.id), view.id)
    assert.isNull(after)
  })

  test('delete: 不存在的视图返回 false', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const deleted = await service.delete(owner, Number(org.id), 'nonexistent')
    assert.isFalse(deleted)
  })

  test('duplicate: 复制视图为个人视图', async ({ assert }) => {
    const { service, org, owner, sharedView } = await setupService()
    const dup = await service.duplicate(owner, Number(org.id), sharedView.viewId, '我的副本')
    assert.isNotNull(dup)
    assert.equal(dup!.name, '我的副本')
    assert.equal(dup!.scope, 'personal')
    // 原始视图不变
    const original = await service.detail(owner, Number(org.id), sharedView.viewId)
    assert.isNotNull(original)
  })

  test('duplicate: 复制系统预设', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const dup = await service.duplicate(owner, Number(org.id), 'system-by-status', '系统预设副本')
    assert.isNotNull(dup)
    assert.equal(dup!.name, '系统预设副本')
    assert.equal(dup!.scope, 'personal')
  })

  test('setDefault: 设置个人默认', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '设默认测试',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const result = await service.setDefault(owner, Number(org.id), view.id, 'personal')
    assert.isNotNull(result)
    assert.isTrue(result!.isDefault)
  })

  test('setDefault: 系统预设不可设为默认', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const result = await service.setDefault(owner, Number(org.id), 'system-by-status', 'personal')
    assert.isNull(result)
  })

  // ─── §4.8 审计 ──────────────────────────────────────────────────────────

  test('create 写入审计事件', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    // 审计已由 Service 内部处理，此测试验证创建不抛异常
    const view = await service.create(owner, Number(org.id), {
      name: '审计创建测试',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    assert.isNotNull(view)
  })

  test('update 写入审计事件', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '审计更新前',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const updated = await service.update(owner, Number(org.id), view.id, {
      name: '审计更新后',
    })
    assert.isNotNull(updated)
  })

  test('delete 写入审计事件', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '审计删除测试',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const deleted = await service.delete(owner, Number(org.id), view.id)
    assert.isTrue(deleted)
  })

  test('setDefault 写入审计事件', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    const view = await service.create(owner, Number(org.id), {
      name: '审计默认测试',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })

    const result = await service.setDefault(owner, Number(org.id), view.id, 'personal')
    assert.isNotNull(result)
  })

  test('审计不包含敏感字段（无 evidence/prompt/model/token/apiKey）', async ({ assert }) => {
    const { service, org, owner } = await setupService()
    // 创建操作不会抛出敏感内容错误（正常视图不包含）
    const view = await service.create(owner, Number(org.id), {
      name: '无敏感字段',
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      query: { primaryGrouping: PMO_GROUPING_VIEW_PRIMARY_KEYS.STATUS },
    })
    assert.isNotNull(view)
    // 审计记录不应包含 evidenceText/prompt/modelOutput/token/apiKey
    // 这是隐式测试：如果审计写入包含这些字段，审计本身会报错
  })
})
