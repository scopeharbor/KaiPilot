import { OrganizationMemberSchema } from '#database/schema'
import Department from '#models/department'
import Organization from '#models/organization'
import User from '#models/user'
import { belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/**
 * 组织成员模型（基于自动生成的 OrganizationMemberSchema 基类）。
 *
 * `permissions` 为 JSON 列（成员级额外显式权限，可选）：用 prepare/consume 做
 * 对象 ↔ JSON 字符串 marshalling（同 ProjectRole.permissions）。
 */
export default class OrganizationMember extends OrganizationMemberSchema {
  /** V3 图表馆：成员所属 OBS 部门（W1.1 department_id 列）。 */
  @column()
  declare departmentId: number | null

  @belongsTo(() => Department, { foreignKey: 'departmentId' })
  declare department: BelongsTo<typeof Department>

  @belongsTo(() => User, { foreignKey: 'userId' })
  declare user: BelongsTo<typeof User>

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'invitedBy' })
  declare inviter: BelongsTo<typeof User>

  @column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })
  declare permissions: string[] | null

  /**
   * 用户是否属于该组织：**成员行 或 组织所有者**。
   *
   * 组织所有者可能没有 `organization_members` 行（历史数据 / 直接建组织），
   * 只查成员表会把所有者挡在自己组织外面。`RbacService.resolveOrganizationPermissions`
   * 与 `isOrgAdmin`、`TenantResolutionService`、`CrossProjectAllocationPolicy`
   * 早就各自带了 owner 兜底，但仍有若干判权点只查成员表——本 helper 是那条语义的**唯一出处**，
   * 新写组织隔离判定一律用它，不要再手写 `OrganizationMember.query().where(...)`。
   *
   * ⚠️ 只放宽到**用户自己拥有**的组织，不涉及任何他人组织，也不含 super admin 旁路
   *（全局能力必须由 registry / Policy 显式 opt-in，见 multitenant-isolation-developer-notes）。
   */
  static async belongsToOrganization(organizationId: number, userId: number): Promise<boolean> {
    const member = await this.query()
      .where('organization_id', organizationId)
      .where('user_id', userId)
      .first()
    if (member) return true

    const owned = await Organization.query()
      .where('id', organizationId)
      .where('owner_id', userId)
      .first()
    return owned !== null
  }
}
