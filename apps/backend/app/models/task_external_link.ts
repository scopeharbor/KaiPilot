import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type {
  ExternalLinkProvider,
  ExternalLinkType,
  ExternalLinkStatus,
  ExternalLinkStatusSource,
  CodeRepositoryCiSummary,
} from '@aiproj/types'
import { parseCiSummary } from '@aiproj/types'

/**
 * TaskExternalLink —— 任务与 GitHub/GitLab Issue/PR/MR 的轻量关联模型。
 *
 * 所有查询必须同时限定 organization_id、project_id、task_id。
 * 外部状态（externalStatus）只作为链接快照，不驱动任务事实变化。
 * metadata 是可选 JSON 字段，用于 future-proof。
 */
export default class TaskExternalLink extends BaseModel {
  static table = 'task_external_links'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare taskId: number

  @column()
  declare provider: ExternalLinkProvider

  @column()
  declare linkType: ExternalLinkType

  @column()
  declare repositoryOwner: string

  @column()
  declare repositoryName: string

  @column()
  declare externalNumber: number

  @column()
  declare externalId: string | null

  @column()
  declare externalTitle: string | null

  @column()
  declare externalStatus: ExternalLinkStatus

  @column()
  declare statusSource: ExternalLinkStatusSource

  @column()
  declare externalUrl: string

  @column()
  declare note: string | null

  @column({
    prepare: (value: Record<string, unknown> | null) => (value ? JSON.stringify(value) : null),
    consume: (value: string | Record<string, unknown> | null) => {
      if (!value) return null
      if (typeof value === 'object') return value as Record<string, unknown>
      try {
        return JSON.parse(value) as Record<string, unknown>
      } catch {
        return null
      }
    },
  })
  declare metadata: Record<string, unknown> | null

  @column.dateTime({ autoCreate: false })
  declare lastObservedAt: DateTime | null

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ---------------------------------------------------------------------------
  // v2-5-code-repository-ci-status-display —— CI/check 摘要（存于 metadata.ciSummary 子结构）
  //
  // 设计 D1：CI 摘要附着在既有 metadata JSON 列的 `ciSummary` 子结构上，不新增列、
  // 不建流水线实体，SQLite 兼容。旧链接（metadata 为空或无 ciSummary）读出为 null。
  // ---------------------------------------------------------------------------

  /**
   * 读取低敏 CI/check 摘要。旧链接或无 CI 数据时返回 null。
   * 经 parseCiSummary 降级解析，脏 metadata 不会破坏读取。
   */
  getCiSummary(): CodeRepositoryCiSummary | null {
    const raw = (this.metadata as Record<string, unknown> | null)?.ciSummary
    return parseCiSummary(raw)
  }

  /**
   * 写入低敏 CI/check 摘要到 metadata.ciSummary。传 null 清除该子结构。
   * 只改动 ciSummary 子键，保留 metadata 内其他字段。
   */
  setCiSummary(summary: CodeRepositoryCiSummary | null): void {
    const meta: Record<string, unknown> = { ...(this.metadata ?? {}) }
    if (summary === null) {
      delete meta.ciSummary
    } else {
      meta.ciSummary = summary
    }
    this.metadata = Object.keys(meta).length > 0 ? meta : null
  }
}
