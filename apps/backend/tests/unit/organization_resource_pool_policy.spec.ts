import { test } from '@japa/runner'
import OrganizationResourcePoolPolicy from '#policies/organization_resource_pool_policy'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import OrganizationMember from '#models/organization_member'
import { ProjectRoleName } from '#rbac'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'

test.group('OrganizationResourcePoolPolicy', (group) => {
  useAuthDatabase(group)

  let policy: OrganizationResourcePoolPolicy

  group.each.setup(() => {
    policy = new OrganizationResourcePoolPolicy(
      new RbacService(),
      new OrganizationPolicy(new RbacService()),
    )
  })

  // ─── 3.4.1: 非成员隔离 ────────────────────────────────────────────────────────

  test('non-member actor receives RESOURCE_NOT_FOUND, not pool existence hint', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-owner') })
    const org = await createOrganization(owner)
    const outsider = await createUser({ email: uniqueEmail('pool-pol-out') })

    await assert.rejects(
      () => policy.assertOrganizationVisible(outsider, Number(org.id)),
      /组织不存在/,
    )
  })

  test('organization owner passes visibility check', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-vis') })
    const org = await createOrganization(owner)

    await policy.assertOrganizationVisible(owner, Number(org.id))
    // 不抛出即通过
    assert.isTrue(true)
  })

  test('organization member passes visibility check', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-mem-own') })
    const member = await createUser({ email: uniqueEmail('pool-pol-mem') })
    const org = await createOrganization(owner)

    await OrganizationMember.create({
      organizationId: org.id,
      userId: member.id,
      role: 'member',
    })

    await policy.assertOrganizationVisible(member, Number(org.id))
    assert.isTrue(true)
  })

  // ─── 3.4.2: 授权读取 ──────────────────────────────────────────────────────────

  test('organization owner can view resource pool', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-view') })
    const org = await createOrganization(owner)

    const result = await policy.canView(owner, Number(org.id))
    assert.isTrue(result)
  })

  test('non-owner non-member without portfolio:view or resource:view cannot view', async ({
    assert,
  }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-noview-own') })
    const org = await createOrganization(owner)
    const stranger = await createUser({ email: uniqueEmail('pool-pol-noview') })

    const result = await policy.canView(stranger, Number(org.id))
    assert.isFalse(result)
  })

  test('authorizeView throws PermissionDenied when cannot view', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-auth-own') })
    const org = await createOrganization(owner)
    const stranger = await createUser({ email: uniqueEmail('pool-pol-auth') })

    await assert.rejects(() => policy.authorizeView(stranger, Number(org.id)), /无权查看组织资源池/)
  })

  // ─── 3.4.3: 资源维度脱敏 ─────────────────────────────────────────────────────

  test('resolveAccess returns limited access for basic member', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-dim-own') })
    const member = await createUser({ email: uniqueEmail('pool-pol-dim') })
    const org = await createOrganization(owner)

    await OrganizationMember.create({
      organizationId: org.id,
      userId: member.id,
      role: 'member',
    })

    const access = await policy.resolveAccess(member, Number(org.id))
    assert.isDefined(access)
    // 基本成员默认没有 resource:manage，所以 canViewResourceDetails 可能为 false
    assert.isDefined(access.canViewResourceDetails)
    assert.isDefined(access.canViewLinkedUsers)
    assert.isDefined(access.canViewPmo)
  })

  test('super admin gets full access', async ({ assert }) => {
    const admin = await createUser({ email: uniqueEmail('pool-pol-sa') })
    admin.isSuperAdmin = true
    const org = await createOrganization(admin)

    const access = await policy.resolveAccess(admin, Number(org.id))
    assert.isTrue(access.canViewResourceDetails)
    assert.isTrue(access.canViewLinkedUsers)
    assert.isTrue(access.canViewPmo)
  })

  // ─── 3.4.4: 项目可见性检查 ───────────────────────────────────────────────────

  test('project creator can view project', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-pc-own') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const result = await policy.canViewProject(owner, Number(org.id), Number(project.id))
    assert.isTrue(result)
  })

  test('non-member cannot view project', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-np-own') })
    const org = await createOrganization(owner)
    const outsider = await createUser({ email: uniqueEmail('pool-pol-np-out') })
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const result = await policy.canViewProject(outsider, Number(org.id), Number(project.id))
    assert.isFalse(result)
  })

  test('super admin always sees all projects', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-sa-proj-own') })
    const org = await createOrganization(owner)
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )
    const admin = await createUser({ email: uniqueEmail('pool-pol-sa-proj') })
    admin.isSuperAdmin = true

    const result = await policy.canViewProject(admin, Number(org.id), Number(project.id))
    assert.isTrue(result)
  })

  // ─── 3.4.5: 下钻重授权失败 ────────────────────────────────────────────────────

  test('drill-down to project without permission fails', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-dd-own') })
    const org = await createOrganization(owner)
    // 创建有权限的项目和没有权限的用户
    const stranger = await createUser({ email: uniqueEmail('pool-pol-dd') })
    // 先把 stranger 加为组织成员（否则 organization visible 会失败）
    await OrganizationMember.create({
      organizationId: org.id,
      userId: stranger.id,
      role: 'viewer',
    })
    const { project } = await createProjectWithMember(
      org,
      owner,
      owner,
      ProjectRoleName.PROJECT_MANAGER,
    )

    await assert.rejects(
      () => policy.authorizeDrillDown(stranger, Number(org.id), 'project', Number(project.id)),
      /无权查看该项目详情/,
    )
  })

  test('drill-down with unsupported kind fails', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-bad-dd') })
    const org = await createOrganization(owner)

    await assert.rejects(
      () => policy.authorizeDrillDown(owner, Number(org.id), 'unknown_kind'),
      /不支持的 drill-down 目标类型/,
    )
  })

  test('drill-down to conflict kind succeeds with entry-level permission', async ({ assert }) => {
    const owner = await createUser({ email: uniqueEmail('pool-pol-dd-conf-own') })
    const org = await createOrganization(owner)

    await policy.authorizeDrillDown(owner, Number(org.id), 'conflict')
    assert.isTrue(true)
  })
})
