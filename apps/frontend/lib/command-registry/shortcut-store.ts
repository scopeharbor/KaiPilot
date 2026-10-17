/**
 * 本地快捷键覆盖存储（spec command-palette / design.md D2）。
 *
 * 只保存低敏元数据：命令 ID、规范化和弦、更新时间、存储版本。
 * 不存储命令标签、搜索原文、业务标题、prompt、model 输出、token、secret、URL 或正式业务数据。
 *
 * 存储格式（localStorage key: `aiproj:shortcuts:v1`）：
 * ```json
 * { "version": 1, "bindings": { "cmdId": { "chord": "ctrl+shift+p", "updatedAt": "2026-07-22T..." } } }
 * ```
 */

const STORAGE_KEY = 'aiproj:shortcuts:v1'
const STORAGE_VERSION = 1

export interface ShortcutOverride {
  /** 规范化和弦（如 `"ctrl+shift+p"`）。 */
  chord: string
  /** ISO-8601 更新时间戳。 */
  updatedAt: string
}

export interface ShortcutOverrideData {
  version: number
  bindings: Record<string, ShortcutOverride>
}

function createDefaultData(): ShortcutOverrideData {
  return { version: STORAGE_VERSION, bindings: {} }
}

/** 尝试从 localStorage 读取快捷键覆盖；损坏或不兼容时回退到空配置。 */
function readFromStorage(): ShortcutOverrideData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDefaultData()
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return createDefaultData()
    if (parsed.version !== STORAGE_VERSION) return createDefaultData()
    if (typeof parsed.bindings !== 'object' || parsed.bindings === null) return createDefaultData()
    // 校验每个覆盖记录格式
    for (const [cmdId, ov] of Object.entries(parsed.bindings)) {
      if (typeof cmdId !== 'string') return createDefaultData()
      if (typeof ov !== 'object' || ov === null) return createDefaultData()
      const override = ov as Record<string, unknown>
      if (typeof override.chord !== 'string') return createDefaultData()
      if (typeof override.updatedAt !== 'string') return createDefaultData()
    }
    return parsed as ShortcutOverrideData
  } catch {
    return createDefaultData()
  }
}

function writeToStorage(data: ShortcutOverrideData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage 满或不可用 — 静默失败
  }
}

/**
 * 快捷键覆盖变更广播（v3-copilot-sidebar-shell 集成点，见该 change observation §3.4）。
 *
 * 纯加法、不改写任何已有行为：规范化/解析/冲突检测/自定义路径全部照旧。
 * Copilot 面板的 tooltip 通过订阅 `aiproj:shortcuts-changed` 事件实时反映重绑后的和弦
 * （spec「Rebinding updates the displayed hint」，壳不直接读写本模块以外的状态）。
 */
const SHORTCUTS_CHANGED_EVENT = 'aiproj:shortcuts-changed'
function notifyShortcutsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(SHORTCUTS_CHANGED_EVENT))
}

/**
 * 本地快捷键覆盖存储实例。
 * 所有操作都是同步的，直接读写 localStorage。
 */
export const shortcutOverrideStore = {
  /** 获取所有本地覆盖（Map 形式，便于快速查询）。 */
  getAll(): Map<string, ShortcutOverride> {
    const data = readFromStorage()
    const map = new Map<string, ShortcutOverride>()
    for (const [id, ov] of Object.entries(data.bindings)) {
      map.set(id, ov)
    }
    return map
  },

  /** 获取单条覆盖。 */
  get(commandId: string): ShortcutOverride | undefined {
    return this.getAll().get(commandId)
  },

  /** 设置/覆盖一条快捷键。 */
  set(commandId: string, chord: string): void {
    const data = readFromStorage()
    data.bindings[commandId] = { chord, updatedAt: new Date().toISOString() }
    writeToStorage(data)
    notifyShortcutsChanged()
  },

  /** 清除单条快捷键覆盖。 */
  remove(commandId: string): void {
    const data = readFromStorage()
    delete data.bindings[commandId]
    writeToStorage(data)
    notifyShortcutsChanged()
  },

  /** 清除所有本地快捷键覆盖。 */
  clearAll(): void {
    writeToStorage(createDefaultData())
    notifyShortcutsChanged()
  },

  /**
   * 清除本地配置中已不存在的命令覆盖（过期命令 ID 清理）。
   * @param validCommandIds 当前有效的命令 ID 集合。
   */
  pruneExpired(validCommandIds: Set<string>): void {
    const data = readFromStorage()
    let changed = false
    for (const cmdId of Object.keys(data.bindings)) {
      if (!validCommandIds.has(cmdId)) {
        delete data.bindings[cmdId]
        changed = true
      }
    }
    if (changed) writeToStorage(data)
  },
}
