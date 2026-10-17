/**
 * v3-pmo-decision-intelligence-workbench —— PmoDecisionEvidenceSnapshot Model（tasks 3.2）。
 *
 * 不可变证据快照：只读模型——服务层从不 update 已完成快照；payload 为 canonical
 * 有界内容；digest 唯一约束支持语义去重引用。
 */
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { PmoDecisionSnapshotReadiness, PmoDecisionSourceState } from '@aiproj/types'

export interface PmoDecisionSnapshotSourceStateRow {
  source: string
  state: PmoDecisionSourceState
  required: boolean
}

/** JSON 列序列化边界（SQLite/PG 兼容）。 */
function jsonColumn<T>() {
  return {
    prepare: (value: T | null | undefined): string => JSON.stringify(value ?? null),
    consume: (value: unknown): T | null => {
      if (value === null || value === undefined) return null
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as T
        } catch {
          return null
        }
      }
      return value as T
    },
  }
}

function stringArrayColumn() {
  const inner = jsonColumn<string[]>()
  return {
    prepare: inner.prepare,
    consume: (value: unknown): string[] => {
      const parsed = inner.consume(value)
      return Array.isArray(parsed) ? parsed : []
    },
  }
}

export default class PmoDecisionEvidenceSnapshot extends BaseModel {
  public static table = 'pmo_decision_evidence_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare caseId: number

  @column()
  declare snapshotRevision: number

  @column()
  declare snapshotHash: string

  @column()
  declare readiness: PmoDecisionSnapshotReadiness

  /** canonical 有界 payload（不含完整业务正文）。 */
  @column(jsonColumn<Record<string, unknown>>())
  declare payload: Record<string, unknown>

  @column(jsonColumn<PmoDecisionSnapshotSourceStateRow[]>())
  declare sourceStates: PmoDecisionSnapshotSourceStateRow[]

  @column(stringArrayColumn())
  declare warningCodes: string[]

  @column()
  declare truncated: boolean

  @column.dateTime()
  declare collectedAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  /** 组织隔离 scope。 */
  static forOrganization(
    query: ReturnType<typeof PmoDecisionEvidenceSnapshot.query>,
    orgId: number,
  ) {
    return query.where('organizationId', orgId)
  }
}
