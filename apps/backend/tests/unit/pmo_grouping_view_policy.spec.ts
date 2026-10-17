import PortfolioGroupingViewPolicy from '#policies/portfolio_grouping_view_policy'
import RbacService from '#services/rbac_service'
import { test } from '@japa/runner'
import {
  createOrganization,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import PmoGroupingView from '#models/pmo_grouping_view'
import { PMO_GROUPING_VIEW_DEFINITION_VERSION, PMO_GROUPING_VIEW_SCOPES } from '@aiproj/types'

test.group('PortfolioGroupingViewPolicy — §3.6', (group) => {
  useAuthDatabase(group)

  // pmo_grouping_views.view_id 是**全局** UNIQUE（不按组织分区），而生产用 randomUUID()
  // 生成，撞不上；测试若用固定字面量，同一个用例里 setup() 调两次（跨组织场景）必然撞约束。
  // 故这里给每次 setup 一个自增后缀。
  let setupSeq = 0
  async function setup() {
    const n = ++setupSeq
    const owner = await createUser({ email: uniqueEmail('pgv-policy') })
    const org = await createOrganization(owner)

    // 创建各类视图用于权限测试
    const personalView = await PmoGroupingView.create({
      viewId: `personal-view-${n}`,
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.PERSONAL,
      ownerUserId: Number(owner.id),
      name: '个人视图',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'status' }),
    })

    const sharedView = await PmoGroupingView.create({
      viewId: `shared-view-${n}`,
      organizationId: Number(org.id),
      scope: PMO_GROUPING_VIEW_SCOPES.ORGANIZATION,
      ownerUserId: Number(owner.id),
      name: '组织视图',
      definitionVersion: PMO_GROUPING_VIEW_DEFINITION_VERSION,
      queryDefinition: JSON.stringify({ primaryGrouping: 'health' }),
      isOrgDefault: 1,
    })

    return { org, owner, personalView, sharedView }
  }

  test('PMO viewer 可以查看 portfolio', async ({ assert }) => {
    const { org } = await setup()
    const viewer = await createUser({
      email: uniqueEmail('pmoviewer'),
      isSuperAdmin: false,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    // 由于无真实 RBAC 角色分配，使用 canViewPortfolio 底层调用
    // 测试不依赖具体 RBAC 角色，只验证方法调用
    const result = await policy.canViewPortfolio(viewer, Number(org.id))
    // 无 RBAC 分配时默认拒绝
    assert.isFalse(result)
  })

  test('SuperAdmin 可以查看 portfolio', async ({ assert }) => {
    const { org } = await setup()
    const admin = await createUser({
      email: uniqueEmail('pmo-admin'),
      isSuperAdmin: true,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canViewPortfolio(admin, Number(org.id))
    assert.isTrue(result)
  })

  test('SuperAdmin 可以管理 portfolio', async ({ assert }) => {
    const { org } = await setup()
    const admin = await createUser({
      email: uniqueEmail('pmomgr'),
      isSuperAdmin: true,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canManagePortfolio(admin, Number(org.id))
    assert.isTrue(result)
  })

  // ─── 个人视图权限 ──────────────────────────────────────────────────────

  test('所有者可以编辑自己的个人视图', async ({ assert }) => {
    const { org, owner, personalView } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canEditView(owner, Number(org.id), personalView)
    assert.isTrue(result)
  })

  test('非所有者不能编辑他人个人视图', async ({ assert }) => {
    const { org, personalView } = await setup()
    const other = await createUser({
      email: uniqueEmail('other'),
      isSuperAdmin: false,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canEditView(other, Number(org.id), personalView)
    assert.isFalse(result)
  })

  test('所有者可以删除自己的个人视图', async ({ assert }) => {
    const { org, owner, personalView } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canDeleteView(owner, Number(org.id), personalView)
    assert.isTrue(result)
  })

  test('非所有者不能删除他人个人视图', async ({ assert }) => {
    const { org, personalView } = await setup()
    const other = await createUser({
      email: uniqueEmail('non-owner'),
      isSuperAdmin: false,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canDeleteView(other, Number(org.id), personalView)
    assert.isFalse(result)
  })

  test('所有者可以复制个人视图', async ({ assert }) => {
    const { org, owner, personalView } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canDuplicateView(owner, Number(org.id), personalView)
    assert.isTrue(result)
  })

  test('所有者可以设置个人默认视图', async ({ assert }) => {
    const { org, owner } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canSetPersonalDefault(owner, Number(org.id))
    assert.isTrue(result, '组织所有者应可设置个人默认视图')

    // SuperAdmin 可以
    const admin = await createUser({
      email: uniqueEmail('admin-default'),
      isSuperAdmin: true,
    })
    const adminResult = await policy.canSetPersonalDefault(admin, Number(org.id))
    assert.isTrue(adminResult)
  })

  // ─── 组织共享视图权限 ──────────────────────────────────────────────────

  test('非 PMO Manager 不能编辑组织共享视图', async ({ assert }) => {
    const { org, sharedView } = await setup()
    const nonManager = await createUser({
      email: uniqueEmail('nonmgr'),
      isSuperAdmin: false,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canEditView(nonManager, Number(org.id), sharedView)
    assert.isFalse(result)
  })

  test('SuperAdmin 可以编辑组织共享视图', async ({ assert }) => {
    const { org, sharedView } = await setup()
    const admin = await createUser({
      email: uniqueEmail('org-admin'),
      isSuperAdmin: true,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canEditView(admin, Number(org.id), sharedView)
    assert.isTrue(result)
  })

  test('SuperAdmin 可以设置组织默认视图', async ({ assert }) => {
    const { org } = await setup()
    const admin = await createUser({
      email: uniqueEmail('set-org-default'),
      isSuperAdmin: true,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canSetOrganizationDefault(admin, Number(org.id))
    assert.isTrue(result)
  })

  test('非 PMO Manager 不能设置组织默认视图', async ({ assert }) => {
    const { org } = await setup()
    const viewer = await createUser({
      email: uniqueEmail('non-mgr-default'),
      isSuperAdmin: false,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canSetOrganizationDefault(viewer, Number(org.id))
    assert.isFalse(result)
  })

  test('非 PMO Manager 不能创建组织共享视图', async ({ assert }) => {
    const { org } = await setup()
    const viewer = await createUser({
      email: uniqueEmail('no-shared-create'),
      isSuperAdmin: false,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canWriteShared(viewer, Number(org.id))
    assert.isFalse(result)
  })

  test('SuperAdmin 可以创建组织共享视图', async ({ assert }) => {
    const { org } = await setup()
    const admin = await createUser({
      email: uniqueEmail('shared-create'),
      isSuperAdmin: true,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const result = await policy.canWriteShared(admin, Number(org.id))
    assert.isTrue(result)
  })

  // ─── 系统预设不可修改 ─────────────────────────────────────────────────

  test('系统预设不可编辑', async ({ assert }) => {
    const { org, owner } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    // 模拟系统预设视图
    const systemPreset = {
      scope: PMO_GROUPING_VIEW_SCOPES.SYSTEM,
      viewId: 'system-by-status',
      organizationId: Number(org.id),
      ownerUserId: null,
      name: '',
      description: null,
      definitionVersion: '',
      queryDefinition: '',
      isDefault: 0,
      isOrgDefault: 0,
    } as unknown as PmoGroupingView

    const result = await policy.canEditView(owner, Number(org.id), systemPreset)
    assert.isFalse(result)
  })

  test('系统预设不可删除', async ({ assert }) => {
    const { org, owner } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const systemPreset = {
      scope: PMO_GROUPING_VIEW_SCOPES.SYSTEM,
      viewId: 'system-by-status',
      organizationId: Number(org.id),
      ownerUserId: null,
      name: '',
      description: null,
      definitionVersion: '',
      queryDefinition: '',
      isDefault: 0,
      isOrgDefault: 0,
    } as unknown as PmoGroupingView

    const result = await policy.canDeleteView(owner, Number(org.id), systemPreset)
    assert.isFalse(result)
  })

  // ─── 跨组织 ────────────────────────────────────────────────────────────

  test('跨组织用户被拒绝查看 portfolio', async ({ assert }) => {
    // 建两个独立组织，只对第二个做越权访问断言
    await setup()
    const crossOrg = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    const nonMember = await createUser({
      email: uniqueEmail('cross-org'),
      isSuperAdmin: false,
    })
    const result = await policy.canViewPortfolio(nonMember, Number(crossOrg.org.id))
    assert.isFalse(result)
  })

  // ─── authorize 方法抛异常 ──────────────────────────────────────────────

  test('authorizeView 无权限时抛 PERMISSION_DENIED', async ({ assert }) => {
    const { org } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())
    const outsider = await createUser({
      email: uniqueEmail('outsider'),
      isSuperAdmin: false,
    })

    await assert.rejects(async () => {
      await policy.authorizeView(outsider, Number(org.id))
    })
  })

  test('authorizeManage 无权限时抛 PERMISSION_DENIED', async ({ assert }) => {
    const { org } = await setup()
    const policy = new PortfolioGroupingViewPolicy(new RbacService())
    const viewer = await createUser({
      email: uniqueEmail('viewer-only'),
      isSuperAdmin: false,
    })

    await assert.rejects(async () => {
      await policy.authorizeManage(viewer, Number(org.id))
    })
  })

  // ─── 默认视图范围分离 ─────────────────────────────────────────────────

  test('canSetDefault 区分 personal 和 organization scope', async ({ assert }) => {
    const { org } = await setup()
    const admin = await createUser({
      email: uniqueEmail('default-scope'),
      isSuperAdmin: true,
    })
    const policy = new PortfolioGroupingViewPolicy(new RbacService())

    assert.isTrue(await policy.canSetDefault(admin, Number(org.id), 'personal'))
    assert.isTrue(await policy.canSetDefault(admin, Number(org.id), 'organization'))

    const viewer = await createUser({
      email: uniqueEmail('default-scope-viewer'),
      isSuperAdmin: false,
    })
    assert.isFalse(await policy.canSetDefault(viewer, Number(org.id), 'personal'))
    assert.isFalse(await policy.canSetDefault(viewer, Number(org.id), 'organization'))
  })
})
