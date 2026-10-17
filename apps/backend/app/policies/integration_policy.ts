import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { INTEGRATION_CONNECT } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class IntegrationPolicy {
  constructor(private rbac: RbacService) {}

  async connect(user: User, organizationId: number) {
    const result = await this.rbac.check(user, INTEGRATION_CONNECT, organizationId)
    return result.allowed
  }
}
