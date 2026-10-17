import { inject } from '@adonisjs/core'
import OrganizationMember from '#models/organization_member'

@inject()
export default class MultiProjectDependencyDetectionPolicy {
  /**
   * 组织隔离：成员行**或**组织所有者才放行（其余 8 个方法全部委派到这里）。
   *
   * owner 可能没有 `organization_members` 行，此前只查成员表会把所有者
   * 挡在自己组织外面。
   */
  async before(organizationId: number, auth: { userId: number }): Promise<boolean> {
    try {
      return await OrganizationMember.belongsToOrganization(Number(organizationId), auth.userId)
    } catch {
      return false
    }
  }

  async plan(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async run(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async listRuns(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async listResults(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async getResult(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async ignoreResult(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async reopenResult(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }

  async buildDraftBridge(organizationId: number, auth: { userId: number }): Promise<boolean> {
    return this.before(organizationId, auth)
  }
}
