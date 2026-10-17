import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { HasMany } from '@adonisjs/lucid/types/relations'
import type {
  ProjectDraftConsistency,
  ProjectDraftPipelineCheckpoint,
  ProjectDraftStructuredStrategy,
  ProjectType,
} from '@aiproj/types'
import AiProjectDraftVersion from './ai_project_draft_version.js'
import AiProjectDraftEvent from './ai_project_draft_event.js'
import AiProjectDraftConfirmation from './ai_project_draft_confirmation.js'

/**
 * AiProjectDraft —— AI 草案会话（ai-draft-generation / T036·T037）。
 *
 * 组织级隔离：查询经 `TenantScope.forOrganization(query, orgId)` 附加 organization_id。
 * 红线（design D7）：本表**不存** rawInput / 澄清回答正文，只留 project_type 与结构化元数据。
 */
const jsonColumn = {
  prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
  consume: (v: unknown) => {
    if (v === null || v === undefined) return null
    return typeof v === 'string' ? JSON.parse(v) : v
  },
}

export default class AiProjectDraft extends BaseModel {
  public static table = 'ai_project_drafts'

  @column({ isPrimary: true })
  declare id: number

  /** 对外不透明 ID（URL 中使用，避免顺序 id 泄露跨组织存在性）。 */
  @column()
  declare draftUid: string

  @column()
  declare organizationId: number

  @column()
  declare userId: number

  @column()
  declare projectType: ProjectType

  @column()
  declare status: string

  @column()
  declare schemaVersion: string

  @column()
  declare currentVersion: number

  @column()
  declare structuredStrategy: ProjectDraftStructuredStrategy | null

  @column()
  declare consistency: ProjectDraftConsistency | null

  @column()
  declare fallbackUsed: boolean

  @column()
  declare provider: string | null

  @column()
  declare model: string | null

  @column()
  declare usingRealAdapter: boolean

  /** 确认导入后回填正式项目 id。 */
  @column()
  declare projectId: number | null

  /** 生成阶段断点快照（JSONB）：重试恢复用，低敏（无 prompt/rawText/token/rawInput）。 */
  @column(jsonColumn)
  declare generationCheckpoint: ProjectDraftPipelineCheckpoint | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @hasMany(() => AiProjectDraftVersion, { foreignKey: 'draftId' })
  declare versions: HasMany<typeof AiProjectDraftVersion>

  @hasMany(() => AiProjectDraftEvent, { foreignKey: 'draftId' })
  declare events: HasMany<typeof AiProjectDraftEvent>

  @hasMany(() => AiProjectDraftConfirmation, { foreignKey: 'draftId' })
  declare confirmations: HasMany<typeof AiProjectDraftConfirmation>
}
