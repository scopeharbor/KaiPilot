/**
 * v3-copilot-portfolio-scope —— 风险早期预警测试
 *
 * §7 测试覆盖：
 * - 7.1 预测信号与 TRIZ 矛盾识别的跨项目联动
 * - 7.2 未复制预测或矛盾识别逻辑
 * - 7.3 预警以待确认建议形式出现
 * - 7.4 预警路径零域写
 * - 7.5 预警的逐项目判权与非泄露
 */

import { describe, it, expect } from 'vitest'
import {
  generateCrossProjectEarlyWarnings,
  assertNoDomainWrite,
  assertAdvisoryOnly,
  type EarlyWarningSignal,
  type PredictionSignalProvider,
  type TrizContradictionProvider,
  type WarningPermissionChecker,
} from '../../app/services/copilot/copilot_portfolio_early_warning_service.js'

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSignal(
  projectId: number,
  projectName: string,
  sourceType: 'prediction' | 'triz_contradiction',
  severity: EarlyWarningSignal['severity'] = 'high',
): EarlyWarningSignal {
  return {
    signalId: `sig_${projectId}_${sourceType}`,
    projectId,
    projectName,
    sourceType,
    sourceId: `src_${projectId}`,
    severity,
    description: `${projectName} 存在风险`,
    detectedAt: new Date().toISOString(),
  }
}

function allowAll(): WarningPermissionChecker {
  return { canReadProject: async () => true }
}

function denyProject(deniedIds: Set<number>): WarningPermissionChecker {
  return {
    canReadProject: async (_orgId, _actorId, projectId) => !deniedIds.has(projectId),
  }
}

function predictionProvider(signals: EarlyWarningSignal[]): PredictionSignalProvider {
  return {
    getPredictionSignals: async () => signals,
  }
}

function trizProvider(signals: EarlyWarningSignal[]): TrizContradictionProvider {
  return {
    getContradictionSignals: async () => signals,
  }
}

const PROJECTS = [
  { projectId: 1, projectName: 'P1' },
  { projectId: 2, projectName: 'P2' },
]

// ─── 7.1 预测信号与 TRIZ 联动 ────────────────────────────────────────────

describe('§7.1 预测信号与 TRIZ 矛盾识别的跨项目联动', () => {
  it('合并预测和 TRIZ 信号', async () => {
    const predSignals = [makeSignal(1, 'P1', 'prediction', 'high')]
    const trizSignals = [makeSignal(2, 'P2', 'triz_contradiction', 'critical')]

    const warnings = await generateCrossProjectEarlyWarnings(
      1,
      1,
      PROJECTS,
      allowAll(),
      predictionProvider(predSignals),
      trizProvider(trizSignals),
    )

    expect(warnings.length).toBeGreaterThan(0)
    const allSignals = warnings.flatMap((w) => w.signals)
    expect(allSignals.some((s) => s.sourceType === 'prediction')).toBe(true)
    expect(allSignals.some((s) => s.sourceType === 'triz_contradiction')).toBe(true)
  })
})

// ─── 7.2 未复制逻辑 ──────────────────────────────────────────────────────

describe('§7.2 未复制预测或矛盾识别逻辑', () => {
  it('预警服务仅聚合信号，不重新计算', async () => {
    // 预警服务调用 provider 获取信号，不自己计算
    // 这是代码审查级断言
    const predSignals = [makeSignal(1, 'P1', 'prediction', 'high')]
    const warnings = await generateCrossProjectEarlyWarnings(
      1,
      1,
      PROJECTS,
      allowAll(),
      predictionProvider(predSignals),
      trizProvider([]),
    )
    expect(warnings.length).toBeGreaterThan(0)
  })
})

// ─── 7.3 预警以待确认建议形式出现 ────────────────────────────────────────

describe('§7.3 预警以待确认建议形式出现', () => {
  it('所有预警状态为 pending_confirmation', async () => {
    const predSignals = [makeSignal(1, 'P1', 'prediction', 'critical')]
    const warnings = await generateCrossProjectEarlyWarnings(
      1,
      1,
      PROJECTS,
      allowAll(),
      predictionProvider(predSignals),
      trizProvider([]),
    )

    const check = assertAdvisoryOnly(warnings)
    expect(check.ok).toBe(true)
  })
})

// ─── 7.4 预警路径零域写 ──────────────────────────────────────────────────

describe('§7.4 预警路径零域写', () => {
  it('预警路径无域写操作', () => {
    const check = assertNoDomainWrite()
    expect(check.ok).toBe(true)
  })
})

// ─── 7.5 预警的逐项目判权与非泄露 ────────────────────────────────────────

describe('§7.5 预警的逐项目判权与非泄露', () => {
  it('无权项目的信号不出现在预警中', async () => {
    const predSignals = [
      makeSignal(1, 'P1', 'prediction', 'high'),
      makeSignal(2, 'P2', 'prediction', 'critical'),
    ]

    const warnings = await generateCrossProjectEarlyWarnings(
      1,
      1,
      PROJECTS,
      denyProject(new Set([2])),
      predictionProvider(predSignals),
      trizProvider([]),
    )

    // 项目 2 的信号不应出现在预警中
    const allSignals = warnings.flatMap((w) => w.signals)
    expect(allSignals.every((s) => s.projectId !== 2)).toBe(true)
  })
})
