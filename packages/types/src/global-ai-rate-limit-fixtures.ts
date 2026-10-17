/**
 * v3-global-ai-rate-limiting —— 全局限流 Fixtures。
 *
 * 覆盖八态：
 * - 放行（allow）
 * - RPM 超限（reject）
 * - TPM 预估超限（reject）
 * - TPM 结算超限（throttle）
 * - 未设限（allow）
 * - 多层叠加（reject，取最严格者）
 * - 计数不可用（conservative_reject）
 * - actor 独占（throttle）
 */

import type { RateLimitDecisionRecord } from './global-ai-rate-limit.js'

// ---------------------------------------------------------------------------
// 八态 Fixtures
// ---------------------------------------------------------------------------

/** 放行：RPM 未超限。 */
export const RATE_LIMIT_FIXTURE_ALLOW: RateLimitDecisionRecord = {
  decisionId: 'allow-rpm-ok-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'rpm',
  layer: 'model',
  limit: 100,
  currentCount: 50,
  estimatedDelta: null,
  decision: 'allow',
  retryAfterSeconds: null,
  triggeringLayer: 'model',
  idempotencyKey: 'idem-allow-001',
  createdAt: '2026-08-17T15:00:30.000Z',
}

/** RPM 超限：reject。 */
export const RATE_LIMIT_FIXTURE_REJECT_RPM: RateLimitDecisionRecord = {
  decisionId: 'reject-rpm-exceeded-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'rpm',
  layer: 'model',
  limit: 100,
  currentCount: 100,
  estimatedDelta: null,
  decision: 'reject',
  retryAfterSeconds: 30,
  triggeringLayer: 'model',
  idempotencyKey: 'idem-reject-rpm-001',
  createdAt: '2026-08-17T15:00:45.000Z',
}

/** TPM 预估超限：reject。 */
export const RATE_LIMIT_FIXTURE_REJECT_TPM_ESTIMATE: RateLimitDecisionRecord = {
  decisionId: 'reject-tpm-estimate-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'tpm',
  layer: 'model',
  limit: 10000,
  currentCount: 9000,
  estimatedDelta: 2000,
  decision: 'reject',
  retryAfterSeconds: 25,
  triggeringLayer: 'model',
  idempotencyKey: 'idem-reject-tpm-est-001',
  createdAt: '2026-08-17T15:00:35.000Z',
}

/** TPM 结算超限：throttle。 */
export const RATE_LIMIT_FIXTURE_THROTTLE_TPM_SETTLE: RateLimitDecisionRecord = {
  decisionId: 'throttle-tpm-settle-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'tpm',
  layer: 'model',
  limit: 10000,
  currentCount: 10500,
  estimatedDelta: null,
  decision: 'throttle',
  retryAfterSeconds: 15,
  triggeringLayer: 'model',
  idempotencyKey: 'idem-throttle-tpm-001',
  createdAt: '2026-08-17T15:00:50.000Z',
}

/** 未设限：allow（不限制）。 */
export const RATE_LIMIT_FIXTURE_ALLOW_UNSET: RateLimitDecisionRecord = {
  decisionId: 'allow-unset-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'rpm',
  layer: 'model',
  limit: null, // 未设限
  currentCount: 0,
  estimatedDelta: null,
  decision: 'allow',
  retryAfterSeconds: null,
  triggeringLayer: null,
  idempotencyKey: 'idem-allow-unset-001',
  createdAt: '2026-08-17T15:00:00.000Z',
}

/** 多层叠加：reject，取最严格者（connection=50, model=100, organization=200）。 */
export const RATE_LIMIT_FIXTURE_REJECT_MULTILAYER: RateLimitDecisionRecord = {
  decisionId: 'reject-multilayer-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'rpm',
  layer: 'connection', // connection limit is strictest (50)
  limit: 50,
  currentCount: 50,
  estimatedDelta: null,
  decision: 'reject',
  retryAfterSeconds: 45,
  triggeringLayer: 'connection',
  idempotencyKey: 'idem-reject-multilayer-001',
  createdAt: '2026-08-17T15:00:15.000Z',
}

/** 计数不可用：conservative_reject。 */
export const RATE_LIMIT_FIXTURE_REJECT_COUNTING_UNAVAILABLE: RateLimitDecisionRecord = {
  decisionId: 'reject-counting-unavail-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'rpm',
  layer: 'model',
  limit: 100,
  currentCount: -1, // 计数不可用
  estimatedDelta: null,
  decision: 'reject',
  retryAfterSeconds: null,
  triggeringLayer: 'model',
  idempotencyKey: 'idem-reject-counting-001',
  createdAt: '2026-08-17T15:00:00.000Z',
}

/** actor 独占：throttle（actor 占比超限）。 */
export const RATE_LIMIT_FIXTURE_THROTTLE_ACTOR: RateLimitDecisionRecord = {
  decisionId: 'throttle-actor-001',
  organizationId: 1,
  connectionId: 10,
  modelId: 20,
  actorId: 30,
  windowStart: '2026-08-17T15:00:00.000Z',
  windowEnd: '2026-08-17T15:01:00.000Z',
  dimension: 'rpm',
  layer: 'actor',
  limit: 50, // 50% of organization limit
  currentCount: 50,
  estimatedDelta: null,
  decision: 'throttle',
  retryAfterSeconds: 20,
  triggeringLayer: 'actor',
  idempotencyKey: 'idem-throttle-actor-001',
  createdAt: '2026-08-17T15:00:40.000Z',
}

// ---------------------------------------------------------------------------
// Fixtures 集合
// ---------------------------------------------------------------------------

/** 所有 fixtures 用于测试。 */
export const RATE_LIMIT_FIXTURES = [
  RATE_LIMIT_FIXTURE_ALLOW,
  RATE_LIMIT_FIXTURE_REJECT_RPM,
  RATE_LIMIT_FIXTURE_REJECT_TPM_ESTIMATE,
  RATE_LIMIT_FIXTURE_THROTTLE_TPM_SETTLE,
  RATE_LIMIT_FIXTURE_ALLOW_UNSET,
  RATE_LIMIT_FIXTURE_REJECT_MULTILAYER,
  RATE_LIMIT_FIXTURE_REJECT_COUNTING_UNAVAILABLE,
  RATE_LIMIT_FIXTURE_THROTTLE_ACTOR,
] as const
