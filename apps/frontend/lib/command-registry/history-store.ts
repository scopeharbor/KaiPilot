import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import {
  COMMAND_HISTORY_STORAGE_VERSION,
  createEmptyCommandHistory,
  parseCommandHistory,
  pruneCommandHistory,
  recordCommandUsage,
  type CommandHistoryData,
} from './history'

/**
 * 命令使用历史的本地持久化 store（spec command-palette / design.md D1、D2）。
 *
 * - 复用仓库既有 Zustand + localStorage 偏好模式（同 `stores/ui-store.ts`），
 *   但独立成 store：历史有自己的版本、容量、剪枝与测试，不稀释 UI 偏好。
 * - 只持久化 `history`（低敏元数据：命令 ID、次数、时间戳、可选路径分类）；
 *   不存储搜索原文、业务标题、完整 URL 查询串、prompt、模型输出、token、secret。
 * - 版本不兼容或载荷损坏时整体回退为空历史，绝不阻断命令面板打开
 *   （spec「本地历史损坏时安全回退」）。
 */

/** localStorage 持久化 key（含版本号，与快捷键覆盖存储同风格）。 */
export const COMMAND_HISTORY_STORAGE_KEY = 'aiproj:command-history:v1'

/**
 * 防御性 localStorage 适配：隐私模式/配额满/不可用时不抛错，
 * 退化为纯内存态（spec「localStorage 不可用时回退既有行为」）。
 */
const safeLocalStorage: StateStorage = {
  getItem: (name) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name, value) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      // 存储满或不可用 — 静默失败，内存态仍然可用
    }
  },
  removeItem: (name) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      // 忽略
    }
  },
}

export interface CommandHistoryState {
  /** 当前本地命令使用历史（低敏）。 */
  history: CommandHistoryData
  /**
   * 记录一次命令使用。`contextPath` 可选且必须是低敏路径分类
   * （不含查询串/哈希）；非法值被忽略。
   */
  recordUsage: (commandId: string, contextPath?: string) => void
  /** 清理已不在有效集合内的历史记录（opportunistic 清理 / 调试恢复）。 */
  pruneStale: (validCommandIds: ReadonlySet<string>) => void
  /** 清空本地历史（测试与安全恢复用）。 */
  reset: () => void
}

export const useCommandHistoryStore = create<CommandHistoryState>()(
  persist(
    (set, get) => ({
      history: createEmptyCommandHistory(),

      recordUsage: (commandId, contextPath) => {
        set({ history: recordCommandUsage(get().history, commandId, Date.now(), contextPath) })
      },

      pruneStale: (validCommandIds) => {
        set({ history: pruneCommandHistory(get().history, validCommandIds) })
      },

      reset: () => set({ history: createEmptyCommandHistory() }),
    }),
    {
      name: COMMAND_HISTORY_STORAGE_KEY,
      version: COMMAND_HISTORY_STORAGE_VERSION,
      storage: createJSONStorage(() => safeLocalStorage),
      // 只持久化历史数据本身（action 不入存储）。
      partialize: (state) => ({ history: state.history }),
      // 存储版本不兼容 → 丢弃旧载荷，回退空历史。
      migrate: () => ({ history: createEmptyCommandHistory() }),
      // 水合时经 parseCommandHistory 校验：任何损坏形态都回退空历史。
      merge: (persisted, current) => {
        const raw = (persisted as { history?: unknown } | undefined)?.history
        return { ...current, history: parseCommandHistory(raw) }
      },
    },
  ),
)
