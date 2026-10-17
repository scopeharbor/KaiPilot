import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { decodeAccessToken } from '@/lib/jwt'

export const AUTH_SESSION_STORAGE_KEY = 'aiproj-auth-session'

/**
 * 套餐档位（后端会话契约 `planTier` 字段）。
 *
 * 个人用户获得免费个人组织；企业能力入口（SSO/KMS/DLP/合规/多租户/AI 质量成本/
 * 发布信任等）仅对 `team`/`enterprise` 开放。`null` 表示缺失/未知。
 */
export type PlanTier = 'free' | 'team' | 'enterprise'

/**
 * 归一化套餐值：只认三个合法档位，其余一律 `null`（最保守，按免费处理）。
 */
export function normalizePlanTier(value: unknown): PlanTier | null {
  return value === 'free' || value === 'team' || value === 'enterprise' ? value : null
}

/**
 * 认证用户（前端视角，来自登录响应的 user DTO）。
 */
export interface AuthUser {
  id: number
  email: string
  fullName: string | null
  initials?: string
  isSuperAdmin?: boolean
  /** 个人版是否允许自行配置 AI 连接；缺失按 false（使用平台统一 AI 配置）。 */
  allowSelfAiConfig?: boolean
  /** 当前组织套餐（低敏展示值）；缺失按 `free` 处理（企业入口隐藏）。 */
  planTier?: PlanTier | null
  organizations: AuthOrganization[]
}

export interface AuthOrganization {
  id: number
  name: string
  slug: string
  role: string
  /** 用于在多工作区列表中区分个人空间与团队/企业组织。 */
  planTier?: PlanTier | null
}

/**
 * 有效租户上下文（前端视图，低敏）。
 *
 * 字段与后端 `EffectiveTenantContext` 契约一一对应，只保留渲染与失效判断需要的部分：
 * 全是 ID / hash / 枚举 / 时间戳，不含原始 token、权限全集、隐藏组织名或资源详情。
 */
export interface EffectiveTenantContextView {
  actorRef: string
  organizationId: number | null
  projectId?: number | null
  membershipRole?: string | null
  scopeMode: string
  selectionSource: string
  resolutionReason: string
  scopeHash: string
  resolvedAt: string
  warningCodes: string[]
  isSuperAdmin: boolean
}

export interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  refreshToken: string | null
  /** 从 access token 解析出的权限声明（仅展示层）。 */
  permissions: string[]
  /**
   * 当前组织（**仅展示层**，不是安全边界）。
   *
   * 该值源自 access token 声明并存放在 sessionStorage，用户可改写。
   * 真正的租户边界只有服务端从认证态解析的 `ctx.tenant.organizationId`；
   * 前端随请求带上的组织值只是请求提示，服务端 `tenant_middleware` 会做一致性
   * 校验，不一致统一 404 掩蔽（v3-multitenant-isolation-architecture §7.3）。
   * 渲染用 `describeTenantScopeForDisplay`（`@/lib/tenant-scope`）取低敏标签。
   */
  currentOrganizationId: number | null
  /**
   * 当前套餐档位（低敏展示值，来自 user DTO 或 JWT 声明）。
   *
   * 缺失/未知一律为 `null`，导航渲染按「免费个人组织」处理：企业能力入口
   * （`enterpriseOnly` 标记）不显示。真正的套餐裁决在服务端，前端只管可见性。
   * 对应选择器：`selectPlanTier`。
   */
  planTier: PlanTier | null
  roleVersion: number
  isAuthenticated: boolean
  hasHydrated: boolean

  /**
   * 服务端解析的有效租户上下文（v3-multitenant-tenant-identification §8.1）。
   *
   * 与上面的 `currentOrganizationId` 的关系：后者是从 access token 声明本地推断的
   * **展示值**；本字段是**服务端事实**（含 scope hash、scope mode、解析 reason 与
   * 低敏 warning codes）。两者冲突时以本字段为准——它来自
   * `GET /account/organization-selection`，是后端 `TenantResolutionService` 的输出。
   *
   * 仍然**不是**安全边界：它只是把服务端决定同步到前端用于渲染与失效判断，
   * 真正的门永远在服务端每个请求上重算。
   */
  effectiveTenantContext: EffectiveTenantContextView | null
  /**
   * 服务端 selection epoch（§4.3 失效栅栏）。
   *
   * 组织切换后 +1。前端据此判断手里的预览/导出/AI 句柄是否已过期，
   * 避免把上一个 selection 的派生结果继续展示或提交。
   */
  selectionEpoch: number

  /** 登录成功后写入会话，并解析 access token 的权限声明（design D11/T007）。 */
  setSession: (session: { user: AuthUser; accessToken: string; refreshToken: string }) => void
  /** 静默刷新后仅更新 token（保留 user）。 */
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void
  /** 登出：清空全部认证态。 */
  clear: () => void
  setHasHydrated: (hydrated: boolean) => void
  /** 是否具备某权限（展示层判断）。 */
  hasPermission: (permission: string) => boolean
  /**
   * 切换当前组织：走受保护端点 `POST /account/organization-selection`
   *（v3-multitenant-tenant-identification §4.1），成功后按新组织重载 claims、
   * 写入服务端 selection epoch，并清空全部租户派生缓存（§8.2）。
   *
   * 唯一的门在服务端：成员/所有权由 `TenantResolutionService` 重算，非成员统一 404
   * （既不放行，也不透露该组织是否存在）。此处**不做**本地 `user.organizations` 预判——
   * 那层旧 UX 前置门会把 owner-without-member-row 的用户挡在自己组织外面。
   */
  switchOrganization: (organizationId: number) => Promise<void>
  /**
   * 从服务端刷新有效租户上下文（§8.1）。
   *
   * 用于 stale-selection 恢复：请求返回 `MEMBERSHIP_STALE`/`ROLE_STALE` 类 warning 时，
   * UI 调它重新取服务端决定，而不是拿本地推断值继续用。
   */
  refreshEffectiveTenantContext: () => Promise<EffectiveTenantContextView | null>
}

/** 从 access token 解析权限、角色版本与套餐。 */
function parseClaims(accessToken: string): {
  permissions: string[]
  roleVersion: number
  organizationId: number | null
  planTier: PlanTier | null
} {
  const claims = decodeAccessToken(accessToken)
  return {
    permissions: claims?.permissions ?? [],
    roleVersion: claims?.roleVersion ?? 0,
    organizationId: claims?.organizationId ?? null,
    planTier: normalizePlanTier(claims?.planTier),
  }
}

function resolveOrganizationId(user: AuthUser | null, claimedOrganizationId: number | null) {
  if (claimedOrganizationId !== null) return claimedOrganizationId
  return user?.organizations.length === 1 ? (user.organizations[0]?.id ?? null) : null
}

export function selectEffectiveOrganizationId(
  state: Pick<AuthState, 'currentOrganizationId' | 'user'>,
) {
  return resolveOrganizationId(state.user, state.currentOrganizationId)
}

/** 套餐选择器：缺失返回 `null`（渲染层按免费处理）。 */
export function selectPlanTier(state: Pick<AuthState, 'planTier'>): PlanTier | null {
  return state.planTier
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      permissions: [],
      currentOrganizationId: null,
      planTier: null,
      roleVersion: 0,
      isAuthenticated: false,
      hasHydrated: false,
      effectiveTenantContext: null,
      selectionEpoch: 0,

      setSession: ({ user, accessToken, refreshToken }) => {
        const { permissions, roleVersion, organizationId, planTier } = parseClaims(accessToken)
        set({
          user,
          accessToken,
          refreshToken,
          permissions,
          currentOrganizationId: resolveOrganizationId(user, organizationId),
          // user DTO 优先，JWT 声明兜底；两者都缺失 → null（按 free 处理，最保守）。
          planTier: normalizePlanTier(user.planTier ?? planTier),
          roleVersion,
          isAuthenticated: true,
          hasHydrated: true,
          effectiveTenantContext: null,
          selectionEpoch: 0,
        })
      },

      setTokens: ({ accessToken, refreshToken }) => {
        const { permissions, roleVersion, organizationId, planTier } = parseClaims(accessToken)
        const user = get().user
        set({
          accessToken,
          refreshToken,
          permissions,
          roleVersion,
          currentOrganizationId: resolveOrganizationId(user, organizationId),
          planTier: normalizePlanTier(user?.planTier ?? planTier),
        })
      },

      clear: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          permissions: [],
          currentOrganizationId: null,
          planTier: null,
          roleVersion: 0,
          isAuthenticated: false,
          hasHydrated: true,
          // 登出必须一并清掉租户上下文与 epoch：留着会让下一个登录用户
          // 在首个请求返回前看到上一个会话的组织标签。
          effectiveTenantContext: null,
          selectionEpoch: 0,
        }),

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      hasPermission: (permission: string) => {
        const { permissions, user } = get()
        // 系统管理员（哨兵权限）放行一切展示
        if (user?.isSuperAdmin || permissions.includes('system:admin')) return true
        return permissions.includes(permission)
      },

      switchOrganization: async (organizationId: number) => {
        const { organizationSelectionApi, invalidateTenantScopedCaches } =
          await import('@/lib/api-client')

        // 服务端受保护端点是唯一的门：成员/所有权在那里重算，
        // 非成员统一 404（既不放行，也不告诉你该组织是否存在）。
        // 这里刻意**不做**本地 `user.organizations` 预判——旧实现那层前置检查会把
        // owner-without-member-row 的用户挡在自己组织外面（服务端支持 owner fallback）。
        const result = await organizationSelectionApi.select(
          organizationId,
          get().effectiveTenantContext?.scopeHash ?? null,
        )

        // 先落新 claims（后续请求立即带新组织），再清缓存。
        // 顺序很重要：反过来会让清缓存后触发的重新拉取仍用旧 token。
        if (result.accessToken) {
          const refreshToken = get().refreshToken
          set({
            accessToken: result.accessToken,
            ...parseClaims(result.accessToken),
            refreshToken,
          })
        }
        set({
          effectiveTenantContext: result.effectiveContext,
          selectionEpoch: result.selectionEpoch,
          currentOrganizationId: result.effectiveContext.organizationId,
        })

        // §8.2：清掉全部租户派生的服务端态。上一组织的预览/导出/AI 句柄在
        // 服务端已被 epoch 栅栏判 stale，这里让 UI 不再展示它们。
        invalidateTenantScopedCaches()
      },

      refreshEffectiveTenantContext: async () => {
        const { organizationSelectionApi } = await import('@/lib/api-client')
        try {
          const result = await organizationSelectionApi.current()
          set({
            effectiveTenantContext: result.effectiveContext,
            selectionEpoch: result.selectionEpoch,
            // 服务端解析不出租户时把展示值也清空，避免 UI 继续显示一个已失效的组织。
            currentOrganizationId: result.effectiveContext.organizationId,
          })
          return result.effectiveContext
        } catch {
          // 读取失败不清会话（可能只是网络抖动）；返回 null 让调用方渲染降级态。
          return null
        }
      },
    }),
    {
      name: AUTH_SESSION_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        permissions: state.permissions,
        currentOrganizationId: state.currentOrganizationId,
        planTier: state.planTier,
        roleVersion: state.roleVersion,
        isAuthenticated: state.isAuthenticated,
        // effectiveTenantContext / selectionEpoch 刻意**不持久化**：
        // 它们是服务端决定的快照，跨标签页/刷新后可能已过期。持久化会让
        // 页面用一个陈旧 epoch 判断"我的预览还有效"，正好是要防的事。
        // 恢复方式是 refreshEffectiveTenantContext() 重新问服务端。
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
)

/** 单调身份版本：切回原账号也不能复用旧请求。token 轮换不改变身份版本。 */
let authScopeRevision = 0
export function getAuthScopeRevision(): number {
  return authScopeRevision
}
useAuthStore.subscribe((state, previous) => {
  if (
    state.user?.id !== previous.user?.id ||
    state.isAuthenticated !== previous.isAuthenticated ||
    selectEffectiveOrganizationId(state) !== selectEffectiveOrganizationId(previous)
  )
    authScopeRevision += 1
})
