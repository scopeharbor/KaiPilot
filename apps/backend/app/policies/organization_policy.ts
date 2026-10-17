import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { ORG_MANAGE, ORG_VIEW } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class OrganizationPolicy {
  constructor(private rbac: RbacService) {}

  async view(user: User, organizationId: number) {
    const result = await this.rbac.check(user, ORG_VIEW, organizationId)
    return result.allowed
  }

  async manage(user: User, organizationId: number) {
    const result = await this.rbac.check(user, ORG_MANAGE, organizationId)
    return result.allowed
  }

  admin(user: User) {
    return user.isSuperAdmin
  }
}
