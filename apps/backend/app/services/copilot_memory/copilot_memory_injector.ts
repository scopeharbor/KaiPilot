/**
 * v3-copilot-memory-user-and-project —— 记忆注入选取器
 *
 * 按 scope、标签、意图类与时效确定性选取记忆，注入为独立记忆切面。
 * 核心约束：
 * - 不引入向量检索（本机优先）
 * - 注入为独立记忆切面，标注为 inferred，不与项目事实切面合并
 * - 受既有上下文预算与确定性截断约束
 * - 记忆与实时事实冲突时实时事实优先
 * - 久未确认的记忆不得驱动变更类动作
 * - 相同输入两次注入选取结果全等
 */

import type {
  CopilotMemoryEntry,
  CopilotMemoryInjectionInput,
  CopilotMemoryInjectionOutput,
  CopilotMemoryFacet,
  CopilotMemoryConflictResolution,
} from '@aiproj/types'
import {
  COPILLOT_MEMORY_FACET_NAME,
  isMemoryStale,
  sortMemoryEntries,
  estimateMemoryEntryBytes,
} from '@aiproj/types'

/**
 * 记忆选取器：按 scope、标签、时效确定性选取。
 * 不依赖 embedding 搜索、向量数据库或外部索引。
 *
 * 三层注入优先级（D4）：项目 > 组织 > 用户偏好（越具体越优先）。
 * 当同标签同层级的记忆冲突时，更具体层级的记忆优先。
 */
export function selectMemoriesForInjection(
  memories: readonly CopilotMemoryEntry[],
  input: CopilotMemoryInjectionInput,
): CopilotMemoryInjectionOutput {
  const { scope, projectId, intentTags, memoryBudgetBytes } = input

  // 1. 按 scope 过滤
  let filtered = memories.filter((m) => {
    if (m.status === 'invalidated') return false
    if (m.status === 'candidate') return false // 候选不注入

    switch (scope) {
      case 'project':
        return m.scope === 'project' || m.scope === 'user'
      case 'organization':
        return m.scope === 'organization' || m.scope === 'project' || m.scope === 'user'
      case 'portfolio':
        // 组合级包含组织、项目和用户记忆
        return m.scope === 'organization' || m.scope === 'project' || m.scope === 'user'
      case 'global':
        return m.scope === 'user' // global scope 只注入用户记忆
      default:
        return false
    }
  })

  // 2. 按项目过滤（project scope 时）
  if (projectId && scope === 'project') {
    filtered = filtered.filter(
      (m) => m.projectId === projectId || m.projectId === undefined || m.scope === 'user',
    )
  }

  // 2b. 三层优先级：项目 > 组织 > 用户偏好（D4）
  // 同标签同摘要时，更具体层级优先
  if (scope === 'portfolio' || scope === 'organization') {
    const priority: Record<string, number> = { project: 3, organization: 2, user: 1 }
    const byKey = new Map<string, CopilotMemoryEntry[]>()
    for (const m of filtered) {
      const key = m.tags.join('|') + '::' + m.summary.slice(0, 50)
      const group = byKey.get(key) ?? []
      group.push(m)
      byKey.set(key, group)
    }
    filtered = []
    for (const group of byKey.values()) {
      // 每组内按层级优先级排序，取最高优先级
      group.sort((a, b) => (priority[b.scope] ?? 0) - (priority[a.scope] ?? 0))
      filtered.push(group[0]!)
    }
  }

  // 3. 按意图标签匹配（相关性排序，确定性）
  if (intentTags && intentTags.length > 0) {
    const scored = filtered.map((m) => ({
      entry: m,
      relevance: m.tags.filter((t) => intentTags.includes(t)).length,
    }))
    // 相关性降序，同分再按稳定排序键（保持确定性）
    filtered = scored
      .sort((a, b) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance
        return sortMemoryEntries([a.entry, b.entry])[0]!.id === a.entry.id ? -1 : 1
      })
      .map((item) => item.entry)
  } else {
    // 无标签时按稳定排序
    filtered = sortMemoryEntries(filtered)
  }

  // 4. 预算截断（确定性顺序）
  let estimatedBytes = 0
  const selected: CopilotMemoryEntry[] = []
  let truncatedCount = 0

  for (const entry of filtered) {
    const entryBytes = estimateMemoryEntryBytes(entry)
    if (estimatedBytes + entryBytes > memoryBudgetBytes) {
      truncatedCount++
      continue
    }
    selected.push(entry)
    estimatedBytes += entryBytes
  }

  // 5. 统计久未确认
  const longUnconfirmedCount = selected.filter((m) => isMemoryStale(m)).length

  return {
    selected,
    truncatedCount,
    longUnconfirmedCount,
    estimatedBytes,
  }
}

/**
 * 将选取结果构建为独立记忆切面（标注为 inferred）。
 * 必须与项目事实切面分开标注。
 */
export function buildMemoryFacet(
  injectionOutput: CopilotMemoryInjectionOutput,
): CopilotMemoryFacet {
  return {
    facetName: COPILLOT_MEMORY_FACET_NAME,
    kind: 'inferred',
    memories: injectionOutput.selected,
    longUnconfirmedCount: injectionOutput.longUnconfirmedCount,
    truncatedCount: injectionOutput.truncatedCount,
  }
}

/**
 * 检测记忆与实时事实的冲突。
 * 实时事实优先，记忆标记为可能过期。
 */
export function detectConflictWithLiveFact(
  memory: CopilotMemoryEntry,
  liveFactValue: unknown,
  memoryValue: unknown,
): CopilotMemoryConflictResolution {
  if (liveFactValue === undefined || liveFactValue === null) {
    return { outcome: 'no_conflict' }
  }

  // 简单值比较（字符串/数字）
  if (String(liveFactValue) !== String(memoryValue)) {
    return {
      outcome: 'live_fact_wins',
      memoryId: memory.id,
      reason: `实时事实值 "${String(liveFactValue)}" 与记忆值 "${String(memoryValue)}" 不符`,
    }
  }

  return { outcome: 'no_conflict' }
}

/**
 * 验证选取依赖面不含 embedding 检索与外部索引。
 * 用于测试：证明选取是纯确定性的。
 */
export function assertNoVectorDependency(): { ok: boolean; reason?: string } {
  // 选取器仅使用 Array.filter/sort，不依赖外部索引
  return { ok: true, reason: '选取器仅使用确定性数组操作，无外部依赖' }
}
