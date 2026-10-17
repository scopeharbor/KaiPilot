import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/**
 * ReportTemplate —— 组织自定义 BI 报表模板副本。
 *
 * 内置模板以代码内注册表定义（不落 DB），本表仅存组织自定义副本。
 * v3-bi-report-template-library §5.1
 */
export default class ReportTemplate extends BaseModel {
  static override table = 'report_templates'

  @column({ isPrimary: true })
  declare id: number

  /** 组织 ID（组织隔离索引） */
  @column()
  declare organizationId: number

  /** 来源内置模板 ID */
  @column()
  declare sourceTemplateId: string

  /** 来源内置模板版本 */
  @column()
  declare sourceVersion: number

  /** 副本名称（可编辑） */
  @column()
  declare name: string

  /** 副本描述（可编辑） */
  @column()
  declare description: string

  /** 配置 JSON（筛选默认值覆盖、图表开关） */
  @column()
  declare config: Record<string, unknown> | null

  /** 状态：active | archived */
  @column()
  declare status: 'active' | 'archived'

  /** 乐观并发版本号 */
  @column()
  declare concurrencyVersion: number

  /** 创建人 ID */
  @column()
  declare createdBy: number | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
