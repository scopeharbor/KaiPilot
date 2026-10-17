import OrganizationMemberPolicy from '#policies/organization_member_policy'
import OrganizationPolicy from '#policies/organization_policy'
import RbacPolicy from '#policies/rbac_policy'
import UserPolicy from '#policies/user_policy'
import RbacService from '#services/rbac_service'
import { ORG_MANAGE, ORG_VIEW, ProjectRoleName } from '#rbac'
import app from '@adonisjs/core/services/app'
import { test } from '@japa/runner'
import {
  addOrgMember,
  createOrganization,
  createProjectWithMember,
  createUser,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('管理 Policy 与 RBAC 辅助判定', (group) => {
  useAuthDatabase(group)

  test('组织管理员辅助判定覆盖系统管理员、owner、admin 与 member', async ({ assert }) => {
    const service = await app.container.make(RbacService)
    const systemAdmin = await createUser({ isSuperAdmin: true })
    const owner = await createUser()
    const admin = await createUser()
    const member = await createUser()
    const organization = await createOrganization(owner)
    await addOrgMember(organization, admin, 'admin')
    await addOrgMember(organization, member, 'member')

    assert.isTrue(await service.isOrgAdmin(systemAdmin, organization.id))
    assert.isTrue(await service.isOrgAdmin(owner, organization.id))
    assert.isTrue(await service.isOrgAdmin(admin, organization.id))
    assert.isFalse(await service.isOrgAdmin(member, organization.id))
  })

  test('项目经理辅助判定覆盖系统管理员、创建者、PM、普通成员与无成员', async ({ assert }) => {
    const service = await app.container.make(RbacService)
    const systemAdmin = await createUser({ isSuperAdmin: true })
    const creator = await createUser()
    const projectManager = await createUser()
    const member = await createUser()
    const stranger = await createUser()
    const organization = await createOrganization(creator)
    const { project } = await createProjectWithMember(
      organization,
      creator,
      projectManager,
      ProjectRoleName.PROJECT_MANAGER,
    )
    await createProjectWithMember(organization, creator, member, ProjectRoleName.MEMBER)

    assert.isTrue(await service.isProjectManager(systemAdmin, project.id))
    assert.isTrue(await service.isProjectManager(creator, project.id))
    assert.isTrue(await service.isProjectManager(projectManager, project.id))
    assert.isFalse(await service.isProjectManager(member, project.id))
    assert.isFalse(await service.isProjectManager(stranger, project.id))
  })

  test('通用与领域 Policy 消费中央权限判定，不硬编码旁路', async ({ assert }) => {
    const owner = await createUser()
    const member = await createUser()
    const systemAdmin = await createUser({ isSuperAdmin: true })
    const organization = await createOrganization(owner)
    await addOrgMember(organization, member, 'member')

    const rbacPolicy = await app.container.make(RbacPolicy)
    const organizationPolicy = await app.container.make(OrganizationPolicy)
    const memberPolicy = await app.container.make(OrganizationMemberPolicy)
    const userPolicy = new UserPolicy()

    assert.isTrue(await rbacPolicy.allows(owner, ORG_MANAGE, { organizationId: organization.id }))
    assert.include(await rbacPolicy.permissionsFor(owner, organization.id), ORG_VIEW)
    assert.isTrue(await organizationPolicy.view(member, organization.id))
    assert.isFalse(await organizationPolicy.manage(member, organization.id))
    assert.isTrue(organizationPolicy.admin(systemAdmin))
    assert.isTrue(await memberPolicy.view(member, organization.id))
    assert.isFalse(await memberPolicy.manage(member, organization.id))
    assert.isTrue(userPolicy.manage(systemAdmin))
    assert.isFalse(userPolicy.manage(member))
  })
})
