import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'

/**
 * v3-triz-contradiction-copilot 任务 4.1 —— 分馆产物模型（表 `triz_gallery_artifacts`）。
 *
 * 一行 = 某产物在某一版本上的快照；版本链键为「项目 + 产物类型」，由服务层维护：
 * 更新即新增下一版，旧版本行保留（版本回退与软删历史可查的依据）。
 *
 * 低敏边界：`content` 只承载结构化产物（格子 / 节点 / 连线 / 标注），不承载 prompt、
 * 模型输出全文或陈述原文；组织 + 项目双隔离由查询强制（跨组织统一 404）。
 *
 * JSON 列在 SQLite 下不自动序列化，故与 `TrizCopilotAnalysis` 同法用 prepare/consume 做
 * 对象 ↔ 字符串 marshalling。
 */
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

export default class TrizGalleryArtifact extends BaseModel {
  static table = 'triz_gallery_artifacts'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  /** 四类产物之一：`contradiction_matrix` / `nine_windows` / `function_analysis` / `s_curve`。 */
  @column()
  declare artifactType: string

  /** 结构化产物内容（有界 JSON；无 prompt / 模型输出 / 陈述原文全文）。 */
  @jsonColumn()
  declare content: Record<string, unknown>

  /** 链内版本号（从 1 起递增）。 */
  @column()
  declare version: number

  @column()
  declare createdBy: number

  @column()
  declare updatedBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'updatedBy' })
  declare updater: BelongsTo<typeof User>
}
