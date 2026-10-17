import { compose } from '@adonisjs/core/helpers'
import hash from '@adonisjs/core/services/hash'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { beforeFetch, beforeFind, column, hasMany } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import { UserSchema } from '#database/schema'
import type { AccessToken } from '@adonisjs/auth/access_tokens'
import Organization from './organization.js'
import OrganizationMember from './organization_member.js'
import ProjectMember from './project_member.js'

/**
 * User 模型（sec7.1.1）。
 *
 * 绝大多数列由自动生成的 `UserSchema` 基类声明；本模型补充关联、JSON 序列化钩子与便捷方法。
 */
export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  declare id: number // 与 schema 基类一致；显式声明便于阅读（见 database/schema_rules.ts）
  static accessTokens = DbAccessTokensProvider.forModel(User)
  declare currentAccessToken?: AccessToken

  @column({
    prepare: (value: boolean) => value,
    consume: (value: boolean | number) => Boolean(value),
  })
  declare isActive: boolean

  @column({
    prepare: (value: boolean) => value,
    consume: (value: boolean | number) => Boolean(value),
  })
  declare isSuperAdmin: boolean

  /**
   * 个人版（free 组织）是否允许自行配置 AI 连接；默认 false = 使用平台统一 AI 配置。
   * 由平台管理员在用户管理里按账号开关（见 `platform_ai_scope.ts`）。
   */
  @column({
    prepare: (value: boolean) => value,
    consume: (value: boolean | number | null) => Boolean(value),
  })
  declare allowSelfAiConfig: boolean

  /**
   * 登录期免两步验证。只由 `node ace admin:create-super` 写入，无 HTTP 修改入口。
   */
  @column({
    prepare: (value: boolean) => value,
    consume: (value: boolean | number | null) => Boolean(value),
  })
  declare twoFactorExempt: boolean

  /**
   * 用户拥有的组织（作为 owner）。
   */
  @hasMany(() => Organization, { foreignKey: 'ownerId' })
  declare ownedOrganizations: HasMany<typeof Organization>

  /**
   * 用户所属的组织成员关系。
   */
  @hasMany(() => OrganizationMember, { foreignKey: 'userId' })
  declare organizationMembers: HasMany<typeof OrganizationMember>

  /**
   * 用户参与的项目成员关系。
   */
  @hasMany(() => ProjectMember, { foreignKey: 'userId' })
  declare projectMembers: HasMany<typeof ProjectMember>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof User>) {
    query.whereNull('deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof User>) {
    query.whereNull('deleted_at')
  }

  /**
   * 统一预加载用户所属组织及其角色，供认证响应与管理 API 复用。
   */
  static withOrganizations(query: ModelQueryBuilderContract<typeof User> = User.query()) {
    return query.preload('organizationMembers', (membersQuery) => {
      membersQuery.preload('organization')
    })
  }

  /**
   * 用户级配置（语言 / 主题 / 密度等）。应用层以对象读写，存储层序列化为 JSON。
   */
  @column({
    prepare: (value) => (value === null || value === undefined ? null : JSON.stringify(value)),
    consume: (value) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value) => value,
  })
  declare preferences: Record<string, unknown> | null

  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    }
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
