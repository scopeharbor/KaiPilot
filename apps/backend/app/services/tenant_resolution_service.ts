// @aiproj/backend — TenantResolutionService（v3-multitenant-tenant-identification §3）。
//
// 租户**识别**服务（design Decision 1/2/5）：在 Controller/Service/job 之前从服务端可信状态
// 产出有效租户决定 EffectiveTenantContext。与 `v3-multitenant-isolation-architecture` 的
// TenantScopeService（隔离**执行**层：scoped query/find/assert）分工：
//   - 本服务：解析"本次操作属于哪个租户、从哪里识别、membership 是否新鲜、scope mode"。
//   - TenantScopeService：消费 ctx.tenant / ctx.tenantDecision 做实际查询隔离。
//
// 解析优先级（Decision 2，固定且 fail closed）：
//   1. 已验证认证态 actor（ctx.authUser + ctx.authPayload）
//   2. JWT 声明的 organizationId（auth_token 来源）
//   3. 服务端 membership / owner 记录校验
//   4. membership freshness（roleVersion + member.updatedAt + org 软删除状态）
// 客户端 body/query 的 organizationId 不进入本服务事实源（由 tenant_middleware 的
// assertRouteAndBodyConsistency 做一致性校验，不一致即 404 不泄露）。
//
// 输出 EffectiveTenantContext 是低敏决定：只含 actorRef/orgId/scopeMode/source/reason/
// scopeHash/membershipVersionHash/warningCodes，不含原始 JWT、完整成员记录、隐藏资源名、权限全集。
// 中间件据 resolutionReason 决定放行（super admin global / 无 tenant 的可选路由）或 fail closed。

import OrganizationMember from '#models/organization_member'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import type { JwtAccessPayload } from '#types/auth'
import {
  buildEffectiveTenantContext,
  type EffectiveTenantContext,
  type TenantResolutionReason,
  type TenantSelectionSource,
  type TenantWarningCode,
} from '@aiproj/types/multitenant-tenant-identification'
// FNV-1a 通用哈希由 isolation-architecture 模块导出（mt 前缀）。
import { mtFnv1aHash } from '@aiproj/types/multitenant-isolation-architecture'

/**
 * membershipVersionHash 输入：组合 roleVersion（user.roleVersion，RBAC 即时传播）+
 * member 行 updatedAt（成员关系/角色变化的代理时间戳）+ org 软删除状态。
 * 任一变化 → hash 变 → 旧 selection snapshot 被 stale 检测捕获（Decision 5）。
 */
function computeMembershipVersionHash(params: {
  roleVersion: number
  memberUpdatedAt: string | null
  orgDeleted: boolean
}): string {
  // 用通用 FNV-1a 哈希（低敏、确定性）；输入不含敏感字段。
  // 注意不能用 tiComputePermissionHash：它的入参是 {roleVersion, organizationId,
  // scopeMode} 三元组，与这里要绑定的 membership 版本三元组不是同一组事实。
  return mtFnv1aHash(
    `rv=${params.roleVersion}|mu=${params.memberUpdatedAt ?? 'null'}|od=${params.orgDeleted ? 1 : 0}`,
  )
}

export interface TenantResolutionInput {
  /** 已验证的 JWT payload（由 auth middleware 注入）。 */
  payload?: JwtAccessPayload | null
  /** 已验证的 user（由 auth middleware 注入）。 */
  user?: User | null
  /** 路由解析的可选项目 scope（来自 tenant_middleware.resolveTenantProjectId）。 */
  projectId?: number | null
}

export interface TenantResolutionResult {
  /** 识别结果（低敏决定）。 */
  context: EffectiveTenantContext
  /**
   * 是否为有效 tenant scope（可放行业务）。
   * false 时中间件应据 reason 决定抛异常或放行匿名/全局路由。
   */
  ok: boolean
}

export default class TenantResolutionService {
  /**
   * 从服务端可信状态解析有效租户决定。
   * 不抛异常——所有缺失/过期/不匹配都编码进 context.resolutionReason + ok=false，
   * 由调用方（中间件）决定 fail closed 语义。这样单元测试可直驱返回值，且
   * 错误语义统一在中间件层映射为非泄露 HTTP 错误。
   *
   * resolver 依赖（组织/成员/角色版本查询）异常时返回 `RESOLVER_FAILED` degraded 决定
   * （§3.5）：服务端此刻拿不到可信租户事实，**绝不回退**到客户端提交的 organizationId
   * hint；中间件据此抛 503，不放行业务。
   */
  async resolve(input: TenantResolutionInput): Promise<TenantResolutionResult> {
    try {
      return await this.resolveFromTrustedState(input)
    } catch {
      // 只吞 resolver 基础设施异常，转成低敏 degraded 决定（不含原始错误信息，
      // 避免把 DB 错误文本/SQL/路径带进响应或审计）。
      const actorRef = input.user ? `user:${input.user.id}` : 'user:unknown'
      return this.fail(
        actorRef,
        Boolean(input.user?.isSuperAdmin),
        // 注意不回写 JWT 声明的组织：degraded 决定不得携带任何可被下游当作
        // 「已解析租户」使用的具体 org（下游只应看到 ok=false + RESOLVER_FAILED）。
        null,
        'RESOLVER_FAILED',
        [],
      )
    }
  }

  private async resolveFromTrustedState(
    input: TenantResolutionInput,
  ): Promise<TenantResolutionResult> {
    const user = input.user ?? null
    const payload = input.payload ?? null

    // 1. 未认证 → 无 actor，无法解析（中间件据路由决定 401 或放行公开路由）。
    if (!user || !payload) {
      return this.noActiveTenant('user:unknown', 'NO_ACTIVE_ORGANIZATION')
    }

    const actorRef = `user:${user.id}`
    const isSuperAdmin = Boolean(user.isSuperAdmin)
    const jwtOrgId = payload.organizationId ?? null

    // 2. JWT 无组织声明。
    if (jwtOrgId === null) {
      // super admin 无 org → global-low-sensitive（须显式 allow-list 才放行业务，见 §6）。
      if (isSuperAdmin) {
        return this.superAdminGlobal(actorRef, 'global-low-sensitive')
      }
      // 普通用户无 org → 无有效 tenant（须重新选组织）。
      return this.noActiveTenant(actorRef, 'NO_ACTIVE_ORGANIZATION', ['NO_ACTIVE_TENANT'])
    }

    // 3. 校验组织存在且未软删除。
    // 注意：Organization 的 beforeFind/beforeFetch 钩子会自动补 `whereNull('deleted_at')`，
    // 走模型查询时软删除组织与不存在组织都返回 null，stale 检测就分不出「已删除」和
    // 「不存在」。这里绕过模型直接查 query builder（不挂钩子），只取 deleted_at 一列。
    // 两条分支对外的响应体必须保持不可区分（都是 fail + ORGANIZATION_HIDDEN），
    // 区分只进低敏 reason 供排查，不泄露组织存在性。
    // 走 query builder 拿到的是原始行，列名是 snake_case（不是模型的驼峰属性）。
    const organization = await db
      .from('organizations')
      .where('id', jwtOrgId)
      .select('deleted_at', 'owner_id')
      .first()
    if (!organization) {
      return this.fail(actorRef, isSuperAdmin, jwtOrgId, 'ORGANIZATION_MISSING', [
        'ORGANIZATION_HIDDEN',
      ])
    }
    if (organization.deleted_at) {
      return this.fail(actorRef, isSuperAdmin, jwtOrgId, 'ORGANIZATION_DELETED', [
        'ORGANIZATION_HIDDEN',
      ])
    }

    // 4. super admin 带具体 org → tenant 模式（不默认全局业务可见，§6.2）。
    if (isSuperAdmin) {
      const memberUpdatedAt = await this.fetchMemberUpdatedAt(user.id, jwtOrgId)
      const membershipVersionHash = computeMembershipVersionHash({
        roleVersion: user.roleVersion,
        memberUpdatedAt,
        orgDeleted: false,
      })
      const context = buildEffectiveTenantContext({
        actorRef,
        organizationId: jwtOrgId,
        projectId: input.projectId ?? null,
        membershipRole: 'super_admin',
        membershipVersionHash,
        scopeMode: 'tenant',
        selectionSource: 'auth_token',
        resolutionReason: 'SUPER_ADMIN_TENANT_SCOPE',
        isSuperAdmin: true,
      })
      return { context, ok: true }
    }

    // 5. 普通用户：校验 membership（owner fallback，与既有 tenant_middleware 一致）。
    const member = await OrganizationMember.query()
      .where('user_id', user.id)
      .where('organization_id', jwtOrgId)
      .first()

    const isOwner = Number(organization.owner_id) === user.id
    if (!member && !isOwner) {
      // 非成员且非 owner → 隐藏（不区分"组织不存在"与"越权"）。
      return this.fail(actorRef, isSuperAdmin, jwtOrgId, 'NOT_A_MEMBER', ['ORGANIZATION_HIDDEN'])
    }

    // 6. membership freshness：JWT roleVersion 与 DB user.roleVersion 不一致 → stale。
    //    旧 token 在 bumpRoleVersion 后应被拒绝（RBAC D9 即时失效语义）。
    if (payload.roleVersion !== user.roleVersion) {
      return this.fail(actorRef, isSuperAdmin, jwtOrgId, 'ROLE_STALE', [
        'ROLE_STALE_REFRESH_REQUIRED',
      ])
    }

    const membershipVersionHash = computeMembershipVersionHash({
      roleVersion: user.roleVersion,
      memberUpdatedAt: member?.updatedAt?.toISO() ?? null,
      orgDeleted: false,
    })
    const context = buildEffectiveTenantContext({
      actorRef,
      organizationId: jwtOrgId,
      projectId: input.projectId ?? null,
      membershipRole: member?.role ?? 'owner',
      membershipVersionHash,
      scopeMode: 'tenant',
      selectionSource: 'auth_token',
      resolutionReason: 'RESOLVED',
      isSuperAdmin: false,
    })
    return { context, ok: true }
  }

  /**
   * 重新解析后台作业 / 长流程恢复时的 selection snapshot。
   * 取 snapshot 中的 organizationId + membershipVersionHash，重新查库比对：
   * 若 membership 已移除/角色降级/组织删除 → stale，返回 ok=false（worker 须拒绝副作用）。
   */
  async revalidateSnapshot(params: {
    actorRef: string
    organizationId: number | null
    expectedMembershipVersionHash: string | null
    isSuperAdmin?: boolean
  }): Promise<TenantResolutionResult> {
    try {
      return await this.revalidateFromTrustedState(params)
    } catch {
      // resolver 故障（§3.5）：worker 必须拒绝副作用，不得凭 snapshot 里的旧 org 继续。
      return this.fail(params.actorRef, Boolean(params.isSuperAdmin), null, 'RESOLVER_FAILED', [
        'REPLAY_STALE_OR_INVALID',
      ])
    }
  }

  private async revalidateFromTrustedState(params: {
    actorRef: string
    organizationId: number | null
    expectedMembershipVersionHash: string | null
    isSuperAdmin?: boolean
  }): Promise<TenantResolutionResult> {
    const userId = Number(params.actorRef.split(':')[1] ?? '0')
    if (!userId || params.organizationId === null) {
      return this.noActiveTenant(params.actorRef, 'NO_ACTIVE_ORGANIZATION', [
        'REPLAY_STALE_OR_INVALID',
      ])
    }

    const user = await User.find(userId)
    if (!user || !user.isActive) {
      return this.fail(
        params.actorRef,
        Boolean(params.isSuperAdmin),
        params.organizationId,
        'MEMBERSHIP_REMOVED',
        ['REPLAY_STALE_OR_INVALID'],
      )
    }

    // 复用主解析路径，再比对 membershipVersionHash。
    const payload: JwtAccessPayload = {
      sub: user.id,
      organizationId: params.organizationId,
      roleVersion: user.roleVersion,
      permissions: [],
    }
    const result = await this.resolve({ payload, user })
    if (!result.ok) {
      // 已是 stale/removed/deleted 语义，叠加 replay warning。
      return {
        context: {
          ...result.context,
          warningCodes: [
            'REPLAY_STALE_OR_INVALID' as TenantWarningCode,
            ...result.context.warningCodes,
          ],
        },
        ok: false,
      }
    }

    // membershipVersionHash 不匹配 → membership 在 snapshot 签发后变化了。
    if (
      params.expectedMembershipVersionHash &&
      result.context.membershipVersionHash !== params.expectedMembershipVersionHash
    ) {
      const context = buildEffectiveTenantContext({
        actorRef: result.context.actorRef,
        organizationId: result.context.organizationId,
        projectId: result.context.projectId,
        membershipRole: result.context.membershipRole,
        membershipVersionHash: result.context.membershipVersionHash,
        scopeMode: result.context.scopeMode,
        selectionSource: 'server_selection',
        resolutionReason: 'MEMBERSHIP_STALE',
        isSuperAdmin: result.context.isSuperAdmin,
        warningCodes: ['MEMBERSHIP_STALE_REFRESH_REQUIRED', 'REPLAY_STALE_OR_INVALID'],
      })
      return { context, ok: false }
    }

    // 重新解析成功，标记来源为 server_selection（snapshot 续跑）。
    const refreshed: EffectiveTenantContext = {
      ...result.context,
      selectionSource: 'server_selection' as TenantSelectionSource,
      resolutionReason: 'RESOLVED' as TenantResolutionReason,
    }
    return { context: refreshed, ok: true }
  }

  // ──────────────────────────────────────────────
  // 私有构造器
  // ──────────────────────────────────────────────

  private async fetchMemberUpdatedAt(
    userId: number,
    organizationId: number,
  ): Promise<string | null> {
    const member = await OrganizationMember.query()
      .where('user_id', userId)
      .where('organization_id', organizationId)
      .first()
    return member?.updatedAt?.toISO() ?? null
  }

  private noActiveTenant(
    actorRef: string,
    reason: TenantResolutionReason,
    warningCodes: TenantWarningCode[] = [],
  ): TenantResolutionResult {
    const context = buildEffectiveTenantContext({
      actorRef,
      organizationId: null,
      scopeMode: 'global-low-sensitive',
      selectionSource: 'auth_token',
      resolutionReason: reason,
      warningCodes,
    })
    return { context, ok: false }
  }

  private superAdminGlobal(
    actorRef: string,
    scopeMode: 'global-low-sensitive' | 'system-maintenance',
  ): TenantResolutionResult {
    const reason: TenantResolutionReason =
      scopeMode === 'global-low-sensitive'
        ? 'SUPER_ADMIN_GLOBAL_LOW_SENSITIVE'
        : 'SUPER_ADMIN_SYSTEM_MAINTENANCE'
    const context = buildEffectiveTenantContext({
      actorRef,
      organizationId: null,
      scopeMode,
      selectionSource: 'super_admin_mode',
      resolutionReason: reason,
      isSuperAdmin: true,
      warningCodes: [
        scopeMode === 'global-low-sensitive'
          ? 'GLOBAL_LOW_SENSITIVE_ONLY'
          : 'SYSTEM_MAINTENANCE_ONLY',
      ],
    })
    // super admin global 模式本身是有效决定（放行低敏全局操作）；业务写入仍须具体 org（§6）。
    return { context, ok: true }
  }

  private fail(
    actorRef: string,
    isSuperAdmin: boolean,
    organizationId: number | null,
    reason: TenantResolutionReason,
    warningCodes: TenantWarningCode[],
  ): TenantResolutionResult {
    const context = buildEffectiveTenantContext({
      actorRef,
      organizationId,
      scopeMode: 'tenant',
      selectionSource: 'auth_token',
      resolutionReason: reason,
      isSuperAdmin,
      warningCodes,
    })
    return { context, ok: false }
  }
}
