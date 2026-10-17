// @aiproj/backend — OrganizationSelectionService（v3-multitenant-tenant-identification §4）。
//
// spec「Tenant selection MUST support explicit organization switching」：受保护的组织选择流程。
// 客户端只提交**目标组织意图**；成员关系/所有权由服务端重新校验（design Decision 3）。
//
// 与既有 `AuthService.refresh(token, organizationId)` 的关系与差别：
//   - 旧路径是**未认证**路由（拿 refresh token 换新 claims），其 `sessionContext` 抛
//     `InvalidCredentialsException`（401「无权切换到该组织」）——这既泄露了"你不是该组织成员"，
//     也**不支持 owner fallback**（organizations.owner_id 是 owner 但没有 member 行的用户
//     切不进自己的组织）。
//   - 本服务是**已认证**路由，复用 `TenantResolutionService` 做校验：owner fallback 与
//     "组织不存在 / 已软删除 / 非成员"三者统一 404 的非泄露语义都与中间件保持一致。
//
// 切换成功后做四件事（缺一不可）：
//   1. 持久化服务端 selection snapshot 并把 selection epoch +1（§4.2）；
//   2. 失效前一租户的派生句柄与服务端缓存（§4.3）；
//   3. 签发带新 organizationId claims 的 access token（§4.2）；
//   4. 写低敏切换审计（previous/next scope hash + requestId，§4.5）。

import { inject } from '@adonisjs/core'
import {
  ResourceNotFoundException,
  TenantResolutionUnavailableException,
} from '#exceptions/api_exception'
import RbacService from '#services/rbac_service'
import TenantIdentificationAuditService from '#services/tenant_identification_audit_service'
import TenantResolutionService from '#services/tenant_resolution_service'
import TenantSelectionInvalidationService, {
  type TenantSelectionInvalidationReport,
} from '#services/tenant_selection_invalidation_service'
import TenantSelectionStateService from '#services/tenant_selection_state_service'
import TokenService from '#services/token_service'
import type User from '#models/user'
import type { CacheStore } from '#services/cache/cache_store'
import type { EffectiveTenantContext } from '@aiproj/types/multitenant-tenant-identification'

export interface OrganizationSelectionInput {
  user: User
  /** 目标组织意图（低敏 id）；仅作意图，安全事实由服务端重算。 */
  targetOrganizationId: number
  /** 客户端可选提交的旧 scope hash，仅用于审计对比，不参与授权判定。 */
  previousScopeHash?: string | null
  requestId: string
  /** 可选缓存后端；缺省时缓存清理降级，隔离仍由 epoch 栅栏保证。 */
  cache?: CacheStore | null
}

export interface OrganizationSelectionOutcome {
  effectiveContext: EffectiveTenantContext
  scopeHash: string
  /** 带新组织 claims 的 access token（前端替换后续请求的 Authorization）。 */
  accessToken: string
  /** 切换后的 selection epoch；旧句柄据此判 stale。 */
  selectionEpoch: number
  invalidation: TenantSelectionInvalidationReport
}

@inject()
export default class OrganizationSelectionService {
  constructor(
    private resolutionService: TenantResolutionService,
    private selectionState: TenantSelectionStateService,
    private invalidation: TenantSelectionInvalidationService,
    private identificationAudit: TenantIdentificationAuditService,
    private tokenService: TokenService,
    private rbacService: RbacService,
  ) {}

  /**
   * 读取当前有效租户上下文（供前端 §8.1 消费）。
   * 不做任何写入；解析失败时返回 ok=false 的低敏决定，由调用方决定呈现方式。
   */
  async current(
    user: User,
    roleVersion: number,
    /**
     * 当前 token 声明的组织，作为**回落**来源。
     *
     * 优先级（design Decision 2）：服务端持久化的 selection > token claim。
     * 回落是必需的——用户可能从未调用过切换端点（首次登录、或本 change 之前签发的
     * token），此时服务端没有 selection 行。若不回落就会把一个有 organizationId
     * 声明的正常会话报成「未选择组织」。
     */
    tokenOrganizationId: number | null = null,
  ): Promise<{
    effectiveContext: EffectiveTenantContext
    ok: boolean
    selectionEpoch: number
  }> {
    const persisted = await this.selectionState.find(user.id)
    const organizationId = persisted?.organizationId ?? tokenOrganizationId
    const { context, ok } = await this.resolutionService.resolve({
      payload: {
        sub: user.id,
        organizationId,
        roleVersion,
        permissions: [],
      },
      user,
    })
    return {
      effectiveContext: {
        ...context,
        // 标明这次决定是来自服务端 selection 还是 token 回落，供审计与前端诊断。
        selectionSource:
          (persisted?.organizationId ?? null) === null ? 'auth_token' : 'server_selection',
      },
      ok,
      selectionEpoch: persisted?.selectionEpoch ?? 0,
    }
  }

  /**
   * 显式切换 active organization。
   *
   * 失败语义（spec「Non-member switch is hidden」）：非成员 / 组织不存在 / 组织已软删除
   * 一律 404 且不区分，绝不透露组织是否存在；resolver 故障单独走 503 degraded，
   * **不回退**到"就按客户端说的组织切"。
   */
  async select(input: OrganizationSelectionInput): Promise<OrganizationSelectionOutcome> {
    const { user } = input
    const actorRef = `user:${user.id}`
    const previous = await this.selectionState.find(user.id)

    // 服务端重算：成员/owner/组织状态/角色新鲜度/scope mode。
    // 这里刻意用 DB 当前 roleVersion（而非请求 token 里的值）：切换是"重新选组织"，
    // 应当基于最新成员事实，而非旧 token 的快照。
    const { context, ok } = await this.resolutionService.resolve({
      payload: {
        sub: user.id,
        organizationId: input.targetOrganizationId,
        roleVersion: user.roleVersion,
        permissions: [],
      },
      user,
    })

    if (!ok) {
      await this.auditFailure(context, input, actorRef)
      if (context.resolutionReason === 'RESOLVER_FAILED') {
        throw new TenantResolutionUnavailableException('租户上下文暂不可用，请稍后重试')
      }
      throw new ResourceNotFoundException('组织不存在')
    }

    // 切换成功：先持久化 selection（epoch +1），再据新 epoch 失效旧句柄。
    const snapshot = await this.selectionState.recordSelection({
      userId: user.id,
      organizationId: context.organizationId,
      membershipVersionHash: context.membershipVersionHash ?? null,
      scopeHash: context.scopeHash,
      selectionSource: 'server_selection',
      scopeMode: context.scopeMode,
    })

    const invalidation = await this.invalidation.invalidateForSwitch({
      actorRef,
      previousOrganizationId: previous?.organizationId ?? null,
      nextOrganizationId: input.targetOrganizationId,
      // 审计对比优先用服务端记录的旧 scope hash；客户端提交的值只在服务端无记录时兜底。
      previousScopeHash: previous?.scopeHash ?? input.previousScopeHash ?? null,
      nextScopeHash: context.scopeHash,
      selectionEpoch: snapshot.selectionEpoch,
      cache: input.cache ?? null,
    })

    // 新 claims：权限按目标组织重算，绝不沿用切换前的权限集。
    const permissions = await this.rbacService.resolveUserPermissions(user, context.organizationId)
    const accessToken = await this.tokenService.generateAccessToken({
      sub: user.id,
      organizationId: context.organizationId,
      roleVersion: user.roleVersion,
      permissions: permissions as unknown as string[],
    })

    await this.identificationAudit.recordSwitch({
      actorRef,
      userId: user.id,
      organizationId: context.organizationId,
      projectId: null,
      scopeMode: context.scopeMode,
      selectionSource: 'server_selection',
      resolutionReason: context.resolutionReason,
      scopeHash: context.scopeHash,
      operation: 'organization_selection.select',
      requestId: input.requestId,
      previousScopeHash: invalidation.previousScopeHash,
      nextScopeHash: context.scopeHash,
      selectionEpoch: snapshot.selectionEpoch,
    })

    return {
      effectiveContext: { ...context, selectionSource: 'server_selection' },
      scopeHash: context.scopeHash,
      accessToken,
      selectionEpoch: snapshot.selectionEpoch,
      invalidation,
    }
  }

  /**
   * 切换失败的低敏审计。
   *
   * 注意 `organizationId` 传的是 **null**，不是目标组织：目标组织在这条路径上属于
   * "隐藏目标"（actor 无权知道它是否存在），把它写进审计等于在审计里留下存在性证据。
   */
  private async auditFailure(
    context: EffectiveTenantContext,
    input: OrganizationSelectionInput,
    actorRef: string,
  ): Promise<void> {
    const base = {
      actorRef,
      userId: input.user.id,
      organizationId: null,
      projectId: null,
      scopeMode: context.scopeMode,
      selectionSource: 'consistency_hint' as const,
      resolutionReason: context.resolutionReason,
      scopeHash: context.scopeHash,
      operation: 'organization_selection.select',
      requestId: input.requestId,
    }

    switch (context.resolutionReason) {
      case 'RESOLVER_FAILED':
        await this.identificationAudit.recordDegraded(base)
        return
      case 'ROLE_STALE':
      case 'MEMBERSHIP_STALE':
      case 'MEMBERSHIP_REMOVED':
        await this.identificationAudit.recordStale(base)
        return
      default:
        await this.identificationAudit.recordDenial(base)
    }
  }
}
