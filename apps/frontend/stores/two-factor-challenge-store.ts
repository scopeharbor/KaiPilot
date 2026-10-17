import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { TwoFactorChallengePurpose } from '@/lib/api/auth'
import type { TwoFactorMethod } from '@/lib/api/two-factor'

export const TWO_FACTOR_CHALLENGE_STORAGE_KEY = 'aiproj-2fa-challenge'

/**
 * 待兑换的第二因子挑战（**中间态，不是会话**）。
 *
 * 存放位置的取舍：
 * - 不能放 URL —— 会进浏览器历史与 Referer；
 * - 不能放 localStorage —— 跨标签页长期驻留；
 * - 本项目前后端跨源（:3000 ↔ :3333）且本地是 http，HttpOnly cookie 需要
 *   `SameSite=None; Secure`，浏览器在 http 下会直接拒收，所以走不通；
 * - 故用 **sessionStorage**：仅当前标签页、关闭即失效。里面只有一枚**不透明、
 *   一次性、5 分钟过期**的挑战票据——它换不到任何数据，只能用来提交第二因子；
 *   TOTP 密钥与恢复码**绝不**进这里。
 *
 * 敏感度低于本应用已有的做法：正式 access token 就存在 sessionStorage（auth-store）。
 */
export interface PendingChallengeState {
  challengeToken: string | null
  expiresAt: string | null
  purpose: TwoFactorChallengePurpose | null
  skippable: boolean
  methods: TwoFactorMethod[]
  /** 完成后要回到的站内路径（已由 `safeNextPath` 过滤，防开放重定向）。 */
  nextPath: string
  hasHydrated: boolean

  start: (input: {
    challengeToken: string
    expiresAt: string
    purpose: TwoFactorChallengePurpose
    skippable?: boolean
    methods: TwoFactorMethod[]
    nextPath: string
  }) => void
  clear: () => void
  setHasHydrated: (hydrated: boolean) => void
}

/** 挑战是否仍可用（存在且未过期）。路由守卫用它决定是渲染还是踢回登录页。 */
export function isChallengeUsable(
  state: Pick<PendingChallengeState, 'challengeToken' | 'expiresAt'>,
) {
  if (!state.challengeToken || !state.expiresAt) return false
  return new Date(state.expiresAt).getTime() > Date.now()
}

export const useTwoFactorChallengeStore = create<PendingChallengeState>()(
  persist(
    (set) => ({
      challengeToken: null,
      expiresAt: null,
      purpose: null,
      skippable: false,
      methods: [],
      nextPath: '/dashboard',
      hasHydrated: false,

      start: ({ challengeToken, expiresAt, purpose, skippable, methods, nextPath }) =>
        set({
          challengeToken,
          expiresAt,
          purpose,
          skippable: skippable ?? false,
          methods,
          nextPath,
        }),

      clear: () =>
        set({
          challengeToken: null,
          expiresAt: null,
          purpose: null,
          skippable: false,
          methods: [],
          nextPath: '/dashboard',
        }),

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: TWO_FACTOR_CHALLENGE_STORAGE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true,
      partialize: (state) => ({
        challengeToken: state.challengeToken,
        expiresAt: state.expiresAt,
        purpose: state.purpose,
        skippable: state.skippable,
        methods: state.methods,
        nextPath: state.nextPath,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
)
