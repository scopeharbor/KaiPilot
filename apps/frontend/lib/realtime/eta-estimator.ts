/**
 * eta-estimator —— 流式操作剩余时间估算（v2-5-streaming-eta-estimation）。
 *
 * 纯客户端、确定性、可降级的 ETA（Estimated Time of Arrival / 剩余时间）算法。
 * 覆盖 AI Draft（9 模块线性流水线）与 Compiler Stage Event（逐 Stage `durationMs`）
 * 两个流式域：本文件提供与域无关的核心算法与状态守卫，域特定 selector 见
 * `@/lib/ai-draft/progress-projection.ts` 的 `selectDraftEta` 与
 * `@/lib/compiler/compiler-eta.ts` 的 `selectCompilerRunEta`。
 *
 * 红线（spec `streaming-eta-estimation`）：
 * - 纯函数、零副作用、零网络写入、零状态写入；ETA 绝不作数据源或副作用触发器。
 * - 算法 = 线性外推：`remainingMs = (elapsedMs / completedUnits) * (totalUnits - completedUnits)`。
 * - 暖机期（completedUnits < 2）返回 null，宁可隐藏也不展示误导数字。
 * - 非 healthy / 终态 / 非活连接时返回 null（守卫由 `isEtaAvailable` 统一把关）。
 *
 * 不变量：
 * - 确定性：同一 (elapsedMs, completedUnits, totalUnits) 恒返回同一结果。
 * - 边界防护：零完成、负值、非有限值、totalUnits ≤ 0 一律返回 null。
 */

/** ETA 置信度三档（spec Requirement: confidence levels）。 */
export type EtaConfidence = 'initial' | 'converging' | 'stable'

/** `computeLinearEta` 的返回——`etaMs` 为 null 表示当前不可估算（暖机/异常/全完成由调用方区分）。 */
export interface EtaResult {
  /** 剩余毫秒数；null 表示不可估算（暖机期或数据不足）。全完成时为 0。 */
  etaMs: number | null
  /** 置信度等级。暖机期返回 'initial'（etaMs 为 null）。 */
  confidence: EtaConfidence
}

/**
 * 线性外推 ETA 核心纯函数（spec: 线性外推中段估算）。
 *
 * `remainingMs = (elapsedMs / completedUnits) * (totalUnits - completedUnits)`
 *
 * 置信度分级（D2）：
 * - `initial`：completedUnits < 2 → etaMs=null（暖机期数据不足）
 * - `converging`：completedUnits ≥ 2 且完成率 < 50%
 * - `stable`：完成率 ≥ 50%
 *
 * 边界：
 * - completedUnits ≤ 0 → null（零完成不可估算，spec: 零完成单元时不可估算）
 * - totalUnits ≤ 0 或 completedUnits > totalUnits → null（非法输入防护）
 * - elapsedMs 非有限或 ≤ 0 → null（无已耗时长无法外推）
 * - 全完成（completedUnits === totalUnits）→ etaMs=0, confidence='stable'（spec: 全完成时 ETA 为零）
 */
export function computeLinearEta(
  elapsedMs: number,
  completedUnits: number,
  totalUnits: number,
): EtaResult {
  // ── 边界防护：非法或不足的输入一律返回 null ──────────────────────
  if (
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0 ||
    !Number.isFinite(completedUnits) ||
    !Number.isFinite(totalUnits)
  ) {
    return { etaMs: null, confidence: 'initial' }
  }

  if (completedUnits <= 0 || totalUnits <= 0 || completedUnits > totalUnits) {
    return { etaMs: null, confidence: 'initial' }
  }

  // ── 全完成：ETA 归零，置信度 stable ──────────────────────────────
  if (completedUnits === totalUnits) {
    return { etaMs: 0, confidence: 'stable' }
  }

  // ── 暖机期：completedUnits < 2 → null（spec: 暖机期不显示）───────
  if (completedUnits < 2) {
    return { etaMs: null, confidence: 'initial' }
  }

  // ── 线性外推（D1）──────────────────────────────────────────────
  const remainingUnits = totalUnits - completedUnits
  const perUnitMs = elapsedMs / completedUnits
  const etaMs = perUnitMs * remainingUnits

  // 负值防护（理论上不会发生，但防御性编程，spec: 负值防护）
  if (!Number.isFinite(etaMs) || etaMs < 0) {
    return { etaMs: null, confidence: 'initial' }
  }

  const completionRatio = completedUnits / totalUnits
  const confidence: EtaConfidence = completionRatio >= 0.5 ? 'stable' : 'converging'

  return { etaMs, confidence }
}

/**
 * ETA 可用性守卫（spec: ETA MUST be cleared during non-healthy states）。
 *
 * 在以下任一情况返回 false，调用方据此将 ETA 清空为 null：
 * - `healthState !== 'healthy'`（含 long_running/stale/reconnecting/fallback_status/failed/user_retry_required）
 * - `terminal !== 'none'`（completed/failed 终态）
 * - `connection` 不是 `live` 或 `recovering`（idle/connecting/closed/failed 不可估算）
 *
 * 参数以字符串联合类型传入，避免本核心文件耦合任一域的具体枚举定义。
 */
export function isEtaAvailable(healthState: string, connection: string, terminal: string): boolean {
  // 终态一律不可用（spec: 失败/完成时清空）
  if (terminal !== 'none') return false

  // 非 healthy 一律不可用（spec: 停滞时 ETA 清空 / 重连中清空）
  if (healthState !== 'healthy') return false

  // 仅 live 与 recovering 连接可估算；idle/connecting/closed/failed 不可用
  if (connection !== 'live' && connection !== 'recovering') return false

  return true
}
