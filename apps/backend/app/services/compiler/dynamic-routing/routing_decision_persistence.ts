/**
 * v2-5-compiler-dynamic-routing-management-ui（切片 A, task 3.1）—— Routing Decision 持久化。
 *
 * 把 per-run routing decision 证据从进程内存提升为可查询的低敏持久 evidence。
 * 写入前经 routingDecisionContainsSensitiveFields() 守卫；只存低敏摘要。
 * 读路径按 runId + organizationId 检索，返回低敏摘要或空态。
 *
 * 不改 routing_decision_service 的进程内存语义（orchestrator resume 仍用它复用原 decision）；
 * 本模块提供并行持久化读/写路径，使审计与 UI 可查询、重启后仍可查询。
 */
import RoutingDecisionModel from '#models/routing_decision'
import type {
  RoutingDecision,
  RouteDriftDiagnostic,
  SerializedDecisionSummary,
} from '@aiproj/types/compiler-dynamic-routing'
import { routingDecisionContainsSensitiveFields } from '@aiproj/types/compiler-dynamic-routing'
import { getDriftDiagnostics } from './routing_decision_service.js'

export interface PersistedDecisionRead {
  hasDecision: boolean
  summary: SerializedDecisionSummary | null
  drift: RouteDriftDiagnostic[]
}

/**
 * 持久化一条 routing decision（低敏）。
 * 写入前经敏感字段守卫；含敏感字段则拒绝落库。
 * 同一 run 已有持久化 decision 时跳过（decision 绑定 run，不可变）。
 */
export async function persistRoutingDecision(
  organizationId: number,
  decision: RoutingDecision,
  actorUserId?: number,
): Promise<{ ok: boolean; error?: string }> {
  const sensitive = routingDecisionContainsSensitiveFields(decision)
  if (sensitive.found) {
    return { ok: false, error: `Decision contains sensitive field: ${sensitive.fieldPath}` }
  }

  // decision 绑定 run：已存在则不覆盖（resume 复用原 decision 语义）
  const existing = await RoutingDecisionModel.query()
    .where('compiler_run_id', decision.runId)
    .where('organization_id', organizationId)
    .first()
  if (existing) {
    return { ok: true }
  }

  await RoutingDecisionModel.create({
    organizationId,
    compilerRunId: decision.runId,
    inputHash: decision.inputHash,
    ruleId: decision.ruleId,
    ruleVersion: decision.ruleVersion
      ? `${decision.ruleVersion.major}.${decision.ruleVersion.minor}`
      : null,
    scenarioKind: decision.scenarioKind,
    reasonCode: decision.reasonCode,
    selectedStageCount: decision.selectedStageCount,
    originalStageCount: decision.originalStageCount,
    isFallback: decision.isFallback,
    selectedStageIds: decision.selectedStageIds,
    skippedStageIds: decision.skippedStageIds,
    actorUserId: actorUserId ?? null,
  })

  return { ok: true }
}

/**
 * 按 run + 组织读取持久化的 routing decision 低敏摘要与 drift。
 * 无绑定决策返回明确空态（hasDecision:false）。
 */
export async function readPersistedDecision(
  organizationId: number,
  runId: number,
): Promise<PersistedDecisionRead> {
  const row = await RoutingDecisionModel.query()
    .where('compiler_run_id', runId)
    .where('organization_id', organizationId)
    .first()

  if (!row) {
    // 跨组织/不存在 → 统一空态（不泄漏存在性由 controller 层 not-found 处理）
    return { hasDecision: false, summary: null, drift: [] }
  }

  const summary: SerializedDecisionSummary = {
    inputHash: row.inputHash,
    ruleVersion: row.ruleVersion ? parseVersionString(row.ruleVersion) : null,
    ruleId: row.ruleId,
    scenarioKind: row.scenarioKind as SerializedDecisionSummary['scenarioKind'],
    selectedStageCount: row.selectedStageCount,
    originalStageCount: row.originalStageCount,
    reasonCode: row.reasonCode as SerializedDecisionSummary['reasonCode'],
    isFallback: row.isFallback,
    runId: row.compilerRunId,
    createdAt: row.createdAt.toISO() ?? '',
    selectedStageIds: row.selectedStageIds ?? [],
    skippedStageIds: row.skippedStageIds ?? [],
  }

  return {
    hasDecision: true,
    summary,
    drift: getDriftDiagnostics(runId),
  }
}

function parseVersionString(v: string): { major: number; minor: number } {
  const [major, minor] = v.split('.').map((n) => Number.parseInt(n, 10))
  return { major: major ?? 0, minor: minor ?? 0 }
}
