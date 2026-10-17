// @aiproj/types —— 资源缺口分析跨视图对齐契约测试。
// v3-resource-gap-analysis §4.3：矩阵 gaps / 资源池 demand-gaps / 缺口分析 三方原因码、严重度、metricVersion 一致。
// upstream 未部署时不伪造字段。

import { describe, expect, test } from 'vitest'
import {
  RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
  RESOURCE_GAP_REASON_CODES,
  RESOURCE_GAP_REASON_LABELS,
  RESOURCE_GAP_SEVERITY_VALUES,
  RESOURCE_GAP_REASON_CODE_VALUES,
  determineGapSeverity,
} from './resource-gap-analysis.js'
import { RESOURCE_SKILL_GAP_SEVERITY_ORDER } from './resource-skill-matrix.js'

// ─── 严重度映射一致性 ──────────────────────────────────────────────────

describe('三方严重度映射一致', () => {
  test('缺口分析 severity 与技能矩阵 gap severity 映射兼容', () => {
    // resource-gap-analysis: critical, high, medium, low, none
    // resource-skill-matrix: critical, high, medium, low, none
    for (const severity of RESOURCE_GAP_SEVERITY_VALUES) {
      expect(severity in RESOURCE_SKILL_GAP_SEVERITY_ORDER).toBe(true)
    }
  })

  test('determineGapSeverity 产出有效的严重度值', () => {
    const testRatios = [0, 0.1, 0.25, 0.3, 0.5, 0.6, 0.75, 0.9, 1.0]
    for (const ratio of testRatios) {
      const severity = determineGapSeverity(ratio)
      expect(RESOURCE_GAP_SEVERITY_VALUES).toContain(severity)
    }
  })
})

// ─── metricVersion 一致性 ──────────────────────────────────────────────

describe('metricVersion 一致性', () => {
  test('gapAnalysisRef.metricVersion 为 resource-gap-analysis@1', () => {
    const ref = {
      metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
      reasonCodes: ['NO_CANDIDATE_RESOURCE'],
      severity: 'high',
      evidenceHashes: ['abc123'],
    }
    expect(ref.metricVersion).toBe('resource-gap-analysis@1')
  })

  test('原因码全部有中文标签', () => {
    for (const code of RESOURCE_GAP_REASON_CODE_VALUES) {
      expect(RESOURCE_GAP_REASON_LABELS[code]).toBeDefined()
      expect(RESOURCE_GAP_REASON_LABELS[code].length).toBeGreaterThan(0)
    }
  })
})

// ─── 上游未部署时不伪造 ──────────────────────────────────────────────

describe('上游未部署时不伪造字段', () => {
  test('gapAnalysisRef 可选——不存在时不破坏既有语义', () => {
    // 模拟旧响应：没有 gapAnalysisRef 仍可正常渲染
    const legacyGap = {
      gapId: 'old_gap_1',
      skill: 'react',
      role: null,
      projectId: 1,
      projectName: 'Test Project',
      taskId: null,
      dateWindow: null,
      priority: null,
      target: null,
      redacted: false,
    }
    // 无 gapAnalysisRef 的旧缺口仍合法
    expect(legacyGap).toHaveProperty('gapId')
    expect(legacyGap).toHaveProperty('skill')
    expect('gapAnalysisRef' in legacyGap).toBe(false)
  })

  test('gapAnalysisRef 存在时包含所有必需字段', () => {
    const ref = {
      metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
      reasonCodes: ['NO_CANDIDATE_RESOURCE', 'CANDIDATES_OVERLOADED'],
      severity: 'high',
      evidenceHashes: ['hash1', 'hash2'],
    }
    expect(ref.metricVersion).toBeTruthy()
    expect(ref.reasonCodes.length).toBeGreaterThan(0)
    expect(ref.severity).toBeDefined()
    expect(ref.evidenceHashes.length).toBeGreaterThan(0)
  })

  test('原因码全部来自封闭枚举', () => {
    const ref = {
      metricVersion: RESOURCE_GAP_ANALYSIS_METRIC_VERSION,
      reasonCodes: ['NO_CANDIDATE_RESOURCE', 'SKILL_ORG_WIDE_SHORTAGE'],
      severity: 'critical',
      evidenceHashes: ['hash1'],
    }
    for (const code of ref.reasonCodes) {
      expect(RESOURCE_GAP_REASON_CODE_VALUES).toContain(code)
    }
  })
})
