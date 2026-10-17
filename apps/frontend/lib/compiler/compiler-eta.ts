/**
 * compiler-eta —— Compiler run 级剩余时间估算 selector（v2-5-streaming-eta-estimation 切片 3）。
 *
 * 纯函数 selector，从 `CompilerRunState.stages` 派生 run 级 ETA，**不修改 store、不新增字段**
 * （spec: ETA MUST be a pure selector without modifying projection state）。
 *
 * 算法（D6）：已完成 Stage 的 `durationMs` 算术平均值 × 剩余 Stage 数。
 * 与 AI Draft 的区别：Compiler 事件携带每个 Stage 的实际 `durationMs`，而非只靠 elapsedMs 外推。
 *
 * 暖机期：已完成 Stage 数 < 2 → null（spec: Compiler 暖机期）。
 * 无 durationMs 数据（已完成 stage 的 durationMs 均 null）→ null（spec: 无 durationMs 数据时 null）。
 * 全完成 → etaMs=0, stable。
 *
 * 红线：零网络写入、零状态写入、ETA 不作数据源或副作用触发器。
 */

import type { CompilerRunState } from '@/lib/compiler/compiler-progress-store'
import { isEtaAvailable, type EtaConfidence } from '@/lib/realtime/eta-estimator'
import { formatEta } from '@/lib/realtime/format-eta'

/** Compiler run 级 ETA 估算结果（与 DraftEtaSelection 同构）。 */
export interface CompilerEtaSelection {
  etaMs: number | null
  confidence: EtaConfidence
  formatted: string
}

/**
 * 将 CompilerRunState 的连接/停滞/终态映射为 isEtaAvailable 的三元参数。
 * - 终态（completed/failed/cancelled）→ terminal 非 'none'
 * - heartbeatStale 或 !connected → healthState 非 'healthy'
 * - 否则 healthy + live
 */
function compilerEtaAvailability(runState: CompilerRunState): {
  healthState: string
  connection: string
  terminal: string
} {
  const terminal =
    runState.overallStatus === 'completed' ||
    runState.overallStatus === 'failed' ||
    runState.overallStatus === 'cancelled'
      ? runState.overallStatus
      : 'none'

  const healthState = runState.heartbeatStale || !runState.connected ? 'stale' : 'healthy'

  const connection = runState.connected ? 'live' : 'closed'

  return { healthState, connection, terminal }
}

/**
 * 计算 Compiler run 级剩余时间估算（spec: ETA MUST be computed for Compiler domain）。
 *
 * @param runState Compiler run 投影
 * @param totalStages 可选总 Stage 数（默认用 `runState.stages.size` 即已见数）。
 *   调用方若已知编排计划总数可传入以获得更准确的外推；不传则用已发现 Stage 数近似。
 *
 * 算法：已完成且带 durationMs 的 Stage 取 durationMs 均值 × 剩余 Stage 数。
 */
export function selectCompilerRunEta(
  runState: CompilerRunState,
  totalStages?: number,
): CompilerEtaSelection {
  const { healthState, connection, terminal } = compilerEtaAvailability(runState)

  // ── 终态守卫：completed → 0；failed/cancelled → null ──────────────
  if (terminal === 'completed') {
    return { etaMs: 0, confidence: 'stable', formatted: '' }
  }
  if (!isEtaAvailable(healthState, connection, terminal)) {
    return { etaMs: null, confidence: 'initial', formatted: '' }
  }

  const stages = [...runState.stages.values()]
  const total = totalStages ?? stages.length
  const completedStages = stages.filter((s) => s.fsmState === 'completed')
  const completedWithDuration = completedStages.filter(
    (s) => s.durationMs !== null && s.durationMs > 0,
  )
  const completedUnits = completedStages.length

  // ── 无 durationMs 数据 → null（spec: 无 durationMs 数据时 null）────
  if (completedWithDuration.length === 0) {
    return { etaMs: null, confidence: 'initial', formatted: '' }
  }

  // ── 暖机期：< 2 已完成 → null（spec: Compiler 暖机期）────────────
  if (completedUnits < 2) {
    return { etaMs: null, confidence: 'initial', formatted: '' }
  }

  // ── 全完成 → 0（防 total 不足时 completedUnits === total）────────
  if (completedUnits >= total) {
    return { etaMs: 0, confidence: 'stable', formatted: '' }
  }

  // ── 均值 × 剩余数（D6）──────────────────────────────────────────
  // avg 仅基于有 durationMs 的已完成 stage（durationMs=null 的完成 stage 耗时未知，
  // 不参与均值以免低估）；剩余数与置信度用真实已完成 stage 数。
  const sumDuration = completedWithDuration.reduce((sum, s) => sum + (s.durationMs ?? 0), 0)
  const avgDuration = sumDuration / completedWithDuration.length
  const remainingUnits = total - completedUnits
  const etaMs = avgDuration * remainingUnits

  if (!Number.isFinite(etaMs) || etaMs < 0) {
    return { etaMs: null, confidence: 'initial', formatted: '' }
  }

  // 置信度分级：完成率 ≥ 50% → stable；否则 ≥2 → converging。
  const completionRatio = total > 0 ? completedUnits / total : 0
  const confidence: EtaConfidence =
    completedUnits < 2 ? 'initial' : completionRatio >= 0.5 ? 'stable' : 'converging'

  return {
    etaMs,
    confidence,
    formatted: formatEta(etaMs),
  }
}
