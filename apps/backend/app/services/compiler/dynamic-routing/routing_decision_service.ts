/**
 * @aiproj/backend —— Routing Decision Evidence Service（tasks 5.1–5.5, 6.1–6.4）。
 *
 * 管理 routing decision 的存储、查询和 drift 检测。
 * decision 绑定到 run，resume/replay 使用原 decision 而不是重新评估。
 *
 * 证据只包含低敏枚举/refs/hash，不包含 prompt/output/artifact/context。
 *
 * @aiproj/backend
 */

import type {
  RoutingDecision,
  RouteDriftDiagnostic,
  RoutingRuleVersion,
} from '@aiproj/types/compiler-dynamic-routing'
import { routingDecisionContainsSensitiveFields } from '@aiproj/types/compiler-dynamic-routing'

// ── In-memory store（进程内；持久化到 run/ledger/artifact 证据需独立 change） ──

const decisionStore = new Map<number, RoutingDecision>()
const driftStore = new Map<number, RouteDriftDiagnostic[]>()

/**
 * 记录 routing decision。
 * 若 decision 含有敏感字段，记录错误并拒绝。
 */
export function recordRoutingDecision(decision: RoutingDecision): { ok: boolean; error?: string } {
  // 敏感字段检查
  const sensitive = routingDecisionContainsSensitiveFields(decision)
  if (sensitive.found) {
    return { ok: false, error: `Decision contains sensitive field: ${sensitive.fieldPath}` }
  }

  decisionStore.set(decision.runId, decision)
  return { ok: true }
}

/**
 * 获取指定 run 的 routing decision。
 * 用于 resume/replay 时读取原 decision。
 */
export function getRoutingDecision(runId: number): RoutingDecision | undefined {
  return decisionStore.get(runId)
}

/**
 * 检查指定 run 是否有 routing decision。
 */
export function hasRoutingDecision(runId: number): boolean {
  return decisionStore.has(runId)
}

/**
 * 记录 registry drift diagnostic。
 * 当 run 之后 registry 版本发生变化时调用。
 */
export function recordDriftDiagnostic(
  runId: number,
  originalRuleVersion: RoutingRuleVersion | null,
  currentRegistryVersion: string,
  drifts: string[],
): RouteDriftDiagnostic {
  const diagnostic: RouteDriftDiagnostic = {
    runId,
    originalRuleVersion,
    currentRegistryVersion,
    drifts,
    detectedAt: new Date().toISOString(),
  }

  const existing = driftStore.get(runId) ?? []
  existing.push(diagnostic)
  driftStore.set(runId, existing)

  return diagnostic
}

/**
 * 获取指定 run 的 drift diagnostics。
 */
export function getDriftDiagnostics(runId: number): RouteDriftDiagnostic[] {
  return driftStore.get(runId) ?? []
}

/**
 * 清空所有存储（用于测试）。
 */
export function resetRoutingStore(): void {
  decisionStore.clear()
  driftStore.clear()
}

/**
 * 序列化 routing decision 为低敏审计摘要。
 * 只返回 refs/hash/enums/counts，不包含敏感 payload。
 */
export function serializeDecisionSummary(decision: RoutingDecision): Record<string, unknown> {
  return {
    inputHash: decision.inputHash,
    ruleVersion: decision.ruleVersion,
    ruleId: decision.ruleId,
    scenarioKind: decision.scenarioKind,
    selectedStageCount: decision.selectedStageCount,
    originalStageCount: decision.originalStageCount,
    reasonCode: decision.reasonCode,
    isFallback: decision.isFallback,
    runId: decision.runId,
    createdAt: decision.createdAt,
    // selectedStageIds / skippedStageIds 是稳定的 stage id 枚举值
    selectedStageIds: decision.selectedStageIds,
    skippedStageIds: decision.skippedStageIds,
  }
}
