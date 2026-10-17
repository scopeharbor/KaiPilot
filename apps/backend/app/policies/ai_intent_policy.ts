import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER } from '#rbac'
import { inject } from '@adonisjs/core'

@inject()
export default class AiIntentPolicy {
  constructor(private readonly rbac: RbacService) {}

  async analyze(user: User, organizationId: number): Promise<boolean> {
    const result = await this.rbac.check(user, AI_TRIGGER, organizationId)
    return result.allowed
  }
}
