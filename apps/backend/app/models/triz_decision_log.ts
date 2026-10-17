import { DateTime } from 'luxon'
import { BaseModel, column, beforeSave, beforeDelete } from '@adonisjs/lucid/orm'
import type {
  TrizDecisionSubjectRef,
  TrizDecisionSourceRef,
  TrizDecisionArtifactHash,
  TrizDecisionType,
  TrizDecisionStatus,
} from '@aiproj/types'

/**
 * triz_decision_logs Model（v2-triz-decision-log-traceability §2.2 P0）。
 *
 * 追加式证据——save/delete 均受 guards 保护。
 */
export default class TrizDecisionLog extends BaseModel {
  static table = 'triz_decision_logs'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare decisionType: TrizDecisionType

  @column()
  declare decisionStatus: TrizDecisionStatus

  @column({
    prepare: (v: TrizDecisionSubjectRef[]) => JSON.stringify(v),
    // SQLite 返回字符串；PostgreSQL 的 json 列驱动已解析，无条件 JSON.parse 会抛错。
    consume: (v: unknown) =>
      (typeof v === 'string' ? JSON.parse(v) : v) as TrizDecisionSubjectRef[],
  })
  declare subjectRefs: TrizDecisionSubjectRef[]

  @column({
    prepare: (v: TrizDecisionSourceRef[]) => JSON.stringify(v),
    consume: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as TrizDecisionSourceRef[],
  })
  declare sourceRefs: TrizDecisionSourceRef[]

  @column({
    prepare: (v: TrizDecisionArtifactHash[]) => JSON.stringify(v),
    consume: (v: unknown) =>
      (typeof v === 'string' ? JSON.parse(v) : v) as TrizDecisionArtifactHash[],
  })
  declare artifactHashes: TrizDecisionArtifactHash[]

  @column()
  declare reasonSummary: string

  @column()
  declare reasonHash: string

  @column()
  declare alternativeSummary: string | null

  @column()
  declare supersedesDecisionLogId: number | null

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // ── Guards ──────────────────────────────────────────────────────────────

  /**
   * 追加式保护：禁止通过 Model.save() 更新已有记录。
   * 新记录走 create，已有记录只允许 append-only 的特定字段补充（reasonSummary, alternativeSummary）。
   * 完整历史更正必须通过 supersedes 链。
   */
  @beforeSave()
  static async guardAppendOnly(decisionLog: TrizDecisionLog) {
    // 如果记录已存在（更新路径），仅允许补充理由场景
    if (decisionLog.$isPersisted) {
      const dirty = Object.keys(decisionLog.$dirty)
      const allowedFields = new Set([
        'reason_summary',
        'alternative_summary',
        'updated_at',
        'decisionStatus',
        'decision_status',
      ])
      for (const field of dirty) {
        if (!allowedFields.has(field)) {
          throw new Error(
            'TRIZ decision logs are append-only. Use supersede to correct a decision.',
          )
        }
      }
    }
  }

  /**
   * 禁止通过 Model.delete() 软/硬删除。
   */
  @beforeDelete()
  static async guardNoDelete() {
    throw new Error('TRIZ decision logs cannot be deleted. Use supersede to mark as superseded.')
  }

  // ── Scopes ──────────────────────────────────────────────────────────────

  static scopeInOrganization(query: any, organizationId: number) {
    query.where('organization_id', organizationId)
  }

  static scopeInProject(query: any, organizationId: number, projectId: number) {
    query.where('organization_id', organizationId).where('project_id', projectId)
  }

  static scopeActive(query: any) {
    query.where('decision_status', 'active')
  }

  static scopeBySubjectKind(query: any, kind: string) {
    // SQLite JSON 子查询近似：subject_refs JSON 中包含指定 kind
    query.whereRaw("json_extract(subject_refs, '$[*].kind') LIKE ?", [`%"${kind}"%`])
  }
}
