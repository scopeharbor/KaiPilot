/**
 * v3-ai-automated-evaluation §6 — 采样、触发与阈值测试。
 *
 * 覆盖：
 * - §6.1 声明式采样求值
 * - §6.2 采样决策记录（含被跳过项）
 * - §6.3 被跳过项可查询其跳过原因
 * - §6.4–6.5 低置信输出必评
 * - §6.6–6.7 阈值越界只产生健康状态、原因码与 runbook 引用
 * - §6.8 越界不触发任何自动修复/回滚/模型切换/重试
 * - §6.9 阈值来源记录（禁止凭空取值）
 *
 * @aiproj/backend tests — 零网络零 provider
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { ThresholdDeclaration } from '@aiproj/types'
import {
  SamplingEvaluationService,
  ThresholdEvaluationService,
  validateThresholdSource,
  DEFAULT_EVALUATION_THRESHOLDS,
} from '../../app/services/ai_evaluation/sampling_service.js'

// ═══════════════════════════════════════════════════════════════════════════════
// §6.1–6.3 采样求值与决策记录
// ═══════════════════════════════════════════════════════════════════════════════

describe('SamplingEvaluationService', () => {
  let service: SamplingEvaluationService

  beforeEach(() => {
    service = new SamplingEvaluationService()
  })

  it('evaluates all-strategy as evaluated', () => {
    const decision = service.evaluate(
      { strategy: 'all', ratio: 1, lowConfidenceAlwaysEvaluate: true },
      false,
      'fnv1a:test',
    )
    expect(decision.decision).toBe('evaluated')
  })

  it('records decision in store', () => {
    service.evaluate(
      { strategy: 'all', ratio: 1, lowConfidenceAlwaysEvaluate: true },
      false,
      'fnv1a:test',
    )
    expect(service.getStore().getAll()).toHaveLength(1)
  })

  it('§6.2 skipped items are recorded', () => {
    // Hash 0xFFFFFFFF → ratio 1.0 >= 0.1 → skip
    service.evaluate(
      { strategy: 'ratio', ratio: 0.1, lowConfidenceAlwaysEvaluate: true },
      false,
      'ffffffff00000000',
    )
    expect(service.getStore().getAll()).toHaveLength(1)
    expect(service.getStore().getSkipped()).toHaveLength(1)
  })

  it('§6.3 skipped items have reason', () => {
    const decision = service.evaluate(
      { strategy: 'ratio', ratio: 0.1, lowConfidenceAlwaysEvaluate: true },
      false,
      'ffffffff00000000',
    )
    expect(decision.decision).toBe('skipped')
    expect(decision.skipReason).toBeDefined()
    expect(decision.skipReason!.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.4–6.5 低置信输出必评
// ═══════════════════════════════════════════════════════════════════════════════

describe('low-confidence always evaluate', () => {
  let service: SamplingEvaluationService

  beforeEach(() => {
    service = new SamplingEvaluationService()
  })

  it('§6.4 low confidence overrides ratio sampling', () => {
    // Hash 0xFFFFFFFF → ratio 1.0 >= 0.01 → normally skip
    // But low confidence → must evaluate
    const decision = service.evaluate(
      { strategy: 'ratio', ratio: 0.01, lowConfidenceAlwaysEvaluate: true },
      true, // isLowConfidence
      'ffffffff00000000',
    )
    expect(decision.decision).toBe('evaluated')
    expect(decision.lowConfidenceOverride).toBe(true)
  })

  it('§6.5 low confidence not skipped even with tiny ratio', () => {
    // 100 runs with ratio 0.01 and low confidence → all evaluated
    const decisions = Array.from({ length: 100 }, (_, i) =>
      service.evaluate(
        { strategy: 'ratio', ratio: 0.01, lowConfidenceAlwaysEvaluate: true },
        true,
        `fnv1a:${i.toString(16).padStart(8, '0')}`,
      ),
    )
    const allEvaluated = decisions.every((d) => d.decision === 'evaluated')
    expect(allEvaluated).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.6–6.8 阈值求值
// ═══════════════════════════════════════════════════════════════════════════════

describe('ThresholdEvaluationService', () => {
  let service: ThresholdEvaluationService

  beforeEach(() => {
    service = new ThresholdEvaluationService()
  })

  const threshold: ThresholdDeclaration = {
    dimension: 'draft_structural_compliance',
    warningThreshold: 0.7,
    criticalThreshold: 0.4,
    source: 'fixture-baseline',
    sourceRef: 'fixture:v1:001',
  }

  it('§6.6 healthy when above warning', () => {
    const result = service.evaluate(threshold, 0.9)
    expect(result.healthState).toBe('healthy')
    expect(result.breached).toBe(false)
  })

  it('§6.6 warning when below warning threshold', () => {
    const result = service.evaluate(threshold, 0.6)
    expect(result.healthState).toBe('warning')
    expect(result.breached).toBe(true)
    expect(result.reasonCode).toContain('warning')
  })

  it('§6.6 critical when below critical threshold', () => {
    const result = service.evaluate(threshold, 0.3)
    expect(result.healthState).toBe('critical')
    expect(result.breached).toBe(true)
    expect(result.reasonCode).toContain('critical')
  })

  it('§6.7 breach produces runbook reference', () => {
    const result = service.evaluate(threshold, 0.3)
    expect(result.runbookRef).toContain('/runbooks/')
  })

  it('§6.7 breach produces reason code', () => {
    const result = service.evaluate(threshold, 0.3)
    expect(result.reasonCode).toBeTruthy()
  })

  it('§6.8 breach does NOT trigger any automatic action', () => {
    const result = service.evaluate(threshold, 0.3)
    // 验证结果只包含健康状态、原因码和 runbook 引用
    // 不包含任何自动修复/回滚/重试/模型切换的字段
    expect(result.healthState).toBeDefined()
    expect(result.reasonCode).toBeDefined()
    expect(result.runbookRef).toBeDefined()
    // 不应有 autoRollback / autoRetry / autoSwitch / businessAction 等字段
    expect(result).not.toHaveProperty('autoRollback')
    expect(result).not.toHaveProperty('autoRetry')
    expect(result).not.toHaveProperty('autoSwitch')
    expect(result).not.toHaveProperty('businessAction')
  })

  it('records evaluation in store', () => {
    service.evaluate(threshold, 0.3)
    expect(service.getStore().getAll()).toHaveLength(1)
    expect(service.getStore().getBreached()).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// §6.9 阈值来源记录
// ═══════════════════════════════════════════════════════════════════════════════

describe('threshold source validation', () => {
  it('validates threshold with source', () => {
    expect(
      validateThresholdSource({
        dimension: 'draft_structural_compliance',
        warningThreshold: 0.7,
        criticalThreshold: 0.4,
        source: 'fixture-baseline',
        sourceRef: 'fixture:v1:001',
      }),
    ).toBe(true)
  })

  it('rejects threshold without source', () => {
    expect(
      validateThresholdSource({
        dimension: 'draft_structural_compliance',
        warningThreshold: 0.7,
        criticalThreshold: 0.4,
        source: '',
        sourceRef: '',
      }),
    ).toBe(false)
  })

  it('default thresholds all have valid sources', () => {
    for (const threshold of DEFAULT_EVALUATION_THRESHOLDS) {
      expect(validateThresholdSource(threshold)).toBe(true)
    }
  })
})
