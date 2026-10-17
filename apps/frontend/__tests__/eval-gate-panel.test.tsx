/**
 * v3-copilot-custom-agent-eval-gate — 门禁报告面板测试
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'

import {
  buildPassingVerdict,
  buildBelowThresholdVerdict,
  buildDependencyInvalidatedVerdict,
  buildAuthGatedVerdict,
  EVAL_GATE_VERDICT_LABELS,
  EVAL_GATE_INVALIDATION_REASON_LABELS,
} from '@aiproj/types'

// 由于面板是纯展示组件（无 hooks/状态），我们测试其数据变换逻辑

describe('EvalGatePanel data logic', () => {
  it('passing verdict has correct label', () => {
    const verdict = buildPassingVerdict()
    assert.equal(EVAL_GATE_VERDICT_LABELS[verdict.verdict], '通过')
  })

  it('fail verdict has correct label', () => {
    const verdict = buildBelowThresholdVerdict()
    assert.equal(EVAL_GATE_VERDICT_LABELS[verdict.verdict], '未通过')
  })

  it('invalidated verdict has correct label', () => {
    const verdict = buildDependencyInvalidatedVerdict()
    assert.equal(EVAL_GATE_VERDICT_LABELS[verdict.verdict], '已失效')
  })

  it('unavailable verdict has correct label', () => {
    const verdict = buildAuthGatedVerdict()
    assert.equal(EVAL_GATE_VERDICT_LABELS[verdict.verdict], '不可用')
  })

  it('invalidation reason has readable label', () => {
    const verdict = buildDependencyInvalidatedVerdict()
    assert.ok(verdict.invalidationReason)
    const label = EVAL_GATE_INVALIDATION_REASON_LABELS[verdict.invalidationReason]
    assert.ok(label, '失效原因应有可读标签')
    assert.ok(label.length > 0)
  })

  it('passing verdict average score >= 0.7', () => {
    const verdict = buildPassingVerdict()
    const avg =
      verdict.itemScores.reduce((sum, item) => sum + item.score, 0) / verdict.itemScores.length
    assert.ok(avg >= 0.7, `通过态平均分应 >= 0.7，实际 ${avg}`)
  })

  it('below-threshold verdict has failing items', () => {
    const verdict = buildBelowThresholdVerdict()
    assert.ok(verdict.failingItemIds.length > 0, '未通过态应有失败项')
    for (const itemId of verdict.failingItemIds) {
      const item = verdict.itemScores.find((i) => i.itemId === itemId)
      assert.ok(item, `失败项 ${itemId} 应在 itemScores 中`)
      assert.equal(item!.failed, true)
    }
  })

  it('benchmark source is displayed', () => {
    const verdict = buildPassingVerdict()
    assert.ok(verdict.benchmarkSource === 'L3' || verdict.benchmarkSource === 'fixture')
  })
})
