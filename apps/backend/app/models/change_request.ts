import { ChangeRequestSchema } from '#database/schema'
import Project from './project.js'
import User from './user.js'
import { beforeFetch, beforeFind, belongsTo, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

/** 变更类型枚举 */
export type ChangeRequestType =
  'scope' | 'schedule' | 'cost' | 'resource' | 'quality' | 'risk' | 'other'

/** 变更请求状态枚举 */
export type ChangeRequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'implemented'
  | 'closed'
  | 'cancelled'

/** 优先级枚举 */
export type ChangeRequestPriority = 'low' | 'medium' | 'high' | 'urgent'

/** 六维结构化影响摘要 */
export interface ChangeRequestImpactSummary {
  scope?: string
  schedule?: string
  resources?: string
  cost?: string
  risks?: string
  assumptions?: string
}

const STATUSES: readonly ChangeRequestStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'implemented',
  'closed',
  'cancelled',
]

export function isChangeRequestStatus(v: unknown): v is ChangeRequestStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v as ChangeRequestStatus)
}

const TYPES: readonly ChangeRequestType[] = [
  'scope',
  'schedule',
  'cost',
  'resource',
  'quality',
  'risk',
  'other',
]

export function isChangeRequestType(v: unknown): v is ChangeRequestType {
  return typeof v === 'string' && (TYPES as readonly string[]).includes(v as ChangeRequestType)
}

const PRIORITIES: readonly ChangeRequestPriority[] = ['low', 'medium', 'high', 'urgent']

export function isChangeRequestPriority(v: unknown): v is ChangeRequestPriority {
  return (
    typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v as ChangeRequestPriority)
  )
}

const jsonColumn = () =>
  column({
    prepare: (value: unknown) =>
      value === null || value === undefined ? null : JSON.stringify(value),
    consume: (value: unknown) =>
      value === null || value === undefined
        ? null
        : typeof value === 'string'
          ? JSON.parse(value)
          : value,
    serialize: (value: unknown) => value,
  })

/**
 * 变更请求模型（simple-change-approval）。
 *
 * 复用已有 change_requests 表 + 补充迁移（1784200000000）。
 * 软删除（deleted_at），组织隔离（organization_id）。
 */
export default class ChangeRequest extends ChangeRequestSchema {
  /** JSON 列：六维影响摘要 */
  @jsonColumn()
  declare impactSummary: ChangeRequestImpactSummary | null

  /** JSON 列：影响分析（旧字段，保留向后兼容） */
  @jsonColumn()
  declare impactAnalysis: Record<string, unknown> | null

  /** JSON 列：AI 元数据 */
  @jsonColumn()
  declare aiMetadata: Record<string, unknown> | null

  // V2 影响分析引用（v2-change-management-impact-analysis §2.3）
  @column()
  declare currentImpactAnalysisId: number | null

  @column()
  declare approveRefAnalysisId: number | null

  @column()
  declare impactAnalysisConfirmStatus: string | null

  @jsonColumn()
  declare approveRefSummaryOverride: Record<string, unknown> | null

  /** JSON 列：关联任务 ID 数组 */
  @jsonColumn()
  declare relatedTaskIds: number[] | null

  /** JSON 列：关联文档 ID 数组 */
  @jsonColumn()
  declare relatedDocumentIds: number[] | null

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'requesterId' })
  declare requester: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'approverId' })
  declare approver: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'requestedBy' })
  declare requestedByUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'reviewedBy' })
  declare reviewedByUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'implementedBy' })
  declare implementedByUser: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'closedBy' })
  declare closedByUser: BelongsTo<typeof User>

  @beforeFind()
  static excludeSoftDeletedOnFind(query: ModelQueryBuilderContract<typeof ChangeRequest>) {
    query.whereNull('change_requests.deleted_at')
  }

  @beforeFetch()
  static excludeSoftDeletedOnFetch(query: ModelQueryBuilderContract<typeof ChangeRequest>) {
    query.whereNull('change_requests.deleted_at')
  }
}
