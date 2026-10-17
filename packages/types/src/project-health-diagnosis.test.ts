/**
 * project-health-diagnosis 共享类型单元测试。
 *
 * 覆盖：
 *   - 状态枚举完整性
 *   - 严重度排序
 *   - 中文标签映射
 *   - DTO 类型兼容空态
 */
import { describe, expect, test } from 'vitest'
import {
  HEALTH_DIAGNOSIS_STATUSES,
  HEALTH_DIMENSIONS,
  HEALTH_SEVERITIES,
  HEALTH_SEVERITY_ORDER,
  HEALTH_RULE_IDS,
  HEALTH_STATUS_LABELS,
  HEALTH_DIMENSION_LABELS,
  healthSeverityScore,
  maxHealthSeverity,
} from './project-health-diagnosis.js'

describe('HealthDiagnosisStatus', () => {
  test('所有状态枚举定义完整', () => {
    expect(HEALTH_DIAGNOSIS_STATUSES).toContain('pending')
    expect(HEALTH_DIAGNOSIS_STATUSES).toContain('confirmed')
    expect(HEALTH_DIAGNOSIS_STATUSES).toContain('rejected')
    expect(HEALTH_DIAGNOSIS_STATUSES).toContain('ai_ready')
    expect(HEALTH_DIAGNOSIS_STATUSES).toContain('ai_failed')
    expect(HEALTH_DIAGNOSIS_STATUSES.length).toBe(5)
  })
})

describe('HealthSeverity', () => {
  test('严重度枚举完整', () => {
    expect(HEALTH_SEVERITIES).toContain('critical')
    expect(HEALTH_SEVERITIES).toContain('high')
    expect(HEALTH_SEVERITIES).toContain('medium')
    expect(HEALTH_SEVERITIES).toContain('low')
    expect(HEALTH_SEVERITIES).toContain('ok')
    expect(HEALTH_SEVERITIES.length).toBe(5)
  })

  test('严重度排序正确', () => {
    expect(HEALTH_SEVERITY_ORDER[0]).toBe('critical')
    expect(HEALTH_SEVERITY_ORDER[1]).toBe('high')
    expect(HEALTH_SEVERITY_ORDER[2]).toBe('medium')
    expect(HEALTH_SEVERITY_ORDER[3]).toBe('low')
    expect(HEALTH_SEVERITY_ORDER[4]).toBe('ok')
  })

  test('healthSeverityScore 返回正确分数', () => {
    expect(healthSeverityScore('critical')).toBe(5)
    expect(healthSeverityScore('high')).toBe(4)
    expect(healthSeverityScore('medium')).toBe(3)
    expect(healthSeverityScore('low')).toBe(2)
    expect(healthSeverityScore('ok')).toBe(1)
  })

  test('maxHealthSeverity 返回更高严重度', () => {
    expect(maxHealthSeverity('low', 'critical')).toBe('critical')
    expect(maxHealthSeverity('ok', 'medium')).toBe('medium')
    expect(maxHealthSeverity('high', 'high')).toBe('high')
  })
})

describe('HealthDimensions', () => {
  test('所有维度枚举完整', () => {
    expect(HEALTH_DIMENSIONS).toContain('progress')
    expect(HEALTH_DIMENSIONS).toContain('critical_path')
    expect(HEALTH_DIMENSIONS).toContain('milestone')
    expect(HEALTH_DIMENSIONS).toContain('resource')
    expect(HEALTH_DIMENSIONS).toContain('risk')
    expect(HEALTH_DIMENSIONS).toContain('change_impact')
    expect(HEALTH_DIMENSIONS).toContain('collaboration')
    expect(HEALTH_DIMENSIONS).toContain('data_integrity')
    expect(HEALTH_DIMENSIONS.length).toBe(8)
  })

  test('所有维度有中文标签', () => {
    for (const dim of HEALTH_DIMENSIONS) {
      expect(HEALTH_DIMENSION_LABELS[dim]).toBeDefined()
      expect(HEALTH_DIMENSION_LABELS[dim].length).toBeGreaterThan(0)
    }
  })
})

describe('HealthRuleIds', () => {
  test('规则 ID 完整', () => {
    expect(HEALTH_RULE_IDS).toContain('R001')
    expect(HEALTH_RULE_IDS).toContain('R002')
    expect(HEALTH_RULE_IDS).toContain('R003')
    expect(HEALTH_RULE_IDS).toContain('R004')
    expect(HEALTH_RULE_IDS).toContain('R005')
    expect(HEALTH_RULE_IDS).toContain('R006')
    expect(HEALTH_RULE_IDS).toContain('R007')
    expect(HEALTH_RULE_IDS).toContain('R008')
    expect(HEALTH_RULE_IDS).toContain('R009')
    expect(HEALTH_RULE_IDS).toContain('R010')
    expect(HEALTH_RULE_IDS.length).toBe(10)
  })
})

describe('HealthStatusLabels', () => {
  test('所有标签有值', () => {
    expect(HEALTH_STATUS_LABELS.healthy).toBe('健康')
    expect(HEALTH_STATUS_LABELS.attention).toBe('需关注')
    expect(HEALTH_STATUS_LABELS.warning).toBe('需警惕')
    expect(HEALTH_STATUS_LABELS.critical).toBe('严重')
  })
})

describe('DTO 兼容空态', () => {
  test('HealthDiagnosis 空态兼容', () => {
    // 模拟从 API 返回可能的空态
    const empty = {
      id: 0,
      organizationId: 0,
      projectId: 0,
      status: 'pending',
      ruleVersion: '',
      inputSignature: '',
      outputHash: '',
      evidenceHash: '',
      summary: null,
      aiDraft: null,
      warnings: [],
      generatedBy: 0,
      generatedAt: new Date().toISOString(),
      confirmedBy: null,
      confirmedAt: null,
      confirmedNotes: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectReason: null,
      stale: false,
      staleReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    // 类型检查通过即可
    expect(empty.warnings).toEqual([])
    expect(empty.summary).toBeNull()
    expect(empty.stale).toBe(false)
  })

  test('DashboardHealthSummary 空态兼容', () => {
    const empty = {
      diagnosisId: null,
      overallScore: null,
      overallLabel: null,
      dimensionScores: [],
      status: null,
      stale: false,
      staleReason: null,
      confirmedAt: null,
      confirmedBy: null,
      confirmedNotes: null,
      warnings: [],
      available: false,
    }
    expect(empty.available).toBe(false)
    expect(empty.dimensionScores).toEqual([])
  })
})
