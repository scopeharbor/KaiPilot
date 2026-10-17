/**
 * v3-triz-ifr-visualization —— IFR 审查会话 Lucid 模型（tasks 3.2 P0）。
 *
 * 提供组织/项目作用域查询 helpers 和 JSON consume/prepare 处理，
 * 与既有 TRIZ 模型风格一致。
 */

import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  IdealityScoreOutput,
  IfrTrendSummary,
  IfrSourceRef,
  IfrWarningCode,
  IfrAiDraftState,
  IfrReviewStatus,
} from '@aiproj/types'

/**
 * JSON 列消费/准备 helpers —— 与 audit_log.ts / triz_decision_log 一致的模式。
 */
function consume<T>(value: string | null | undefined): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function prepare(value: unknown): string {
  return JSON.stringify(value ?? null)
}

export default class TrizIfrReviewSession extends BaseModel {
  public static table = 'triz_ifr_review_sessions'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare ifrId: string

  @column()
  declare organizationId: number

  @column()
  declare projectId: number

  @column()
  declare actorId: number

  @column()
  declare currentState: string

  @column()
  declare idealState: string

  @column()
  declare reviewStatus: IfrReviewStatus

  @column()
  declare schemaVersion: number

  @column()
  declare scoreVersion: number

  /** idealityScore 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<IdealityScoreOutput>(v),
    prepare,
    serialize: (v: IdealityScoreOutput) => (v ? prepare(v) : 'null'),
  })
  declare idealityScore: IdealityScoreOutput | null

  /** trendSummary 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<IfrTrendSummary>(v),
    prepare,
    serialize: (v: IfrTrendSummary) => (v ? prepare(v) : 'null'),
  })
  declare trendSummary: IfrTrendSummary | null

  /** sourceRefs 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<IfrSourceRef[]>(v),
    prepare,
    serialize: (v: IfrSourceRef[]) => (v ? prepare(v) : '[]'),
  })
  declare sourceRefs: IfrSourceRef[]

  /** warningSummary 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<IfrWarningCode[]>(v),
    prepare,
    serialize: (v: IfrWarningCode[]) => (v ? prepare(v) : '[]'),
  })
  declare warningSummary: IfrWarningCode[]

  @column()
  declare aiDraftState: IfrAiDraftState | null

  @column()
  declare outputHash: string

  @column()
  declare sourceHash: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // ── 作用域查询 helpers ──

  static queryForOrg(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  static queryForProject(organizationId: number, projectId: number) {
    return this.query().where('organization_id', organizationId).where('project_id', projectId)
  }

  static queryForOrgProjectIfr(organizationId: number, projectId: number, ifrId: string) {
    return this.query()
      .where('organization_id', organizationId)
      .where('project_id', projectId)
      .where('ifr_id', ifrId)
  }
}

/** IFR 阶段快照模型。 */
export class TrizIfrStageSnapshot extends BaseModel {
  public static table = 'triz_ifr_stage_snapshots'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare sessionId: number

  @column()
  declare stageId: string

  @column()
  declare kind: string

  @column()
  declare label: string

  @column()
  declare description: string

  @column()
  declare expectedUsefulFunctionChange: string

  @column()
  declare expectedCostChange: string

  @column()
  declare expectedHarmChange: string

  /** relatedPrincipleRefs 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<string[]>(v),
    prepare,
    serialize: (v: string[]) => (v ? prepare(v) : '[]'),
  })
  declare relatedPrincipleRefs: string[]

  /** relatedContradictionRefs 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<string[]>(v),
    prepare,
    serialize: (v: string[]) => (v ? prepare(v) : '[]'),
  })
  declare relatedContradictionRefs: string[]

  /** warningCodes 的 JSON 序列化。 */
  @column({
    consume: (v: string) => consume<IfrWarningCode[]>(v),
    prepare,
    serialize: (v: IfrWarningCode[]) => (v ? prepare(v) : '[]'),
  })
  declare warningCodes: IfrWarningCode[]

  @column()
  declare reviewState: string

  @column()
  declare stageHash: string

  @column()
  declare stale: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  static queryForSession(sessionId: number) {
    return this.query().where('session_id', sessionId)
  }
}
