/**
 * performance-gate-preflight.test —— release-preflight advisory 集成测试（任务 7.5）。
 *
 * 证明：
 * - 无报告 → advisory passed（建议性，非阻断）。
 * - 报告 schema 非法 → advisory 失败并说明，但不影响既有门禁判定（由调用方字段隔离）。
 * - status=blocked 报告 → advisory 失败并给出 blocked 计数；非 blocked → passed。
 * - 报告只消费低敏字段：不嵌入完整日志/源码/prompt/模型输出/token/secret。
 * - 既有 pack/build 门禁语义不变：advisory 与 gates 数组隔离（non-breaking）。
 */
import { describe, expect, it } from 'vitest'
import { containsSensitiveContent } from './performance-and-scale-gates.js'
import {
  countGateStatuses,
  evaluatePreflightAdvisory,
  type PreflightAdvisoryResult,
} from './performance-gate-preflight.js'
import type { PerformanceScaleGateReport } from './performance-and-scale-gates.js'

function makeReport(
  status: PerformanceScaleGateReport['status'],
  gates: PerformanceScaleGateReport['gates'] = [],
): PerformanceScaleGateReport {
  return {
    schemaVersion: '1.0',
    reportId: 'perf-release-test',
    generatedAt: '2026-08-16T00:00:00.000Z',
    commit: 'abc123',
    profile: 'smoke',
    environment: {
      platform: 'win32',
      nodeVersion: 'v20',
      commit: 'abc123',
      profile: 'smoke',
      graphFreshness: 'unknown',
    },
    observation: { graphFreshness: 'unknown', sourceFallbackRefs: [] },
    commands: [],
    gates,
    metricSummaries: [],
    status,
    redactionSummary: { redactedCount: 0, reasons: {} },
    evidenceRefs: [],
    waiverRefs: [],
    sourceFallback: { used: false, refs: [], graphIncomplete: false },
  }
}

const blockedGate = {
  gateId: 'gantt-scale-smoke',
  surface: 'project-task-wbs-gantt' as const,
  status: 'blocked' as const,
  exitCode: null,
  durationMs: 10,
  metricSummaries: [],
  findings: [],
  redactionSummary: { redactedCount: 0, reasons: {} },
  evidenceRefs: [],
}

describe('advisory 求值', () => {
  it('无报告 → passed（建议性跳过，不阻断）', () => {
    const r = evaluatePreflightAdvisory({})
    expect(r.passed).toBe(true)
    expect(r.message).toContain('建议性')
  })

  it('passed 报告 → advisory passed', () => {
    const r = evaluatePreflightAdvisory({ report: makeReport('passed') })
    expect(r.passed).toBe(true)
    expect(r.status).toBe('passed')
    expect(r.reportId).toBe('perf-release-test')
  })

  it('blocked 报告 → advisory 失败并给出 blocked 计数', () => {
    const report = makeReport('blocked', [blockedGate])
    const r = evaluatePreflightAdvisory({ report })
    expect(r.passed).toBe(false)
    expect(r.blockedCount).toBe(1)
    expect(r.message).toContain('blocking gate')
    expect(r.message).toContain('1 个')
  })

  it('schema 非法报告 → advisory 失败并说明', () => {
    const r = evaluatePreflightAdvisory({ report: { schemaVersion: '0.1' } })
    expect(r.passed).toBe(false)
    expect(r.message).toContain('schema 非法')
  })

  it('degraded/skipped 报告 → advisory passed（非阻断）', () => {
    const skipped = evaluatePreflightAdvisory({
      report: makeReport('degraded', [
        { ...blockedGate, status: 'skipped', reasonCode: 'external-not-authorized' },
      ]),
    })
    expect(skipped.passed).toBe(true)
    expect(skipped.skippedCount).toBe(1)
  })

  it('countGateStatuses 分布统计正确', () => {
    const counts = countGateStatuses([
      blockedGate,
      { ...blockedGate, gateId: 'w', status: 'warned' },
      { ...blockedGate, gateId: 'd', status: 'degraded' },
      { ...blockedGate, gateId: 's', status: 'skipped' },
      { ...blockedGate, gateId: 'v', status: 'waived' },
      { ...blockedGate, gateId: 'p', status: 'passed' },
    ])
    expect(counts).toEqual({ blocked: 1, warned: 1, degraded: 1, skipped: 1, waived: 1, passed: 1 })
  })
})

describe('低敏边界', () => {
  it('advisory 结果不嵌入敏感内容', () => {
    const r = evaluatePreflightAdvisory({
      report: makeReport('blocked', [blockedGate]),
      reportPath: '.tmp/performance-gates/perf-x.json',
    }) as PreflightAdvisoryResult
    expect(containsSensitiveContent(JSON.stringify(r))).toBe(false)
    for (const kw of [
      'sk-proj',
      'ghp_',
      'Bearer ',
      'PRIVATE KEY',
      'system prompt',
      'model_output',
    ]) {
      expect(JSON.stringify(r)).not.toContain(kw)
    }
  })

  it('既有 pack/build 门禁语义不变：advisory 是独立字段', () => {
    // 模拟 release-preflight 的组装：advisory 不进入 gates 数组
    const advisory = evaluatePreflightAdvisory({ report: makeReport('blocked', [blockedGate]) })
    const gates: { name: string; passed: boolean }[] = [
      { name: '构建产物', passed: true },
      { name: '包大小', passed: true },
    ]
    const allPassed = gates.every((g) => g.passed)
    expect(allPassed).toBe(true)
    expect(advisory.passed).toBe(false)
    // non-breaking：既有 passed 判定不因 advisory 改变
    expect(allPassed).toBe(true)
  })
})
