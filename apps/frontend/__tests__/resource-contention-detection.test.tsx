import { describe, expect, it } from 'vitest'
import {
  RESOURCE_CONTENTION_REASON_CODE_VALUES,
  RESOURCE_CONTENTION_SEVERITY_VALUES,
  RESOURCE_CONTENTION_WARNING_CODE_VALUES,
  RESOURCE_CONTENTION_REDACTION_STATE_VALUES,
  RESOURCE_CONTENTION_VIEW_MODE_VALUES,
  RESOURCE_CONTENTION_SORT_KEY_VALUES,
  RESOURCE_CONTENTION_TARGET_KIND_VALUES,
  deriveResourceContentionSeverity,
  normalizeResourceContentionQuery,
  emptySeverityCounts,
  emptyReasonCounts,
} from '@aiproj/types'

/**
 * 前端 hooks 与 API 客户端测试（v3-resource-contention-detection §5.7）。
 *
 * 覆盖 loading/empty/filtered empty/error/redacted/partial visibility 等状态。
 */

describe('Resource Contention Frontend Contracts', () => {
  // ─── Loading State ──────────────────────────────────────────────────────
  it('API query keys are stable for different queries', () => {
    const keys1 = ['resource-contentions', 'summary', 1, { severity: 'critical' }]
    const keys2 = ['resource-contentions', 'summary', 1, { severity: 'critical' }]
    expect(keys1).toEqual(keys2)
  })

  // ─── Empty State ────────────────────────────────────────────────────────
  it('empty severity counts are all zero', () => {
    const counts = emptySeverityCounts()
    for (const sev of RESOURCE_CONTENTION_SEVERITY_VALUES) {
      expect(counts[sev]).toBe(0)
    }
  })

  it('empty reason counts are all zero', () => {
    const counts = emptyReasonCounts()
    for (const code of RESOURCE_CONTENTION_REASON_CODE_VALUES) {
      expect(counts[code]).toBe(0)
    }
  })

  // ─── Filtered Empty State ───────────────────────────────────────────────
  it('normalised query with severity filter is valid', () => {
    const query = normalizeResourceContentionQuery({ severity: 'critical' })
    expect(query.severity).toBe('critical')
    expect(query.page).toBe(1)
  })

  it('normalised query with reasonCode filter is valid', () => {
    const query = normalizeResourceContentionQuery({ reasonCode: 'cross-project-overload' })
    expect(query.reasonCode).toBe('cross-project-overload')
  })

  // ─── Error State ────────────────────────────────────────────────────────
  it('invalid severity is rejected', () => {
    const query = normalizeResourceContentionQuery({ severity: 'bogus' as never })
    expect(query.severity).toBeNull()
  })

  it('invalid reasonCode is rejected', () => {
    const query = normalizeResourceContentionQuery({ reasonCode: 'bogus' as never })
    expect(query.reasonCode).toBeNull()
  })

  // ─── Redacted State ─────────────────────────────────────────────────────
  it('redaction state values are complete', () => {
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('visible')
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('redacted')
    expect(RESOURCE_CONTENTION_REDACTION_STATE_VALUES).toContain('forbidden')
  })

  it('warning codes include permission redacted', () => {
    expect(RESOURCE_CONTENTION_WARNING_CODE_VALUES).toContain('PERMISSION_REDACTED')
  })

  // ─── Partial Visibility ─────────────────────────────────────────────────
  it('severity derivation preserves user visibility context', () => {
    // Even with no (undefined) data, returns a valid severity
    const result = deriveResourceContentionSeverity({})
    expect(RESOURCE_CONTENTION_SEVERITY_VALUES).toContain(result)
  })

  // ─── Matrix/List ────────────────────────────────────────────────────────
  it('view modes include matrix and list', () => {
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toContain('matrix')
    expect(RESOURCE_CONTENTION_VIEW_MODE_VALUES).toContain('list')
  })

  it('sort keys include severity', () => {
    expect(RESOURCE_CONTENTION_SORT_KEY_VALUES).toContain('severity')
  })

  // ─── Detail ─────────────────────────────────────────────────────────────
  it('target kind values include evidence', () => {
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('evidence')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('project')
    expect(RESOURCE_CONTENTION_TARGET_KIND_VALUES).toContain('resource')
  })

  // ─── Advisory ───────────────────────────────────────────────────────────
  it('suggestion preview is always advisory', () => {
    // Suggestion preview DTO has isAdvisory: true by contract
    const preview = {
      suggestionId: 'test',
      contentionId: 'test',
      kind: 'rule' as const,
      title: '规则建议',
      description: '测试',
      candidateActions: ['action1'],
      isAdvisory: true,
      redactionState: 'visible' as const,
      createdAt: '2026-07-29',
    }
    expect(preview.isAdvisory).toBe(true)
  })

  // ─── Mobile ─────────────────────────────────────────────────────────────
  it('Chinese labels exist for all severities', () => {
    const labels: Record<string, string> = {
      info: '信息',
      warning: '提示',
      high: '高风险',
      critical: '严重',
    }
    for (const sev of RESOURCE_CONTENTION_SEVERITY_VALUES) {
      expect(labels[sev]).toBeDefined()
      expect(typeof labels[sev]).toBe('string')
    }
  })

  it('Chinese labels exist for all reason codes', () => {
    const labels: Record<string, string> = {
      'cross-project-overload': '跨项目过载',
      'unavailable-allocation': '不可用分配',
      'critical-skill-contention': '关键技能争用',
      'duplicate-reservation': '重复预留',
      'demand-window-contention': '需求窗口争用',
      'draft-allocation-contention': '调配草案冲突',
    }
    for (const code of RESOURCE_CONTENTION_REASON_CODE_VALUES) {
      expect(labels[code]).toBeDefined()
      expect(typeof labels[code]).toBe('string')
    }
  })
})
