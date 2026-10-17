import { test } from '@japa/runner'
import ResourceService from '#services/resource_service'
import type AuditService from '#services/audit_service'
import ResourcePolicy from '#policies/resource_policy'
import RbacService from '#services/rbac_service'
import {
  createOrganization,
  createProjectWithMember,
  createUser,
  uniqueEmail,
  useAuthDatabase,
} from '../auth/_helpers.js'

test.group('ResourcePolicy', (group) => {
  useAuthDatabase(group)

  let policy: ResourcePolicy
  let rbac: RbacService

  group.each.setup(() => {
    const mockAudit = { log: async () => {} } as unknown as AuditService
    new ResourceService(mockAudit)
    rbac = new RbacService()
    policy = new ResourcePolicy(rbac)
  })

  async function setupProject() {
    const owner = await createUser({ email: uniqueEmail('pol-owner') })
    const org = await createOrganization(owner)
    const pm = await createUser({ email: uniqueEmail('pol-pm') })
    const { project } = await createProjectWithMember(org, owner, pm, 'Project Manager')
    return { owner, org, pm, project }
  }

  test('Owner（组织所有者）可以管理资源', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const allowed = await policy.manage(owner, org.id, project.id)
    assert.isTrue(allowed)
  })

  test('项目创建者可以管理资源', async ({ assert }) => {
    const { owner, org, project } = await setupProject()
    const allowed = await policy.manage(owner, org.id, project.id)
    assert.isTrue(allowed)
  })

  test('非成员无权限', async ({ assert }) => {
    const { org, project } = await setupProject()
    const stranger = await createUser({ email: uniqueEmail('pol-stranger') })
    const allowed = await policy.manage(stranger, org.id, project.id)
    assert.isFalse(allowed)
  })

  test('组织越权隔离', async ({ assert }) => {
    const { pm, project } = await setupProject()
    const otherOwner = await createUser({ email: uniqueEmail('pol-other') })
    const otherOrg = await createOrganization(otherOwner)

    const allowed = await policy.manage(pm, otherOrg.id, project.id)
    assert.isFalse(allowed)
  })
})
