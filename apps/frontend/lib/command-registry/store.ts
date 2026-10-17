import { create } from 'zustand'
import type { RegisteredCommand } from './types'

/**
 * 插件命令的 owner 元数据。
 * 核心命令不需要此字段（owner = 'core'）。
 */
export interface CommandOwnerMeta {
  /** owner key（插件 ID 或 'core'）。 */
  ownerKey: string
  /** 版本号（单调递增，用于乱序防护）。 */
  revision: string
  /** manifest digest（用于变更检测）。 */
  manifestDigest: string
  /** source kind（'plugin-ui-command' | 'static' | 'context'）。 */
  sourceKind: 'plugin-ui-command' | 'static' | 'context'
}

/**
 * 带 owner 元数据的命令条目。
 */
export interface OwnedCommand {
  /** 命令数据。 */
  command: RegisteredCommand
  /** owner 元数据（undefined = 核心命令）。 */
  owner?: CommandOwnerMeta
}

/**
 * typed command registry 的运行时存储（design.md D1 + D5）。
 *
 * - 持有已注册命令的 `Map<id, RegisteredCommand>`，天然支持订阅；
 *   面板组件用 selector 读取并自动更新。
 * - `addCommands` 做 **ID 冲突检测**：开发模式下同 ID 后注册者被拒绝并 `console.error`，
 *   防止静默覆盖（spec「重复命令 ID 被拒绝」）。
 * - 静态命令在模块 import 时注册（常驻），上下文命令通过 `useRegisterCommands` 挂载注册/卸载注销。
 * - 插件命令通过 `replaceOwnerCommands` 原子注册/替换，按 owner/revision 管理。
 *
 * Strict Mode 幂等由 `useRegisterCommands` 的 effect cleanup 保证；
 * 此 store 本身对重复 add 同一命令做去重（按 id 覆盖等价命令），避免双调用残留。
 */
export interface CommandRegistryState {
  /** 已注册命令（按稳定 ID 索引）。 */
  commands: Map<string, RegisteredCommand>
  /** 命令 owner 元数据（按稳定 ID 索引，仅插件命令有值）。 */
  ownerMeta: Map<string, CommandOwnerMeta>
  /** 每个 owner 的当前 revision（用于乱序防护）。 */
  ownerRevisions: Map<string, string>
  /** 批量注册命令；同 ID 在开发模式被拒绝并警告。 */
  addCommands: (commands: RegisteredCommand[]) => void
  /** 按 ID 批量注销命令（忽略不存在的 ID）。 */
  removeCommands: (ids: string[]) => void
  /**
   * 原子替换某 owner 的全部命令。
   * 1. 新 revision 必须高于当前 revision（乱序防护）。
   * 2. 任一命令 ID 与核心/其他 owner 冲突时整批拒绝。
   * 3. 成功时原子替换该 owner 的全部旧命令。
   * 4. 同 revision 幂等（重复调用不产生变化）。
   */
  replaceOwnerCommands: (
    ownerKey: string,
    revision: string,
    manifestDigest: string,
    commands: RegisteredCommand[],
  ) => { success: boolean; reason?: string }
  /**
   * 按 owner 原子移除全部命令。
   * 用于 disable/uninstall/quarantine/grant revoke。
   */
  removeOwnerCommands: (ownerKey: string) => void
  /**
   * 获取某 owner 的当前 revision。
   */
  getOwnerRevision: (ownerKey: string) => string | undefined
  /** 取全部已注册命令（数组形式，便于面板过滤/排序）。 */
  getAllCommands: () => RegisteredCommand[]
  /** 取全部带 owner 元数据的命令。 */
  getAllOwnedCommands: () => OwnedCommand[]
  /** 清空注册表（主要供测试 reset 用）。 */
  clear: () => void
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production'
}

/** 核心 owner key（不可被插件使用）。 */
export const CORE_OWNER_KEY = '__core__'

/**
 * 比较两个 revision 字符串，返回 a > b 的布尔值。
 * 支持数字字符串和语义化版本。
 */
function isRevisionNewer(a: string, b: string): boolean {
  // 尝试数字比较
  const numA = Number(a)
  const numB = Number(b)
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA > numB
  }
  // 回退到字符串比较
  return a.localeCompare(b) > 0
}

export const useCommandRegistryStore = create<CommandRegistryState>((set, get) => ({
  commands: new Map(),
  ownerMeta: new Map(),
  ownerRevisions: new Map(),

  addCommands: (incoming) => {
    if (incoming.length === 0) return
    set((state) => {
      const next = new Map(state.commands)
      for (const cmd of incoming) {
        const existing = next.get(cmd.id)
        if (existing) {
          // 开发模式：重复 ID 警告并拒绝后者，防止静默覆盖。
          if (isDev()) {
            console.error(
              `[command-registry] 命令 ID 冲突："${cmd.id}" 已注册，后注册者被拒绝。` +
                ` 命名约定：nav.<href> / theme.<name> / ctx.<scope>.<action> / ext.<module>.<action>`,
            )
          }
          continue
        }
        next.set(cmd.id, cmd)
      }
      return { commands: next }
    })
  },

  removeCommands: (ids) => {
    if (ids.length === 0) return
    set((state) => {
      const next = new Map(state.commands)
      const nextMeta = new Map(state.ownerMeta)
      for (const id of ids) {
        next.delete(id)
        nextMeta.delete(id)
      }
      return { commands: next, ownerMeta: nextMeta }
    })
  },

  replaceOwnerCommands: (ownerKey, revision, manifestDigest, commands) => {
    const state = get()

    // 1. 同 revision 幂等
    const currentRevision = state.ownerRevisions.get(ownerKey)
    if (currentRevision === revision) {
      return { success: true, reason: 'idempotent' }
    }

    // 2. 乱序防护：新 revision 必须高于当前
    if (currentRevision && !isRevisionNewer(revision, currentRevision)) {
      return {
        success: false,
        reason: `stale-revision: current=${currentRevision}, new=${revision}`,
      }
    }

    // 3. 冲突预检：任一 ID 与核心/其他 owner 冲突时整批拒绝
    for (const cmd of commands) {
      const existing = state.commands.get(cmd.id)
      if (existing) {
        const existingMeta = state.ownerMeta.get(cmd.id)
        // 核心命令冲突
        if (!existingMeta || existingMeta.ownerKey === CORE_OWNER_KEY) {
          if (isDev()) {
            console.error(
              `[command-registry] 插件命令 ID 与核心命令冲突："${cmd.id}"，整批拒绝 owner="${ownerKey}"。`,
            )
          }
          return { success: false, reason: `core-conflict: ${cmd.id}` }
        }
        // 其他 owner 冲突
        if (existingMeta.ownerKey !== ownerKey) {
          if (isDev()) {
            console.error(
              `[command-registry] 插件命令 ID 与其他 owner 冲突："${cmd.id}" owner="${existingMeta.ownerKey}"，整批拒绝新 owner="${ownerKey}"。`,
            )
          }
          return {
            success: false,
            reason: `owner-conflict: ${cmd.id} owner=${existingMeta.ownerKey}`,
          }
        }
      }
    }

    // 4. 原子替换：移除旧 owner 命令 + 注册新命令
    set((prevState) => {
      const next = new Map(prevState.commands)
      const nextMeta = new Map(prevState.ownerMeta)
      const nextRevisions = new Map(prevState.ownerRevisions)

      // 移除该 owner 的旧命令
      for (const [id, meta] of prevState.ownerMeta) {
        if (meta.ownerKey === ownerKey) {
          next.delete(id)
          nextMeta.delete(id)
        }
      }

      // 注册新命令
      for (const cmd of commands) {
        next.set(cmd.id, cmd)
        nextMeta.set(cmd.id, {
          ownerKey,
          revision,
          manifestDigest,
          sourceKind: 'plugin-ui-command',
        })
      }

      // 更新 owner revision
      nextRevisions.set(ownerKey, revision)

      return {
        commands: next,
        ownerMeta: nextMeta,
        ownerRevisions: nextRevisions,
      }
    })

    return { success: true }
  },

  removeOwnerCommands: (ownerKey) => {
    set((state) => {
      const next = new Map(state.commands)
      const nextMeta = new Map(state.ownerMeta)
      const nextRevisions = new Map(state.ownerRevisions)

      // 移除该 owner 的全部命令
      for (const [id, meta] of state.ownerMeta) {
        if (meta.ownerKey === ownerKey) {
          next.delete(id)
          nextMeta.delete(id)
        }
      }

      // 清除 owner revision
      nextRevisions.delete(ownerKey)

      return {
        commands: next,
        ownerMeta: nextMeta,
        ownerRevisions: nextRevisions,
      }
    })
  },

  getOwnerRevision: (ownerKey) => get().ownerRevisions.get(ownerKey),

  getAllCommands: () => Array.from(get().commands.values()),

  getAllOwnedCommands: () => {
    const state = get()
    const result: OwnedCommand[] = []
    for (const [id, command] of state.commands) {
      const meta = state.ownerMeta.get(id)
      result.push({ command, owner: meta })
    }
    return result
  },

  clear: () => set({ commands: new Map(), ownerMeta: new Map(), ownerRevisions: new Map() }),
}))
