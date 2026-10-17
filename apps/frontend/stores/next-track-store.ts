import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const NEXT_TRACK_STORAGE_KEY = 'aiproj-next-track'

/** 新旧双轨：用户当前所在轨道。 */
export type TrackType = 'legacy' | 'next'

/** 沉浸阶梯三档（PRD §7 / D-f）：沉浸 / 轻量 / 精确。 */
export type ImmersionTier = 'immersive' | 'light' | 'precise'

/** 新轨明暗主题（v3-next-cinematic-techniques-completion：浅色模式新增）。 */
export type NxTheme = 'dark' | 'light'

export interface NextTrackState {
  /** 默认恒为 'legacy'：未显式选择过的新用户始终落在旧轨，绝不静默自动重定向。 */
  track: TrackType
  /** 手动覆盖的沉浸档位；null 表示未手动选择，遵循系统/默认合成（见 use-immersion-tier）。 */
  immersionTier: ImmersionTier | null
  /** 新轨明暗主题；缺省 'dark'（既有深空基座），用户可切 'light'。 */
  nxTheme: NxTheme
  /** 切换来源记录（会话内诊断字段），如 'topbar_button' | 'next_login' | 'shell_switch'。 */
  source: string | null
  setTrack: (track: TrackType, source?: string) => void
  setImmersionTier: (tier: ImmersionTier | null) => void
  setNxTheme: (theme: NxTheme) => void
  reset: () => void
}

/**
 * 新旧轨切换偏好 Store（v3-ui-next-track-foundation D-b / spec「切换偏好的默认值与持久化」）。
 *
 * - persist 到 localStorage，Key `aiproj-next-track`（用户级、按设备）；
 * - 持久化契约：只落 `track` 与 `immersionTier`；`source` 只在会话内存里；
 * - 导航纪律：旧轨（包括根重定向 `app/page.tsx` 与 `(dashboard)`）只读取本偏好
 *   用于状态判定，**绝对禁止**根据持久化的 `track: 'next'` 自动重定向至新轨——
 *   从旧轨进入新轨必须发生在显式点击「进入新页面」之后。
 */
export const useNextTrackStore = create<NextTrackState>()(
  persist(
    (set) => ({
      track: 'legacy',
      immersionTier: null,
      nxTheme: 'dark',
      source: null,

      setTrack: (track, source) => set({ track, source: source ?? null }),

      setImmersionTier: (immersionTier) => set({ immersionTier }),

      setNxTheme: (nxTheme) => set({ nxTheme }),

      reset: () => set({ track: 'legacy', immersionTier: null, nxTheme: 'dark', source: null }),
    }),
    {
      name: NEXT_TRACK_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        track: state.track,
        immersionTier: state.immersionTier,
        nxTheme: state.nxTheme,
      }),
    },
  ),
)
