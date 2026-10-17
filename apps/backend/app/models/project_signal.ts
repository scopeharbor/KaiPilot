import { DateTime } from 'luxon'
import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Project from './project.js'
import User from './user.js'
import TrizCopilotAnalysis from './triz_copilot_analysis.js'
import type {
  ProjectSignalSeverity,
  ProjectSignalStatus,
  ProjectSignalTier,
  ProjectSignalType,
} from '#services/project_signal/signal_contracts'

/**
 * v3-triz-contradiction-copilot 任务 3.1 —— 被动雷达信号模型（表 `project_signals`）。
 *
 * 只读检测 + 卡片提示 + 跳转的载体：信号本身**不是**业务数据变更，检测链路零业务表写入；
 * 本表是雷达唯一自有的写入面（生成、读数刷新、状态流转）。
 *
 * 低敏边界（RL-12）：`evidence` / `tier_reasons` 只落数值、枚举码与实体 ID，
 * 不落 PM 陈述原文、prompt、模型输出全文；资源类证据为团队聚合口径，无个人维度字段（D9 ③）。
 *
 * JSON 列在 SQLite 下不自动序列化，故与 `RiskSignalCandidate` / `TrizCopilotAnalysis` 同法
 * 用 prepare/consume 做对象 ↔ 字符串 marshalling。
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

export default class ProjectSignal extends BaseModel {
  static table = 'project_signals'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare signalType: ProjectSignalType

  @column()
  declare confidenceTier: ProjectSignalTier

  /** 四条件命中情况（分层理由，可读「为什么它是高置信」）。 */
  @jsonColumn()
  declare tierReasons: Record<string, unknown>

  @column()
  declare severity: ProjectSignalSeverity

  /** 可复算的低敏读数证据（指标名 / 当前值 / 阈值 / 基期 / 覆盖周期数 / 实体 ID）。 */
  @jsonColumn()
  declare evidence: Record<string, unknown>

  /** 确定性去重摘要（项目 + 类型 + 观测窗 + 关键实体集合摘要）。 */
  @column()
  declare idempotencyKey: string

  /** 观测窗 `YYYY-MM-DD..YYYY-MM-DD`（闭区间）。 */
  @column()
  declare observationWindow: string

  @column.dateTime()
  declare expiresAt: DateTime

  @column()
  declare status: ProjectSignalStatus

  /** 状态流转前态（审计：前后状态可读）。 */
  @column()
  declare previousStatus: ProjectSignalStatus | null

  @column()
  declare statusChangedBy: number | null

  @column.dateTime()
  declare statusChangedAt: DateTime | null

  /** 采纳后关联的分析记录（双向可追溯：分析记录侧为 `source_signal_id`）。 */
  @column()
  declare adoptedAnalysisId: number | null

  /** 检测发起人；系统触发时为 null。 */
  @column()
  declare createdBy: number | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Project, { foreignKey: 'projectId' })
  declare project: BelongsTo<typeof Project>

  @belongsTo(() => User, { foreignKey: 'statusChangedBy' })
  declare statusActor: BelongsTo<typeof User>

  @belongsTo(() => TrizCopilotAnalysis, { foreignKey: 'adoptedAnalysisId' })
  declare adoptedAnalysis: BelongsTo<typeof TrizCopilotAnalysis>
}
