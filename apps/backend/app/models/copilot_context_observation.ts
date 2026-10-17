/**
 * v3-ai-context-and-retrieval-observability —— CopilotContextObservation 模型。
 *
 * 上下文与检索观测记录模型：组织隔离、低敏 JSON 列、只读查询。
 *
 * @aiproj/backend
 */

import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class CopilotContextObservation extends BaseModel {
  static table = 'copilot_context_observations'

  @column({ isPrimary: true })
  declare id: number

  @column({ columnName: 'organization_id' })
  declare organizationId: number

  @column()
  declare assemblyId: string

  @column({ columnName: 'project_id' })
  declare projectId: number | null

  @column({ columnName: 'actor_id' })
  declare actorId: number

  @column({ serialize: (v: string) => JSON.parse(v) })
  declare sources: string

  @column({ serialize: (v: string) => JSON.parse(v) })
  declare truncation: string

  @column({ serialize: (v: string) => JSON.parse(v) })
  declare uncertainty: string

  @column({ serialize: (v: string) => JSON.parse(v) })
  declare retrievalQuality: string

  @column({ columnName: 'routing_inputs_preserved' })
  declare routingInputsPreserved: boolean

  @column({ columnName: 'total_ms' })
  declare totalMs: number

  @column()
  declare degraded: boolean

  @column({ columnName: 'degraded_reason' })
  declare degradedReason: string | null

  @column({ columnName: 'observed_at' })
  declare observedAt: Date

  @column({ columnName: 'created_at' })
  declare createdAt: Date
}
