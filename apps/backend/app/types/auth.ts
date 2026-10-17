/**
 * JWT access token 自包含 payload。
 */
export interface JwtAccessPayload {
  /**
   * 用户 ID
   */
  sub: number

  /**
   * 当前组织 ID
   */
  organizationId: number | null

  /**
   * 当前组织套餐层级（'free' | 'team' | 'enterprise'；无组织为 null）。
   * 用于前端区分「个人免费组织」与「企业组织」——企业能力已由套餐权益门控，
   * free 组织的权限集不含 ENTERPRISE_PERMISSIONS，本字段只是会话侧的配套标记。
   * 可选用以向后兼容（老调用方不传时，签发与校验路径均按 null 处理；
   * AuthService 真实签发时恒写入当前组织 planTier）。
   */
  planTier?: string | null

  /**
   * 角色版本号（用于即时失效）
   */
  roleVersion: number

  /**
   * 权限声明数组（前端展示层使用）
   */
  permissions: string[]
}

/**
 * DB 存储的 refresh token 记录（复用 auth_access_tokens 表）。
 *
 * 注意：DbAccessTokensProvider 实际返回 AccessToken（createdAt/lastUsedAt/expiresAt 为 Date），
 * 这里用独立接口描述 JWT refresh token 关心的字段，避免与 AccessToken 做结构性 extends。
 */
export interface JwtRefreshToken {
  /**
   * token 标识符
   */
  identifier: string | number | bigint

  /**
   * token 原始值（仅首次可访问）
   */
  value?: { release(): string }

  /**
   * token 类型（本项目固定为 'refresh'）
   */
  type: string

  /**
   * 关联用户 ID
   */
  tokenableId: number

  /**
   * 创建时间
   */
  createdAt: Date

  /**
   * 最后使用时间（用于空闲超时）
   */
  lastUsedAt: Date | null

  /**
   * 绝对过期时间
   */
  expiresAt: Date | null

  /**
   * 保存更新（运行时 AccessToken 实例的方法）。
   */
  save(): Promise<void>
}

/**
 * 请求上下文（IP / UA / requestId），供登录锁定与审计埋点使用。
 */
export interface AuthContext {
  ip?: string
  userAgent?: string
  requestId?: string | null
}

/**
 * 认证成功后的标准响应。
 */
export interface AuthSuccessResponse {
  user: Record<string, unknown>
  accessToken: string
  refreshToken: string
}

/**
 * 统一错误响应结构。
 */
export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

/**
 * Tenant 上下文（由 tenant_middleware 注入 HttpContext）。
 *
 * 与共享契约 `@aiproj/types` 的 `TenantContext` 结构一致；新增字段按需由
 * `TenantScopeService.requireTenant` 补全为完整契约（v3-multitenant-isolation-architecture §3.1）。
 * 既有调用方 `ctx.tenant.organizationId` 保持兼容。
 */
export interface TenantContext {
  organizationId: number

  /**
   * 当前项目 scope（可选，项目级 API 由路由解析）。
   */
  projectId?: number | null

  /**
   * 租户 scope mode：organization_scoped / project_scoped / system_global。
   */
  scopeMode?: 'organization_scoped' | 'project_scoped' | 'system_global'

  /**
   * 低敏 actor 引用（`user:<id>`）。
   */
  actorRef?: string

  /**
   * 是否系统管理员（仅身份标记，全局能力仍需 registry 显式声明）。
   */
  isSuperAdmin?: boolean
}

/**
 * RBAC scope 上下文。
 */
export interface RbacContext {
  /**
   * 当前操作目标项目 ID（可选）
   */
  projectId?: number

  /**
   * 当前组织 ID（默认从 tenant 取）
   */
  organizationId: number
}

/**
 * 权限判定结果。
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * 请求级 RBAC 上下文：Policy 层做**同步**权限判定所依赖的已解析权限集。
 *
 * 为什么需要它：`RbacMiddleware` 的路由规则表只覆盖登记在
 * `ROUTE_PERMISSION_RULES` 里的路由，而 Policy 层（DLP / 企业审计 / 水印 /
 * OCR 等）还要在控制器内部做更细的 view/manage 判定。Policy 的方法签名是同步的，
 * 没法在其中 await 权限解析，因此由中间件预解析后挂到 ctx 上。
 *
 * 为什么权限集来自数据库而不是 JWT 的 `permissions` claim：
 * token 里的权限是**签发时刻**的快照，成员被移出组织或角色降级后，旧 token
 * 仍会带着过期权限存活到过期时间，Policy 会据此放行。每请求重解析可让
 * 成员/角色变更立即生效，与多租户隔离要求的 membership freshness 一致。
 */
export interface RbacRequestContext {
  /** 当前组织（若路由带项目 scope 则再与项目级取交集）下的有效权限集。 */
  readonly permissions: ReadonlySet<string>
  /** 解析权限时所用的组织 scope；为 null 表示未选组织，此时权限集必为空。 */
  readonly organizationId: number | null
  /** 路由解析出的项目 scope；非 null 时权限集已是组织级 ∩ 项目级。 */
  readonly projectId: number | null
  readonly isSuperAdmin: boolean
  /** 同步判定。超级管理员由 `system:admin` 哨兵整体放行。 */
  hasPermission(permission: string): boolean
}

/**
 * 扩展 AdonisJS HttpContext，挂载 JWT 认证信息。
 */
declare module '@adonisjs/core/http' {
  interface HttpContext {
    authUser?: import('#models/user').default
    authPayload?: JwtAccessPayload
    tenant?: TenantContext
    rbac?: RbacRequestContext
    /**
     * 当前用户在路由项目中的成员身份（v3-backend-type-debt-closure F20）。
     * 由全局 rbac_middleware 在项目级路由上预解析挂载（Policy 方法是同步的，
     * 无法自行 await 查询）。非项目路由或非成员为 null。OCR/文档类 Policy 的
     * `isProjectMember()` 判定依赖它——此前全链路无人挂载，导致恒 false 恒 403。
     */
    projectMember?: { role: string } | null
    /**
     * V3 多租户识别链路的有效租户决定（v3-multitenant-tenant-identification §3.3）。
     * 由 tenant_middleware 调用 TenantResolutionService 产出，供 isolation 层与
     * Controller 消费。低敏：只含 actorRef/orgId/scopeMode/source/reason/scopeHash/
     * membershipVersionHash/warningCodes。与 ctx.tenant 并存（兼容）。
     */
    tenantDecision?: import('@aiproj/types/multitenant-tenant-identification').EffectiveTenantContext
    /**
     * V3 多租户 API 边界的低敏决定（v3-multitenant-api §3.5）。
     * 由 tenant_api_boundary_middleware 对**已登记**的 tenant-scoped route 产出并挂载；
     * 未登记（inventory gap / legacy）路由不挂载，保持既有 `ctx.tenant`/RBAC 兼容。
     * 仅携带 low-sensitive decision metadata（scopeHash/cacheNamespace/reasonCode/warnings），
     * 不含隐藏资源名/计数/source hash/来源/权限 allowlist。
     */
    tenantApiBoundary?: import('@aiproj/types/multitenant-api-boundary').ApiDecisionMetadata
  }
}
