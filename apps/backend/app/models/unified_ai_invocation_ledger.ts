/**
 * v3-unified-ai-invocation-ledger §3.5 — 统一 AI 调用账本 Lucid 模型。
 *
 * 组织隔离默认作用域约定：
 * - 所有查询必须经 `filterOrganization(organizationId)` 或显式 `.where('organization_id', …)`
 *   首列过滤；模型本身不注入全局作用域（与 `OcrProviderAttempt` 等既有账本模型一致，
 *   由 service/controller 层保证组织隔离）。
 * - 列名与 `packages/types/src/unified-ai-invocation-ledger.ts` 契约一致；
 *   本地扩展列带 `aiproj_` 语义前缀在表内以裸列名存储（见迁移注释），
 *   模型字段按 Lucid camelCase 映射。
 *
 * 低敏红线：不存 prompt/system instructions/模型输出全文/messages/tool 参数结果/
 * 检索正文/原始 provider 载荷/token/secret/apiKey/Authorization。
 */

import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import type { LedgerAttemptStatus, LedgerOperationName, LedgerErrorKind } from '@aiproj/types'

export default class UnifiedAiInvocationLedger extends BaseModel {
  public static readonly table = 'unified_ai_invocation_ledger'

  @column({ isPrimary: true })
  declare id: number

  // ── 归属与身份（本地扩展命名空间 aiproj.*） ──
  @column()
  declare organizationId: number

  @column()
  declare projectId: number | null

  @column()
  declare userId: number | null

  @column()
  declare connectionId: number | null

  @column()
  declare modelId: number | null

  @column()
  declare capability: string

  @column()
  declare surface: string

  @column()
  declare attemptNumber: number

  @column()
  declare usingRealAdapter: boolean

  @column()
  declare fallbackUsed: boolean

  @column()
  declare source: string

  // ── 生命周期 ──
  @column()
  declare status: LedgerAttemptStatus

  @column()
  declare errorKind: LedgerErrorKind | 'none'

  @column()
  declare errorMessageRef: string | null

  @column()
  declare degraded: boolean

  // ── 标准遥测字段（gen_ai.* 对齐） ──
  @column()
  declare operationName: LedgerOperationName

  @column()
  declare providerName: string

  @column()
  declare requestModel: string

  @column()
  declare responseModel: string | null

  @column()
  declare responseId: string | null

  @column({
    prepare: (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v)),
    consume: (v: unknown) =>
      v === null || v === undefined ? null : typeof v === 'string' ? JSON.parse(v) : v,
  })
  declare finishReasons: string[] | null

  @column()
  declare outputType: string | null

  @column()
  declare promptName: string | null

  /** prompt 版本（本地扩展，对齐 aiproj_ 命名空间）。null = 未注册。 */
  @column()
  declare promptVersion: string | null

  @column()
  declare toolName: string | null

  @column()
  declare toolType: string | null

  @column()
  declare toolCallId: string | null

  @column()
  declare dataSourceId: string | null

  @column()
  declare traceId: string | null

  @column()
  declare spanId: string | null

  @column()
  declare parentSpanId: string | null

  @column()
  declare conversationId: string | null

  @column()
  declare workflowName: string | null

  @column()
  declare agentId: string | null

  @column()
  declare agentName: string | null

  @column()
  declare agentVersion: string | null

  @column()
  declare idempotencyKey: string | null

  // ── 延迟与用量 ──
  @column()
  declare timeToFirstChunkMs: number | null

  @column()
  declare durationMs: number | null

  @column()
  declare usageInputTokens: number | null

  @column()
  declare usageOutputTokens: number | null

  @column()
  declare usageCacheReadInputTokens: number | null

  @column()
  declare usageCacheCreationInputTokens: number | null

  @column()
  declare usageReasoningOutputTokens: number | null

  @column()
  declare audioTokens: number | null

  @column()
  declare contextTokens: number | null

  @column()
  declare totalTokens: number | null

  // ── 成本估算（本地扩展命名空间） ──
  @column()
  declare estimatedCost: number | null

  @column()
  declare currency: string | null

  @column()
  declare costStatus: string | null

  @column()
  declare pricingSnapshotId: string | null

  @column()
  declare pricingApproximate: boolean | null

  @column()
  declare pricingMatchedBy: 'connection_model_id' | 'model_name' | null

  // ── 内容指纹与决策引用 ──
  @column()
  declare inputHash: string | null

  @column()
  declare outputHash: string | null

  @column()
  declare budgetDecisionRef: string | null

  @column()
  declare rateLimitDecisionRef: string | null

  // ── 桥接（§5） ──
  @column()
  declare sourceLedgerRef: string | null

  // ── 时间 ──
  @column.dateTime()
  declare occurredAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  // ── 组织隔离默认作用域 ──

  /** 组织隔离查询入口（全部读路径首列过滤）。 */
  static filterOrganization(organizationId: number) {
    return this.query().where('organization_id', organizationId)
  }

  /** 归属组合查询。 */
  static filterOrganizationAndCapability(organizationId: number, capability: string) {
    return this.query().where('organization_id', organizationId).where('capability', capability)
  }
}
