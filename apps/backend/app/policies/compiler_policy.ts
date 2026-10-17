/**
 * v2-project-compiler-foundation —— CompilerPolicy（tasks 8.3）。
 * v2-5-compiler-resume-replay-wiring —— canReplay（tasks 6.4）。
 *
 * 校验组织成员身份与角色/权限。
 * 越权返回 PERMISSION_DENIED。
 * 跨组织 run 读取返回 not-found，不泄漏存在性。
 */
import { inject } from '@adonisjs/core'
import type User from '#models/user'
import RbacService from '#services/rbac_service'
import { AI_TRIGGER } from '#start/rbac/permissions'
import type { PermissionCheckResult } from '#types/auth'

@inject()
export default class CompilerPolicy {
  constructor(private readonly rbac: RbacService) {}

  /** 是否可以发起编译。 */
  async canTrigger(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_TRIGGER, organizationId)
  }

  /** 是否可以读取编译结果。 */
  async canRead(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_TRIGGER, organizationId)
  }

  /** 是否可以 Resume 编译。 */
  async canResume(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_TRIGGER, organizationId)
  }

  /** 是否可以 Replay 编译（tasks 6.4, design D4）。读级权限。 */
  async canReplay(user: User, organizationId: number): Promise<PermissionCheckResult> {
    return this.rbac.check(user, AI_TRIGGER, organizationId)
  }
}
