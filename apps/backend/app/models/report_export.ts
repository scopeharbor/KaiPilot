import { DateTime } from 'luxon'
import { BaseModel, beforeFetch, beforeFind, column } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import type { V2ReportExportFormat } from '@aiproj/types'

/**
 * ReportExport —— V2 报表导出记录（report_exports 表）。
 *
 * 每个版本可多次导出不同格式（markdown/csv/pdf/xlsx）。
 * 文件 hash 与 size 用于完整性校验，filePath 不对外暴露。
 * 下载前二次权限校验。
 */
export default class ReportExport extends BaseModel {
  static table = 'report_exports'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare reportId: number

  @column()
  declare versionId: number | null

  @column()
  declare format: V2ReportExportFormat

  @column()
  declare status: 'pending' | 'processing' | 'completed' | 'failed'

  @column()
  declare fileHash: string | null

  @column()
  declare fileSize: number | null

  @column()
  declare mimeType: string | null

  @column({ serialize: (_v: string | null) => undefined })
  declare filePath: string | null

  @column()
  declare errorCategory: string | null

  @column()
  declare createdBy: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare completedAt: DateTime | null

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null

  @beforeFind()
  static filterOrganization(_query: ModelQueryBuilderContract<typeof ReportExport>) {
    // 调用方必须显式添加 organization_id 过滤
  }

  @beforeFetch()
  static filterOrganizationFetch(_query: ModelQueryBuilderContract<typeof ReportExport>) {
    // 调用方必须显式添加 organization_id 过滤
  }
}
