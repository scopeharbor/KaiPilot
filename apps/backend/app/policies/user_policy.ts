import type User from '#models/user'

/**
 * 用户管理属于系统管理员域。
 */
export default class UserPolicy {
  manage(user: User): boolean {
    return user.isSuperAdmin
  }
}
