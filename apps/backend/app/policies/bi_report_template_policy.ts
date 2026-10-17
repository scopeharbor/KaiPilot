import { inject } from '@adonisjs/core'
import { PermissionDeniedException, ResourceNotFoundException } from '#exceptions/api_exception'
import type User from '#models/user'
import { CanonicalRole, canonicalRoleFromOrganizationRole } from '#rbac'
import OrganizationMember from '#models/organization_member'

/**
 * BI 报表模板库策略（v3-bi-report-template-library §3.3）。
 *
 * 分层：
 *   1. **组织隔离**：非成员按 RESOURCE_NOT_FOUND 拒绝。
 *   2. **读权限**：组织成员即可浏览模板目录/详情/预览。
 *   3. **写权限**：组织管理员 (org_admin) 或 PMO 角色才可另存为/编辑/归档副本。
 *   4. **维度脱敏**：团队绩效模板的个人级数据需额外权限位。
 */
@inject()
export default class BiReportTemplatePolicy {
  /**
   * 组织隔离断言：非成员按 RESOURCE_NOT_FOUND 拒绝（不泄露组织是否存在）。
   */
  async assertOrganizationVisible(user: User, organizationId: number): Promise<void> {
    if (user.isSuperAdmin) return

    const { default: OrganizationModel } = await import('#models/organization')
    const organization = await OrganizationModel.find(organizationId)
    if (!organization) throw new ResourceNotFoundException('组织不存在')

    // 成员行**或**所有者：owner 可能没有 organization_members 行，只查成员表会把
    // 所有者挡在自己组织外面。注意 canWrite 下面已有 ownerId 判定，但它跑在本方法**之后**，
    // 所以在此之前就被拒的 owner 永远走不到那一支——两处语义必须一致。
    const belongs = await OrganizationMember.belongsToOrganization(organizationId, user.id)
    if (!belongs) throw new ResourceNotFoundException('组织不存在')
  }

  /**
   * 读权限：组织成员即可浏览模板目录/详情/预览。
   */
  async canRead(user: User, organizationId: number): Promise<void> {
    await this.assertOrganizationVisible(user, organizationId)
  }

  /**
   * 写权限：组织管理员或 PMO 角色。
   */
  async canWrite(user: User, organizationId: number): Promise<void> {
    await this.assertOrganizationVisible(user, organizationId)
    if (user.isSuperAdmin) return

    const { default: Organization } = await import('#models/organization')
    const org = await Organization.find(organizationId)
    if (org && org.ownerId === user.id) return

    const member = await OrganizationMember.query()
      .where('organization_id', organizationId)
      .where('user_id', user.id)
      .first()
    if (!member) {
      throw new PermissionDeniedException('无权管理 BI 报表模板')
    }

    const role = canonicalRoleFromOrganizationRole(member.role)
    if (role !== CanonicalRole.ORG_ADMIN) {
      throw new PermissionDeniedException('无权管理 BI 报表模板')
    }
  }

  /**
   * 团队绩效个人级数据权限：组织管理员具备。
   */
  async canViewPersonDimension(user: User, organizationId: number): Promise<boolean> {
    if (user.isSuperAdmin) return true
    try {
      await this.canWrite(user, organizationId)
      return true
    } catch {
      return false
    }
  }
}
