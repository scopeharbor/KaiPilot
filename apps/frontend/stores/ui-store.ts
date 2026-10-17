import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/** 界面密度：舒适（默认）/ 紧凑。与主题正交（design.md D2）。 */
export type Density = 'comfortable' | 'compact'

/** localStorage 持久化 key——首屏防闪烁内联脚本须读同一个 key（见 layout.tsx）。 */
export const UI_STORE_KEY = 'aiproj-ui'

export interface UiState {
  density: Density
  setDensity: (density: Density) => void
  toggleDensity: () => void
  /**
   * 桌面/平板侧栏是否折叠为 64px（build-app-shell-layout D2）。
   * 用户偏好，需持久化；与密度/主题偏好并列存在同一份 UI store。
   */
  sidebarCollapsed: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebarCollapsed: () => void
  /**
   * 移动端汉堡抽屉是否打开（build-app-shell-layout D3）。
   * 会话状态，不持久化：刷新后回到默认关闭。
   */
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  /**
   * 埋点开关（v3-frontend-ai-usage-telemetry D4）。
   * 关闭后前端不再发送事件（而非后端丢弃）。
   * 用户偏好，需持久化；个人选择优先于组织默认值。
   */
  telemetryEnabled: boolean
  setTelemetryEnabled: (enabled: boolean) => void
}

/** 是否处于「减弱动画」偏好。 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 把密度写入 `<html data-density>`；非减弱动画时短暂挂 `density-transition` 类，
 * 让间距/行高平滑降档（globals.css 定义过渡；减弱动画时该过渡被媒体查询归零）。
 */
export function applyDensity(density: Density) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!prefersReducedMotion()) {
    root.classList.add('density-transition')
    window.setTimeout(() => root.classList.remove('density-transition'), 320)
  }
  root.setAttribute('data-density', density)
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      density: 'comfortable',
      setDensity: (density) => {
        applyDensity(density)
        set({ density })
      },
      toggleDensity: () => {
        const next: Density = get().density === 'comfortable' ? 'compact' : 'comfortable'
        applyDensity(next)
        set({ density: next })
      },
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebarCollapsed: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      mobileNavOpen: false,
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      telemetryEnabled: true,
      setTelemetryEnabled: (enabled) => {
        set({ telemetryEnabled: enabled })
        // 同步到 localStorage（供 telemetry client 读取）
        if (typeof window !== 'undefined') {
          localStorage.setItem('aiproj-telemetry-enabled', String(enabled))
        }
      },
    }),
    {
      name: UI_STORE_KEY,
      storage: createJSONStorage(() => localStorage),
      // 仅持久化用户偏好——密度、侧栏折叠与埋点开关；抽屉开关属会话态，刷新回默认。
      partialize: (state) => ({
        density: state.density,
        sidebarCollapsed: state.sidebarCollapsed,
        telemetryEnabled: state.telemetryEnabled,
      }),
      // 水合后把持久化的密度同步到 DOM（首帧由内联脚本兜底，这里保证 store↔DOM 一致）。
      // 同时同步埋点开关状态到 localStorage（供 telemetry client 读取）。
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyDensity(state.density)
          // 同步埋点开关到 localStorage
          if (typeof window !== 'undefined') {
            localStorage.setItem('aiproj-telemetry-enabled', String(state.telemetryEnabled))
          }
        }
      },
    },
  ),
)
