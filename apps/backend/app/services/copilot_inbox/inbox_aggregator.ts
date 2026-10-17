/**
 * v3-copilot-suggestion-inbox — 五来源聚合器（任务 4.1–4.10）
 *
 * 按引用回源读取，**不复制建议正文**。
 * 逐来源权限判定，复用来源自身权限模型。
 * 不可访问来源零泄露省略。
 * 组织隔离，跨组织建议恒不出现。
 * 单来源不可用时降级为标注缺失的部分聚合，不静默省略。
 */

import type {
  InboxSourceKind,
  InboxSourceRef,
  InboxEntry,
  InboxMissingSource,
  InboxProblemKind,
  InboxSeverity,
  InboxDedupeKey,
} from '@aiproj/types'
import { serializeInboxDedupeKey } from '@aiproj/types'
import { createDefaultInboxSourceAdapters } from './inbox_production_wiring.js'

/**
 * 来源适配器接口：每个来源实现此接口以提供聚合能力。
 * 内容按引用回源读取，权限沿用来源自身模型。
 */
export interface InboxSourceAdapter {
  /** 来源标识 */
  readonly sourceKind: InboxSourceKind

  /**
   * 获取该来源的建议列表（仅返回 actor 有权查看的）。
   * 返回的条目不含建议正文——正文在来源侧读取。
   */
  listForInbox(params: {
    organizationId: number
    projectId: number
    actorId: number
  }): Promise<InboxSourceEntry[]>

  /**
   * 检查来源是否可用（不抛异常）。
   */
  isAvailable(): Promise<boolean>
}

/**
 * 来源适配器返回的条目形状（不含建议正文）。
 */
export interface InboxSourceEntry {
  /** 来源类别（由聚合层按 adapter 统一打标，adapter 无需自报） */
  sourceKind?: InboxSourceKind
  /** 来源侧 ID */
  sourceId: string
  /** 项目 ID */
  projectId: number
  /** 问题种类 */
  problemKind: InboxProblemKind
  /** 严重度 */
  severity: InboxSeverity
  /** 按问题种类声明的去重键 */
  declaredDedupeKey: string
  /** 来源内容 hash（用于过期判定） */
  sourceHash: string
  /** 来源捕获时间 */
  capturedAt: string
}

/**
 * 聚合结果。
 */
export interface InboxAggregateOutput {
  entries: InboxEntry[]
  missingSources: InboxMissingSource[]
}

/**
 * 五来源聚合器。
 *
 * 职责：
 * 1. 并行查询五来源
 * 2. 过滤不可访问来源（零泄露）
 * 3. 收集不可用来源标注
 * 4. 去重合并
 * 5. 确定性排序
 */
export class InboxAggregator {
  // 默认值不可省：容器按 Function.length 判定构造依赖数，无默认值又没 @inject() 即抛
  // Cannot inject，会让本控制器四个端点全部 500（含完全实现好的 index / unreadCount）。
  constructor(private adapters: InboxSourceAdapter[] = createDefaultInboxSourceAdapters()) {}

  /**
   * 聚合五来源建议。
   * 组织隔离在 adapter 内部强制执行。
   */
  async aggregate(params: {
    organizationId: number
    projectId: number
    actorId: number
  }): Promise<InboxAggregateOutput> {
    const { organizationId, projectId, actorId } = params
    const missingSources: InboxMissingSource[] = []
    const allEntries: InboxSourceEntry[] = []

    // 并行查询所有来源
    const results = await Promise.allSettled(
      this.adapters.map(async (adapter) => {
        const available = await adapter.isAvailable()
        if (!available) {
          missingSources.push({
            sourceKind: adapter.sourceKind,
            reason: `${adapter.sourceKind} 来源不可用`,
          })
          return []
        }
        try {
          const entries = await adapter.listForInbox({
            organizationId,
            projectId,
            actorId,
          })
          // 按 adapter 打标来源类别：条目扁平化后仍能追溯来源（五来源区分的前提）
          return entries.map((entry) => ({ ...entry, sourceKind: adapter.sourceKind }))
        } catch (error) {
          missingSources.push({
            sourceKind: adapter.sourceKind,
            reason: `${adapter.sourceKind} 查询失败: ${error instanceof Error ? error.message : '未知错误'}`,
          })
          return []
        }
      }),
    )

    // 收集所有成功来源的条目
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allEntries.push(...result.value)
      }
    }

    // 将来源条目转换为 InboxEntry 形态（聚合引用）
    const entries = this.mergeEntries(allEntries)

    return { entries, missingSources }
  }

  /**
   * 去重合并：同一去重键合并为一条，保留各来源引用。
   */
  private mergeEntries(sourceEntries: InboxSourceEntry[]): InboxEntry[] {
    const dedupeMap = new Map<string, InboxEntry>()

    for (const entry of sourceEntries) {
      const dedupeKey = serializeInboxDedupeKey({
        problemKind: entry.problemKind,
        declaredKey: entry.declaredDedupeKey,
      })

      const existing = dedupeMap.get(dedupeKey)
      if (existing) {
        // 合并来源引用
        const newRef: InboxSourceRef = {
          sourceKind: this.resolveSourceKind(entry),
          sourceId: entry.sourceId,
          projectId: String(entry.projectId),
          sourceHash: entry.sourceHash,
          capturedAt: entry.capturedAt,
        }
        existing.sourceRefs = [...existing.sourceRefs, newRef]
        // 更新严重度为更严重者
        if (this.severityRank(entry.severity) > this.severityRank(existing.severity)) {
          existing.severity = entry.severity
        }
      } else {
        const dedupeKeyObj: InboxDedupeKey = {
          problemKind: entry.problemKind,
          declaredKey: entry.declaredDedupeKey,
        }
        const newEntry: InboxEntry = {
          id: '', // 由持久化层分配
          organizationId: '', // 由调用方填充
          projectId: String(entry.projectId),
          state: 'unread',
          problemKind: entry.problemKind,
          severity: entry.severity,
          dedupeKey: dedupeKeyObj,
          sourceRefs: [
            {
              sourceKind: this.resolveSourceKind(entry),
              sourceId: entry.sourceId,
              projectId: String(entry.projectId),
              sourceHash: entry.sourceHash,
              capturedAt: entry.capturedAt,
            },
          ],
          expiryReason: null,
          expiryDetail: null,
          createdAt: entry.capturedAt,
          updatedAt: entry.capturedAt,
          readAt: null,
          actionedAt: null,
        }
        dedupeMap.set(dedupeKey, newEntry)
      }
    }

    return Array.from(dedupeMap.values())
  }

  /**
   * 确定性排序：严重度降序 → 创建时间降序 → id 升序。
   * 不含个性化权重。
   */
  sortEntries(entries: InboxEntry[]): InboxEntry[] {
    return [...entries].sort((a, b) => {
      // 严重度降序
      const sevDiff = this.severityRank(b.severity) - this.severityRank(a.severity)
      if (sevDiff !== 0) return sevDiff
      // 创建时间降序
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (timeDiff !== 0) return timeDiff
      // id 升序（稳定破平局）
      return a.id.localeCompare(b.id)
    })
  }

  private severityRank(severity: InboxSeverity): number {
    const map: Record<InboxSeverity, number> = {
      critical: 50,
      high: 40,
      medium: 30,
      low: 20,
      info: 10,
    }
    return map[severity] ?? 0
  }

  /** 来源类别由聚合层在收集时按 adapter 打标；缺标时退回智能推荐（仅防御，正常路径必有值）。 */
  private resolveSourceKind(entry: InboxSourceEntry): InboxSourceKind {
    return entry.sourceKind ?? 'smart_recommendation'
  }
}
