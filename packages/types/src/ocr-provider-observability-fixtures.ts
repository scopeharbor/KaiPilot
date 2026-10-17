/**
 * v3-ocr-provider-observability-cost-controls — 共享契约联调 fixtures。
 *
 * 为 OCR provider observability types 提供结构化 fixture builder。
 * 所有 fixture 都是纯函数，不依赖运行时/数据库/外部服务。
 */

export {
  ocrProviderAttemptFixture,
  ocrProviderSafeRefFixture,
  ocrProviderUsageSummaryFixture,
  ocrCostEstimateFixture,
  ocrBudgetDecisionFixture,
  ocrRateLimitDecisionFixture,
  ocrBudgetPreflightResultFixture,
  ocrRateLimitPreflightResultFixture,
  ocrProviderObservabilitySummaryFixture,
  ocrProviderAttemptFixtures,
  ocrProviderAttemptFailureFixture,
  ocrProviderAttemptBudgetBlockedFixture,
  ocrProviderAttemptRateLimitedFixture,
  ocrProviderAttemptUnknownCostFixture,
  ocrProviderAttemptNoUsageFixture,
} from './ocr-provider-observability.js'

export type {
  OcrProviderAttemptEvent,
  OcrProviderAttemptStatus,
  OcrProviderErrorCategory,
  OcrProviderWarningCode,
  OcrBudgetDecisionStatus,
  OcrRateLimitDecisionStatus,
  OcrCostStatus,
  OcrBudgetScope,
  OcrBudgetSoftLimitAction,
  OcrProviderSafeRef,
  OcrCostEstimate,
  OcrProviderUsageSummary,
  OcrBudgetDecision,
  OcrRateLimitDecision,
  OcrBudgetPreflightInput,
  OcrBudgetPreflightResult,
  OcrBudgetPostflightInput,
  OcrRateLimitPreflightInput,
  OcrRateLimitPreflightResult,
  OcrProviderObservabilitySummary,
  OcrProviderObservabilityFilters,
  OcrProviderObservabilityEventItem,
  OcrProviderObservabilityEventList,
  OcrPricingSnapshot,
} from './ocr-provider-observability.js'
