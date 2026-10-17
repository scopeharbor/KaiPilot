import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'

/**
 * v3-triz-contradiction-copilot 任务 2.1 —— TRIZ 矛盾求解分析记录模型（表 `triz_copilot_analyses`）。
 *
 * 低敏边界（RL-12）：模型上只有编号 / 枚举 / 摘要 / 有界标题；PM 陈述原文、prompt 与模型输出
 * 全文在**任何**情况下都不进本表（提交原文只在请求生命周期内存在，落库前即折算为 digest 与长度）。
 * 组织 + 项目双隔离由查询强制（`organization_id` 与 `project_id` 同时过滤，跨组织统一 404）。
 *
 * JSON 列在 SQLite 下不自动序列化，故与 `RiskSignalCandidate` 同法用 prepare/consume 做
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

export default class TrizCopilotAnalysis extends BaseModel {
  static table = 'triz_copilot_analyses'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare createdBy: number

  /** 澄清轮次链上的上一条记录（首轮为 null）。 */
  @column()
  declare parentAnalysisId: number | null

  /** 被动雷达信号接线预留列（W3 才写入）。 */
  @column()
  declare sourceSignalId: number | null

  @column()
  declare contradictionType: string

  @column()
  declare improvingParameter: number | null

  @column()
  declare worseningParameter: number | null

  /** 候选原则编号集合（按推荐序）。 */
  @jsonColumn()
  declare candidatePrinciples: number[]

  /** Top 3 方案低敏投影（序号 / 原则编号 / 有界标题 / 实体引用 / 排序分）。 */
  @jsonColumn()
  declare topSolutions: Record<string, unknown>[]

  @column()
  declare path: string

  @column()
  declare confidence: number

  @column()
  declare entityBinding: string

  /** 通过白名单校验的项目实体引用（task:1 / risk:2 …）。 */
  @jsonColumn()
  declare contextRefs: string[]

  @jsonColumn()
  declare qualityFlags: string[]

  /** 规则路径的回退原因码（零 Token 回退的可观测记录）。 */
  @jsonColumn()
  declare fallbackReasons: string[]

  @column()
  declare knowledgePackVersion: string

  @column()
  declare statementDigest: string

  @column()
  declare statementLength: number

  @column()
  declare statementTruncated: boolean

  @column()
  declare humanOverride: boolean

  @column()
  declare overrideBy: number | null

  @column.dateTime()
  declare overrideAt: DateTime | null

  @column()
  declare clarificationRounds: number

  @column()
  declare metricReadCount: number

  @column()
  declare tokenBudget: number

  @column()
  declare estimatedTokens: number

  @column()
  declare actualTokens: number | null

  @column()
  declare budgetState: string

  @column()
  declare budgetReason: string | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'overrideBy' })
  declare overrideActor: BelongsTo<typeof User>

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => TrizCopilotAnalysis, { foreignKey: 'parentAnalysisId' })
  declare parentAnalysis: BelongsTo<typeof TrizCopilotAnalysis>
}
