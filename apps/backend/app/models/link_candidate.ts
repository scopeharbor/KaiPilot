/**
 * v2-5-code-repository-auto-linking —— 仓库引用链接候选模型。
 *
 * 存储来自 GitHub 事件的自动检测任务引用候选，支持
 * pending / confirmed / ignored / expired / rejected 生命周期。
 */

import { DateTime } from 'luxon'
import { BaseModel, column, beforeSave } from '@adonisjs/lucid/orm'
import type { CandidateEvidenceDto } from '@aiproj/types'

export default class LinkCandidate extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare provider: string

  @column()
  declare repositoryFullName: string

  @column()
  declare repositoryExternalId: string

  @column()
  declare eventType: string

  @column()
  declare deliveryId: string

  @column()
  declare objectType: string

  @column()
  declare objectId: string

  @column()
  declare taskReference: string

  @column()
  declare taskId: number | null

  @column()
  declare taskTitle: string | null

  @column()
  declare confidenceClass: string

  @column()
  declare status: string

  @column()
  declare ruleVersion: number

  /**
   * JSON 序列化的低敏证据列表。
   * 只包含 sourceField、matchedPreview、ruleVersion。
   */
  @column({
    prepare: (value: CandidateEvidenceDto[] | null | undefined) =>
      value ? JSON.stringify(value) : null,
    consume: (value: string | null | undefined): CandidateEvidenceDto[] =>
      value ? (typeof value === 'string' ? JSON.parse(value) : value) : [],
  })
  declare evidencesJson: CandidateEvidenceDto[] | null

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime()
  declare settledAt: DateTime | null

  @column()
  declare settledBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * 判断候选是否处于可确认状态（pending）。
   */
  get isConfirmable(): boolean {
    return this.status === 'pending'
  }

  /**
   * 判断候选是否已过期。
   */
  get isExpired(): boolean {
    return (
      this.status === 'expired' || (this.status === 'pending' && this.expiresAt < DateTime.utc())
    )
  }

  /**
   * 判断候选是否处于终态（confirmed / ignored / expired / rejected）。
   */
  get isTerminal(): boolean {
    return ['confirmed', 'ignored', 'expired', 'rejected'].includes(this.status)
  }

  // ---------------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------------

  @beforeSave()
  static validateStatus(candidate: LinkCandidate) {
    const validStatuses = ['pending', 'confirmed', 'ignored', 'expired', 'rejected']
    if (!validStatuses.includes(candidate.status)) {
      throw new Error(`Invalid candidate status: ${candidate.status}`)
    }
  }
}
