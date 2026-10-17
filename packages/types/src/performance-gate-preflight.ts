/**
 * performance-gate-preflight —— release-preflight 的建议性（non-breaking）集成（任务 7.4/7.5）。
 *
 * 语义：
 * - release-preflight 的既有 pack/build 门禁语义完全不变；本模块只提供一个「建议性」advisory，
 *   消费已生成的 `PerformanceScaleGateReport` JSON。
 * - 无报告 → advisory passed（非阻断提示，不要求报告存在）。
 * - 报告存在且 status=blocked → advisory 失败并给出低敏摘要（blocked gate 数），
 *   但调用方（release-preflight）必须把它放在 advisory 字段而不是 gates 数组，
 *   保证不改变既有门禁的通过/失败判定（non-breaking）。
 * - 所有输出低敏：只含 reportId / status / gate 状态计数 / metric 摘要，绝不嵌入
 *   完整日志、prompt、模型输出、token、secret。
 */
import {
  aggregateReportStatus,
  validateReportSchema,
  type GateResult,
  type PerformanceScaleGateReport,
  type ReportStatus,
} from './performance-and-scale-gates.js'

export interface PreflightAdvisoryInput {
  /** 内联报告对象（优先于 reportPath）。 */
  report?: unknown
  /** 报告 JSON 文件路径（由 CLI/脚本层读取后传入）。 */
  reportPath?: string
  changeName?: string
}

export interface PreflightAdvisoryResult {
  name: 'performance-gates-advisory'
  passed: boolean
  message: string
  reportId?: string
  status?: ReportStatus
  blockedCount: number
  warnedCount: number
  degradedCount: number
  skippedCount: number
  waivedCount: number
}

/** 统计 gate 状态分布（低敏计数）。 */
export function countGateStatuses(gates: GateResult[]): {
  blocked: number
  warned: number
  degraded: number
  skipped: number
  waived: number
  passed: number
} {
  const counts = { blocked: 0, warned: 0, degraded: 0, skipped: 0, waived: 0, passed: 0 }
  for (const g of gates) {
    if (g.status === 'blocked') counts.blocked += 1
    else if (g.status === 'warned') counts.warned += 1
    else if (g.status === 'degraded') counts.degraded += 1
    else if (g.status === 'skipped') counts.skipped += 1
    else if (g.status === 'waived') counts.waived += 1
    else counts.passed += 1
  }
  return counts
}

/**
 * 求值 advisory（7.5 测试对象）。
 * - 无报告 → passed（建议性，不阻断）。
 * - 报告非法 schema → passed=false 且 message 说明校验问题（仍非阻断：由调用方决定展示方式）。
 * - 报告 status=blocked → passed=false；否则 passed=true。
 */
export function evaluatePreflightAdvisory(input: PreflightAdvisoryInput): PreflightAdvisoryResult {
  const base = (over: Partial<PreflightAdvisoryResult>): PreflightAdvisoryResult => ({
    name: 'performance-gates-advisory',
    passed: true,
    message: '',
    blockedCount: 0,
    warnedCount: 0,
    degradedCount: 0,
    skippedCount: 0,
    waivedCount: 0,
    ...over,
  })

  const report = input.report as PerformanceScaleGateReport | undefined
  if (!report) {
    return base({
      message: `未提供性能门禁报告（${input.reportPath ?? '无路径'}）；建议性检查跳过，不影响 release-preflight 既有门禁`,
    })
  }

  const issues = validateReportSchema(report)
  if (issues.length > 0) {
    return base({
      passed: false,
      message: `性能门禁报告 schema 非法（${issues.length} 项）：${issues.join('；')}`,
    })
  }

  const counts = countGateStatuses(report.gates ?? [])
  const status = aggregateReportStatus(report.gates ?? [])
  const blocked = status === 'blocked' || counts.blocked > 0
  return base({
    passed: !blocked,
    reportId: report.reportId,
    status,
    blockedCount: counts.blocked,
    warnedCount: counts.warned,
    degradedCount: counts.degraded,
    skippedCount: counts.skipped,
    waivedCount: counts.waived,
    message: blocked
      ? `性能门禁报告 ${report.reportId} 存在 blocking gate（${counts.blocked} 个）；建议归档前修复或登记 waiver（非阻断 advisory）`
      : `性能门禁报告 ${report.reportId} status=${status}（blocked=${counts.blocked} warned=${counts.warned} degraded=${counts.degraded} skipped=${counts.skipped} waived=${counts.waived}）`,
  })
}
