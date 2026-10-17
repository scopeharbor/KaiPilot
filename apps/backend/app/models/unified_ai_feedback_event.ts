/**
 * v3-unified-ai-feedback-ledger §3.4 — 统一 AI 反馈事件 Lucid 模型。
 *
 * 组织隔离默认作用域约定：
 * - 所有查询必须经 `filterOrganization(organizationId)` 或显式
 *   `.where('organization_id', …)` 首列过滤；模型本身不注入全局作用域，
 *   由 service/controller 层保证组织隔离。
 * - 列名与 `packages/types/src/unified-ai-feedback.ts` 契约一致。
 *
 * 低敏红线：不存 AI 提议正文、用户输入正文、prompt、模型输出、凭据。
 */

import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type {
  FeedbackType,
  EvaluatedArtifactKind,
  FeedbackCapabilitySurface,
  RejectionReason,
  ModificationFingerprint,
} from '@aiproj/types'

export default class UnifiedAiFeedbackEvent extends BaseModel {
  public static readonly table = 'unified_ai_feedback_events'

  @column({ isPrimary: true })
  declare id: number

  // ── 归属 ──
  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  // ── 被反馈对象引用 ──
  @column()
  declare artifactKind: EvaluatedArtifactKind

  @column()
  declare artifactId: string

  @column()
  declare capabilitySurface: FeedbackCapabilitySurface

  // ── 反馈内容 ──
  @column()
  declare feedbackType: FeedbackType

  @column()
  declare rejectionReason: RejectionReason | null

  @column({ serialize: (value: unknown) => value })
  declare modificationFingerprint: ModificationFingerprint | null

  @column()
  declare note: string | null

  // ── 指纹（禁存正文） ──
  @column()
  declare proposedContentHash: string | null

  @column()
  declare finalContentHash: string | null

  // ── 来源与追踪 ──
  @column()
  declare actorId: number

  @column()
  declare idempotencyKey: string

  @column()
  declare sourceEndpoint: string

  @column()
  declare sourceRef: string | null

  @column()
  declare deduplicationKey: string | null

  // ── 时间 ──
  @column({ serializeAs: null })
  declare occurredAt: DateTime

  @column({ serializeAs: null })
  declare createdAt: DateTime

  @column({ serializeAs: null })
  declare updatedAt: DateTime

  // ── 组织隔离查询辅助 ──
  static filterOrganization(query: any, organizationId: number) {
    return query.where('organization_id', organizationId)
  }

  static filterOrganizationAndSurface(query: any, organizationId: number, surface: string) {
    return query.where('organization_id', organizationId).where('capability_surface', surface)
  }
}
