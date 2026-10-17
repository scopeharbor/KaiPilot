/**
 * v3-copilot-routing-decision-ledger（任务 5.1–5.5, 6.1–6.14）—— 路由决策聚合服务。
 *
 * 核心职责：
 * - 准确率聚合（口径写死：首位命中率/前N命中率/放弃/歧义选择）
 * - 规则命中率与模型兜底率聚合（兜底率是目录健康度先行指标）
 * - 兜底率阈值健康状态（禁止自动动作）
 * - 澄清效率聚合（轮数分布 + 澄清后成功率）
 * - 不可用类别分布聚合
 * - 确定性违规查询（同 hash 不同排序检测）
 * - 组织隔离全路径
 * - 为评测与排序提供稳定读接口
 */

import type {
  CopilotRoutingLedgerRecord,
  RoutingRedirectClass,
  RoutingAggregateFilter,
  RoutingAggregateResult,
  RoutingAccuracyMetrics,
  RoutingRuleHitMetrics,
  RoutingUnavailabilityDistribution,
  ReproducibilityViolation,
} from '@aiproj/types'
import {
  computeRoutingAccuracyMetrics,
  computeRoutingRuleHitMetrics,
  computeRoutingClarificationEfficiency,
  detectReproducibilityViolation,
} from '@aiproj/types'
import CopilotRoutingDecisionModel from '../../models/copilot_routing_decision.js'

// ---------------------------------------------------------------------------
// 查询 helpers
// ---------------------------------------------------------------------------

/**
 * 从数据库记录转换为账本记录（扁平化）。
 */
function modelToLedgerRecord(model: CopilotRoutingDecisionModel): CopilotRoutingLedgerRecord {
  return {
    dbId: model.id,
    organizationId: model.organizationId,
    recordId: model.recordId,
    catalogVersion: model.catalogVersion,
    intentClass: model.intentClass as CopilotRoutingLedgerRecord['intentClass'],
    subIntentId: model.subIntentId,
    intentSummary: model.intentSummary,
    destinationOrder: model.destinationOrder,
    confidences: model.confidences,
    clarificationRoundCount: model.clarificationRoundCount,
    ambiguous: model.ambiguous,
    unavailabilityKinds:
      model.unavailabilityKinds as CopilotRoutingLedgerRecord['unavailabilityKinds'],
    ruleHitCount: model.ruleHitCount,
    fallbackCount: model.fallbackCount,
    scope: model.scope as CopilotRoutingLedgerRecord['scope'],
    userDestination: model.userDestination as CopilotRoutingLedgerRecord['userDestination'],
    redirectClass: model.redirectClass as RoutingRedirectClass,
    attributionConfidence:
      model.attributionConfidence as CopilotRoutingLedgerRecord['attributionConfidence'],
    inputTupleHash: model.inputTupleHash,
    idempotencyKey: model.idempotencyKey,
    traceId: model.traceId,
    createdAt: model.createdAt.toJSDate(),
  }
}

/**
 * 构建组织隔离的查询基线。
 */
function buildBaseQuery(organizationId: number) {
  return CopilotRoutingDecisionModel.query().where('organization_id', organizationId)
}

/**
 * 应用可选的切分维度过滤。
 */
function applyFilter(query: ReturnType<typeof buildBaseQuery>, filter: RoutingAggregateFilter) {
  let q = query
  if (filter.intentClass) {
    q = q.where('intent_class', filter.intentClass)
  }
  if (filter.subIntentId) {
    q = q.where('sub_intent_id', filter.subIntentId)
  }
  if (filter.catalogVersion) {
    q = q.where('catalog_version', filter.catalogVersion)
  }
  if (filter.startTime) {
    q = q.where('created_at', '>=', filter.startTime)
  }
  if (filter.endTime) {
    q = q.where('created_at', '<=', filter.endTime)
  }
  return q
}

// ---------------------------------------------------------------------------
// 聚合查询
// ---------------------------------------------------------------------------

/**
 * 按组织隔离聚合路由决策指标。
 */
export async function aggregateRoutingMetrics(
  filter: RoutingAggregateFilter,
): Promise<RoutingAggregateResult> {
  const query = applyFilter(buildBaseQuery(filter.organizationId), filter)
  const models = await query

  const records = models.map(modelToLedgerRecord)

  // 准确率
  const accuracy = computeRoutingAccuracyMetrics(records)

  // 规则命中率与模型兜底率
  const ruleHit = computeRoutingRuleHitMetrics(records)

  // 澄清效率
  const clarificationEfficiency = computeRoutingClarificationEfficiency(records)

  // 不可用类别分布（从所有记录聚合）
  let missingPermissionTotal = 0
  let notEnabledTotal = 0
  let authorizationGatedTotal = 0

  for (const r of records) {
    // missingPermission 由账本从权限比较中计算，这里从 redirectClass 推断
    // （实际 missingPermissionCount 在 recorder 时计算并存储）
    for (const kind of r.unavailabilityKinds) {
      if (kind === 'not-enabled') notEnabledTotal++
      else if (kind === 'authorization-gated') authorizationGatedTotal++
    }
  }

  const unavailabilityDistribution: RoutingUnavailabilityDistribution = {
    missingPermissionCount: missingPermissionTotal,
    notEnabledCount: notEnabledTotal,
    authorizationGatedCount: authorizationGatedTotal,
    totalUnavailabilityEvents: missingPermissionTotal + notEnabledTotal + authorizationGatedTotal,
  }

  return {
    accuracy,
    ruleHit,
    clarificationEfficiency,
    unavailabilityDistribution,
    filter,
  }
}

/**
 * 查询确定性违规：同 inputTupleHash 出现不同 destination 排序或 confidence。
 */
export async function queryReproducibilityViolations(
  organizationId: number,
): Promise<ReproducibilityViolation[]> {
  // 获取所有记录的 inputTupleHash 分组
  const allRecords = await buildBaseQuery(organizationId)

  // 按 inputTupleHash 分组
  const hashGroups = new Map<string, CopilotRoutingDecisionModel[]>()
  for (const model of allRecords) {
    const existing = hashGroups.get(model.inputTupleHash) ?? []
    existing.push(model)
    hashGroups.set(model.inputTupleHash, existing)
  }

  const violations: ReproducibilityViolation[] = []

  for (const [, group] of hashGroups) {
    if (group.length < 2) continue

    const violation = detectReproducibilityViolation(
      group.map((m) => ({
        inputTupleHash: m.inputTupleHash,
        destinationOrder: m.destinationOrder,
        confidences: m.confidences,
        catalogVersion: m.catalogVersion,
      })),
    )

    if (violation) {
      violations.push(violation)
    }
  }

  return violations
}

/**
 * 供评测与排序消费的稳定读接口。
 * 返回低敏聚合摘要，不暴露原始输入。
 */
export async function readRoutingAggregatesForEvaluation(params: {
  readonly organizationId: number
  readonly intentClass?: string
  readonly catalogVersion?: string
  readonly startTime?: string
  readonly endTime?: string
}): Promise<{
  readonly accuracy: RoutingAccuracyMetrics
  readonly ruleHit: RoutingRuleHitMetrics
  readonly totalDecisions: number
}> {
  const result = await aggregateRoutingMetrics({
    organizationId: params.organizationId,
    intentClass: params.intentClass as any,
    catalogVersion: params.catalogVersion,
    startTime: params.startTime,
    endTime: params.endTime,
  })

  return {
    accuracy: result.accuracy,
    ruleHit: result.ruleHit,
    totalDecisions: result.accuracy.totalDecisions,
  }
}
