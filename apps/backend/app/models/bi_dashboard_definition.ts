// v3-bi-dashboard-builder §4.1 — BiDashboardDefinition Lucid Model。
// 组织/PMO 级 BI Dashboard 定义实体。

import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import type {
  BiDashboardFreshnessPolicy,
  BiDashboardGlobalFilter,
  BiDashboardLayout,
  BiDashboardTimeWindow,
  BiDashboardWarning,
  BiDashboardWidgetInstance,
} from '@aiproj/types'
import Organization from '#models/organization'
import User from '#models/user'

export default class BiDashboardDefinition extends BaseModel {
  static table = 'bi_dashboard_definitions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare scope: 'personal' | 'organization_shared'

  @column()
  declare ownerActorId: number | null

  @column()
  declare name: string

  @column()
  declare version: number

  @column()
  declare definitionHash: string

  @column()
  declare snapshotHash: string

  @column({
    consume: (v: string) => (typeof v === 'string' ? JSON.parse(v) : v),
    prepare: (v: unknown) => JSON.stringify(v),
  })
  declare layout: BiDashboardLayout

  @column({
    consume: (v: string) => (typeof v === 'string' ? JSON.parse(v) : v),
    prepare: (v: unknown) => JSON.stringify(v),
  })
  declare widgets: BiDashboardWidgetInstance[]

  @column({
    consume: (v: string | null) => (typeof v === 'string' ? JSON.parse(v) : v),
    prepare: (v: unknown) => (v ? JSON.stringify(v) : null),
  })
  declare globalFilters: BiDashboardGlobalFilter[] | null

  @column({
    consume: (v: string | null) => (typeof v === 'string' ? JSON.parse(v) : v),
    prepare: (v: unknown) => (v ? JSON.stringify(v) : null),
  })
  declare timeWindow: BiDashboardTimeWindow | null

  @column({
    consume: (v: string | null) => (typeof v === 'string' ? JSON.parse(v) : v),
    prepare: (v: unknown) => (v ? JSON.stringify(v) : null),
  })
  declare freshnessPolicy: BiDashboardFreshnessPolicy | null

  @column()
  declare isDefault: boolean

  @column()
  declare isArchived: boolean

  @column({
    consume: (v: string | null) => (typeof v === 'string' ? JSON.parse(v) : v),
    prepare: (v: unknown) => (v ? JSON.stringify(v) : null),
  })
  declare warningSummary: BiDashboardWarning[] | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Organization, { foreignKey: 'organizationId' })
  declare organization: BelongsTo<typeof Organization>

  @belongsTo(() => User, { foreignKey: 'ownerActorId' })
  declare owner: BelongsTo<typeof User>
}
