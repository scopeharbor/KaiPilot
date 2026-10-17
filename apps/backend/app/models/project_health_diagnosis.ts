import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Project from './project.js'
import ProjectHealthDiagnosisItem from './project_health_diagnosis_item.js'
import type {
  HealthDiagnosisStatus,
  HealthDiagnosisSummary,
  HealthAiDraft,
  HealthDataWarning,
} from '@aiproj/types'

/**
 * 项目健康诊断快照模型（v2-ai-project-health-diagnosis D1）。
 * 每次诊断创建一条快照记录，刷新生成新记录。
 * Dashboard 和报表只能消费 status=confirmed 的诊断。
 */
export default class ProjectHealthDiagnosis extends BaseModel {
  static table = 'project_health_diagnoses'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare status: HealthDiagnosisStatus

  @column()
  declare ruleVersion: string

  @column()
  declare inputSignature: string

  @column()
  declare outputHash: string | null

  @column()
  declare evidenceHash: string | null

  @column({
    prepare: (v: HealthDiagnosisSummary | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): HealthDiagnosisSummary | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as HealthDiagnosisSummary
      return v as HealthDiagnosisSummary
    },
    serialize: (v: unknown) => v,
  })
  declare summary: HealthDiagnosisSummary | null

  @column({
    prepare: (v: HealthAiDraft | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): HealthAiDraft | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as HealthAiDraft
      return v as HealthAiDraft
    },
    serialize: (v: unknown) => v,
  })
  declare aiDraft: HealthAiDraft | null

  @column({
    prepare: (v: HealthDataWarning[] | null) => (v ? JSON.stringify(v) : null),
    consume: (v: unknown): HealthDataWarning[] | null => {
      if (!v) return null
      if (typeof v === 'string') return JSON.parse(v) as HealthDataWarning[]
      return v as HealthDataWarning[]
    },
    serialize: (v: unknown) => v,
  })
  declare warnings: HealthDataWarning[] | null

  @column()
  declare generatedBy: number

  @column.dateTime()
  declare generatedAt: DateTime

  @column()
  declare confirmedBy: number | null

  @column.dateTime()
  declare confirmedAt: DateTime | null

  @column()
  declare confirmedNotes: string | null

  @column()
  declare rejectedBy: number | null

  @column.dateTime()
  declare rejectedAt: DateTime | null

  @column()
  declare rejectReason: string | null

  @column()
  declare stale: boolean

  @column()
  declare staleReason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  // 关系
  @hasMany(() => ProjectHealthDiagnosisItem, { foreignKey: 'diagnosisId' })
  declare items: HasMany<typeof ProjectHealthDiagnosisItem>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'generatedBy' })
  declare generator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'confirmedBy' })
  declare confirmer: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'rejectedBy' })
  declare rejector: BelongsTo<typeof User>
}
