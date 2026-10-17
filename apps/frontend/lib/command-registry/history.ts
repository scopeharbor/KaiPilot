import type { RegisteredCommand } from './types'

/**
 * 命令使用历史（本地 MRU/frecency）纯函数核心（spec command-palette / design.md D1、D3、D4）。
 *
 * 低敏边界：只保存稳定命令 ID、使用次数、首次/最近使用时间（epoch ms）、
 * 可选低敏路径分类（不含查询串与哈希）。禁止存储搜索原文、业务对象标题、
 * prompt、模型输出、token、secret、完整 URL 查询串或正式业务数据。
 *
 * 本模块全部是纯函数：不读注册表、不写 localStorage、不产生副作用。
 * 持久化见 `history-store.ts`，面板集成见 `CommandPalette.tsx`。
 */

/** 存储格式版本；持久化载荷版本不兼容时整体回退为空历史。 */
export const COMMAND_HISTORY_STORAGE_VERSION = 1

/** 本地历史容量上限（保留的命令 ID 数）；超出时按 frecency 评分从低到高驱逐。 */
export const COMMAND_HISTORY_MAX_ENTRIES = 50

/** 命令面板「最近使用」区最多展示的命令数（design.md D5 紧凑推广区）。 */
export const COMMAND_HISTORY_PROMOTED_LIMIT = 5

/** recency 半衰期（毫秒）：距今每过一个半衰期，recency 分量减半。 */
export const FRECENCY_HALF_LIFE_MS = 24 * 60 * 60 * 1000

/** recency 分量权重。 */
export const FRECENCY_RECENCY_WEIGHT = 2

/** frequency 分量权重（乘以 `log1p(count)`，抑制超高次数的线性膨胀）。 */
export const FRECENCY_FREQUENCY_WEIGHT = 1

/** 单条命令的本地使用记录（低敏元数据）。 */
export interface CommandUsageRecord {
  /** 稳定命令 ID（注册表主键）。 */
  id: string
  /** 本地累计使用次数。 */
  count: number
  /** 首次使用时间（epoch ms）。 */
  firstUsedAt: number
  /** 最近使用时间（epoch ms）。 */
  lastUsedAt: number
  /** 可选低敏路径分类（如 `/projects`；禁止含查询串 `?` 与哈希 `#`）。 */
  lastContextPath?: string
}

/** 本地命令历史的持久化形态。 */
export interface CommandHistoryData {
  /** 存储格式版本。 */
  version: number
  /** 按命令 ID 索引的使用记录。 */
  records: Record<string, CommandUsageRecord>
}

/** frecency 排名结果项。 */
export interface FrecencyRankedCommand {
  /** 被推广的命令 ID（必属于传入的可见命令集合）。 */
  id: string
  /** 确定性 frecency 评分。 */
  score: number
}

export function createEmptyCommandHistory(): CommandHistoryData {
  return { version: COMMAND_HISTORY_STORAGE_VERSION, records: {} }
}

/** 命令 ID 必须是非空白字符串（空/非法 ID 一律忽略，见 spec「忽略无效历史」）。 */
function isValidCommandId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0
}

/** 路径分类的低敏形态校验：非空且不含查询串 `?` 与哈希 `#`。 */
function isLowSensitivityPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.includes('?') && !path.includes('#')
}

/**
 * 记录一次命令使用（纯函数，返回新历史）。
 *
 * - 首次使用：创建记录（`count=1`，`firstUsedAt=lastUsedAt=now`）。
 * - 重复使用：`count+1`，保留 `firstUsedAt`，更新 `lastUsedAt=now`。
 * - 空/非法命令 ID：原样返回，不记录。
 * - `contextPath` 仅在通过低敏校验时记录；非法值静默忽略（不阻断使用记录）。
 * - 写入后执行容量驱逐（见 `enforceHistoryCap`）。
 */
export function recordCommandUsage(
  history: CommandHistoryData,
  commandId: string,
  now: number,
  contextPath?: string,
): CommandHistoryData {
  if (!isValidCommandId(commandId)) return history
  const id = commandId.trim()
  const existing = history.records[id]
  const record: CommandUsageRecord = existing
    ? { ...existing, count: existing.count + 1, lastUsedAt: now }
    : { id, count: 1, firstUsedAt: now, lastUsedAt: now }
  if (contextPath !== undefined && isLowSensitivityPath(contextPath)) {
    record.lastContextPath = contextPath
  }
  const next: CommandHistoryData = {
    version: history.version,
    records: { ...history.records, [id]: record },
  }
  return enforceHistoryCap(next, now)
}

/**
 * 确定性 frecency 评分（design.md D4）：
 * `RECENCY_WEIGHT * 0.5^(age/HALF_LIFE) + FREQUENCY_WEIGHT * log1p(count)`。
 * `now` 由调用方注入，保证相同输入历史下评分确定（spec「排序结果保持确定」）。
 */
export function scoreCommandUsage(record: CommandUsageRecord, now: number): number {
  const age = Math.max(0, now - record.lastUsedAt)
  const recency = Math.pow(0.5, age / FRECENCY_HALF_LIFE_MS)
  const frequency = Math.log1p(Math.max(0, record.count))
  return FRECENCY_RECENCY_WEIGHT * recency + FRECENCY_FREQUENCY_WEIGHT * frequency
}

/**
 * 容量驱逐：超过 `COMMAND_HISTORY_MAX_ENTRIES` 时按评分从低到高驱逐；
 * 评分相同先驱逐 `lastUsedAt` 较旧者，再按命令 ID 字典序驱逐（确定性）。
 */
export function enforceHistoryCap(history: CommandHistoryData, now: number): CommandHistoryData {
  const ids = Object.keys(history.records)
  if (ids.length <= COMMAND_HISTORY_MAX_ENTRIES) return history
  const scored = ids.map((id) => ({ id, score: scoreCommandUsage(history.records[id]!, now) }))
  // 保留者优先级：高分 > 较近使用 > ID 字典序小。
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ra = history.records[a.id]!
    const rb = history.records[b.id]!
    if (rb.lastUsedAt !== ra.lastUsedAt) return rb.lastUsedAt - ra.lastUsedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  const keep = new Set(scored.slice(0, COMMAND_HISTORY_MAX_ENTRIES).map((s) => s.id))
  const records: Record<string, CommandUsageRecord> = {}
  for (const id of ids) {
    if (keep.has(id)) records[id] = history.records[id]!
  }
  return { version: history.version, records }
}

/**
 * 剪枝：移除不在 `validCommandIds` 内的历史记录（已移除/改名的命令）。
 * 排序时本就会忽略不可见命令，此函数用于安全的 opportunistic 清理
 * （spec「命令被移除或改名后历史被忽略」）。
 */
export function pruneCommandHistory(
  history: CommandHistoryData,
  validCommandIds: ReadonlySet<string>,
): CommandHistoryData {
  let changed = false
  const records: Record<string, CommandUsageRecord> = {}
  for (const [id, record] of Object.entries(history.records)) {
    if (!validCommandIds.has(id)) {
      changed = true
      continue
    }
    records[id] = record
  }
  if (!changed) return history
  return { version: history.version, records }
}

/**
 * 解析持久化载荷；任何损坏（非对象、版本不兼容、记录字段非法、
 * 路径分类含查询串等）都整体回退为空历史（spec「本地历史损坏时安全回退」）。
 */
export function parseCommandHistory(raw: unknown): CommandHistoryData {
  if (typeof raw !== 'object' || raw === null) return createEmptyCommandHistory()
  const data = raw as Record<string, unknown>
  if (data.version !== COMMAND_HISTORY_STORAGE_VERSION) return createEmptyCommandHistory()
  if (typeof data.records !== 'object' || data.records === null) return createEmptyCommandHistory()
  const records: Record<string, CommandUsageRecord> = {}
  for (const [id, value] of Object.entries(data.records as Record<string, unknown>)) {
    if (!isValidCommandId(id)) return createEmptyCommandHistory()
    const record = sanitizeUsageRecord(value)
    if (!record) return createEmptyCommandHistory()
    records[id] = record
  }
  return { version: COMMAND_HISTORY_STORAGE_VERSION, records }
}

/** 校验并规范化单条使用记录；非法（含疑似敏感路径）返回 null。 */
function sanitizeUsageRecord(value: unknown): CommandUsageRecord | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (!isValidCommandId(raw.id)) return null
  if (typeof raw.count !== 'number' || !Number.isFinite(raw.count) || raw.count < 1) return null
  if (typeof raw.firstUsedAt !== 'number' || !Number.isFinite(raw.firstUsedAt)) return null
  if (typeof raw.lastUsedAt !== 'number' || !Number.isFinite(raw.lastUsedAt)) return null
  const record: CommandUsageRecord = {
    id: raw.id.trim(),
    count: Math.floor(raw.count),
    firstUsedAt: raw.firstUsedAt,
    lastUsedAt: raw.lastUsedAt,
  }
  if (raw.lastContextPath !== undefined) {
    // 含查询串/哈希的路径可能夹带敏感信息——整条载荷作废，宁空勿留。
    if (!isLowSensitivityPath(raw.lastContextPath)) return null
    record.lastContextPath = raw.lastContextPath
  }
  return record
}

/** 序列化为持久化字符串（只含低敏字段）。 */
export function serializeCommandHistory(history: CommandHistoryData): string {
  return JSON.stringify({ version: COMMAND_HISTORY_STORAGE_VERSION, records: history.records })
}

/**
 * 只对「当前可见的已注册命令」做 frecency 排名（design.md D3 核心安全不变量）。
 *
 * 调用方必须先完成既有可见性过滤（命令仍存在、RBAC 通过、`when(ctx)` 通过），
 * 再把结果传入本函数。历史中有但不在可见集合内的命令（被移除、无权限、
 * 上下文不匹配）绝不进入返回结果，也不会通过历史重新出现。
 *
 * 排序：评分降序 → `lastUsedAt` 较近优先 → 传入数组原顺序（registry/分组顺序）
 * → 命令 ID 字典序。纯函数，不修改传入的命令数组与历史对象。
 */
export function rankVisibleCommandsByFrecency(
  visibleCommands: readonly RegisteredCommand[],
  history: CommandHistoryData,
  now: number,
  limit: number = COMMAND_HISTORY_PROMOTED_LIMIT,
): FrecencyRankedCommand[] {
  const orderIndex = new Map<string, number>()
  visibleCommands.forEach((cmd, index) => {
    if (!orderIndex.has(cmd.id)) orderIndex.set(cmd.id, index)
  })
  const ranked: FrecencyRankedCommand[] = []
  for (const cmd of visibleCommands) {
    const record = history.records[cmd.id]
    if (!record) continue // 无历史不参与推广；历史独有的命令天然被排除
    ranked.push({ id: cmd.id, score: scoreCommandUsage(record, now) })
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ra = history.records[a.id]!
    const rb = history.records[b.id]!
    if (rb.lastUsedAt !== ra.lastUsedAt) return rb.lastUsedAt - ra.lastUsedAt
    const oa = orderIndex.get(a.id)!
    const ob = orderIndex.get(b.id)!
    if (oa !== ob) return oa - ob
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return ranked.slice(0, Math.max(0, limit))
}
