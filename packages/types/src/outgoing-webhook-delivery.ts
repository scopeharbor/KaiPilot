/**
 * v2-5-outgoing-webhook-delivery-ledger -- 出站 webhook 投递账本共享契约（前后端）。
 *
 * 投递事件/尝试状态、失败分类、重试策略、幂等键、HMAC 签名方案、低敏信封、脱敏投影。
 * 密钥明文仅在签名边界内 decrypt 使用，永不入投影/审计/日志/前端/快照（design D2）。
 * 默认 fixture/mock 投递，真实外发需用户明确授权（design D3）。
 *
 * 事件白名单 append-only，消费自 v2-5-outgoing-webhook-subscription-foundation。
 */
import crypto from 'node:crypto'
import type { OutgoingWebhookEventType } from './outgoing-webhook.js'

// ===== 2.1 投递状态 / 尝试状态 / 失败分类 / 重试策略 / 幂等 / HMAC 元数据 / 脱敏投影 =====

/** 投递事件状态。pending=待发；in_progress=发送中；success=终态成功；failed=终态失败；paused=暂停/feature-off。 */
export const OUTGOING_WEBHOOK_DELIVERY_STATUS = [
  'pending',
  'in_progress',
  'success',
  'failed',
  'paused',
] as const
export type OutgoingWebhookDeliveryStatus = (typeof OUTGOING_WEBHOOK_DELIVERY_STATUS)[number]

/** 尝试状态。scheduled=已调度；in_progress=发送中；success=成功；failed=失败。 */
export const OUTGOING_WEBHOOK_ATTEMPT_STATUS = [
  'scheduled',
  'in_progress',
  'success',
  'failed',
] as const
export type OutgoingWebhookAttemptStatus = (typeof OUTGOING_WEBHOOK_ATTEMPT_STATUS)[number]

/** 低敏失败分类（不含敏感响应内容）。 */
export const OUTGOING_WEBHOOK_FAILURE_CATEGORY = [
  'timeout',
  'network',
  'rate_limited',
  'server_error',
  'client_error',
  'signature',
  'config',
  'disabled',
  'exhausted',
  'unknown',
] as const
export type OutgoingWebhookFailureCategory = (typeof OUTGOING_WEBHOOK_FAILURE_CATEGORY)[number]

/** 可重试的失败分类（design D4：timeout/network/rate_limited/retryable 5xx）。 */
export const RETRYABLE_FAILURE_CATEGORIES: readonly OutgoingWebhookFailureCategory[] = [
  'timeout',
  'network',
  'rate_limited',
  'server_error',
]

/** 判定失败分类是否可自动重试。 */
export function isRetryableFailureCategory(c: OutgoingWebhookFailureCategory): boolean {
  return RETRYABLE_FAILURE_CATEGORIES.includes(c)
}

/** 判定 HTTP 响应状态码是否可重试（429 + 5xx）。 */
export function isRetryableResponseStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

/** 重试策略：最大尝试数 + 基础退避（确定性指数退避，无随机抖动，SQLite 可测）。 */
export interface OutgoingWebhookRetryPolicy {
  maxAttempts: number
  baseDelayMs: number
}

export const DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY: OutgoingWebhookRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 1000,
}

/** 确定性退避：base * 2^(attempt-1)，指数封顶避免溢出。 */
export function computeBackoffDelayMs(
  attemptNumber: number,
  policy: OutgoingWebhookRetryPolicy = DEFAULT_OUTGOING_WEBHOOK_RETRY_POLICY,
): number {
  const exp = Math.min(Math.max(attemptNumber - 1, 0), 10)
  return policy.baseDelayMs * 2 ** exp
}

/** 幂等键前缀（receiver-facing 稳定语义）。 */
export const OUTGOING_WEBHOOK_IDEMPOTENCY_PREFIX = 'wh-evt'

/** 构造稳定幂等键：wh-evt-<orgId>-<subscriptionId>-<eventType>-<sourceHash>。同一源事件+订阅恒定。 */
export function buildOutgoingWebhookIdempotencyKey(parts: {
  organizationId: number
  subscriptionId: number
  eventType: OutgoingWebhookEventType
  sourceEntityRef: string
}): string {
  const refHash = crypto
    .createHash('sha256')
    .update(parts.sourceEntityRef)
    .digest('hex')
    .slice(0, 16)
  return `${OUTGOING_WEBHOOK_IDEMPOTENCY_PREFIX}-${parts.organizationId}-${parts.subscriptionId}-${parts.eventType}-${refHash}`
}

// ===== 2.5 HMAC 签名方案（版本化）=====

export const OUTGOING_WEBHOOK_SIGNATURE_SCHEME_VERSION = 'v1' as const
export const OUTGOING_WEBHOOK_SIGNATURE_HEADER = 'x-aiproj-webhook-signature'
export const OUTGOING_WEBHOOK_TIMESTAMP_HEADER = 'x-aiproj-webhook-timestamp'
export const OUTGOING_WEBHOOK_IDEMPOTENCY_HEADER = 'x-aiproj-webhook-idempotency-key'
export const OUTGOING_WEBHOOK_EVENT_TYPE_HEADER = 'x-aiproj-webhook-event-type'
export const OUTGOING_WEBHOOK_DELIVERY_ID_HEADER = 'x-aiproj-webhook-delivery-id'

/** 全部签名相关 header 名（用于负向断言：这些 header 的值除签名外可入投影，签名值不入投影）。 */
export const OUTGOING_WEBHOOK_SIGNATURE_HEADER_NAMES = [
  OUTGOING_WEBHOOK_SIGNATURE_HEADER,
  OUTGOING_WEBHOOK_TIMESTAMP_HEADER,
  OUTGOING_WEBHOOK_IDEMPOTENCY_HEADER,
  OUTGOING_WEBHOOK_EVENT_TYPE_HEADER,
  OUTGOING_WEBHOOK_DELIVERY_ID_HEADER,
] as const

/** 已签名请求头（发送侧使用，含真实签名值；永不入投影/审计/前端）。 */
export interface OutgoingWebhookSignedHeaders {
  [OUTGOING_WEBHOOK_SIGNATURE_HEADER]: string
  [OUTGOING_WEBHOOK_TIMESTAMP_HEADER]: string
  [OUTGOING_WEBHOOK_IDEMPOTENCY_HEADER]: string
  [OUTGOING_WEBHOOK_EVENT_TYPE_HEADER]: string
  [OUTGOING_WEBHOOK_DELIVERY_ID_HEADER]: string
}

// ===== 2.3 低敏信封 + canonical payload builders =====

export type OutgoingWebhookSourceEntityType = 'project' | 'task' | 'risk'

export interface OutgoingWebhookSourceEntityRef {
  entityType: OutgoingWebhookSourceEntityType
  entityId: number
  projectId: number | null
}

/** 低敏 payload 字段（仅白名单允许的标量字段，永不含完整对象体/评论/文件/prompt/输出/token）。 */
export interface OutgoingWebhookLowSensitivePayload {
  projectId?: number
  projectName?: string
  taskId?: number
  taskTitle?: string
  riskId?: number
  riskTitle?: string
  updatedBy?: number
  createdBy?: number
  completedBy?: number
}

/** 低敏允许字段白名单（负向断言用：payload 构造不得超出此集）。 */
export const LOW_SENSITIVE_PAYLOAD_ALLOWED_FIELDS = [
  'projectId',
  'projectName',
  'taskId',
  'taskTitle',
  'riskId',
  'riskTitle',
  'updatedBy',
  'createdBy',
  'completedBy',
] as const

/** 投递信封：签名边界的输入（deliveryId 在 enqueue 后回填）。 */
export interface OutgoingWebhookEventEnvelope {
  eventType: OutgoingWebhookEventType
  deliveryId: number
  idempotencyKey: string
  timestamp: string // ISO8601
  source: OutgoingWebhookSourceEntityRef
  payload: OutgoingWebhookLowSensitivePayload
}

/** project.updated 低敏 payload builder（只输出白名单字段）。 */
export function buildProjectUpdatedPayload(input: {
  projectId: number
  projectName: string
  updatedBy: number
}): OutgoingWebhookLowSensitivePayload {
  return { projectId: input.projectId, projectName: input.projectName, updatedBy: input.updatedBy }
}

/** task.created 低敏 payload builder。 */
export function buildTaskCreatedPayload(input: {
  taskId: number
  taskTitle: string
  projectId: number
  createdBy: number
}): OutgoingWebhookLowSensitivePayload {
  return {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    projectId: input.projectId,
    createdBy: input.createdBy,
  }
}

/** task.updated 低敏 payload builder。 */
export function buildTaskUpdatedPayload(input: {
  taskId: number
  taskTitle: string
  projectId: number
  updatedBy: number
}): OutgoingWebhookLowSensitivePayload {
  return {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    projectId: input.projectId,
    updatedBy: input.updatedBy,
  }
}

/** task.completed 低敏 payload builder。 */
export function buildTaskCompletedPayload(input: {
  taskId: number
  taskTitle: string
  projectId: number
  completedBy: number
}): OutgoingWebhookLowSensitivePayload {
  return {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    projectId: input.projectId,
    completedBy: input.completedBy,
  }
}

/** risk.created 低敏 payload builder。 */
export function buildRiskCreatedPayload(input: {
  riskId: number
  riskTitle: string
  projectId: number
  createdBy: number
}): OutgoingWebhookLowSensitivePayload {
  return {
    riskId: input.riskId,
    riskTitle: input.riskTitle,
    projectId: input.projectId,
    createdBy: input.createdBy,
  }
}

/** 校验 payload 仅含白名单字段（负向断言：超出即拒绝投递准备，design D2）。 */
export function assertLowSensitivePayload(payload: OutgoingWebhookLowSensitivePayload): void {
  const allowed = new Set<string>(LOW_SENSITIVE_PAYLOAD_ALLOWED_FIELDS)
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) {
      throw new OutgoingWebhookPayloadSensitiveFieldError(key)
    }
  }
}

/** payload 含非白名单字段时抛出（投递准备拒绝，标记 failed）。 */
export class OutgoingWebhookPayloadSensitiveFieldError extends Error {
  constructor(field: string) {
    super(`出站 webhook payload 含非低敏字段: ${field}`)
    this.name = 'OutgoingWebhookPayloadSensitiveFieldError'
  }
}

// ===== 2.5 canonicalization + HMAC（纯函数，golden test 可复现）=====

/** 确定性 JSON 规范化：递归键排序、无多余空白（receiver 可复现签名）。 */
export function canonicalizeOutgoingWebhookEnvelope(
  envelope: OutgoingWebhookEventEnvelope,
): string {
  return JSON.stringify(sortKeys(envelope))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeys(obj[k])
        return acc
      }, {})
  }
  return value
}

/** 计算版本化 HMAC 签名：HMAC-SHA256(`${timestamp}.${canonical}`) -> `v1=<hex>`。 */
export function computeOutgoingWebhookSignature(
  canonicalPayload: string,
  timestamp: string,
  secret: string,
): string {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${canonicalPayload}`)
    .digest('hex')
  return `${OUTGOING_WEBHOOK_SIGNATURE_SCHEME_VERSION}=${hmac}`
}

/** 构造已签名请求头集合（发送侧；签名值永不入投影/审计）。 */
export function buildOutgoingWebhookSignedHeaders(args: {
  signature: string
  timestamp: string
  idempotencyKey: string
  eventType: OutgoingWebhookEventType
  deliveryId: number
}): OutgoingWebhookSignedHeaders {
  return {
    [OUTGOING_WEBHOOK_SIGNATURE_HEADER]: args.signature,
    [OUTGOING_WEBHOOK_TIMESTAMP_HEADER]: args.timestamp,
    [OUTGOING_WEBHOOK_IDEMPOTENCY_HEADER]: args.idempotencyKey,
    [OUTGOING_WEBHOOK_EVENT_TYPE_HEADER]: args.eventType,
    [OUTGOING_WEBHOOK_DELIVERY_ID_HEADER]: String(args.deliveryId),
  }
}

// ===== 2.1 脱敏投影 DTO（list/detail/attempts/manual retry 响应统一形态）=====

export interface OutgoingWebhookDeliveryEventDto {
  id: number
  subscriptionId: number
  subscriptionName: string
  eventType: OutgoingWebhookEventType
  status: OutgoingWebhookDeliveryStatus
  idempotencyKey: string
  attemptCount: number
  maxAttempts: number
  lastAttemptStatus: OutgoingWebhookAttemptStatus | null
  lastAttemptAt: string | null
  nextAttemptAt: string | null
  failureCategory: OutgoingWebhookFailureCategory | null
  terminalFailureReason: string | null
  paused: boolean
  sourceEntityType: OutgoingWebhookSourceEntityType
  sourceEntityId: number
  projectId: number | null
  createdAt: string
  updatedAt: string | null
}

export interface OutgoingWebhookDeliveryAttemptDto {
  id: number
  deliveryEventId: number
  attemptNumber: number
  status: OutgoingWebhookAttemptStatus
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  responseStatus: number | null
  failureCategory: OutgoingWebhookFailureCategory | null
  responseBodyHash: string | null
  responseExcerpt: string | null
  retryReason: string | null
}

/** 投递账本列表入参。 */
export interface ListOutgoingWebhookDeliveriesRequest {
  subscriptionId?: number
  status?: OutgoingWebhookDeliveryStatus
  page?: number
  perPage?: number
}

/** 列表响应 meta（标准 { data, meta } 信封）。 */
export interface OutgoingWebhookDeliveryListMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

/** 手动重试入参。 */
export interface ManualRetryOutgoingWebhookDeliveryRequest {
  reason?: string
}

/** 手动重试响应：新调度尝试的脱敏摘要。 */
export interface OutgoingWebhookManualRetryResultDto {
  deliveryEventId: number
  newAttemptNumber: number
  scheduledAt: string
  status: OutgoingWebhookDeliveryStatus
}

// ===== v2-5-webhook-batched-delivery: 批量投递共享契约 =====

/** 批量投递状态。pending=待发；in_progress=发送中；success=终态全成功；partial=部分成功；failed=终态失败；paused=暂停/feature-off。 */
export const OUTGOING_WEBHOOK_BATCH_STATUS = [
  'pending',
  'in_progress',
  'success',
  'partial',
  'failed',
  'paused',
] as const
export type OutgoingWebhookBatchStatus = (typeof OUTGOING_WEBHOOK_BATCH_STATUS)[number]

/** 批量投递入口逐项结果码。 */
export const OUTGOING_WEBHOOK_BATCH_ENTRY_OUTCOME = [
  'pending',
  'success',
  'retryable',
  'non_retryable',
  'terminal',
] as const
export type OutgoingWebhookBatchEntryOutcome = (typeof OUTGOING_WEBHOOK_BATCH_ENTRY_OUTCOME)[number]

/** 批量投递配置（design D7：本地可配置，feature-off 安全）。 */
export interface OutgoingWebhookBatchConfig {
  enabled: boolean
  /** 批次窗口秒数（从第一批入口加入开始计时）。 */
  windowSeconds: number
  /** 批次最大入口数。 */
  maxEntries: number
  /** 批次最大规范 payload 字节数。 */
  maxPayloadBytes: number
}

export const DEFAULT_OUTGOING_WEBHOOK_BATCH_CONFIG: OutgoingWebhookBatchConfig = {
  enabled: false,
  windowSeconds: 60,
  maxEntries: 50,
  maxPayloadBytes: 256 * 1024,
}

/** 批量入口低敏信封（design D3：每个入口保持稳定幂等键）。 */
export interface OutgoingWebhookBatchEntryEnvelope {
  deliveryEventId: number
  idempotencyKey: string
  eventType: OutgoingWebhookEventType
  timestamp: string
  sourceEntityType: string
  sourceEntityId: number
  projectId: number | null
  /** 低敏 payload 字段（仅白名单字段）。 */
  payload: Record<string, unknown>
}

/** 批量规范低敏信封（design D3：签名信封而非逐条原始体）。 */
export interface OutgoingWebhookBatchEnvelope {
  batchId: string
  organizationId: number
  subscriptionId: number
  eventTypes: readonly OutgoingWebhookEventType[]
  createdTimestamp: string
  entries: readonly OutgoingWebhookBatchEntryEnvelope[]
}

/** 批量投递请求头名（扩展自单条投递签名 header）。 */
export const OUTGOING_WEBHOOK_BATCH_ID_HEADER = 'x-aiproj-webhook-batch-id'
export const OUTGOING_WEBHOOK_BATCH_SIGNATURE_HEADER = 'x-aiproj-webhook-batch-signature'
export const OUTGOING_WEBHOOK_BATCH_TIMESTAMP_HEADER = 'x-aiproj-webhook-batch-timestamp'
export const OUTGOING_WEBHOOK_BATCH_SUBSCRIPTION_HEADER = 'x-aiproj-webhook-batch-subscription-id'

/** 已签名批量请求头（发送侧使用；签名值永不入投影/审计）。 */
export interface OutgoingWebhookBatchSignedHeaders {
  [OUTGOING_WEBHOOK_BATCH_SIGNATURE_HEADER]: string
  [OUTGOING_WEBHOOK_BATCH_TIMESTAMP_HEADER]: string
  [OUTGOING_WEBHOOK_BATCH_ID_HEADER]: string
  [OUTGOING_WEBHOOK_BATCH_SUBSCRIPTION_HEADER]: string
}

/** 批量投递入口结果投影（脱敏，design D4）。 */
export interface OutgoingWebhookBatchEntryOutcomeDto {
  deliveryEventId: number
  idempotencyKey: string
  outcome: OutgoingWebhookBatchEntryOutcome
  failureCategory: OutgoingWebhookFailureCategory | null
  failureReason: string | null
}

/** 批量投递尝试脱敏投影（design D5）。 */
export interface OutgoingWebhookBatchAttemptDto {
  id: number
  batchId: string
  attemptNumber: number
  status: OutgoingWebhookBatchStatus
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  responseStatus: number | null
  failureCategory: OutgoingWebhookFailureCategory | null
  entryOutcomes: readonly OutgoingWebhookBatchEntryOutcomeDto[]
}

/** 批量投递脱敏投影（加性字段，嵌入既有 OutgoingWebhookDeliveryEventDto）。 */
export interface OutgoingWebhookBatchProjectionDto {
  batchId: string
  batchStatus: OutgoingWebhookBatchStatus
  entryCount: number
  eventTypes: readonly string[]
  lastAttemptSummary: string | null
  nextAttemptAt: string | null
  paused: boolean
  perEntryOutcomes: readonly OutgoingWebhookBatchEntryOutcomeDto[] | null
}

/** 批量投递创建输入（供 collector/builder 内部使用）。 */
export interface OutgoingWebhookBatchCreateInput {
  organizationId: number
  subscriptionId: number
  targetUrl: string
  signingKeyFingerprint: string
  signingKeyVersion: string
  signatureSchemeVersion: string
  entryIds: readonly number[]
  config: OutgoingWebhookBatchConfig
}

/** 批量手动重试入参。 */
export interface ManualRetryOutgoingWebhookBatchRequest {
  batchId?: string
  reason?: string
}

/** 批量手动重试响应。 */
export interface OutgoingWebhookBatchManualRetryResultDto {
  batchId: string
  newAttemptNumber: number
  scheduledAt: string
  status: OutgoingWebhookBatchStatus
}

/** 批量收集器分组键（design D2）。 */
export interface OutgoingWebhookBatchGroupingKey {
  organizationId: number
  subscriptionId: number
  targetUrl: string
  signingKeyFingerprint: string
  signingKeyVersion: string
  signatureSchemeVersion: string
  eventEnvelopeSchemaVersion: string
}
