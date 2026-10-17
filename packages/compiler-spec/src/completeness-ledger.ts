/**
 * Completeness Ledger —— 生成状态单一事实来源。
 *
 * Ledger 从 Manifest 初始化，每个 Manifest 实体对应一条 Ledger Entry。
 * 包含实体状态机（pending → ready → generating → generated → validating →
 * validated → committed_to_pdm / failed_retryable / needs_human_review / skipped_by_user）、
 * 尝试历史、验证结果、阻塞项与完整度摘要。
 *
 * @aiproj/compiler-spec
 */

import { z } from 'zod'

// ── Ledger Metadata ──

export const ledgerMetaSchema = z.object({
  schemaVersion: z.string().default('2.0'),
  runId: z.number().int().positive(),
  manifestVersion: z.number().int().positive(),
  initializedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type LedgerMeta = z.infer<typeof ledgerMetaSchema>

// ── Entry Status ──

/**
 * Ledger Entry 状态机。
 *
 * pending → ready → generating → generated → validating → validated → committed_to_pdm
 *                                                        ↘ failed_retryable → ready
 *                                                        ↘ needs_human_review（终态）
 *                        ↘ skipped_by_user（终态）
 *
 * 非法转移（如 pending → committed_to_pdm）必须被守卫拒绝。
 */
export const ledgerEntryStatusSchema = z.enum([
  'pending',
  'ready',
  'generating',
  'generated',
  'validating',
  'validated',
  'committed_to_pdm',
  'failed_retryable',
  'needs_human_review',
  'skipped_by_user',
])
export type LedgerEntryStatus = z.infer<typeof ledgerEntryStatusSchema>

// ── Attempt Record ──

export const attemptRecordSchema = z.object({
  attemptNumber: z.number().int().positive(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  status: z.string(),
  errorSummary: z.string().optional(),
  outputRef: z.string().optional(),
  tokenUsed: z.number().int().nonnegative().default(0),
})
export type AttemptRecord = z.infer<typeof attemptRecordSchema>

// ── Validation Result ──

export const validationResultSchema = z.object({
  validatorId: z.string().min(1),
  validatorType: z.string(),
  passed: z.boolean(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
        code: z.string().default('VALIDATION_ERROR'),
      }),
    )
    .default([]),
  warnings: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .default([]),
  validatedAt: z.string().datetime(),
})
export type ValidationResult = z.infer<typeof validationResultSchema>

// ── Blocking Item ──

export const blockingItemSchema = z.object({
  itemId: z.string().min(1),
  entityId: z.string().min(1),
  reason: z.string().min(1),
  category: z.enum([
    'validation_failure',
    'retry_exhausted',
    'dependency_blocked',
    'contract_violation',
    'human_review_required',
    'unknown_entity',
  ]),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().optional(),
})
export type BlockingItem = z.infer<typeof blockingItemSchema>

// ── Ledger Entry ──

export const ledgerEntrySchema = z.object({
  entityId: z.string().min(1),
  entityType: z.string(),
  label: z.string().min(1).max(200),
  status: ledgerEntryStatusSchema,
  currentAttempt: z.number().int().nonnegative().default(0),
  maxRetries: z.number().int().nonnegative().default(3),
  attempts: z.array(attemptRecordSchema).default([]),
  validationResults: z.array(validationResultSchema).default([]),
  blockingItemIds: z.array(z.string()).default([]),
  outputRef: z.string().optional(),
  responsibleStageId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>

// ── Completeness Summary ──

export const completenessSummarySchema = z.object({
  overallCompleteness: z.number().min(0).max(1).default(0),
  totalEntries: z.number().int().nonnegative(),
  statusCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  blockingItems: z.array(blockingItemSchema).default([]),
  warnings: z.array(z.string()).default([]),
  needsHumanReviewCount: z.number().int().nonnegative().default(0),
  failedRetryableCount: z.number().int().nonnegative().default(0),
})
export type CompletenessSummary = z.infer<typeof completenessSummarySchema>

// ── Resume Queue ──

/**
 * Resume 队列分类结果。
 * 用于从中断点恢复时决定哪些实体可跳过、需验证或需重试。
 */
export const resumeQueueSchema = z.object({
  skipped: z.array(z.string()).default([]),
  needsValidation: z.array(z.string()).default([]),
  needsRetry: z.array(z.string()).default([]),
  needsHumanReview: z.array(z.string()).default([]),
})
export type ResumeQueue = z.infer<typeof resumeQueueSchema>

// ── Enhanced CompletenessLedger ──

/**
 * CompletenessLedger —— 生成状态单一事实来源。
 *
 * 从 Manifest 初始化，追踪每个实体的状态机流转、
 * 尝试历史、验证结果与阻塞项。
 * Resume/重试/Ledger 查询都以本 Ledger 为准。
 */
export const completenessLedgerSchema = z.object({
  meta: ledgerMetaSchema,
  entries: z.array(ledgerEntrySchema).default([]),
  summary: completenessSummarySchema,
  resumeQueue: resumeQueueSchema.optional(),
})
export type CompletenessLedger = z.infer<typeof completenessLedgerSchema>
