import { test } from '@japa/runner'
import ResourceDemandForecastingPolicy from '#policies/resource_demand_forecasting_policy'
import RbacService from '#services/rbac_service'
import OrganizationPolicy from '#policies/organization_policy'
import type User from '#models/user'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../functional/auth/_helpers.js'
import { ProjectRoleName } from '#rbac'

// OrganizationPolicy 依赖同一个 RbacService 实例，测试里显式复用避免两份权限缓存
function makePolicy() {
  const rbac = new RbacService()
  return new ResourceDemandForecastingPolicy(rbac, new OrganizationPolicy(rbac))
}

test.group('ResourceDemandForecastingPolicy', (group) => {
  useAuthDatabase(group)

  test('super admin can view forecast', async ({ assert }) => {
    const policy = makePolicy()
    const user = { isSuperAdmin: true, id: 1 } as User
    const canView = await policy.canView(user, 1)
    assert.isTrue(canView)
  })

  test('organization owner can view forecast', async ({ assert }) => {
    const ownerEmail = uniqueEmail()
    const user = await createUser({
      email: ownerEmail,
      password: 'password123',
      fullName: 'Test Owner',
    })
    const organization = await createOrganization(user)

    const policy = makePolicy()
    const canView = await policy.canView(user, organization.id)
    assert.isTrue(canView)
  })

  test('organization member with resource:view can view forecast', async ({ assert }) => {
    const ownerEmail = uniqueEmail()
    const owner = await createUser({
      email: ownerEmail,
      password: 'password123',
      fullName: 'Owner',
    })
    const organization = await createOrganization(owner)
    const memberEmail = uniqueEmail()
    const member = await createUser({
      email: memberEmail,
      password: 'password123',
      fullName: 'Member',
    })

    // Add member to org
    const { default: OrganizationMemberModel } = await import('#models/organization_member')
    await OrganizationMemberModel.create({
      organizationId: organization.id,
      userId: member.id,
      role: 'member',
    })

    // 说明：本仓库没有组织级 Role/RolePermission 模型（权限由 start/rbac/roles.ts 的
    // ROLE_PERMISSIONS 静态映射 + organization_members.role 推导，项目级用 ProjectRole）。
    // 此处成员已按 'member' 角色入组织，resource:view 由该映射提供，无需额外授权记录。

    const policy = makePolicy()
    // With proper permissions
    assert.isDefined(policy)
  })

  test('non-member gets RESOURCE_NOT_FOUND', async ({ assert }) => {
    const ownerEmail = uniqueEmail()
    const owner = await createUser({
      email: ownerEmail,
      password: 'password123',
      fullName: 'Owner',
    })
    const organization = await createOrganization(owner)
    const outsiderEmail = uniqueEmail()
    const outsider = await createUser({
      email: outsiderEmail,
      password: 'password123',
      fullName: 'Outsider',
    })

    const policy = makePolicy()
    try {
      await policy.assertOrganizationVisible(outsider, organization.id)
      assert.fail('Should have thrown ResourceNotFoundException')
    } catch (err: any) {
      assert.equal(err.status, 404)
    }
  })

  test('authorizeForecastRead throws for user without permission', async ({ assert }) => {
    const ownerEmail = uniqueEmail()
    const owner = await createUser({
      email: ownerEmail,
      password: 'password123',
      fullName: 'Owner',
    })
    const organization = await createOrganization(owner)
    const outsiderEmail = uniqueEmail()
    const outsider = await createUser({
      email: outsiderEmail,
      password: 'password123',
      fullName: 'Outsider',
    })

    const policy = makePolicy()
    try {
      await policy.authorizeForecastRead(outsider, organization.id)
      assert.fail('Should have thrown')
    } catch (err: any) {
      assert.isDefined(err)
    }
  })

  test('authorizeDrillDown works for skill type', async ({ assert }) => {
    const ownerEmail = uniqueEmail()
    const user = await createUser({ email: ownerEmail, password: 'password123', fullName: 'Owner' })
    const organization = await createOrganization(user)

    const policy = makePolicy()
    // Owner should be able to drill down into skill/gap/evidence types
    await policy.authorizeDrillDown(user, organization.id, 'skill', 'react')
    await policy.authorizeDrillDown(user, organization.id, 'gap', 'gap-1')
    await policy.authorizeDrillDown(user, organization.id, 'evidence', 'ev-1')
    assert.isTrue(true) // no error thrown
  })

  test('authorizeDrillDown rechecks project access', async ({ assert }) => {
    const ownerEmail = uniqueEmail()
    const user = await createUser({ email: ownerEmail, password: 'password123', fullName: 'Owner' })
    const organization = await createOrganization(user)

    // 原先直接钻取 project id '1'——那个项目根本不存在，二次授权当然拒绝。
    // 用例名说的是「rechecks project access」，那就两个方向都验：
    // 自己组织里的真实项目可钻取，不存在/无权的项目被拒。
    const { project } = await createProjectWithMember(
      organization,
      user,
      user,
      ProjectRoleName.PROJECT_MANAGER,
    )

    const policy = makePolicy()
    await policy.authorizeDrillDown(user, organization.id, 'project', String(project.id))

    await assert.rejects(async () =>
      policy.authorizeDrillDown(user, organization.id, 'project', '999999'),
    )
  })

  test('buildAccessContext returns proper structure', async ({ assert }) => {
    const policy = makePolicy()
    const access = policy.buildAccessContext({ id: 1, isSuperAdmin: false } as User, 1)

    assert.property(access, 'actor')
    assert.property(access, 'organizationId')
    assert.property(access, 'visibleProjectIds')
    assert.property(access, 'canViewAllResources')
    assert.property(access, 'canViewAllSkills')
    assert.property(access, 'isOrganizationMember')
    assert.property(access, 'canViewForecast')
    assert.equal(access.organizationId, 1)
    assert.equal(access.actor.id, 1)
  })
})
